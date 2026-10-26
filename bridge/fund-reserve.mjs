// Prepare a signed reserve funding transaction; broadcast only with an explicit flag.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { Wallet, parseUnits, verifyMessage } from 'ethers'
const require = createRequire(import.meta.url),
  crypto = require('@shardus/lib-crypto-utils'),
  { Utils } = require('@shardus/lib-types')
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
crypto.setCustomStringifier(Utils.safeStringify)
const base = process.env.WIN_NATIVE_GATEWAY?.replace(/\/$/, ''),
  file = process.env.WIN_RESERVE_TX_FILE
if (!base || !file) throw new Error('Set WIN_NATIVE_GATEWAY and WIN_RESERVE_TX_FILE (keep the file for retries)')
const url = new URL(base)
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
)
  throw new Error('Secure native gateway required')
async function read(path) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('Gateway unavailable')
  return Utils.safeJsonParse(await r.text())
}
const c = await read('/bridge/v2/status')
if (!c.configured || c.protocol !== 2) throw new Error('Configure the bridge before funding')
let tx
if (fs.existsSync(file)) tx = Utils.safeJsonParse(fs.readFileSync(file, 'utf8'))
else {
  const signer = new Wallet(process.env.WIN_NATIVE_FUNDING_KEY),
    from = signer.address.slice(2).toLowerCase() + '0'.repeat(24),
    amount = parseUnits(process.env.WIN_RESERVE_AMOUNT, 18)
  const account = (await read('/account/' + from))?.account
  if (amount <= 0n || account?.type !== 'UserAccount' || account.id !== from || account.data.balance < amount)
    throw new Error('Funded native wallet and positive amount required')
  tx = {
    type: 'bridge_fund',
    from,
    to: c.reserveAddress,
    networkId: c.networkId,
    amount,
    fee: 0n,
    nonce: (account.data.transferNonce ?? 0) + 1,
    id: randomBytes(32).toString('hex'),
    timestamp: Date.now(),
  }
  tx.sign = { owner: from, sig: await signer.signMessage(crypto.hashObj(tx)) }
  fs.writeFileSync(file, Utils.safeStringify(tx), { flag: 'wx', mode: 0o600 })
}
const { sign, ...unsigned } = tx,
  txId = crypto.hashObj(unsigned)
if (
  tx.type !== 'bridge_fund' ||
  tx.networkId !== c.networkId ||
  tx.to !== c.reserveAddress ||
  tx.fee !== 0n ||
  verifyMessage(txId, sign.sig).slice(2).toLowerCase() + '0'.repeat(24) !== tx.from
)
  throw new Error('Saved funding transaction mismatch')
console.log(`Prepared ${txId}: ${tx.amount} atomic native WIN to ${tx.to}.`)
if (process.argv.includes('--broadcast')) {
  if (process.env.CONFIRM_NATIVE_RESERVE_FUNDING !== 'yes')
    throw new Error('Set CONFIRM_NATIVE_RESERVE_FUNDING=yes to authorize moving the displayed native funds')
  const r = await fetch(base + '/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Utils.safeStringify({ tx: Utils.safeStringify(tx) }),
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error('Submission response unavailable; retry the same saved transaction')
  console.log(await r.text())
  console.log('Submission is not settlement. Verify /transaction/' + txId + ' has success:true before enabling conversions.')
}
