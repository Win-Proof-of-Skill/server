import { Wallet } from 'ethers'
import * as handler from '../../src/transactions/bridge'
import * as config from '../../src/config/reserveBridge'
import { WIN_NETWORK_ID } from '../../src/config'
import { formulas, transferFee } from '../../src/config/formulas'
import { userAccount } from '../../src/accounts/userAccount'
import { serializeAccounts, deserializeAccounts } from '../../src/accounts'
import * as crypto from '../../src/crypto'
import { Utils } from '@shardus/lib-types'
const operators = [1, 2, 3].map((i) => new Wallet(i.toString(16).padStart(64, '0')))
const from = operators[0].address.toLowerCase().slice(2) + '0'.repeat(24)
const c = {
  configured: true,
  enabled: true,
  networkId: WIN_NETWORK_ID,
  vaultAddress: '0x' + 'a'.repeat(40),
  operators: operators.map((w) => w.address.toLowerCase()),
  reserveCapAtomic: (10000n * 10n ** 18n).toString(),
  referenceToken: { address: '0x' + 'b'.repeat(40) },
}
const now = Date.now(),
  response = () => ({ success: false, reason: '' }),
  dapp: any = {
    createWrappedResponse: (id, _created, _hash, _ts, data) => ({ accountId: id, data }),
    applyResponseAddReceiptData: (result, receipt) => {
      result.receipt = receipt
    },
  }
function tx(type = 'bridge_deposit', amount = 100n * 10n ** 18n, nonce = 1): any {
  return {
    type,
    from,
    to: config.bridgeReserveAddress,
    networkId: WIN_NETWORK_ID,
    timestamp: now,
    amount,
    fee: type === 'bridge_fund' ? 0n : transferFee(amount),
    nonce,
    id: 'c'.repeat(64),
    sign: { owner: from, sig: 'synthetic' },
  }
}
async function signed(t: any) {
  t.signatures = await Promise.all(
    operators
      .slice(0, 2)
      .map((w) =>
        w.signTypedData(config.bridgeDomain(WIN_NETWORK_ID, c.vaultAddress), config.depositTypes, {
          id: '0x' + t.id,
          recipient: '0x' + t.from,
          amount: t.amount,
        }),
      ),
  )
  return t
}
function states(t: any, existing: any = {}) {
  const s = { ...existing }
  for (const id of handler.keys(t, {}).allKeys) if (!s[id]) s[id] = handler.createRelevantAccount(dapp, null, id, t)
  return s
}
beforeEach(() => {
  jest.spyOn(config, 'reserveBridge').mockReturnValue(c)
  jest.spyOn(crypto, 'verifyObj').mockReturnValue(true)
})
afterEach(() => jest.restoreAllMocks())
test('deposit and withdrawal conserve native balances, route 0.5% fees and persist replay records', async () => {
  const deposit = await signed(tx()),
    s = states(deposit)
  s[config.bridgeReserveAddress].data.balance = 1000n * 10n ** 18n
  s[config.bridgeReserveAddress].data.funded = 1000n * 10n ** 18n
  expect(handler.validate(deposit, s, response()).success).toBe(true)
  const receipt: any = {}
  handler.apply(deposit, now, 'deposit-tx', s, dapp, receipt)
  expect(s[from].data.data.balance).toBe(995n * 10n ** 17n)
  expect(s[formulas.feeRecipient].data.data.balance).toBe(5n * 10n ** 17n)
  const before = Utils.safeStringify(s)
  expect(() => handler.apply(deposit, now, 'replay', s, dapp, {} as any)).toThrow()
  expect(Utils.safeStringify(s)).toBe(before)
  const withdraw = { ...tx('bridge_withdraw', 99n * 10n ** 18n, 2), recipient: operators[0].address.toLowerCase() },
    s2 = states(withdraw, s)
  handler.apply(withdraw, now, 'withdraw-tx', s2, dapp, {} as any)
  expect(s2[config.bridgeReserveAddress].data.balance).toBe(999n * 10n ** 18n)
  expect(s2[formulas.feeRecipient].data.data.balance).toBe(995n * 10n ** 15n)
  expect(s2[from].data.data.balance + s2[formulas.feeRecipient].data.data.balance + s2[config.bridgeReserveAddress].data.balance).toBe(1000n * 10n ** 18n)
  for (const wrapped of Object.values(s2) as any[]) expect(deserializeAccounts(serializeAccounts(wrapped.data).getBuffer())).toEqual(wrapped.data)
})
test('invalid quorum, amount, destination, fee, network and liquidity do not change state', async () => {
  const t = await signed(tx()),
    s = states(t)
  s[config.bridgeReserveAddress].data.balance = t.amount
  s[config.bridgeReserveAddress].data.funded = t.amount
  const original = Utils.safeStringify(s)
  for (const patch of [
    { signatures: [t.signatures[0], t.signatures[0]] },
    { amount: t.amount + 1n },
    { fee: 0n },
    { from: 'd'.repeat(64) },
    { networkId: 'e'.repeat(64) },
    { to: from },
    { nonce: 2 },
  ]) {
    expect(handler.validate({ ...t, ...patch }, s, response()).success).toBe(false)
    expect(() => handler.apply({ ...t, ...patch }, now, 'invalid', s, dapp, {} as any)).toThrow()
    expect(Utils.safeStringify(s)).toBe(original)
  }
  s[config.bridgeReserveAddress].data.balance = 0n
  expect(handler.validate(t, s, response()).reason).toMatch(/liquidity/)
})
test('reserve funding consumes existing native WIN and a nonce; configuration never mints', () => {
  const t = tx('bridge_fund'),
    wallet = userAccount(from, now)
  wallet.data.balance = t.amount
  const s = states(t, { [from]: { data: wallet } })
  expect(s[config.bridgeReserveAddress].data.balance).toBe(0n)
  handler.apply(t, now, 'fund', s, dapp, {} as any)
  expect(wallet.data.balance).toBe(0n)
  expect(s[config.bridgeReserveAddress].data.balance).toBe(t.amount)
  expect(() => handler.apply(t, now, 'again', s, dapp, {} as any)).toThrow(/nonce/)
})
test('one-atomic-unit minimum and rounding', () => {
  expect(transferFee(1n)).toBe(1n)
  expect(transferFee(201n)).toBe(2n)
  expect(transferFee(10000n)).toBe(50n)
})

test('withdrawals cannot reserve more BNB than previously attested deposits', () => {
  const t = { ...tx('bridge_withdraw'), recipient: operators[0].address.toLowerCase() },
    wallet = userAccount(from, now)
  wallet.data.balance = t.amount + t.fee
  const s = states(t, { [from]: { data: wallet } })
  expect(handler.validate(t, s, response()).reason).toMatch(/backing/)
  s[config.bridgeReserveAddress].data.funded = t.amount
  s[config.bridgeReserveAddress].data.balance = t.amount
  expect(handler.validate(t, s, response()).reason).toMatch(/backing/)
})
