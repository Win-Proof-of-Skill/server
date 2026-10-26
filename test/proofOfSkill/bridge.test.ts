import { bridgeConfiguration, parseBridgeSettings, WIN_BSC_TOKEN } from '../../src/config/bridgeConfig'
import { bridgeStatus } from '../../src/api/bridge'
import { networkAccount } from '../../src/config'

const localId = 'e7275795b34dabb07eee283f565249fe45cd667f5b3cb4d5df3c87973dc981d4'
const otherId = 'b'.repeat(64)
const deployment = (patch = {}) => ({
  tssAddress: '0x' + 'a'.repeat(40), vaultAddress: '0x' + 'b'.repeat(40),
  reserveCapWin: '100', observerUrls: ['http://127.0.0.1:8101'], ...patch,
})
const settings = (patch = {}) => parseBridgeSettings({ schemaVersion: 1, deployments: { [localId]: deployment(patch) } })

test('the selected local reserve limit is 100 WIN; neither funding nor bridge activation is implied', () => {
  const config = bridgeConfiguration(localId)
  expect(config.reserveCapAtomic).toBe('100000000000000000000')
  expect(config.allocationAppliedByConfiguration).toBe(false)
  expect(config.reserveCapEnforced).toBe(false)
  expect(config.enabled).toBe(false)
  expect(config.reserveAddress).toBeNull()
  expect(config.referenceToken).toEqual(WIN_BSC_TOKEN)
  expect(bridgeConfiguration(otherId).reserveCapAtomic).toBeNull()
})

test('reserve addresses use the TSS EVM identity and amounts retain all 18 decimals', () => {
  const config = bridgeConfiguration(localId, settings({ reserveCapWin: '100.000000000000000001' }))
  expect(config.reserveAddress).toBe('a'.repeat(40) + '0'.repeat(24))
  expect(config.reserveCapAtomic).toBe('100000000000000000001')
  for (const reserveCapWin of [100, '0', '-1', '1e2', '1000000001', '0.0000000000000000001']) {
    expect(() => settings({ reserveCapWin })).toThrow()
  }
})

test('bridge custody cannot use protected accounts, the token contract, or the same vault/TSS address', () => {
  for (const address of [...Array.from({ length: 6 }, (_, n) => '0x' + n + '0'.repeat(39)), WIN_BSC_TOKEN.address, 'invalid']) {
    expect(() => settings({ tssAddress: address })).toThrow()
    expect(() => settings({ vaultAddress: address })).toThrow()
  }
  expect(() => settings({ vaultAddress: deployment().tssAddress })).toThrow()
})

test('reject unknown config fields, unbound deployments and observer credentials', () => {
  expect(() => settings({ enabled: true })).toThrow()
  expect(() => settings({ privateKey: 'do-not-publish' })).toThrow()
  expect(() => parseBridgeSettings({ schemaVersion: 1, deployments: { invalid: deployment() } })).toThrow()
  for (const observerUrls of [['https://user:secret@example.com'], ['http://example.com'], ['file:///tmp/observer'],
    ['https://example.com?key=secret'], ['https://example.com', 'https://example.com/']]) {
    expect(() => settings({ observerUrls })).toThrow()
  }
})

async function statusFixture(reserve = null, configured = bridgeConfiguration(localId, settings()), networkId = localId) {
  const reads = []
  const dapp: any = {
    async getLocalOrRemoteAccount(id) {
      reads.push(id)
      return id === networkAccount ? { data: { networkId } } : reserve ? { data: reserve } : null
    },
    log: jest.fn(),
  }
  const response: any = { code: 200, body: null, status(code) { this.code = code; return this }, json(body) { this.body = body } }
  await bridgeStatus(dapp, configured)({}, response)
  return { ...response, reads }
}

test('status never creates or funds a missing reserve, even when a limit is configured', async () => {
  const result = await statusFixture()
  expect(result.code).toBe(200)
  expect(result.body.reserve).toEqual({ accountExists: false, balanceAtomic: null, transferNonce: null, withinConfiguredCap: null })
  expect(result.body.missing).toContain('funded_native_reserve')
  expect(result.body.operational).toBe(false)
  expect(result.reads).toHaveLength(2)
})

test('diagnostics show actual reserve balances independently of its cap without claiming operational readiness', async () => {
  const reserve = { id: 'a'.repeat(40) + '0'.repeat(24), type: 'UserAccount', private: false, data: { balance: 7n * 10n ** 18n, transferNonce: 3 } }
  const before = { ...reserve.data }
  const result = await statusFixture(reserve)
  expect(result.body.reserve.balanceAtomic).toBe('7000000000000000000')
  expect(result.body.reserve.withinConfiguredCap).toBe(true)
  expect(result.body.reserve.transferNonce).toBe(3)
  expect(result.body.enabled).toBe(false)
  expect(result.body.operational).toBe(false)
  expect(reserve.data).toEqual(before)
  reserve.data.balance = 101n * 10n ** 18n
  expect((await statusFixture(reserve)).body.reserve.withinConfiguredCap).toBe(false)
})

test('refuse misleading status from a different network or unsuitable reserve', async () => {
  const wrongNetwork = await statusFixture(null, bridgeConfiguration(localId, settings()), otherId)
  expect(wrongNetwork.code).toBe(503)
  expect(wrongNetwork.reads).toEqual([networkAccount])
  expect((await statusFixture({ type: 'ProfilesAccount' } as any)).code).toBe(503)
  expect((await statusFixture({ id: 'a'.repeat(40) + '0'.repeat(24), type: 'UserAccount', private: true, data: { balance: 1n } } as any)).code).toBe(503)
})
