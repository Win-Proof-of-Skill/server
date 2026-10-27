import { Shardus, ShardusTypes } from '@shardus/core'
import { Utils } from '@shardus/lib-types'
import { WIN_NETWORK_ID, isProtectedAddress } from '../config'
import { bridgeReserveAddress, bridgeTypes, reserveBridge, bridgeAccounting } from '../config/reserveBridge'
import { formulas } from '../config/formulas'
import { bridgeQuote, bridgeRecord, verifyDeposit, bridgeSupply } from '../domain/reserveBridge'
import { userAccount } from '../accounts/userAccount'
import * as crypto from '../crypto'

const id = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) && !/^0+$/.test(v)
export const configuration = () => reserveBridge(WIN_NETWORK_ID)
export function validate_fields(tx: any, response: any): any {
  response.success = false
  try {
    if (tx.type === 'bridge_fund') throw new Error('Native reserve funding is retired; deposit BNB WIN through the vault')
    const config = configuration()
    if (!config.configured || !config.enabled || config.accounting !== bridgeAccounting) throw new Error('Bridge is not enabled')
    const common = ['type', 'from', 'to', 'networkId', 'timestamp', 'fee', 'amount', 'nonce', 'id', 'sign']
    const allowed = tx.type === 'bridge_deposit' ? [...common, 'signatures'] : tx.type === 'bridge_withdraw' ? [...common, 'recipient'] : common
    if (Object.keys(tx).some((k) => !allowed.includes(k)) || Buffer.byteLength(Utils.safeStringify(tx)) > 8192)
      throw new Error('Invalid bridge transaction shape')
    if (
      !bridgeTypes.includes(tx.type) ||
      tx.networkId !== WIN_NETWORK_ID ||
      !id(tx.from) ||
      isProtectedAddress(tx.from) ||
      tx.to !== bridgeReserveAddress ||
      !id(tx.id)
    )
      throw new Error('Invalid bridge network or addresses')
    if (!Number.isSafeInteger(tx.timestamp) || tx.timestamp <= 0 || !Number.isSafeInteger(tx.nonce) || tx.nonce < 1)
      throw new Error('Invalid bridge timestamp or nonce')
    const quote = bridgeQuote(tx.amount, tx.type)
    if (tx.fee !== quote.fee) throw new Error('Bridge fee must be exactly 0.5%')
    if (tx.sign?.owner !== tx.from || !crypto.verifyObj(tx)) throw new Error('Invalid bridge owner signature')
    if (tx.type === 'bridge_deposit') verifyDeposit(tx, config)
    if (
      tx.type === 'bridge_withdraw' &&
      (!/^0x[a-f0-9]{40}$/.test(tx.recipient) ||
        /^0x[0-6]0{39}$/.test(tx.recipient) ||
        [config.vaultAddress, config.referenceToken.address].includes(tx.recipient))
    )
      throw new Error('Invalid BNB recipient')
    response.success = true
  } catch (error) {
    response.reason = error.message
  }
  return response
}
function checked(tx: any, states: any): any {
  const fields = validate_fields(tx, { success: false })
  if (!fields.success) throw new Error(fields.reason)
  const config = configuration(),
    sender = states[tx.from]?.data,
    reserve = states[bridgeReserveAddress]?.data,
    collector = states[formulas.feeRecipient]?.data
  for (const [account, expected] of [
    [sender, tx.from],
    [collector, formulas.feeRecipient],
  ]) {
    if (
      account?.id !== expected ||
      account.type !== 'UserAccount' ||
      account.private === true ||
      typeof account.data.balance !== 'bigint' ||
      account.data.balance < 0n
    )
      throw new Error('Valid public wallet required')
  }
  if (!reserve) throw new Error('Missing bridge supply ledger')
  const supply = bridgeSupply(reserve, config)
  if (tx.nonce !== (sender.data.transferNonce ?? 0) + 1) throw new Error('Bridge payment nonce is out of sequence')
  const recordId = bridgeRecord(tx, config),
    record = states[recordId]?.data
  if (record?.type !== 'BridgeRecord' || record.id !== recordId || record.completed) throw new Error('Bridge event already consumed or invalid')
  const quote = bridgeQuote(tx.amount, tx.type)
  if (tx.type === 'bridge_withdraw') {
    if (sender.data.balance < tx.amount + tx.fee) throw new Error('Insufficient native WIN including fee')
    if (supply.minted - supply.burned < tx.amount) throw new Error('Insufficient outstanding BNB backing')
  }
  return { config, sender, reserve, collector, recordId, quote, supply }
}
export function validate(tx: any, states: any, response: any): any {
  response.success = false
  try {
    checked(tx, states)
    response.success = true
  } catch (error) {
    response.reason = error.message
  }
  return response
}
export function apply(tx: any, now: number, txId: string, states: any, dapp: Shardus, response: ShardusTypes.ApplyResponse): void {
  const { sender, reserve, collector, recordId, quote, config, supply } = checked(tx, states)
  const nativeMinted = tx.type === 'bridge_deposit' ? tx.amount : 0n
  const nativeBurned = tx.type === 'bridge_withdraw' ? tx.amount : 0n
  Object.assign(reserve, {
    accounting: bridgeAccounting,
    networkId: config.networkId,
    vaultAddress: config.vaultAddress,
    minted: supply.minted + nativeMinted,
    burned: supply.burned + nativeBurned,
  })
  delete reserve.balance
  delete reserve.funded
  if (tx.type === 'bridge_deposit') sender.data.balance += quote.receive
  else sender.data.balance -= tx.amount + tx.fee
  collector.data.balance += tx.fee
  sender.data.transferNonce = tx.nonce
  for (const account of [sender, reserve, collector]) account.timestamp = now
  states[recordId].data = {
    id: recordId,
    type: 'BridgeRecord',
    hash: '',
    timestamp: now,
    completed: true,
    accounting: bridgeAccounting,
    nativeMinted,
    nativeBurned,
    networkId: tx.networkId,
    vaultAddress: config.vaultAddress,
    operation: tx.type,
    eventId: tx.id,
    from: tx.from,
    recipient: tx.recipient || tx.from,
    amount: tx.amount,
    fee: tx.fee,
    txId,
  }
  const receipt: any = {
    networkId: tx.networkId,
    txId,
    timestamp: now,
    type: tx.type,
    from: tx.from,
    to: tx.to,
    transactionFee: tx.fee,
    success: true,
    additionalInfo: { bridgeId: tx.id, recordId, amount: tx.amount, accounting: bridgeAccounting, nativeMinted, nativeBurned },
  }
  dapp.applyResponseAddReceiptData(response, receipt, crypto.hashObj(receipt))
}
export function createFailedAppReceiptData(tx: any, now: number, txId: string, _states: any, dapp: Shardus, response: any, reason: string): void {
  const receipt: any = { networkId: tx.networkId, txId, timestamp: now, type: tx.type, from: tx.from, to: tx.to, transactionFee: 0n, success: false, reason }
  dapp.applyResponseAddReceiptData(response, receipt, crypto.hashObj(receipt))
}
export function keys(tx: any, result: any): any {
  const config = configuration()
  result.sourceKeys = [tx.from]
  result.targetKeys = [...new Set([bridgeReserveAddress, formulas.feeRecipient, bridgeRecord(tx, config)])].filter((k) => k !== tx.from)
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}
export function memoryPattern(tx: any): any {
  return { rw: keys(tx, {}).allKeys, ro: [], wo: [], on: [], ri: [] }
}
export function createRelevantAccount(dapp: Shardus, account: any, accountId: string, tx: any, accountCreated = false): any {
  if (!keys(tx, {}).allKeys.includes(accountId)) throw new Error('Undeclared bridge account')
  if (!account) {
    if (accountId === bridgeReserveAddress)
      account = {
        id: accountId,
        type: 'BridgeReserve',
        hash: '',
        timestamp: 0,
        accounting: bridgeAccounting,
        networkId: WIN_NETWORK_ID,
        vaultAddress: configuration().vaultAddress,
        minted: 0n,
        burned: 0n,
      }
    else if (accountId === tx.from || accountId === formulas.feeRecipient) {
      if (accountId === tx.from && tx.type !== 'bridge_deposit') throw new Error('Sender must exist')
      account = userAccount(accountId, tx.timestamp)
    } else account = { id: accountId, type: 'BridgeRecord', hash: '', timestamp: 0, completed: false }
    account.hash = crypto.hashObj(account)
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
