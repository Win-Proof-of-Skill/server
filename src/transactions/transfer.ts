import * as crypto from '../crypto'
import { formulas } from '../config/formulas'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from '../utils'
import * as config from '../config'
import create from '../accounts'
import { UserAccount, ChatAccount, NetworkAccount, WrappedStates, Tx, AppReceiptData, TollUnit } from '../@types'
import { SafeBigIntMath } from '../utils/safeBigIntMath'
import * as AccountsStorage from '../storage/accountStorage'
import { isUserAccount, isChatAccount } from '../@types/accountTypeGuards'

export const validate_fields = (tx: Tx.Transfer, response: ShardusTypes.IncomingTransactionResult): ShardusTypes.IncomingTransactionResult => {
  if (utils.isValidAddress(tx.from) === false) {
    response.reason = 'tx "from" is not a valid address.'
    return response
  }
  if (utils.isValidAddress(tx.to) === false) {
    response.reason = 'tx "to" is not a valid address.'
    return response
  }
  if ([tx.from, tx.to, tx.chatId].some(config.isProtectedAddress)) {
    response.reason = 'Payments cannot use protected registry addresses'
    return response
  }
  if (!Number.isSafeInteger(tx.nonce) || tx.nonce < 1) {
    response.reason = 'Payment nonce must be a positive safe integer'
    return response
  }
  if (typeof tx.fee !== 'bigint' || tx.fee !== formulas.transferFee) {
    response.reason = `Payment fee must be exactly ${formulas.transferFee} atomic WIN`
    return response
  }
  if (typeof tx.amount !== 'bigint' || tx.amount <= BigInt(0)) {
    response.reason = 'tx "amount" field must be a bigint and greater than 0.'
    return response
  }
  if (utils.isValidAddress(tx.chatId) === false) {
    response.reason = 'tx "chatId" is not a valid address.'
    return response
  }
  if (tx.chatId !== utils.calculateChatId(tx.from, tx.to)) {
    response.reason = 'chatId is not calculated correctly for from and to addresses'
    return response
  }
  if (tx.memo && typeof tx.memo !== 'string') {
    response.reason = 'tx "memo" field must be a string.'
    return response
  }
  if (tx.memo && tx.memo.length > config.WinFlags.transferMemoLimit) {
    response.reason = `tx "memo" size must be less than ${config.WinFlags.transferMemoLimit} characters.`
    return response
  }
  if (config.WinFlags.versionFlags.supportDeductTxFeeFromAmount === true) {
    if (tx.deductTxFeeFromAmount !== undefined && typeof tx.deductTxFeeFromAmount !== 'boolean') {
      response.reason = 'tx "deductTxFeeFromAmount" field must be a boolean.'
      return response
    }
    if (tx.deductTxFeeFromAmount === true) {
      const transactionFee = formulas.transferFee
      if (tx.amount <= transactionFee) {
        response.reason = 'transfer amount must be greater than the transaction fee when deductTxFeeFromAmount is true'
        return response
      }
    }
  }
  if (!tx.sign || !tx.sign.owner || !tx.sign.sig || tx.sign.owner !== tx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
    return response
  }
  response.success = true
  return response
}

