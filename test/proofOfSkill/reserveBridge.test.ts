import { Wallet } from 'ethers'
import * as handler from '../../src/transactions/bridge'
import * as config from '../../src/config/reserveBridge'
import { WIN_NETWORK_ID } from '../../src/config'
import { formulas, transferFee } from '../../src/config/formulas'
import { userAccount } from '../../src/accounts/userAccount'
import { serializeAccounts, deserializeAccounts } from '../../src/accounts'
import * as crypto from '../../src/crypto'
import { Utils } from '@shardus/lib-types'

const unit = 10n ** 18n
const operators = [1, 2, 3].map((i) => new Wallet(i.toString(16).padStart(64, '0')))
const from = operators[0].address.toLowerCase().slice(2) + '0'.repeat(24)
const c = {
  configured: true,
  enabled: true,
  accounting: 'deposit-backed-v1',
  networkId: WIN_NETWORK_ID,
  vaultAddress: '0x' + 'a'.repeat(40),
  operators: operators.map((w) => w.address.toLowerCase()),
  referenceToken: { address: '0x' + 'b'.repeat(40) },
}
const now = Date.now()
const response = () => ({ success: false, reason: '' })
const dapp: any = {
  createWrappedResponse: (id, _created, _hash, _ts, data) => ({ accountId: id, data }),
  applyResponseAddReceiptData: (result, receipt) => {
    result.receipt = receipt
  },
}
function tx(type = 'bridge_deposit', amount = 100n * unit, nonce = 1, event = 'c'): any {
  return {
    type,
    from,
    to: config.bridgeReserveAddress,
    networkId: WIN_NETWORK_ID,
    timestamp: now,
    amount,
    fee: transferFee(amount),
    nonce,
    id: event.repeat(64),
    sign: { owner: from, sig: 'synthetic' },
  }
}
async function signed(t: any, wallets = operators.slice(0, 2), domain = config.bridgeDomain(WIN_NETWORK_ID, c.vaultAddress)) {
  t.signatures = await Promise.all(
    wallets.map((w) => w.signTypedData(domain, config.depositTypes, { id: '0x' + t.id, recipient: '0x' + t.from, amount: t.amount })),
  )
  return t
}
function states(t: any, existing: any = {}) {
  const s = { ...existing }
  for (const id of handler.keys(t, {}).allKeys) if (!s[id]) s[id] = handler.createRelevantAccount(dapp, null, id, t)
  return s
}
function unchanged(t, s, reason?) {
  const original = Utils.safeStringify(s)
  const result = handler.validate(t, s, response())
  expect(result.success).toBe(false)
  if (reason) expect(result.reason).toMatch(reason)
  expect(() => handler.apply(t, now, 'invalid', s, dapp, {} as any)).toThrow()
  expect(Utils.safeStringify(s)).toBe(original)
}
beforeEach(() => {
  jest.spyOn(config, 'reserveBridge').mockReturnValue(c)
  jest.spyOn(crypto, 'verifyObj').mockReturnValue(true)
})
afterEach(() => jest.restoreAllMocks())

