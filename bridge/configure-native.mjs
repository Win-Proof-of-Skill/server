// Uses public deployment metadata only. Never reads keys or sends transactions.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { JsonRpcProvider, Contract, FetchRequest } from 'ethers'
import { ACCOUNTING, ABI, loadConfig, verifyVault } from './operator.mjs'
const require = createRequire(import.meta.url)
const { reserveBridge } = require('../dist/config/reserveBridge')
export function deploymentEntry(deployed, operatorConfig, observerUrls) {
  if (!/^[a-f0-9]{64}$/.test(deployed.networkId)) throw new Error('Invalid native network ID')
  for (const key of ['networkId', 'vaultAddress', 'vaultCodeHash', 'operators'])
    if (!isDeepStrictEqual(deployed[key], operatorConfig[key])) throw new Error('Vault deployment and operator configuration must match: ' + key)
  const entry = {
    accounting: ACCOUNTING,
    enabled: false,
    vaultAddress: deployed.vaultAddress,
    vaultCodeHash: deployed.vaultCodeHash,
    operators: deployed.operators,
    observerUrls,
  }
  reserveBridge(deployed.networkId, { schemaVersion: 2, deployments: { [deployed.networkId]: entry } })
  return entry
}
export function updatedSettings(settings, networkId, entry, enable = false) {
  if (settings?.schemaVersion !== 2 || !settings.deployments || Array.isArray(settings.deployments) || typeof settings.deployments !== 'object')
    throw new Error('Invalid bridge settings file')
  const existing = settings.deployments[networkId]
  if (existing && !isDeepStrictEqual({ ...existing, enabled: false }, entry))
    throw new Error('Existing deployment differs. Review it manually; it was not overwritten.')
  if (enable && !existing) throw new Error('Prepare and restart validators with the disabled deployment first')
  if (!enable && existing?.enabled) throw new Error('Deployment already enabled; configuration was not changed')
  return { ...settings, deployments: { ...settings.deployments, [networkId]: { ...entry, enabled: enable } } }
}
export function verifyNativeStatus(status, deployed, enable = false) {
  if (status?.networkId !== deployed.networkId || status.protocol !== 2) throw new Error('Native gateway network/protocol mismatch')
  if (status.accounting !== ACCOUNTING) {
    // Only the prior, unused reserve bridge may be upgraded automatically.
    if (enable || status.configured !== false || status.enabled !== false || status.nativeLiquidity !== '0' || status.backedWithdrawalCapacity !== '0')
      throw new Error('Native validators need the deposit-backed upgrade, or legacy activity requires manual migration')
    return
  }
  const names = ['nativeMinted', 'nativeBurned', 'nativeOutstanding', 'backedWithdrawalCapacity']
  if (
    names.some((key) => typeof status[key] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(status[key])) ||
    BigInt(status.nativeMinted) - BigInt(status.nativeBurned) !== BigInt(status.nativeOutstanding) ||
    status.backedWithdrawalCapacity !== status.nativeOutstanding ||
    status.requiresNativePrefunding !== false
  )
    throw new Error('Invalid native supply accounting')
  if (
    enable &&
    (status.configured !== true ||
      status.vaultAddress !== deployed.vaultAddress ||
      status.vaultCodeHash !== deployed.vaultCodeHash ||
      !isDeepStrictEqual(status.operators, deployed.operators))
  )
    throw new Error('Restart all validators with the prepared deployment before enabling it')
}
async function read(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('Endpoint unavailable: ' + new URL(url).origin + ' (HTTP ' + r.status + ')')
  return r.json()
}
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--enable')) throw new Error('Usage: node configure-native.mjs [--enable]')
  const enable = process.argv.includes('--enable')
  const home = process.env.WIN_BRIDGE_HOME || path.join(os.homedir(), '.config/win-bridge')
  const deployed = JSON.parse(fs.readFileSync(path.join(home, 'deployed-vault.json'), 'utf8'))
  const c = loadConfig(path.join(home, 'operator-config.json'))
  const observers = process.env.WIN_OBSERVER_URLS
    ? JSON.parse(process.env.WIN_OBSERVER_URLS)
    : [1, 2, 3].map((n) => `https://bridge.win-pskill.com/operator-${n}`)
  const entry = deploymentEntry(deployed, c, observers)
  const gateway = process.env.WIN_NATIVE_GATEWAY || 'http://127.0.0.1:3030'
  const u = new URL(gateway)
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
  )
    throw new Error('Secure native gateway required')
  const status = await read(gateway.replace(/\/$/, '') + '/bridge/v2/status')
  verifyNativeStatus(status, deployed, enable)
  if (enable && !isDeepStrictEqual(status.observerUrls, observers)) throw new Error('Native operator URLs do not match the deployment')
  const transport = new FetchRequest(c.bnbRpc)
  transport.timeout = 15000
  const provider = new JsonRpcProvider(transport)
  try {
    await verifyVault(provider, new Contract(c.vaultAddress, ABI, provider), c)
  } finally {
    provider.destroy()
  }
  for (const [i, url] of observers.entries()) {
    const health = await read(url + '/health')
    if (health.accounting !== ACCOUNTING || health.networkId !== c.networkId || health.vaultAddress !== c.vaultAddress || health.operator !== c.operators[i])
      throw new Error('Update/restart operator ' + (i + 1) + '; health does not match deposit-backed deployment')
  }
  const file = fileURLToPath(new URL('../src/config/bridge-v2.json', import.meta.url))
  const original = fs.readFileSync(file, 'utf8')
  const settings = updatedSettings(JSON.parse(original), c.networkId, entry, enable)
  const text = JSON.stringify(settings, null, 2) + '\n'
  if (text !== original) {
    const backup = file + '.previous-' + Date.now()
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
    const temp = file + '.' + process.pid + '.tmp'
    fs.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
    console.log('Previous public configuration saved to ' + backup)
  }
  console.log(`Prepared ${c.vaultAddress}: enabled=${enable}, accounting=${ACCOUNTING}. Rebuild and restart every validator together. No funds were moved.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
