import { getAddress, parseUnits } from 'ethers'
import settings from './bridge.json'

export interface BridgeDeployment {
  tssAddress: string | null
  vaultAddress: string | null
  reserveCapWin: string | null
  observerUrls: string[]
}

// This is the existing asset to integrate, not an active vault deployment.
export const WIN_BSC_TOKEN = Object.freeze({
  chainId: 56,
  address: '0x8a27363dd26f78b09014338e106b16055fcb9799',
  symbol: 'WIN',
  decimals: 18,
})

const idPattern = /^[a-f0-9]{64}$/
const allowedFields = ['tssAddress', 'vaultAddress', 'reserveCapWin', 'observerUrls']

function evmAddress(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`Bridge ${field} must be an EVM address or null`)
  let address: string
  try { address = getAddress(value).toLowerCase() } catch (_) {
    throw new Error(`Bridge ${field} is not a valid EVM address`)
  }
  // Native wallets use the EVM address followed by 24 zeroes. Exclude the
  // network record and all five application registries from bridge custody.
  if (/^0x[0-5]0{39}$/.test(address) || address === WIN_BSC_TOKEN.address) {
    throw new Error(`Bridge ${field} cannot be a system address or the WIN token contract`)
  }
  return address
}

/** Public configuration only. Reading it never creates an account or allocates funds. */
export function parseBridgeSettings(raw: unknown): Record<string, BridgeDeployment> {
  const config = raw as any
  if (!config || config.schemaVersion !== 1 || !config.deployments || typeof config.deployments !== 'object' ||
      Array.isArray(config.deployments) || Object.keys(config).some(key => !['schemaVersion', 'deployments'].includes(key))) {
    throw new Error('Invalid bridge configuration: expected schemaVersion 1 and deployments')
  }
  const deployments: Record<string, BridgeDeployment> = Object.create(null)
  for (const [networkId, value] of Object.entries(config.deployments)) {
    if (!idPattern.test(networkId) || /^0{64}$/.test(networkId)) throw new Error('Bridge deployment requires a WIN application network ID')
    const entry = value as any
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).length !== allowedFields.length || Object.keys(entry).some(key => !allowedFields.includes(key))) {
      throw new Error('Bridge deployment must contain only tssAddress, vaultAddress, reserveCapWin and observerUrls')
    }
    const tssAddress = evmAddress(entry.tssAddress, 'tssAddress')
    const vaultAddress = evmAddress(entry.vaultAddress, 'vaultAddress')
    if (tssAddress && tssAddress === vaultAddress) throw new Error('Bridge vault and TSS addresses must differ')
    if (entry.reserveCapWin !== null) {
      if (typeof entry.reserveCapWin !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(entry.reserveCapWin)) {
        throw new Error('Bridge reserveCapWin must be exact decimal text or null')
      }
      const amount = parseUnits(entry.reserveCapWin, 18)
      if (amount <= 0n || amount > 1_000_000_000n * 10n ** 18n) throw new Error('Bridge reserve cap must be greater than zero and at most 1 billion WIN')
    }
    if (!Array.isArray(entry.observerUrls) || entry.observerUrls.length > 20) throw new Error('Bridge observerUrls must be an array of at most 20 URLs')
    const observerUrls = entry.observerUrls.map(value => {
      if (typeof value !== 'string') throw new Error('Bridge observer URL must be text')
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new Error('Bridge observers require HTTPS, or HTTP on loopback, without credentials, query or fragment')
      }
      return url.toString().replace(/\/$/, '')
    })
    if (new Set(observerUrls).size !== observerUrls.length) throw new Error('Bridge observer URLs must be unique')
    deployments[networkId] = { tssAddress, vaultAddress, reserveCapWin: entry.reserveCapWin, observerUrls }
  }
  return deployments
}

const deployments = parseBridgeSettings(settings)

export function bridgeConfiguration(networkId: string, configured = deployments) {
  const deployment = configured[networkId] || { tssAddress: null, vaultAddress: null, reserveCapWin: null, observerUrls: [] }
  return {
    model: 'liberdus-reserve',
    networkId,
    // No flag can enable a bridge before the vault and observer integration exist.
    enabled: false,
    phase: 'configuration',
    referenceToken: WIN_BSC_TOKEN,
    tssAddress: deployment.tssAddress,
    vaultAddress: deployment.vaultAddress,
    reserveAddress: deployment.tssAddress ? deployment.tssAddress.slice(2) + '0'.repeat(24) : null,
    reserveCapAtomic: deployment.reserveCapWin === null ? null : parseUnits(deployment.reserveCapWin, 18).toString(),
    reserveCapEnforced: false,
    observerUrls: [...deployment.observerUrls],
    allocationAppliedByConfiguration: false,
  }
}
