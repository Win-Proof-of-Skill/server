const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ethers } = require('ethers')
const crypto = require('@shardus/lib-crypto-utils')
const { Utils } = require('@shardus/lib-types')
const { WinClient, parseWin, address, receiptState, profileTemplate, contractTemplate, readJson, writePrivateJson, localNetworkId } = require('./client-win')
const { WIN_NETWORK_ID, proofOfSkillAddresses } = require('../dist/config')
require('../dist/config').WinFlags.VerboseLogs = false
const ethereum = ethers.Wallet.createRandom()
const wallet = { address: address(ethereum.address), keys: { secretKey: ethereum.privateKey } }
const recipient = 'b'.repeat(64)
const protocol = { networkId: WIN_NETWORK_ID, currency: 'WIN', decimals: 18, transferNonceRequired: true,
  transferFee: '100000000000000000', registryAddresses: proofOfSkillAddresses }

function fixture(options = {}) {
  const state = { protocol: { ...protocol }, receipt: null, posts: [], nonce: 0, balance: parseWin('100'), ...options }
  const http = {
    async get(url) {
      const route = new URL(url).pathname
      let data
      if (route === '/network/parameters') data = { protocol: state.protocol }
      else if (route === '/sync-newest-cycle') data = { newestCycle: { mode: 'processing', active: 10, start: Date.now() / 1000, duration: 15 } }
      else if (route.startsWith('/account/')) data = { account: state.missing ? null : { type: 'UserAccount', data: { balance: state.balance, transferNonce: state.nonce } } }
      else if (route.startsWith('/transaction/')) data = { transaction: state.receipt }
      else throw new Error(`Unexpected request: ${route}`)
      return { data: JSON.parse(Utils.safeStringify(data)) }
    },
    async post(url, body) {
      const tx = Utils.safeJsonParse(body.tx)
      state.posts.push(tx)
      if (state.throwPost) throw new Error('Connection lost after broadcast')
      if (state.confirm) state.receipt = { txId: crypto.hashObj(tx, true), networkId: tx.networkId,
        type: tx.type, from: tx.from, to: tx.to, success: true, transactionFee: tx.fee }
      return { data: { result: { success: !state.reject, reason: state.reject ? 'Rejected' : undefined } } }
    },
  }
  const client = new WinClient('127.0.0.1:9001', { http, waitMs: 0, historyFile: state.historyFile })
  return { client, state }
}

test('WIN amount parsing preserves atomic precision and rejects ambiguous or invalid input', () => {
  assert.equal(parseWin('9007199254740993.123456789012345678'), 9007199254740993123456789012345678n)
  assert.equal(parseWin('0.000000000000000001'), 1n)
  for (const value of ['0', '-1', '1e3', '1,000', '01', '1.0000000000000000001', 'NaN', 'Infinity']) assert.throws(() => parseWin(value))
})

test('local connection pins the manifest domain and rejects a switched node domain', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'win-client-domain-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'instances-local'))
  writePrivateJson(path.join(root, 'instances-local/local-network.json'), { networkId: WIN_NETWORK_ID })
  assert.equal(localNetworkId('localhost:9001', root), WIN_NETWORK_ID)
  assert.equal(localNetworkId('example.com:9001', root), undefined)
  const { client, state } = fixture()
  await client.connect()
  state.protocol.networkId = 'f'.repeat(64)
  await assert.rejects(client.connect(), /network ID changed/)
})

test('payment uses live fee and nonce, round-trips bigint JSON, and passes server signature validation', async () => {
  const { client } = fixture({ nonce: 7 })
  const tx = await client.payment(wallet, recipient, '1.000000000000000001')
  assert.equal(tx.nonce, 8)
  assert.equal(tx.amount, 1000000000000000001n)
  assert.equal(tx.fee, 100000000000000000n)
  assert.equal(require('../dist/transactions/transfer').validate_fields(tx, { success: false, reason: '' }).success, true)
  assert.equal(require('../dist/utils').generateTxId(tx), crypto.hashObj(tx, true))
  assert.deepEqual(Utils.safeJsonParse(Utils.safeStringify(tx)), tx)
})

test('payments reject protected addresses, empty wallets, and insufficient funds before broadcasting', async () => {
  const { client, state } = fixture()
  for (const to of Object.values(proofOfSkillAddresses)) {
    await assert.rejects(client.payment(wallet, `0x${to}`, '1'), /Protected/)
  }
  state.missing = true
  await assert.rejects(client.payment(wallet, recipient, '1'), /No funded wallet/)
  state.missing = false
  state.balance = parseWin('1')
  await assert.rejects(client.payment(wallet, recipient, '1'), /Insufficient/)
  assert.equal(state.posts.length, 0)
})

test('all six profile templates pass server schema, signature and exact UTF-8 fee validation', async () => {
  const { client } = fixture()
  const handler = require('../dist/transactions/proofOfSkill')
  for (const type of ['person', 'company', 'organization', 'government', 'university', 'school']) {
    const payload = profileTemplate(type)
    payload.summary = 'é'.repeat(2000)
    const tx = await client.objectTransaction(wallet, 'profile', 'create', 'a'.repeat(64), 0, { payload })
    assert.equal(tx.fee, handler.proofOfSkillFee(tx))
    const checked = handler.validate_fields(tx, { success: false, reason: '' })
    assert.equal(checked.success, true, checked.reason)
  }
})

