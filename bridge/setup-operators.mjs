// Prepare local operator files only. This script never deploys or broadcasts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Wallet } from 'ethers'
import { readOperatorKey, validateConfig } from './operator.mjs'

const keyNames = ['operator-key.json', 'operator-2-key.json', 'operator-3-key.json']
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const root = fs.realpathSync(directory)
  const repository = path.resolve(import.meta.dirname, '..')
  if (root === repository || root.startsWith(repository + path.sep)) throw new Error('Store operator files outside the server repository')
  if (process.platform !== 'win32' && (fs.statSync(root).mode & 0o077)) throw new Error('Operator directory must be private (chmod 700)')
  return root
}
function keepOrCreate(file, text) {
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== text) throw new Error(`Existing ${path.basename(file)} differs; review it instead of overwriting it`)
    return
  }
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 })
}
export function prepareKeys(directory) {
  const root = privateDirectory(directory)
  const deployedFile = path.join(root, 'deployed-vault.json')
  const deployed = fs.existsSync(deployedFile) ? json(deployedFile) : null
  // After deployment, missing keys must be recovered; generating replacements cannot change the vault.
  if (deployed && keyNames.some((name) => !fs.existsSync(path.join(root, name))))
    throw new Error('Vault already deployed: restore all three original operator key files; do not generate replacement keys')
  const operators = keyNames.map((name, index) => {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) {
      const wallet = Wallet.createRandom()
      fs.writeFileSync(file, JSON.stringify({ address: wallet.address, privateKey: wallet.privateKey }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    }
    const address = readOperatorKey(file).address.toLowerCase()
    if (deployed && deployed.operators?.[index]?.toLowerCase() !== address)
      throw new Error(`Operator ${index + 1} does not match the deployed vault`)
    return address
  })
  if (new Set(operators).size !== 3) throw new Error('Three distinct operator keys required')
  return operators
}
export function configureOperators(directory, { gateway = 'http://127.0.0.1:3030', walletOrigin = 'https://wallet.win-pskill.com' } = {}) {
  const root = privateDirectory(directory)
  const deployment = json(path.join(root, 'deployment.json'))
  const deployed = json(path.join(root, 'deployed-vault.json'))
  const operators = keyNames.map((name) => readOperatorKey(path.join(root, name)).address.toLowerCase())
  if (deployment.networkId !== deployed.networkId ||
    JSON.stringify(deployment.operators?.map((a) => a.toLowerCase())) !== JSON.stringify(operators) ||
    JSON.stringify(deployed.operators?.map((a) => a.toLowerCase())) !== JSON.stringify(operators))
    throw new Error('Deployment files and local keys must match the same network and operator order')
  const config = validateConfig({
    networkId: deployed.networkId,
    vaultAddress: deployed.vaultAddress.toLowerCase(),
    vaultCodeHash: deployed.vaultCodeHash.toLowerCase(),
    operators,
    bnbRpc: deployment.bnbRpc,
    nativeGatewayMode: 'single',
    nativeGateways: [gateway],
    walletOrigin,
  })
  const configFile = path.join(root, 'operator-config.json')
  const ecosystemFile = path.join(root, 'ecosystem.config.cjs')
  const apps = keyNames.map((name, index) => ({
    name: `win-bridge-operator-${index + 1}`,
    cwd: import.meta.dirname,
    script: path.join(import.meta.dirname, 'operator.mjs'),
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 5000,
    min_uptime: 10000,
    max_restarts: 10,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production', PORT: String(8081 + index),
      WIN_BRIDGE_CONFIG: configFile,
      WIN_BRIDGE_KEY_FILE: path.join(root, name),
      // Avoid inheriting a key from a previous manual startup. PM2 stores paths only.
      WIN_BRIDGE_OPERATOR_KEY: '',
      WIN_BRIDGE_DEPLOYER_KEY: '',
      WIN_NATIVE_FUNDING_KEY: '',
    },
  }))
  const configText = JSON.stringify(config, null, 2) + '\n'
  const ecosystemText = 'module.exports = ' + JSON.stringify({ apps }, null, 2) + '\n'
  // Check both managed files before writing either, so a rerun preserves local edits.
  for (const [file, text] of [[configFile, configText], [ecosystemFile, ecosystemText]]) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text)
      throw new Error(`Existing ${path.basename(file)} differs; review it instead of overwriting it`)
  }
  keepOrCreate(configFile, configText)
  keepOrCreate(ecosystemFile, ecosystemText)
  return { configFile, ecosystemFile, operators, ports: [8081, 8082, 8083] }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const directory = process.env.WIN_BRIDGE_HOME || path.join(os.homedir(), '.config', 'win-bridge')
    if (process.argv[2] === 'keys') console.log(JSON.stringify({ operators: prepareKeys(directory) }, null, 2))
    else if (process.argv[2] === 'configure') console.log(JSON.stringify(configureOperators(directory, {
      gateway: process.env.WIN_NATIVE_GATEWAY || 'http://127.0.0.1:3030',
      walletOrigin: process.env.WIN_WALLET_ORIGIN || 'https://wallet.win-pskill.com',
    }), null, 2))
    else throw new Error('Usage: node setup-operators.mjs keys|configure')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
