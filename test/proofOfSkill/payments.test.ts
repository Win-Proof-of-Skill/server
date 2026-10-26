import { Utils } from '@shardus/lib-types'
import * as transfer from '../../src/transactions/transfer'
import * as create from '../../src/transactions/create'
import * as crypto from '../../src/crypto'
import * as utils from '../../src/utils'
import { userAccount } from '../../src/accounts/userAccount'
import { chatAccount } from '../../src/accounts/chatAccount'
import { deserializeAccounts, serializeAccounts } from '../../src/accounts'
import { Tx, TXTypes, WrappedStates } from '../../src/@types'
import { formulas } from '../../src/config/formulas'
import { WIN_NETWORK_ID, profilesAddress, contractsAddress, endorsementsAddress, scoresAddress, skillsAddress } from '../../src/config'

const from = 'a'.repeat(64),
  to = 'b'.repeat(64)
const now = Date.UTC(2026, 9, 25)
const response = () => ({ success: false, reason: '' })
const dapp: any = {
  applyResponseAddReceiptData: (result, receipt) => {
    result.receipt = receipt
  },
  log: () => undefined,
}
const tx = (): Tx.Transfer => ({
  type: TXTypes.transfer,
  from,
  to,
  amount: 123456789012345678901234n,
  fee: formulas.transferFee,
  nonce: 1,
  chatId: utils.calculateChatId(from, to),
  timestamp: now,
  networkId: WIN_NETWORK_ID,
  sign: { owner: from, sig: 'test' },
})
function states(transaction = tx()): WrappedStates {
  const sender = userAccount(from, now),
    recipient = userAccount(to, now),
    chat = chatAccount(transaction.chatId, transaction)
  sender.data.balance = transaction.amount + transaction.fee
  return Object.fromEntries(
    [sender, recipient, chat].map((account) => [account.id, { accountId: account.id, data: account, timestamp: 0, stateId: account.hash }]),
  ) as unknown as WrappedStates
}
beforeEach(() => {
  jest.spyOn(crypto, 'verifyObj').mockReturnValue(true)
  jest.spyOn(utils, 'maintenanceAmount').mockReturnValue(0n)
})
afterEach(() => jest.restoreAllMocks())
test('new wallets start at zero and public create cannot mint', () => {
  expect(userAccount(from, now).data.balance).toBe(0n)
  expect(create.validate_fields({} as any, response()).success).toBe(false)
  expect(() => create.apply()).toThrow('disabled')
})
test.each([profilesAddress, contractsAddress, endorsementsAddress, scoresAddress, skillsAddress])('protects reserved wallet %s', (address) => {
  expect(() => userAccount(address, now)).toThrow('protected')
  expect(transfer.validate_fields({ ...tx(), to: address }, response()).success).toBe(false)
})
test('exact atomic transfer debits once, credits the recipient, and consumes the nonce', () => {
  const transaction = tx(),
    wrapped = states(transaction),
    result: any = {}
  expect(transfer.validate_fields(transaction, response()).success).toBe(true)
  expect(transfer.validate(transaction, wrapped, response(), dapp).success).toBe(true)
  transfer.apply(transaction, now, 'tx-id', wrapped, dapp, result)
  expect(wrapped[from].data.data.balance).toBe(0n)
  expect(wrapped[to].data.data.balance).toBe(transaction.amount)
  expect(wrapped[from].data.data.transferNonce).toBe(1)
  expect(result.receipt.transactionFee).toBe(formulas.transferFee)
  expect(result.receipt.networkId).toBe(WIN_NETWORK_ID)
  expect(deserializeAccounts(serializeAccounts(wrapped[from].data).getBuffer())).toEqual(wrapped[from].data)
})
test('replayed and out-of-sequence payments cannot move funds or charge failure fees', () => {
  const transaction = tx(),
    wrapped = states(transaction)
  transfer.apply(transaction, now, 'tx-id', wrapped, dapp, {} as any)
  const before = Utils.safeStringify(wrapped)
  expect(transfer.validate(transaction, wrapped, response(), dapp).success).toBe(false)
  expect(() => transfer.apply(transaction, now, 'again', wrapped, dapp, {} as any)).toThrow('nonce')
  transfer.createFailedAppReceiptData(transaction, now, 'again', wrapped, dapp, {} as any, 'replay')
  expect(Utils.safeStringify(wrapped)).toBe(before)
  expect(transfer.validate({ ...transaction, nonce: 3 }, wrapped, response(), dapp).success).toBe(false)
})
test('invalid amounts, nonces, fee quotes, and signatures are rejected', () => {
  for (const patch of [{ amount: 0n }, { amount: 1 }, { nonce: 0 }, { nonce: 1.5 }, { nonce: Number.MAX_SAFE_INTEGER + 1 }, { fee: 0n }, { fee: undefined }]) {
    expect(transfer.validate_fields({ ...tx(), ...patch } as any, response()).success).toBe(false)
  }
  jest.spyOn(crypto, 'verifyObj').mockReturnValue(false)
  expect(transfer.validate_fields(tx(), response()).success).toBe(false)
})
test('legacy wallets without a nonce start at zero, and a missing recipient starts unfunded', () => {
  const transaction = tx(),
    wrapped = states(transaction)
  delete wrapped[from].data.data.transferNonce
  expect(transfer.validate(transaction, wrapped, response(), dapp).success).toBe(true)
  const wrapper: any = { createWrappedResponse: (_id, _created, _hash, _time, account) => account }
  expect((transfer.createRelevantAccount(wrapper, null, to, transaction) as any).data.balance).toBe(0n)
})
test('payment signing domain is the new WIN application network', () => {
  const core: any = { getLatestCycles: () => [{ networkId: 'different-core-cycle-id' }] }
  expect(utils.isValidNetworkId(tx(), core)).toBe(true)
  expect(utils.isValidNetworkId({ ...tx(), networkId: '0'.repeat(64) }, core)).toBe(false)
})
