'use strict'

// Shared by the interactive client and its protocol tests. No service is started here.
const fs = require('fs')
const path = require('path')
const { randomBytes } = require('crypto')
const axios = require('axios')
const crypto = require('@shardus/lib-crypto-utils')
const { Utils } = require('@shardus/lib-types')
const { ethers } = require('ethers')

crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
crypto.setCustomStringifier(Utils.safeStringify, 'shardus_safeStringify')
const idPattern = /^[0-9a-f]{64}$/
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const decode = data => typeof data === 'string' ? Utils.safeJsonParse(data) : Utils.safeJsonParse(Utils.safeStringify(data))

function readJson(file, fallback) {
  try { return Utils.safeJsonParse(fs.readFileSync(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`Cannot read ${file}: ${error.message}. File was not overwritten.`)
  }
}

function writePrivateJson(file, value) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(JSON.parse(Utils.safeStringify(value)), null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    fs.renameSync(temp, file)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

function address(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^0x[0-9a-f]{40}$/.test(text)) return text.slice(2) + '0'.repeat(24)
  const native = text.replace(/^0x/, '')
  if (!idPattern.test(native)) throw new Error('Enter a wallet name, registered alias, or valid WIN/Ethereum address')
  return native
}

function parseWin(value) {
  if (typeof value !== 'string') throw new Error('Pass the WIN amount as decimal text to preserve precision')
  const text = String(value).trim()
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(text)) throw new Error('Use a positive decimal WIN amount with at most 18 decimal places')
  const amount = ethers.parseEther(text)
  if (amount <= 0n) throw new Error('Amount must be greater than zero')
  return amount
}

function assertId(value, label = 'Object ID') {
  if (!idPattern.test(value)) throw new Error(`${label} must contain 64 lowercase hexadecimal characters`)
  return value
}

function localNetworkId(host, root = path.resolve(__dirname, '..')) {
  if (!/^(localhost|127\.0\.0\.1):90(0[1-9]|10)$/.test(host)) return undefined
  const manifest = readJson(path.join(root, 'instances-local/local-network.json'), null)
  return manifest ? assertId(manifest.networkId, 'Local network ID') : undefined
}

function sign(tx, wallet) {
  assertId(tx.networkId, 'Network ID')
  const signer = new ethers.Wallet(wallet.keys.secretKey)
  if (address(signer.address) !== tx.from || tx.from !== wallet.address) throw new Error('Wallet key does not match the transaction sender')
  const body = { ...tx }
  delete body.sign
  tx.sign = { owner: wallet.address, sig: signer.signMessageSync(crypto.hashObj(body)) }
  return tx
}

function receiptState(receipt, txId, networkId, entry) {
  if (!receipt || receipt.txId !== txId || typeof receipt.success !== 'boolean') return 'unknown'
  if (receipt.networkId !== undefined && receipt.networkId !== networkId) return 'unknown'
  if (receipt.type === 'transfer' && receipt.networkId !== networkId) return 'unknown'
  if (entry && (receipt.type !== entry.type || receipt.from !== entry.from || (entry.to !== undefined && receipt.to !== entry.to))) return 'unknown'
  return receipt.success ? 'confirmed' : 'failed'
}

class WinClient {
  constructor(host, options = {}) {
    if (!/^[a-zA-Z0-9.-]+:[0-9]{1,5}$/.test(host)) throw new Error('Use a node address such as 127.0.0.1:9001 (without http://)')
    this.host = host
    this.expectedNetworkId = options.expectedNetworkId
    this.http = options.http || axios.create({ timeout: 10000 })
    this.historyFile = options.historyFile
    this.history = []
    this.waitMs = options.waitMs ?? 45000
    this.pollMs = options.pollMs ?? 2000
  }

  async get(route) {
    const { data } = await this.http.get(`http://${this.host}${route}`)
    const body = decode(data)
    if (body.error) throw new Error(typeof body.error === 'string' ? body.error : 'Node could not complete the query; check network readiness')
    return body
  }

  async connect() {
    const { protocol } = await this.get('/network/parameters')
    if (!protocol || !idPattern.test(protocol.networkId) || protocol.currency !== 'WIN' || protocol.decimals !== 18 ||
        protocol.transferNonceRequired !== true || typeof protocol.transferFee !== 'string' || !/^[0-9]+$/.test(protocol.transferFee)) {
      throw new Error('WIN protocol unavailable. Start the network and wait for npm run local:check to pass.')
    }
    const expected = this.expectedNetworkId || this.protocol?.networkId
    if (expected && protocol.networkId !== expected) throw new Error('Node network ID changed or differs from the local manifest. Reconnect to the intended network.')
    this.protocol = protocol
    return protocol
  }