export const validate = (
  tx: Tx.Transfer,
  wrappedStates: WrappedStates,
  response: ShardusTypes.IncomingTransactionResult,
  dapp: Shardus,
): ShardusTypes.IncomingTransactionResult => {
  const from: UserAccount = wrappedStates[tx.from] && wrappedStates[tx.from].data
  const to: UserAccount = wrappedStates[tx.to] && wrappedStates[tx.to].data
  const chatAccount: ChatAccount = wrappedStates[tx.chatId] && wrappedStates[tx.chatId].data
  const network = AccountsStorage.cachedNetworkAccount

  if (from === undefined || from === null) {
    response.reason = "from account doesn't exist"
    return response
  }
  if (!isUserAccount(from)) {
    response.reason = 'from account is not a UserAccount'
    return response
  }
  if (to === undefined || to === null) {
    response.reason = "To account doesn't exist"
    return response
  }
  if (!isUserAccount(to)) {
    response.reason = 'to account is not a UserAccount'
    return response
  }
  if (chatAccount && !isChatAccount(chatAccount)) {
    response.reason = 'chatId account is not a ChatAccount'
    return response
  }

  if (tx.nonce !== (from.data.transferNonce ?? 0) + 1) {
    response.reason = 'Payment nonce has already been consumed or is out of sequence'
    return response
  }

  const fromPrivate = from.private || false
  const toPrivate = to.private || false

  if (fromPrivate !== toPrivate) {
    response.reason = 'Both accounts must have the same private value.'
    return response
  }

  const transactionFee = formulas.transferFee
  const deductTxFeeFromAmount =
    config.WinFlags.versionFlags.supportDeductTxFeeFromAmount === true &&
    tx.deductTxFeeFromAmount === true

  if (deductTxFeeFromAmount === false && from.data.balance < tx.amount + transactionFee + utils.maintenanceAmount(tx.timestamp, from, network)) {
    response.reason = "from account doesn't have sufficient balance to cover the transaction"
    return response
  }
  if (deductTxFeeFromAmount === true) {
    if (from.data.balance < tx.amount + utils.maintenanceAmount(tx.timestamp, from, network)) {
      response.reason = "from account doesn't have sufficient balance to cover the transfer amount"
      return response
    }
    if (tx.amount <= transactionFee) {
      response.reason = 'transfer amount must be greater than the transaction fee when deductTxFeeFromAmount is true'
      return response
    }
  }
  // if there is a memo, check if the amount is larger than the Toll required for the chat
  if (config.WinFlags.versionFlags.minTransferAmountCheck) {
    const hasMemo = (tx.memo && tx.memo.length > 0) || (tx.xmemo && tx.xmemo.message && tx.xmemo.message.length > 0)
    console.log('hasMemo', tx, hasMemo)
    let shouldSendMinToll = false
    if (chatAccount == null && hasMemo) {
      // new chat. sender should send at least the toll set by the receiver
      shouldSendMinToll = true
    } else if (chatAccount !== undefined && chatAccount !== null) {
      // chat account exists, check the required toll
      const [address1, address2] = utils.sortAddresses(tx.from, tx.to)
      const receiverIndex = tx.to === address1 ? 0 : 1
      const receiverBlockedSender = chatAccount.toll.required[receiverIndex] === 2

      // if the receiver has blocked the sender, they cannot send messages or coins
      if (receiverBlockedSender) {
        response.reason = 'Receiver has blocked the sender from sending messages or coins.'
        return response
      }

      const receiverDemandsToll = chatAccount.toll.required[receiverIndex] === 1
      if (hasMemo && receiverDemandsToll) {
        // tx has a memo and receiver demands toll, so sender should send at least the minimum amount
        shouldSendMinToll = true
      }
    }
    if (shouldSendMinToll) {
      let tollInWei = to.data.toll
      if (to.data.tollUnit === TollUnit.usd) {
        tollInWei = utils.usdToWei(to.data.toll, network) // legit use cos' we don't store toll in string format
      }
      if (tx.amount < tollInWei) {
        response.reason = `You must send at least ${utils.weiToWin(tollInWei)} WIN to this user.`
        return response
      }
    }
  }
  if (network) {
    if (formulas.transferFee > tx.fee) {
      response.success = false
      response.reason = `The network transaction fee (${utils.getTransactionFeeWei(
        AccountsStorage.cachedNetworkAccount,
      )}) is greater than the transaction fee provided (${tx.fee}).`
      return response
    }
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Transfer,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: UserAccount = wrappedStates[tx.from].data
  const to: UserAccount = wrappedStates[tx.to].data
  const chat: ChatAccount = wrappedStates[tx.chatId].data
  const network = AccountsStorage.cachedNetworkAccount

  if (tx.nonce !== (from.data.transferNonce ?? 0) + 1) throw new Error('Payment nonce mismatch')
  // Consume the nonce atomically with the balance changes.
  from.data.transferNonce = tx.nonce

  // update balances
  const transactionFee = formulas.transferFee
  const maintenanceFee = utils.maintenanceAmount(txTimestamp, from, network)
  const deductTxFeeFromAmount =
    config.WinFlags.versionFlags.supportDeductTxFeeFromAmount === true &&
    tx.deductTxFeeFromAmount === true
  if (deductTxFeeFromAmount === false) {
    from.data.balance = SafeBigIntMath.subtract(from.data.balance, transactionFee)
  }
  from.data.balance = SafeBigIntMath.subtract(from.data.balance, maintenanceFee)
  from.data.balance = SafeBigIntMath.subtract(from.data.balance, tx.amount)
  let amountReceived = tx.amount
  if (deductTxFeeFromAmount === true) {
    amountReceived = SafeBigIntMath.subtract(tx.amount, transactionFee)
  }
  to.data.balance = SafeBigIntMath.add(to.data.balance, amountReceived)

  // store transfer data in chat
  if (!from.data.chats[tx.to]) {
    from.data.chats[tx.to] = {
      receivedTimestamp: 0,
      chatId: tx.chatId,
    }
  }
  to.data.chats[tx.from] = {
    receivedTimestamp: txTimestamp,
    chatId: tx.chatId,
  }
  to.data.chatTimestamp = txTimestamp
  chat.messages.push(tx)

  // update account timestamps
  from.timestamp = txTimestamp
  to.timestamp = txTimestamp
  chat.timestamp = txTimestamp

  const additionalInfo: { amount: bigint; maintenanceFee: bigint } = {
    amount: tx.amount,
    maintenanceFee,
  }
  if (deductTxFeeFromAmount === true) {
    // amount reflects the net amount received by the recipient.
    additionalInfo.amount = amountReceived
  }

  const appReceiptData: AppReceiptData = {
    networkId: tx.networkId,
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.to,
    type: tx.type,
    transactionFee,
    additionalInfo,
  }
  const appReceiptDataHash = crypto.hashObj(appReceiptData)
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, appReceiptDataHash)
  dapp.log('Applied transfer tx', from, to)
}

