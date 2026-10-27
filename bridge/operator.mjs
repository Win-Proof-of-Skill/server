import http from 'node:http'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JsonRpcProvider, Contract, Wallet, keccak256, FetchRequest } from 'ethers'
export const ACCOUNTING = 'deposit-backed-v1'
export const ABI = [
  'function token() view returns(address)',
  'function networkId() view returns(bytes32)',
  'function feeBps() view returns(uint256)',
  'function operators(uint256) view returns(address)',
  'function released(bytes32) view returns(bool)',
  'function deposit(uint256,bytes32) returns(bytes32)',
  'function release(bytes32,address,uint256,bytes[2])',
  'event Deposited(bytes32 indexed id,bytes32 indexed recipient,address indexed sender,uint256 amount)',
  'event Released(bytes32 indexed id,address indexed recipient,uint256 amount)',
]
export const types = {
  Deposit: [
    { name: 'id', type: 'bytes32' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
  ],
  Withdrawal: [
    { name: 'id', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
}
export const domain = (c) => ({ name: 'WINBridge', version: '1', chainId: 56, verifyingContract: c.vaultAddress, salt: '0x' + c.networkId })
const hash = (v) => typeof v === 'string' && /^0x[a-f0-9]{64}$/.test(v)
const token = '0x8a27363dd26f78b09014338e106b16055fcb9799'
export async function verifyVault(provider, vault, c) {
  if (BigInt(await provider.send('eth_chainId', [])) !== 56n) throw new Error('BNB mainnet required')
  if (keccak256(await provider.getCode(c.vaultAddress)).toLowerCase() !== c.vaultCodeHash) throw new Error('Vault code mismatch')
  if ((await vault.token()).toLowerCase() !== token || (await vault.networkId()) !== '0x' + c.networkId || (await vault.feeBps()) !== 50n)
    throw new Error('Vault configuration mismatch')
  for (let i = 0; i < 3; i++) if ((await vault.operators(i)).toLowerCase() !== c.operators[i]) throw new Error('Vault operator mismatch')
}
export async function depositEvidence(provider, vault, c, transactionHash) {
  if (!hash(transactionHash)) throw new Error('Invalid source transaction hash')
  const receipt = await provider.getTransactionReceipt(transactionHash)
  const finalized = await provider.send('eth_getBlockByNumber', ['finalized', false])
  if (!receipt || receipt.status !== 1 || !finalized || BigInt(receipt.blockNumber) > BigInt(finalized.number)) throw new Error('Deposit is not finalized')
  const canonical = await provider.send('eth_getBlockByNumber', ['0x' + receipt.blockNumber.toString(16), false])
  if (canonical?.hash !== receipt.blockHash) throw new Error('Noncanonical deposit')
  const events = receipt.logs
    .filter((l) => l.address.toLowerCase() === c.vaultAddress)
    .flatMap((l) => {
      try {
        const e = vault.interface.parseLog(l)
        return e?.name === 'Deposited' ? [e] : []
      } catch {
        return []
      }
    })
  if (events.length !== 1) throw new Error('Exactly one vault deposit required')
  const { id, recipient, amount } = events[0].args
  if (amount <= 0n) throw new Error('Invalid deposit amount')
  return { id, recipient, amount: amount.toString() }
}
async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('Native gateway unavailable')
  return response.json()
}
export function nativeGatewayPolicy(c) {
  const mode = c.nativeGatewayMode ?? 'quorum'
  if (!['quorum', 'single'].includes(mode)) throw new Error('Invalid native gateway mode')
  const expected = mode === 'single' ? 1 : 3
  const countError = mode === 'single' ? 'Single gateway mode requires exactly one native gateway' : 'Three independent native gateways required'
  if (!Array.isArray(c.nativeGateways) || c.nativeGateways.length !== expected) throw new Error(countError)
  const gateways = c.nativeGateways.map((value) => {
    const u = new URL(value)
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    )
      throw new Error('Secure trusted native gateways required')
    return u.toString().replace(/\/$/, '')
  })
  if (new Set(gateways).size !== expected) throw new Error(countError)
  return { mode, gateways, threshold: mode === 'single' ? 1 : 2 }
}
// Native receipts use Shardus bigint wire objects; records expose decimal strings.
function atomic(value) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,81})$/.test(value)) return value
  if (value?.dataType === 'bi' && typeof value.value === 'string' && /^[a-f0-9]{1,68}$/i.test(value.value)) return BigInt('0x' + value.value).toString()
  return null
}
export async function withdrawalEvidence(c, id, reader = read) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid native withdrawal ID')
  const policy = nativeGatewayPolicy(c)
  const outcomes = await Promise.allSettled(
    policy.gateways.map(async (base) => {
      const result = await reader(base + '/bridge/v2/records/bridge_withdraw/' + id)
      const r = result?.record
      if (
        result?.networkId !== c.networkId ||
        !r?.completed ||
        r.type !== 'BridgeRecord' ||
        r.networkId !== c.networkId ||
        r.vaultAddress !== c.vaultAddress ||
        r.eventId !== id ||
        r.operation !== 'bridge_withdraw' ||
        r.accounting !== ACCOUNTING ||
        r.nativeBurned !== r.amount ||
        r.nativeMinted !== '0' ||
        !/^[1-9][0-9]*$/.test(r.amount)
      )
        throw new Error('Withdrawal not committed')
      const receipt = (await reader(base + '/transaction/' + r.txId))?.transaction
      if (
        !receipt ||
        receipt.success !== true ||
        receipt.txId !== r.txId ||
        receipt.networkId !== c.networkId ||
        receipt.type !== 'bridge_withdraw' ||
        receipt.from !== r.from ||
        receipt.additionalInfo?.recordId !== r.id ||
        receipt.additionalInfo?.bridgeId !== id ||
        receipt.additionalInfo?.accounting !== ACCOUNTING ||
        atomic(receipt.additionalInfo?.nativeBurned) !== r.amount ||
        atomic(receipt.additionalInfo?.nativeMinted) !== '0' ||
        atomic(receipt.additionalInfo?.amount) !== r.amount
      )
        throw new Error('Missing committed withdrawal receipt')
      return { id: '0x' + id, recipient: r.recipient, amount: r.amount }
    }),
  )
  const counts = new Map()
  for (const r of outcomes)
    if (r.status === 'fulfilled') {
      const key = JSON.stringify(r.value)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  const agreement = [...counts].find(([, count]) => count >= policy.threshold)
  if (!agreement)
    throw new Error(
      policy.mode === 'single'
        ? 'Trusted native gateway must confirm the committed withdrawal and successful receipt'
        : 'Two trusted native gateways must agree on the committed withdrawal',
    )
  return JSON.parse(agreement[0])
}
export function loadConfig(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'))
  return validateConfig(c)
}
export function validateConfig(c) {
  if (
    !/^[a-f0-9]{64}$/.test(c.networkId) ||
    !/^0x[a-f0-9]{40}$/.test(c.vaultAddress) ||
    !hash(c.vaultCodeHash) ||
    c.operators?.length !== 3 ||
    new Set(c.operators).size !== 3 ||
    c.operators.some((address) => !/^0x[a-f0-9]{40}$/.test(address))
  )
    throw new Error('Invalid deployment config')
  nativeGatewayPolicy(c)
  for (const value of [c.bnbRpc]) {
    const u = new URL(value)
    if (
      u.username ||
      u.password ||
      u.hash ||
      !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    )
      throw new Error('Secure trusted endpoints required')
  }
  const origin = new URL(c.walletOrigin)
  if (
    origin.origin !== c.walletOrigin ||
    origin.username ||
    origin.password ||
    !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Explicit secure wallet origin required')
  return c
}
export function readOperatorKey(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || (process.platform !== 'win32' && stat.mode & 0o077)) throw new Error('Operator key must be a private regular file (chmod 600)')
  let key
  try {
    key = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!/^0x[a-fA-F0-9]{64}$/.test(key.privateKey)) throw new Error()
    const signer = new Wallet(key.privateKey)
    if (key.address && key.address.toLowerCase() !== signer.address.toLowerCase()) throw new Error()
    return signer
  } catch {
    throw new Error('Invalid operator key file; restore the matching key')
  }
}
export async function serve() {
  const c = loadConfig(process.env.WIN_BRIDGE_CONFIG)
  if (process.env.WIN_BRIDGE_KEY_FILE && process.env.WIN_BRIDGE_OPERATOR_KEY) throw new Error('Set only WIN_BRIDGE_KEY_FILE or WIN_BRIDGE_OPERATOR_KEY')
  const signer = process.env.WIN_BRIDGE_KEY_FILE ? readOperatorKey(process.env.WIN_BRIDGE_KEY_FILE) : new Wallet(process.env.WIN_BRIDGE_OPERATOR_KEY)
  if (!c.operators.includes(signer.address.toLowerCase())) throw new Error('Key is not a configured operator')
  const policy = nativeGatewayPolicy(c)
  if (policy.mode === 'single') console.warn('Single gateway mode: withdrawal evidence trusts one native gateway. Two operator signatures are still required.')
  const transport = new FetchRequest(c.bnbRpc)
  transport.timeout = 10000
  const provider = new JsonRpcProvider(transport),
    vault = new Contract(c.vaultAddress, ABI, provider)
  await verifyVault(provider, vault, c)
  let active = 0
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', c.walletOrigin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          accounting: ACCOUNTING,
          networkId: c.networkId,
          vaultAddress: c.vaultAddress,
          operator: signer.address.toLowerCase(),
          nativeGatewayMode: policy.mode,
          nativeGatewayQuorum: policy.threshold,
        }),
      )
      return
    }
    if (req.method !== 'POST' || !['/deposit', '/withdraw'].includes(req.url)) {
      res.writeHead(404).end()
      return
    }
    if (active >= 8) {
      res.writeHead(429).end()
      return
    }
    active++
    try {
      let text = ''
      for await (const chunk of req) {
        text += chunk
        if (text.length > 1024) throw new Error('Request too large')
      }
      const body = JSON.parse(text)
      await verifyVault(provider, vault, c)
      const kind = req.url === '/deposit' ? 'Deposit' : 'Withdrawal'
      const value = kind === 'Deposit' ? await depositEvidence(provider, vault, c, body.transactionHash) : await withdrawalEvidence(c, body.id)
      const signature = await signer.signTypedData(domain(c), { [kind]: types[kind] }, value)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ networkId: c.networkId, vaultAddress: c.vaultAddress, operator: signer.address.toLowerCase(), value, signature }))
    } catch (error) {
      res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }))
    } finally {
      active--
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.once('close', () => provider.destroy())
  server.listen(Number(process.env.PORT || 8081), '127.0.0.1', () => console.log('WIN bridge operator listening on loopback'))
  return server
}
// PM2 imports ESM through its launcher; argv[1] then points to that launcher.
const entryPoint = process.env.pm_exec_path || process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    await serve()
  } catch (error) {
    console.error('WIN bridge operator failed to start:', error.message)
    process.exit(1)
  }
}