  async ready() {
    await this.connect()
    const { newestCycle: cycle } = await this.get('/sync-newest-cycle')
    if (!cycle || cycle.mode !== 'processing' || !Number.isSafeInteger(cycle.active) || cycle.active < 1 ||
        !Number.isFinite(cycle.start) || !Number.isFinite(cycle.duration) ||
        Math.abs(Date.now() - cycle.start * 1000) >= (cycle.duration + 90) * 1000) {
      throw new Error(`Network is not ready for transactions (${cycle?.mode || 'starting'}). Run npm run local:check.`)
    }
    return cycle
  }

  entries() {
    const entries = this.historyFile ? readJson(this.historyFile, []) : this.history
    if (!Array.isArray(entries)) throw new Error('Invalid client transaction history; preserve it and inspect the file')
    return entries
  }

  remember(entry) {
    const entries = this.entries()
    const index = entries.findIndex(e => e.txId === entry.txId && e.networkId === entry.networkId)
    if (index < 0) entries.push(entry)
    else entries[index] = entry
    if (this.historyFile) writePrivateJson(this.historyFile, entries)
    else this.history = entries
  }

  async resolveTarget(value, wallets = {}) {
    if (Object.prototype.hasOwnProperty.call(wallets, value)) return address(wallets[value].address)
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(value) || /^0x[0-9a-fA-F]{40}$/.test(value)) return address(value)
    const body = await this.get(`/address/${crypto.hash(value)}`)
    if (!body.address) throw new Error('Alias not found. Use a local wallet name or address; registration is optional for payments.')
    return address(body.address)
  }

  async account(id) {
    const { account } = await this.get(`/account/${address(id)}`)
    return account
  }

  async funded(id, required) {
    const account = await this.account(id)
    if (!account || account.type !== 'UserAccount') throw new Error('No funded wallet on this network. Wallet creation does not issue WIN; test funding is still a separate step.')
    if (BigInt(account.data.balance) < required) throw new Error(`Insufficient funds: ${ethers.formatEther(account.data.balance)} WIN available; at least ${ethers.formatEther(required)} WIN required.`)
    return account
  }

  async payment(wallet, to, amount, memo = '') {
    await this.ready()
    to = address(to)
    const reserved = Object.values(this.protocol.registryAddresses || {})
    if ([wallet.address, to].some(id => /^[1-5]0{63}$/.test(id) || reserved.includes(id) || id === '0'.repeat(64))) {
      throw new Error('Protected registry/network addresses cannot be payment wallets')
    }
    if (to === wallet.address) throw new Error('Choose a different recipient wallet')
    if (memo.length > 140) throw new Error('Memo must be at most 140 characters')
    const atomic = parseWin(amount)
    const fee = BigInt(this.protocol.transferFee)
    const account = await this.funded(wallet.address, atomic + fee)
    const nonce = (account.data.transferNonce ?? 0) + 1
    if (!Number.isSafeInteger(nonce) || nonce < 1) throw new Error('Invalid payment nonce returned by node')
    const unresolved = this.entries().find(e => e.networkId === this.protocol.networkId && e.from === wallet.address &&
      e.type === 'transfer' && ['pending', 'unknown'].includes(e.status) && e.nonce >= nonce)
    if (unresolved) throw new Error(`Resolve payment ${unresolved.txId} with "receipt ${unresolved.txId}" before sending another payment.`)
    return sign({ type: 'transfer', networkId: this.protocol.networkId, from: wallet.address, to, amount: atomic, fee, nonce,
      chatId: crypto.hash([wallet.address, to].sort().join('')), memo: memo || null, timestamp: Date.now() }, wallet)
  }

  async objectTransaction(wallet, type, action, objectId, expectedRevision, extra = {}) {
    await this.ready()
    assertId(objectId)
    if (!['profile', 'contract'].includes(type)) throw new Error('Only profiles and contracts are currently implemented by this server')
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Revision must be a nonnegative safe integer')
    const tx = { ...extra, type, action, objectId, expectedRevision, from: wallet.address,
      to: (type === 'profile' ? '1' : '2') + '0'.repeat(63), networkId: this.protocol.networkId, timestamp: Date.now() }
    // Use this checkout's compiled rules, including UTF-8 size-based profile fees.
    const { formulas, transactionFee } = require('../dist/config/formulas')
    const { validateProofOfSkillShape } = require('../dist/domain/schema')
    const { fee, sign: signature, ...body } = tx
    tx.fee = type === 'contract' ? formulas.contractFee : transactionFee(Buffer.byteLength(Utils.safeStringify(body), 'utf8'))
    sign(tx, wallet)
    const error = validateProofOfSkillShape(tx)
    if (error) throw new Error(`Invalid ${type} data: ${error}`)
    if (Buffer.byteLength(Utils.safeStringify(tx), 'utf8') > 256 * 1024) throw new Error('Object transaction exceeds 256 KiB')
    await this.funded(wallet.address, tx.fee)
    return tx
  }

  async record(kind, id) {
    if (!['profiles', 'contracts', 'scores'].includes(kind)) throw new Error('Unsupported record type')
    await this.connect()
    return this.get(`/${kind}/${assertId(id)}`)
  }

  async receipt(txId, waitMs = 0) {
    assertId(txId, 'Transaction ID')
    await this.connect()
    const networkId = this.protocol.networkId
    const entry = this.entries().find(e => e.txId === txId && e.networkId === networkId)
    const deadline = Date.now() + waitMs
    let reason
    do {
      try {
        const { transaction } = await this.get(`/transaction/${txId}`)
        const status = receiptState(transaction, txId, networkId, entry)
        if (status !== 'unknown') {
          if (entry) this.remember({ ...entry, status, reason: transaction.reason, receipt: transaction })
          return { txId, status, receipt: transaction, reason: transaction.reason }
        }
      } catch (error) { reason = error.message }
      if (Date.now() >= deadline) break
      await sleep(Math.min(this.pollMs, deadline - Date.now()))
    } while (true)
    // A previously verified receipt remains useful after the node cache expires.
    const saved = entry?.receipt && receiptState(entry.receipt, txId, networkId, entry)
    const status = saved && saved !== 'unknown' ? saved : entry?.status === 'failed' ? 'failed' :
      entry?.status === 'pending' && Date.now() - entry.submittedAt < this.waitMs ? 'pending' : 'unknown'
    if (entry) this.remember({ ...entry, status })
    return { txId, status, reason: reason || entry?.reason || 'No committed receipt available. Do not assume success or resend.', receipt: entry?.receipt }
  }

  async submit(tx, report = () => {}) {
    await this.ready()
    if (tx.networkId !== this.protocol.networkId) throw new Error('Transaction was prepared for a different network')
    const txId = crypto.hashObj(tx, true)
    if (this.entries().some(e => e.txId === txId && e.networkId === tx.networkId)) throw new Error(`Transaction already recorded. Use receipt ${txId}.`)
    const entry = { txId, networkId: tx.networkId, type: tx.type, from: tx.from, to: tx.to ?? (tx.type === 'register' ? tx.aliasHash : undefined), nonce: tx.nonce,
      objectId: tx.objectId, submittedAt: Date.now(), status: 'unknown' }
    this.remember(entry) // Persist before broadcast, including a possible transport timeout.
    report(`Transaction ID: ${txId}`)
    let response
    try {
      response = decode((await this.http.post(`http://${this.host}/inject`, { tx: Utils.safeStringify(tx) })).data)
    } catch (error) {
      entry.reason = `Submission outcome unknown: ${error.message}`
    }
    if (response?.result?.success === false) {
      entry.status = 'failed'
      entry.reason = response.result.reason || 'Submission rejected by node'
      this.remember(entry)
      return { ...response, txId, status: entry.status, reason: entry.reason }
    }
    if (response?.result?.success === true) entry.status = 'pending'
    this.remember(entry)
    report(`${entry.status}: waiting for a committed receipt (up to ${this.waitMs / 1000} seconds).`)
    const result = await this.receipt(txId, this.waitMs)
    return { ...response, ...result }
  }
}

