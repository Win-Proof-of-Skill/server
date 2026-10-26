import { getAddress } from 'ethers'
import settings from './bridge-v2.json'
import { WIN_BSC_TOKEN } from './bridgeConfig'
import { formulas } from './formulas'

export const bridgeReserveAddress = '6' + '0'.repeat(63)
export const bridgeTypes = ['bridge_deposit', 'bridge_withdraw', 'bridge_fund']
export const bridgeDomain = (networkId: string, vault: string) => ({
  name: 'WINBridge',
  version: '1',
  chainId: 56,
  verifyingContract: vault,
  salt: '0x' + networkId,
})
export const depositTypes = {
  Deposit: [
    { name: 'id', type: 'bytes32' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
  ],
}
export const withdrawalTypes = {
  Withdrawal: [
    { name: 'id', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
}
export function reserveBridge(networkId: string, raw: any = settings): any {
  if (raw?.schemaVersion !== 2) throw new Error('Expected bridge schemaVersion 2')
  const entry = raw.deployments?.[networkId]
  const base = {
    protocol: 2,
    networkId,
    referenceToken: WIN_BSC_TOKEN,
    reserveAddress: bridgeReserveAddress,
    feeBps: formulas.transferFeeBps,
    feeRecipient: formulas.feeRecipient,
    exchangeRate: '1:1',
    threshold: 2,
  }
  if (!entry) return { ...base, configured: false, enabled: false, operators: [], observerUrls: [] }
  const address = (v: string) => {
    const a = getAddress(v).toLowerCase()
    if (/^0x[0-6]0{39}$/.test(a) || a === WIN_BSC_TOKEN.address) throw new Error('Invalid bridge address')
    return a
  }
  const operators = entry.operators?.map(address)
  const vaultAddress = address(entry.vaultAddress)
  if (operators?.length !== 3 || new Set(operators).size !== 3 || operators.includes(vaultAddress)) throw new Error('Three distinct bridge operators required')
  if (!/^0x[0-9a-f]{64}$/.test(entry.vaultCodeHash)) throw new Error('Pinned vault runtime code hash required')
  if (!/^[1-9][0-9]*$/.test(entry.reserveCapAtomic) || BigInt(entry.reserveCapAtomic) > 10n ** 27n) throw new Error('Invalid native reserve cap')
  if (!Array.isArray(entry.observerUrls) || entry.observerUrls.length !== 3) throw new Error('Three observer endpoints required')
  const observerUrls = entry.observerUrls.map((v: string) => {
    const u = new URL(v)
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    )
      throw new Error('Secure observer URL required')
    return u.toString().replace(/\/$/, '')
  })
  if (new Set(observerUrls).size !== 3 || typeof entry.enabled !== 'boolean') throw new Error('Invalid observer configuration')
  return {
    ...base,
    configured: true,
    enabled: entry.enabled,
    vaultAddress,
    operators,
    observerUrls,
    reserveCapAtomic: entry.reserveCapAtomic,
    vaultCodeHash: entry.vaultCodeHash,
  }
}
