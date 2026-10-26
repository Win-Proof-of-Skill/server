import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { Wallet, Interface, keccak256 } from 'ethers'
import { prepareKeys, configureOperators } from '../setup-operators.mjs'
import { readOperatorKey, loadConfig, serve, ABI } from '../operator.mjs'

const names = ['operator-key.json', 'operator-2-key.json', 'operator-3-key.json']
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-operator-setup-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function save(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}
function fixture(t, rpc = 'https://bnb.example') {
  const dir = directory(t)
  const wallets = [1, 2, 3].map((i) => new Wallet(i.toString(16).padStart(64, '0')))
  wallets.forEach((wallet, index) => save(dir, names[index], { address: wallet.address, privateKey: wallet.privateKey }))
  const deployment = { networkId: 'a'.repeat(64), operators: wallets.map((w) => w.address), bnbRpc: rpc }
  const deployed = { ...deployment, vaultAddress: '0x' + 'b'.repeat(40), vaultCodeHash: keccak256('0x6000') }
  save(dir, 'deployment.json', deployment)
  save(dir, 'deployed-vault.json', deployed)
  return { dir, wallets, deployment, deployed }
}
test('key preparation preserves the original key and is safe to repeat', (t) => {
  const dir = directory(t)
  const wallet = new Wallet('1'.padStart(64, '0'))
  save(dir, names[0], { address: wallet.address, privateKey: wallet.privateKey })
  const original = fs.readFileSync(path.join(dir, names[0]), 'utf8')
  const addresses = prepareKeys(dir)
  assert.equal(addresses[0], wallet.address.toLowerCase())
  assert.equal(new Set(addresses).size, 3)
  assert.deepEqual(prepareKeys(dir), addresses)
  assert.equal(fs.readFileSync(path.join(dir, names[0]), 'utf8'), original)
  for (const name of names) assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o600)
})
test('deployed vault keys cannot be silently replaced or duplicated', (t) => {
  const f = fixture(t)
  fs.unlinkSync(path.join(f.dir, names[2]))
  assert.throws(() => prepareKeys(f.dir), /restore all three original/)
  assert.equal(fs.existsSync(path.join(f.dir, names[2])), false)
  save(f.dir, names[2], { privateKey: f.wallets[0].privateKey })
  assert.throws(() => prepareKeys(f.dir), /does not match/)
  fs.unlinkSync(path.join(f.dir, 'deployed-vault.json'))
  assert.throws(() => prepareKeys(f.dir), /distinct/)
})
test('three PM2 apps use distinct keys and ports without storing private keys in the ecosystem', (t) => {
  const f = fixture(t)
  const result = configureOperators(f.dir)
  const c = loadConfig(result.configFile)
  assert.equal(c.nativeGatewayMode, 'single')
  assert.deepEqual(c.nativeGateways, ['http://127.0.0.1:3030'])
  assert.deepEqual(c.operators, f.wallets.map((w) => w.address.toLowerCase()))
  const require = createRequire(import.meta.url)
  const ecosystem = require(result.ecosystemFile)
  assert.deepEqual(ecosystem.apps.map((a) => a.env.PORT), ['8081', '8082', '8083'])
  assert.equal(new Set(ecosystem.apps.map((a) => a.name)).size, 3)
  for (const [i, app] of ecosystem.apps.entries()) {
    assert.equal(readOperatorKey(app.env.WIN_BRIDGE_KEY_FILE).address, f.wallets[i].address)
    assert.equal(app.env.WIN_BRIDGE_OPERATOR_KEY, '')
    assert.equal(app.env.WIN_BRIDGE_DEPLOYER_KEY, '')
    assert.equal(app.env.WIN_NATIVE_FUNDING_KEY, '')
  }
  const text = fs.readFileSync(result.ecosystemFile, 'utf8') + fs.readFileSync(result.configFile, 'utf8')
  for (const wallet of f.wallets) assert.equal(text.includes(wallet.privateKey), false)
  assert.deepEqual(configureOperators(f.dir), result)
})
test('setup refuses wrong deployment keys and preserves edited configuration', (t) => {
  const f = fixture(t)
  save(f.dir, 'deployment.json', { ...f.deployment, operators: [...f.deployment.operators].reverse() })
  assert.throws(() => configureOperators(f.dir), /must match/)
  assert.equal(fs.existsSync(path.join(f.dir, 'operator-config.json')), false)
  save(f.dir, 'deployment.json', f.deployment)
  const result = configureOperators(f.dir)
  const custom = 'custom operator settings\n'
  fs.writeFileSync(result.configFile, custom)
  assert.throws(() => configureOperators(f.dir), /instead of overwriting/)
  assert.equal(fs.readFileSync(result.configFile, 'utf8'), custom)
})
test('key loading rejects exposed files and mismatched identity without revealing secrets', (t) => {
  const f = fixture(t)
  const file = path.join(f.dir, names[0])
  fs.chmodSync(file, 0o644)
  assert.throws(() => readOperatorKey(file), /chmod 600/)
  fs.chmodSync(file, 0o600)
  save(f.dir, names[0], { privateKey: f.wallets[0].privateKey, address: f.wallets[1].address })
  assert.throws(() => readOperatorKey(file), (error) => /Invalid operator key/.test(error.message) && !error.message.includes(f.wallets[0].privateKey))
})
test('three running operators report distinct identities and the explicit single gateway policy', async (t) => {
  const iface = new Interface(ABI)
  let deployed
  const rpc = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const input = JSON.parse(body)
    const response = (request) => {
      let result
      if (request.method === 'eth_chainId') result = '0x38'
      else if (request.method === 'eth_getCode') result = '0x6000'
      else if (request.method === 'eth_call') {
        const call = iface.parseTransaction({ data: request.params[0].data })
        const value = call.name === 'token' ? '0x8a27363dd26f78b09014338e106b16055fcb9799'
          : call.name === 'networkId' ? '0x' + deployed.networkId
          : call.name === 'feeBps' ? 50n : deployed.operators[Number(call.args[0])]
        result = iface.encodeFunctionResult(call.name, [value])
      } else throw new Error('Unexpected RPC: ' + request.method)
      return { jsonrpc: '2.0', id: request.id, result }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(Array.isArray(input) ? input.map(response) : response(input)))
  })
  rpc.listen(0, '127.0.0.1')
  await once(rpc, 'listening')
  t.after(() => { rpc.closeAllConnections(); rpc.close() })
  const f = fixture(t, `http://127.0.0.1:${rpc.address().port}`)
  deployed = f.deployed
  const result = configureOperators(f.dir)
  const variables = ['WIN_BRIDGE_CONFIG', 'WIN_BRIDGE_KEY_FILE', 'WIN_BRIDGE_OPERATOR_KEY', 'PORT']
  const previous = Object.fromEntries(variables.map((key) => [key, process.env[key]]))
  t.after(() => {
    for (const key of variables) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  })
  const operators = []
  const ports = []
  for (let i = 0; i < 3; i++) {
    process.env.WIN_BRIDGE_CONFIG = result.configFile
    process.env.WIN_BRIDGE_KEY_FILE = path.join(f.dir, names[i])
    delete process.env.WIN_BRIDGE_OPERATOR_KEY
    process.env.PORT = '0'
    const server = await serve()
    t.after(() => { server.closeAllConnections(); server.close() })
    if (!server.listening) await once(server, 'listening')
    ports.push(server.address().port)
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://wallet.win-pskill.com')
    const health = await response.json()
    assert.equal(health.nativeGatewayMode, 'single')
    assert.equal(health.nativeGatewayQuorum, 1)
    assert.equal(health.vaultAddress, deployed.vaultAddress)
    operators.push(health.operator)
  }
  assert.equal(new Set(ports).size, 3)
  assert.deepEqual(operators, f.wallets.map((wallet) => wallet.address.toLowerCase()))
})