function profileTemplate(type) {
  if (!['person', 'organization', 'government', 'company', 'university', 'school'].includes(type)) throw new Error('Choose person, organization, government, company, university, or school')
  const details = type === 'person' ? {
    firstName: 'Alice', lastName: 'Example', headline: '', skills: [], experience: [], education: [], projects: [],
    certifications: [], languages: [], awards: [], publications: [], patents: [], courses: [], volunteering: [],
    memberships: [], speaking: [], interests: [], referencesAvailableOnRequest: true,
  } : { legalName: 'Example entity', ...(type === 'government' ? { jurisdiction: 'Example jurisdiction', level: 'local' } : {}) }
  return { type, displayName: type === 'person' ? 'Alice Example' : 'Example entity', summary: '', contact: {}, details }
}

function contractTemplate() {
  return { origin: 'historical', title: 'Example completed contract', publicDescription: 'Replace with the work performed',
    workerProfileId: 'REPLACE_WITH_WORKER_PROFILE_ID', hiringProfileIds: ['REPLACE_WITH_HIRING_PROFILE_ID'], skillIds: [],
    terms: { responsibilities: ['Describe the work'], acceptanceCriteria: ['Describe the agreed outcome'],
      startDate: '2024-01-01', endDate: '2024-02-01', durationMonths: 1, workMode: 'remote' },
    workStatus: 'completed', periodOutcomes: [{ month: 1, outcome: 'success' }], evidence: [] }
}

module.exports = { WinClient, address, parseWin, assertId, sign, receiptState, localNetworkId, readJson, writePrivateJson, profileTemplate, contractTemplate }
