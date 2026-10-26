const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
function config(extra = {}) {
  const env = { ...process.env }
  for (const key of ['WIN_LOCAL_TEST', 'WIN_LOCAL_NETWORK_ID', 'WIN_LOCAL_ARCHIVER_VERSION', 'BASE_DIR', 'APP_SEEDLIST', 'EXISTING_ARCHIVERS']) delete env[key]
  return spawnSync(process.execPath, ['-e', `const c = require('./dist/config'); process.stdout.write(JSON.stringify({ id: c.WIN_NETWORK_ID, local: c.IS_LOCAL_TEST, staking: c.WinFlags.StakingEnabled, archiver: c.INITIAL_PARAMETERS.archiver, ip: c.default.server.ip, p2p: { min: c.default.server.p2p.minNodes, max: c.default.server.p2p.maxNodes, baseline: c.default.server.p2p.baselineNodes, rotate: c.default.server.p2p.maxRotatedPerCycle }, sharding: c.default.server.sharding }));`], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' })
}
const local = {
  WIN_LOCAL_TEST: '1', WIN_LOCAL_NETWORK_ID: 'a'.repeat(64), WIN_LOCAL_ARCHIVER_VERSION: '1.0.0',
  WIN_LOCAL_AUTHORITY_PUBLIC_KEY: 'c'.repeat(64),
  EXISTING_ARCHIVERS: JSON.stringify([{ ip: '127.0.0.1', port: 4000, publicKey: 'b'.repeat(64) }]),
}

test('default deployment keeps its network domain, staking and archiver gate', () => {
  const result = config()
  assert.equal(result.status, 0, result.stderr)
  assert.ifError(result.error)
  const data = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.equal(data.local, false)
  assert.equal(data.id, 'f4ad1838b012fe4af28cfbcc01c30044e3e225ef6be7e8461343d1de369949d9')
  assert.equal(data.staking, true)
  assert.equal(data.archiver.minVersion, '3.8.3')
})

test('local configuration isolates the domain and pins three loopback validators and their consensus group', () => {
  const result = config({ ...local, APP_IP: '162.35.97.118', minNodes: '100', maxNodes: '1000', baselineNodes: '100', maxRotatedPerCycle: '10', nodesPerConsensusGroup: '10', nodesPerEdge: '5' })
  assert.equal(result.status, 0, result.stderr)
  assert.ifError(result.error)
  const data = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.equal(data.local, true)
  assert.equal(data.id, local.WIN_LOCAL_NETWORK_ID)
  assert.equal(data.staking, false)
  assert.equal(data.archiver.minVersion, '1.0.0')
  assert.equal(data.ip.externalIp, '127.0.0.1')
  assert.equal(data.ip.internalIp, '127.0.0.1')
  assert.deepEqual(data.p2p, { min: 3, max: 3, baseline: 3, rotate: 0 })
  assert.equal(data.sharding.nodesPerConsensusGroup, 3)
  assert.equal(data.sharding.nodesPerEdge, 1)
})

test('launcher uses three validator ports and rejects stale, partial or mismatched processing cycles', () => {
  const { ports, validatorCount, processingCycle } = require('./local-network')
  assert.equal(validatorCount, 3)
  assert.deepEqual(ports, [3000, 4000, 9001, 9002, 9003, 10001, 10002, 10003])
  const cycle = { mode: 'processing', active: 3, start: Date.now() / 1000, duration: 15 }
  assert.equal(processingCycle(cycle, 3), true)
  for (const change of [{ active: 2 }, { active: 10 }, { mode: 'forming' }, { start: 0 }, { duration: -1 }]) {
    assert.equal(processingCycle({ ...cycle, ...change }, 3), false)
  }
  const shardFunctions = require('@shardus/core/dist/state-manager/shardFunctions').default
  const globals = shardFunctions.calculateShardGlobals(3, 3, 1)
  assert.equal(globals.numActiveNodes, 3)
  assert.equal(globals.nodesPerConsenusGroup, 3)
  assert.equal(globals.consensusRadius, 1)
})

test('a ten-node resize preserves identity, keys, backup and node data, and requires a stopped checkpoint', t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const { readManifest, resizeManifest } = require('./local-network')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-resize-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'local-network.json')
  const manifest = { format: 2, root, nodes: 10, networkId: 'a'.repeat(64), authority: { publicKey: 'test-authority' }, archiver: { publicKey: 'test-archiver' } }
  const original = JSON.stringify(manifest)
  fs.writeFileSync(file, original, { mode: 0o600 })
  fs.mkdirSync(path.join(dir, 'win-local-node-9010'))
  fs.writeFileSync(path.join(dir, 'win-local-node-9010', 'ledger.fixture'), 'preserve')
  const queue = { networkId: manifest.networkId, cycle: 1, mode: 'shutdown' }
  assert.deepEqual(readManifest(dir), manifest)
  assert.throws(() => resizeManifest(manifest, queue, [{ status: 'online' }], file), /stopped services/)
  for (const change of [{ cycle: -1 }, { mode: 'processing' }, { networkId: 'b'.repeat(64) }]) {
    assert.throws(() => resizeManifest(manifest, { ...queue, ...change }, [], file), /checkpoint/)
  }
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  const updated = resizeManifest(manifest, queue, [], file)
  assert.deepEqual(updated, { ...manifest, nodes: 3 })
  assert.deepEqual(readManifest(dir), updated)
  const backup = path.join(dir, 'local-network.10-nodes.json')
  assert.equal(fs.readFileSync(backup, 'utf8'), original)
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(fs.readFileSync(path.join(dir, 'win-local-node-9010', 'ledger.fixture'), 'utf8'), 'preserve')
  assert.deepEqual(resizeManifest(updated, queue, [], file), updated)
})