test('first deposit issues exactly its backing from zero native supply; withdrawal burns principal and preserves fee backing', async () => {
  const deposit = await signed(tx()),
    s = states(deposit),
    receipt: any = {}
  expect(s[from].data.data.balance).toBe(0n)
  expect(handler.validate(deposit, s, response()).success).toBe(true)
  handler.apply(deposit, now, 'deposit-tx', s, dapp, receipt)
  const ledger = s[config.bridgeReserveAddress].data
  expect(ledger.minted).toBe(100n * unit)
  expect(ledger.burned).toBe(0n)
  expect(s[from].data.data.balance).toBe((995n * unit) / 10n)
  expect(s[formulas.feeRecipient].data.data.balance).toBe(unit / 2n)
  expect(receipt.receipt.additionalInfo).toMatchObject({ accounting: c.accounting, nativeMinted: 100n * unit, nativeBurned: 0n })
  unchanged(deposit, s)
  const withdrawal = { ...tx('bridge_withdraw', 99n * unit, 2), recipient: operators[0].address.toLowerCase() }
  const next = states(withdrawal, s),
    result: any = {}
  handler.apply(withdrawal, now, 'withdraw-tx', next, dapp, result)
  expect(ledger.minted - ledger.burned).toBe(unit)
  expect(ledger.burned).toBe(99n * unit)
  expect(next[formulas.feeRecipient].data.data.balance).toBe((995n * unit) / 1000n)
  expect(next[from].data.data.balance + next[formulas.feeRecipient].data.data.balance).toBe(unit)
  expect(result.receipt.additionalInfo).toMatchObject({ accounting: c.accounting, nativeMinted: 0n, nativeBurned: 99n * unit })
  unchanged({ ...withdrawal, nonce: 3 }, next, /consumed/)
  for (const wrapped of Object.values(next) as any[]) expect(deserializeAccounts(serializeAccounts(wrapped.data).getBuffer())).toEqual(wrapped.data)
  unchanged({ ...deposit, nonce: 3 }, next, /consumed/)
})
test('invalid quorum, amount, destination, signature, fee, network, nonce and domain never issue or change balances', async () => {
  const t = await signed(tx()),
    s = states(t)
  for (const patch of [
    { signatures: [] },
    { signatures: [t.signatures[0], t.signatures[0]] },
    { amount: t.amount + 1n },
    { fee: 0n },
    { from: 'd'.repeat(64) },
    { networkId: 'e'.repeat(64) },
    { to: from },
    { nonce: 2 },
    { type: 'bridge_fund', fee: 0n },
    { extra: 'not allowed' },
  ])
    unchanged({ ...t, ...patch }, s)
  unchanged(await signed(tx(), [operators[0], new Wallet('4'.padStart(64, '0'))]), s)
  unchanged(await signed(tx(), operators.slice(0, 2), config.bridgeDomain('e'.repeat(64), c.vaultAddress)), s)
  unchanged(await signed(tx(), operators.slice(0, 2), config.bridgeDomain(WIN_NETWORK_ID, '0x' + 'f'.repeat(40))), s)
  jest.spyOn(crypto, 'verifyObj').mockReturnValue(false)
  unchanged(t, s, /signature/)
})
test('configuration and retired funding cannot allocate coins; disabled deposits and withdrawals fail closed', async () => {
  const t = await signed(tx()),
    s = states(t)
  expect(s[config.bridgeReserveAddress].data.minted).toBe(0n)
  unchanged({ ...tx('bridge_fund'), fee: 0n }, s, /funding.*retired/i)
  jest.spyOn(config, 'reserveBridge').mockReturnValue({ ...c, enabled: false })
  unchanged(t, s, /not enabled/)
  unchanged({ ...tx('bridge_withdraw'), recipient: operators[0].address.toLowerCase() }, s, /not enabled/)
})
test('withdrawals require native balance including fee and cannot burn more than outstanding backed issuance', async () => {
  const t = { ...tx('bridge_withdraw'), recipient: operators[0].address.toLowerCase() },
    wallet = userAccount(from, now)
  wallet.data.balance = t.amount + t.fee
  const s = states(t, { [from]: { data: wallet } })
  unchanged(t, s, /backing/)
  s[config.bridgeReserveAddress].data.minted = t.amount
  wallet.data.balance = t.amount
  unchanged(t, s, /including fee/)
})
test('only a provably unused legacy reserve can initialize deposit-backed accounting', async () => {
  const t = await signed(tx()),
    s = states(t)
  const empty = { id: config.bridgeReserveAddress, type: 'BridgeReserve', hash: '', timestamp: 0, balance: 0n, funded: 0n }
  s[config.bridgeReserveAddress].data = { ...empty, funded: 1n }
  unchanged(t, s, /legacy/i)
  s[config.bridgeReserveAddress].data = { ...empty, balance: 1n }
  unchanged(t, s, /legacy/i)
  s[config.bridgeReserveAddress].data = { ...empty, timestamp: now }
  unchanged(t, s, /legacy/i)
  s[config.bridgeReserveAddress].data = empty
  handler.apply(t, now, 'first', s, dapp, {} as any)
  expect(s[config.bridgeReserveAddress].data).toMatchObject({ accounting: c.accounting, minted: t.amount, burned: 0n, vaultAddress: c.vaultAddress })
})
test('corrupt or cross-deployment supply ledgers are rejected without mutations', async () => {
  const t = await signed(tx()),
    s = states(t),
    original = { ...s[config.bridgeReserveAddress].data }
  for (const patch of [
    { minted: -1n },
    { burned: 1n },
    { burned: '0' },
    { accounting: 'other' },
    { networkId: 'e'.repeat(64) },
    { vaultAddress: '0x' + 'f'.repeat(40) },
    { balance: 1n },
    { funded: 1n },
  ]) {
    s[config.bridgeReserveAddress].data = { ...original, ...patch }
    unchanged(t, s)
  }
})
test('fee recipient as depositor or withdrawer does not double-count issuance or burns', async () => {
  const t = await signed({ ...tx(), from: formulas.feeRecipient, sign: { owner: formulas.feeRecipient, sig: 'synthetic' } })
  const s = states(t)
  handler.apply(t, now, 'fee-deposit', s, dapp, {} as any)
  expect(s[formulas.feeRecipient].data.data.balance).toBe(t.amount)
  const w = { ...tx('bridge_withdraw', 99n * unit, 2), from: formulas.feeRecipient, sign: t.sign, recipient: operators[0].address.toLowerCase() }
  const next = states(w, s)
  handler.apply(w, now, 'fee-withdraw', next, dapp, {} as any)
  expect(next[formulas.feeRecipient].data.data.balance).toBe(unit)
  expect(next[config.bridgeReserveAddress].data.minted - next[config.bridgeReserveAddress].data.burned).toBe(unit)
})
test('rounding stays exact and a deposit must exceed its fee', async () => {
  expect(transferFee(1n)).toBe(1n)
  expect(transferFee(201n)).toBe(2n)
  const t = await signed(tx('bridge_deposit', 1n)),
    s = states(t)
  unchanged(t, s, /exceed/)
  const valid = await signed(tx('bridge_deposit', 201n))
  handler.apply(valid, now, 'tiny', s, dapp, {} as any)
  expect(s[from].data.data.balance).toBe(199n)
  expect(s[formulas.feeRecipient].data.data.balance).toBe(2n)
})