test('historical contracts and signed approval hashes match current server schemas', async () => {
  const { client } = fixture()
  const payload = contractTemplate()
  payload.workerProfileId = 'a'.repeat(64)
  payload.hiringProfileIds = ['b'.repeat(64)]
  const tx = await client.objectTransaction(wallet, 'contract', 'create', 'c'.repeat(64), 0, { payload })
  assert.equal(tx.fee, parseWin('1'))
  assert.equal(tx.payload.terms.startDate, '2024-01-01')
  const approval = await client.objectTransaction(wallet, 'contract', 'approve', 'c'.repeat(64), 2, { requestHash: 'd'.repeat(64), hiringProfileId: 'b'.repeat(64) })
  const handler = require('../dist/transactions/proofOfSkill')
  assert.equal(handler.validate_fields(approval, { success: false, reason: '' }).success, true)
  await assert.rejects(client.objectTransaction(wallet, 'contract', 'approve', 'c'.repeat(64), 2), /Invalid contract data/)
  await assert.rejects(client.objectTransaction(wallet, 'profile', 'update', 'a'.repeat(64), 1, { payload: { ...profileTemplate('person'), owner: wallet.address } }), /Invalid profile data/)
})

test('accepted submission remains unknown without a committed receipt and blocks reuse of its nonce after client restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-client-history-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const historyFile = path.join(dir, 'history.json')
  const { client, state } = fixture({ historyFile })
  const tx = await client.payment(wallet, recipient, '1')
  const updates = []
  const result = await client.submit(tx, value => updates.push(value))
  assert.equal(result.status, 'unknown')
  assert(updates.some(value => value.startsWith('pending:')))
  assert(!updates.some(value => value.includes('confirmed')))
  assert.equal(state.posts.length, 1)
  const next = fixture({ historyFile }).client
  await assert.rejects(next.payment(wallet, recipient, '2'), /Resolve payment/)
  await assert.rejects(client.submit(tx), /already recorded/)
})

test('only a matching committed receipt confirms payment; receipt bigint survives journal persistence', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-client-receipt-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const historyFile = path.join(dir, 'history.json')
  const { client, state } = fixture({ confirm: true, historyFile })
  const tx = await client.payment(wallet, recipient, '1')
  const result = await client.submit(tx)
  assert.equal(result.status, 'confirmed')
  assert.equal(readJson(historyFile)[0].receipt.transactionFee, tx.fee)
  assert.equal(fs.statSync(historyFile).mode & 0o777, 0o600)
  state.receipt = null
  assert.equal((await client.receipt(result.txId)).status, 'confirmed')
  const receipt = result.receipt
  for (const patch of [{ txId: 'f'.repeat(64) }, { networkId: 'e'.repeat(64) }, { networkId: undefined }, { success: 'true' }, { from: recipient }]) {
    assert.equal(receiptState({ ...receipt, ...patch }, result.txId, WIN_NETWORK_ID, tx), 'unknown')
  }
  assert.equal(receiptState({ ...receipt, success: false }, result.txId, WIN_NETWORK_ID, tx), 'failed')
})

test('node rejection is failed, but transport timeout is unknown and never automatically rebroadcast', async () => {
  for (const options of [{ reject: true }, { throwPost: true }]) {
    const { client, state } = fixture(options)
    const result = await client.submit(await client.payment(wallet, recipient, '1'))
    assert.equal(result.status, options.reject ? 'failed' : 'unknown')
    assert.equal(state.posts.length, 1)
  }
})

test('registration receipts use the alias account as destination even though the submitted transaction has no to field', async () => {
  const { client } = fixture()
  const tx = { type: 'register', from: wallet.address, aliasHash: crypto.hash('testalias'), networkId: WIN_NETWORK_ID, timestamp: Date.now() }
  require('./client-win').sign(tx, wallet)
  const receipt = { type: 'register', from: wallet.address, to: tx.aliasHash, txId: crypto.hashObj(tx, true), success: true, transactionFee: 0n }
  client.http.post = async () => ({ data: { result: { success: true } } })
  const get = client.http.get
  client.http.get = async url => url.includes('/transaction/') ? { data: { transaction: receipt } } : get(url)
  assert.equal((await client.submit(tx)).status, 'confirmed')
  assert.equal(client.entries()[0].to, tx.aliasHash)
  // Older journal entries without a destination still require matching ID/type/sender.
  assert.equal(receiptState(receipt, receipt.txId, WIN_NETWORK_ID, { type: 'register', from: wallet.address }), 'confirmed')
})

test('wallet files are kept private, bigint-safe, and malformed JSON is never replaced', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-client-wallet-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'wallet.json')
  writePrivateJson(file, { alice: wallet })
  assert.deepEqual(readJson(file), { alice: wallet })
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  fs.writeFileSync(file, '{broken')
  assert.throws(() => readJson(file, {}), /not overwritten/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
})