export const createFailedAppReceiptData = (
  tx: Tx.Transfer,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
  reason: string,
): void => {
  // A rejected payment changes neither balances nor nonce. In particular, replaying
  // an already committed payment must not charge its sender again.
  const transactionFee = 0n

  const appReceiptData: AppReceiptData = {
    networkId: tx.networkId,
    txId,
    timestamp: txTimestamp,
    success: false,
    reason,
    from: tx.from,
    to: tx.to,
    type: tx.type,
    transactionFee,
    additionalInfo: {
      amount: tx.amount,
    },
  }
  const appReceiptDataHash = crypto.hashObj(appReceiptData)
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, appReceiptDataHash)
}

export const keys = (tx: Tx.Transfer, result: ShardusTypes.TransactionKeys): ShardusTypes.TransactionKeys => {
  result.sourceKeys = [tx.chatId, tx.from]
  result.targetKeys = [tx.to]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Transfer, result: ShardusTypes.TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  const memoryPattern: ShardusTypes.ShardusMemoryPatternsInput = {
    rw: [tx.from, tx.to, tx.chatId],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
  return memoryPattern
}
export const createRelevantAccount = (
  dapp: Shardus,
  account: UserAccount | ChatAccount,
  accountId: string,
  tx: Tx.Transfer,
  accountCreated = false,
): ShardusTypes.WrappedResponse => {
  if (!account) {
    if (accountId === tx.chatId) {
      account = create.chatAccount(accountId, tx)
    } else if (accountId === tx.to && accountId !== tx.from) {
      account = create.userAccount(accountId, tx.timestamp)
    } else {
      throw Error('Sender account must exist to send a payment')
    }
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