test('local configuration rejects a missing/deployment domain, unsupported archiver, and remote discovery', () => {
  for (const overrides of [
    { WIN_LOCAL_NETWORK_ID: '' },
    { WIN_LOCAL_NETWORK_ID: 'f4ad1838b012fe4af28cfbcc01c30044e3e225ef6be7e8461343d1de369949d9' },
    { WIN_LOCAL_ARCHIVER_VERSION: '3.8.3' },
    { WIN_LOCAL_AUTHORITY_PUBLIC_KEY: '' },
    { EXISTING_ARCHIVERS: JSON.stringify([{ ip: '162.35.97.118', port: 4000, publicKey: 'b'.repeat(64) }]) },
  ]) {
    const result = config({ ...local, ...overrides })
    assert.ifError(result.error)
    assert.notEqual(result.status, 0)
  }
})

test('listener guard constrains TCP bind overloads and preserves Unix sockets', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('assert/strict'); const net = require('net');
    const shardusNet = require('@shardus/lib-net'); let transportOptions;
    shardusNet.Sn = options => { transportOptions = options; return 'transport'; };
    let seen; net.Server.prototype.listen = function (...args) { seen = args; return this; };
    require('./scripts/local-loopback'); const server = new net.Server(); const cb = () => {};
    assert.equal(server.listen(3000, cb), server); assert.deepEqual(seen, [3000, '127.0.0.1', cb]);
    server.listen(4000, '0.0.0.0', cb); assert.deepEqual(seen, [4000, '127.0.0.1', cb]);
    server.listen({ port: 4000, host: '::', backlog: 10 }, cb); assert.deepEqual(seen, [{ port: 4000, host: '127.0.0.1', backlog: 10 }, cb]);
    server.listen('/tmp/win-test.sock', cb); assert.deepEqual(seen, ['/tmp/win-test.sock', cb]);
    assert.equal(shardusNet.Sn({ port: 10001, address: '0.0.0.0', crypto: 'preserved' }), 'transport');
    assert.deepEqual(transportOptions, { port: 10001, address: '127.0.0.1', crypto: 'preserved' });
  `], { cwd: root, env: { ...process.env, WIN_LOCAL_TEST: '1' }, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
})

test('queue recovery preserves signed cycle contents and refuses corrupt or incomplete history', async t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const sqlite = require('sqlite3')
  const crypto = require('@shardus/lib-crypto-utils')
  const { Utils } = require('@shardus/lib-types')
  const { recoverQueue } = require('./local-network')
  crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
  crypto.setCustomStringifier(Utils.safeStringify, 'shardus_safeStringify')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-queue-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let count = 0
  async function fixture(cycles) {
    const file = path.join(dir, `${count++}.sqlite3`)
    await new Promise((resolve, reject) => {
      const db = new sqlite.Database(file)
      db.serialize(() => {
        db.run('CREATE TABLE cycles (counter INTEGER, cycleRecord TEXT)', error => { if (error) reject(error) })
        for (const cycle of cycles) db.run('INSERT INTO cycles VALUES (?, ?)', [cycle.counter, Utils.safeStringify(cycle)], error => { if (error) reject(error) })
        db.close(error => error ? reject(error) : resolve())
      })
    })
    return file
  }
  const added = { hash: 'a'.repeat(64), type: 'claim_reward', cycle: 0, priority: 1, txData: { amount: 123n, sign: { owner: 'test', sig: 'test' } } }
  const expected = [{ hash: added.hash, tx: { hash: added.hash, type: added.type, cycle: 0, priority: 1, txData: { amount: 123n } } }]
  const cycle = { counter: 0, mode: 'shutdown', txadd: [added], txremove: [], txlisthash: crypto.hashObj(expected) }
  const manifest = { networkId: 'a'.repeat(64) }
  const recovered = await recoverQueue(manifest, await fixture([cycle]))
  assert.deepEqual(recovered.txList, expected)
  assert.equal(recovered.hash, cycle.txlisthash)
  const removed = { counter: 1, mode: 'shutdown', txadd: [], txremove: [{ txHash: added.hash }], txlisthash: crypto.hashObj([]) }
  assert.deepEqual((await recoverQueue(manifest, await fixture([cycle, removed]))).txList, [])
  await assert.rejects(recoverQueue(manifest, await fixture([{ ...cycle, txlisthash: 'bad' }])), /hash mismatch/)
  await assert.rejects(recoverQueue(manifest, await fixture([{ ...cycle, counter: 1 }])), /history has a gap/)
  await assert.rejects(recoverQueue(manifest, await fixture([{ ...cycle, mode: 'processing' }])), /no shutdown checkpoint/)
})
