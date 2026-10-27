import { reserveBridge, bridgeAccounting, bridgeReserveAddress } from '../../src/config/reserveBridge'
import * as config from '../../src/config/reserveBridge'
import { reserveBridgeStatus, reserveBridgeRecord } from '../../src/api/reserveBridge'
import { WIN_NETWORK_ID, networkAccount } from '../../src/config'
const entry = {
  enabled: false,
  accounting: bridgeAccounting,
  vaultAddress: '0x' + 'a'.repeat(40),
  vaultCodeHash: '0x' + 'b'.repeat(64),
  operators: ['c', 'd', 'e'].map((x) => '0x' + x.repeat(40)),
  observerUrls: ['https://one.example', 'https://two.example', 'https://three.example'],
}
const raw = (change = {}) => ({ schemaVersion: 2, deployments: { [WIN_NETWORK_ID]: { ...entry, ...change } } })
afterEach(() => jest.restoreAllMocks())
test('configuration requires explicit deposit-backed accounting and does not allocate native supply', () => {
  expect(reserveBridge(WIN_NETWORK_ID, raw())).toMatchObject({ configured: true, enabled: false, accounting: bridgeAccounting })
  expect(reserveBridge(WIN_NETWORK_ID, { schemaVersion: 2, deployments: {} }).configured).toBe(false)
  for (const patch of [
    { accounting: undefined },
    { accounting: 'reserve' },
    { reserveCapAtomic: '100' },
    { operators: [entry.operators[0], entry.operators[0], entry.operators[1]] },
    { enabled: 'yes' },
    { observerUrls: ['https://one.example', 'https://one.example/', 'https://three.example'] },
  ])
    expect(() => reserveBridge(WIN_NETWORK_ID, raw(patch))).toThrow()
})
function fixture(account: any = null) {
  const res: any = {
    code: 200,
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  const dapp = { getLocalOrRemoteAccount: async (id) => ({ data: id === networkAccount ? { networkId: WIN_NETWORK_ID } : account }) }
  return { res, dapp }
}
test('status is operational at zero supply without a native reserve; counters reflect pending burns', async () => {
  const c = reserveBridge(WIN_NETWORK_ID, raw({ enabled: true }))
  jest.spyOn(config, 'reserveBridge').mockReturnValue(c)
  const zero = fixture()
  await reserveBridgeStatus(zero.dapp)({}, zero.res)
  expect(zero.res.body).toMatchObject({
    configured: true,
    enabled: true,
    operational: true,
    requiresNativePrefunding: false,
    nativeMinted: '0',
    nativeBurned: '0',
    nativeOutstanding: '0',
    backedWithdrawalCapacity: '0',
    missing: [],
  })
  const used = fixture({
    id: bridgeReserveAddress,
    type: 'BridgeReserve',
    accounting: bridgeAccounting,
    networkId: WIN_NETWORK_ID,
    vaultAddress: entry.vaultAddress,
    minted: 1000n,
    burned: 900n,
  })
  await reserveBridgeStatus(used.dapp)({}, used.res)
  expect(used.res.body.nativeOutstanding).toBe('100')
  expect(used.res.body.backedWithdrawalCapacity).toBe('100')
})
test('status fails closed for a legacy funded reserve or wrong ledger deployment', async () => {
  jest.spyOn(config, 'reserveBridge').mockReturnValue(reserveBridge(WIN_NETWORK_ID, raw({ enabled: true })))
  for (const account of [
    { id: bridgeReserveAddress, type: 'BridgeReserve', balance: 1n, funded: 1n },
    {
      id: bridgeReserveAddress,
      type: 'BridgeReserve',
      accounting: bridgeAccounting,
      networkId: WIN_NETWORK_ID,
      vaultAddress: '0x' + 'f'.repeat(40),
      minted: 0n,
      burned: 0n,
    },
  ]) {
    const f = fixture(account)
    await reserveBridgeStatus(f.dapp)({}, f.res)
    expect(f.res.code).toBe(503)
    expect(f.res.body.operational).toBeUndefined()
  }
})
test('record API exposes decimal issuance and burn amounts for operator and wallet verification', async () => {
  jest.spyOn(config, 'reserveBridge').mockReturnValue(reserveBridge(WIN_NETWORK_ID, raw({ enabled: true })))
  const f = fixture({ type: 'BridgeRecord', completed: true, accounting: bridgeAccounting, amount: 1000n, fee: 5n, nativeMinted: 0n, nativeBurned: 1000n })
  await reserveBridgeRecord(f.dapp)({ params: { kind: 'bridge_withdraw', id: 'c'.repeat(64) } }, f.res)
  expect(f.res.body.record).toMatchObject({ amount: '1000', fee: '5', nativeMinted: '0', nativeBurned: '1000' })
  expect(() => JSON.stringify(f.res.body)).not.toThrow()
})
