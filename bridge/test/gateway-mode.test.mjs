import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, withdrawalEvidence } from '../operator.mjs'

const base = {
  networkId: 'a'.repeat(64),
  vaultAddress: '0x' + 'b'.repeat(40),
  vaultCodeHash: '0x' + 'c'.repeat(64),
  operators: ['1', '2', '3'].map((n) => '0x' + n.repeat(40)),
  bnbRpc: 'https://bnb.example',
  nativeGateways: ['https://one.example', 'https://two.example', 'https://three.example'],
  walletOrigin: 'https://wallet.example',
}
function readConfig(t, changes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-gateway-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'operator.json')
  fs.writeFileSync(file, JSON.stringify({ ...base, ...changes }))
  return loadConfig(file)
}
function evidence(c) {
  const id = 'd'.repeat(64)
  const record = {
    id: 'e'.repeat(64),
    completed: true,
    type: 'BridgeRecord',
    networkId: c.networkId,
    vaultAddress: c.vaultAddress,
    eventId: id,
    operation: 'bridge_withdraw',
    accounting: 'deposit-backed-v1',
    nativeMinted: '0',
    nativeBurned: '100',
    from: 'f'.repeat(64),
    recipient: '0x' + '4'.repeat(40),
    amount: '100',
    txId: 'transaction-id',
  }
  const receipt = {
    success: true,
    txId: record.txId,
    networkId: c.networkId,
    type: 'bridge_withdraw',
    from: record.from,
    additionalInfo: { recordId: record.id, bridgeId: id, accounting: 'deposit-backed-v1', nativeMinted: '0', nativeBurned: '100', amount: '100' },
  }
  const read = async (url) => (url.includes('/transaction/') ? { transaction: receipt } : { networkId: c.networkId, record })
  return { id, record, receipt, read }
}
test('single gateway requires explicit mode and accepts a loopback proxy', (t) => {
  const nativeGateways = ['http://127.0.0.1:3030']
  assert.throws(() => readConfig(t, { nativeGateways }), /Three independent/)
  const c = readConfig(t, { nativeGateways, nativeGatewayMode: 'single' })
  assert.equal(c.nativeGatewayMode, 'single')
  assert.deepEqual(c.nativeGateways, nativeGateways)
  assert.throws(() => readConfig(t, { nativeGatewayMode: 'single' }), /exactly one/)
  assert.throws(() => readConfig(t, { nativeGatewayMode: 'typo' }), /gateway mode/i)
})
test('gateway configuration rejects duplicate URLs after normalization and public HTTP', (t) => {
  assert.throws(() => readConfig(t, { nativeGateways: ['https://one.example', 'https://one.example/', 'https://three.example'] }), /Three independent/)
  assert.throws(() => readConfig(t, { nativeGatewayMode: 'single', nativeGateways: ['http://public.example'] }), /Secure/)
})
test('single gateway still requires matching successful committed record and receipt', async () => {
  const c = { ...base, nativeGatewayMode: 'single', nativeGateways: ['http://127.0.0.1:3030'] }
  const e = evidence(c)
  const calls = []
  const result = await withdrawalEvidence(c, e.id, async (url) => {
    calls.push(url)
    return e.read(url)
  })
  assert.equal(result.amount, '100')
  assert.equal(calls.length, 2)
  e.receipt.success = false
  await assert.rejects(withdrawalEvidence(c, e.id, e.read), /gateway/i)
  e.receipt.success = true
  e.receipt.additionalInfo.recordId = 'wrong'
  await assert.rejects(withdrawalEvidence(c, e.id, e.read), /gateway/i)
  e.receipt.additionalInfo.recordId = e.record.id
  e.record.networkId = '0'.repeat(64)
  await assert.rejects(withdrawalEvidence(c, e.id, e.read), /gateway/i)
  await assert.rejects(
    withdrawalEvidence(c, e.id, async () => {
      throw new Error('offline')
    }),
    /gateway/i,
  )
})
test('default quorum never falls back to one gateway during an outage', async () => {
  const c = { ...base }
  const e = evidence(c)
  await assert.rejects(
    withdrawalEvidence(c, e.id, async (url) => {
      if (!url.startsWith(c.nativeGateways[0])) throw new Error('offline')
      return e.read(url)
    }),
    /Two trusted/,
  )
  assert.equal(
    (
      await withdrawalEvidence(c, e.id, async (url) => {
        if (url.startsWith(c.nativeGateways[2])) throw new Error('offline')
        return e.read(url)
      })
    ).amount,
    '100',
  )
})

test('operators reject legacy or mismatched burns even with a successful receipt', async () => {
  const c = { ...base, nativeGatewayMode: 'single', nativeGateways: ['http://127.0.0.1:3030'] }
  for (const patch of [{ accounting: undefined }, { nativeBurned: '0' }, { nativeMinted: '1' }]) {
    const e = evidence(c)
    Object.assign(e.record, patch)
    await assert.rejects(withdrawalEvidence(c, e.id, e.read), /gateway/i)
  }
  for (const patch of [{ accounting: undefined }, { nativeBurned: '99' }, { nativeMinted: '1' }, { amount: '99' }]) {
    const e = evidence(c)
    Object.assign(e.receipt.additionalInfo, patch)
    await assert.rejects(withdrawalEvidence(c, e.id, e.read), /gateway/i)
  }
  const e = evidence(c)
  Object.assign(e.receipt.additionalInfo, {
    nativeBurned: { dataType: 'bi', value: '64' },
    nativeMinted: { dataType: 'bi', value: '0' },
    amount: { dataType: 'bi', value: '64' },
  })
  assert.equal((await withdrawalEvidence(c, e.id, e.read)).amount, '100')
})
