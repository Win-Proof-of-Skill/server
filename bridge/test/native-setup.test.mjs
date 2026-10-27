import test from 'node:test'
import assert from 'node:assert/strict'
import { deploymentEntry, updatedSettings, verifyNativeStatus } from '../configure-native.mjs'
const deployed = {
  networkId: 'a'.repeat(64),
  vaultAddress: '0x' + 'b'.repeat(40),
  vaultCodeHash: '0x' + 'c'.repeat(64),
  operators: ['d', 'e', 'f'].map((n) => '0x' + n.repeat(40)),
}
const urls = ['https://one.example', 'https://two.example', 'https://three.example']
test('native setup copies only validated public deployment data and defaults to disabled', () => {
  const entry = deploymentEntry(deployed, { ...deployed, bnbRpc: 'https://rpc.example' }, urls)
  assert.equal(entry.enabled, false)
  assert.equal(entry.accounting, 'deposit-backed-v1')
  assert.equal(entry.reserveCapAtomic, undefined)
  assert.throws(() => deploymentEntry(deployed, { ...deployed, operators: [...deployed.operators].reverse() }, urls), /must match/)
  assert.throws(() => deploymentEntry(deployed, deployed, [urls[0], urls[0], urls[1]]), /observer/)
})
test('native setup preserves other networks and refuses conflicting deployments or enabling an unprepared entry', () => {
  const entry = deploymentEntry(deployed, deployed, urls),
    original = { schemaVersion: 2, deployments: { other: { enabled: false } } }
  const prepared = updatedSettings(original, deployed.networkId, entry)
  assert.deepEqual(prepared.deployments.other, original.deployments.other)
  assert.equal(original.deployments[deployed.networkId], undefined)
  assert.equal(updatedSettings(prepared, deployed.networkId, entry, true).deployments[deployed.networkId].enabled, true)
  assert.throws(() => updatedSettings(original, deployed.networkId, entry, true), /Prepare/)
  assert.throws(() => updatedSettings(prepared, deployed.networkId, { ...entry, vaultCodeHash: '0x' + '1'.repeat(64) }), /differs/)
})
test('activation requires upgraded matching validators; no funded legacy reserve is automatically migrated', () => {
  const old = { networkId: deployed.networkId, protocol: 2, configured: false, enabled: false, nativeLiquidity: '0', backedWithdrawalCapacity: '0' }
  verifyNativeStatus(old, deployed)
  assert.throws(() => verifyNativeStatus(old, deployed, true), /upgrade/)
  assert.throws(() => verifyNativeStatus({ ...old, nativeLiquidity: '1' }, deployed), /legacy/)
  const status = {
    ...deployed,
    protocol: 2,
    configured: true,
    accounting: 'deposit-backed-v1',
    requiresNativePrefunding: false,
    nativeMinted: '0',
    nativeBurned: '0',
    nativeOutstanding: '0',
    backedWithdrawalCapacity: '0',
  }
  verifyNativeStatus(status, deployed, true)
  assert.throws(() => verifyNativeStatus({ ...status, networkId: 'f'.repeat(64) }, deployed, true), /mismatch/)
  assert.throws(() => verifyNativeStatus({ ...status, nativeMinted: '1' }, deployed, true), /supply/)
  assert.throws(() => verifyNativeStatus({ ...status, operators: [] }, deployed, true), /Restart/)
})
