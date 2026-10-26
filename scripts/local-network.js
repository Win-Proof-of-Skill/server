'use strict'

const fs = require('fs')
const path = require('path')
const net = require('net')
const http = require('http')
const { randomBytes } = require('crypto')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'instances-local')
const manifestPath = path.join(directory, 'local-network.json')
const ecosystemPath = path.join(directory, 'ecosystem.config.json')
const hashKey = '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc'
const ports = [3000, 4000, ...Array.from({ length: 10 }, (_, i) => 9001 + i), ...Array.from({ length: 10 }, (_, i) => 10001 + i)]

function readManifest() {
  if (!fs.existsSync(directory)) return null
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Refusing a symlink as the local network directory')
  if (!fs.existsSync(manifestPath)) throw new Error('instances-local exists without a WIN manifest; no files were overwritten')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.format !== 2 || manifest.root !== root || manifest.nodes !== 10 || !/^[a-f0-9]{64}$/.test(manifest.networkId) || !manifest.authority) {
    throw new Error('Local manifest does not match this checkout; no files were overwritten')
  }
  return manifest
}

function dependencies() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required')
  const archiver = require('@shardus/archiver/package.json')
  if (archiver.version !== '1.0.0') throw new Error(`Expected the pinned WIN archiver 1.0.0, found ${archiver.version}`)
  if (!fs.existsSync(path.join(root, 'dist/index.js'))) throw new Error('Compile the server first with npm run compile')
  // Exercise the actual installed hashing implementations, including bigint data.
  const crypto = require('@shardus/lib-crypto-utils')
  const { Utils } = require('@shardus/lib-types')
  crypto.init(hashKey)
  crypto.setCustomStringifier(Utils.safeStringify, 'shardus_safeStringify')
  const archiveRoot = path.dirname(require.resolve('@shardus/archiver/package.json'))
  require(path.join(archiveRoot, 'build/Crypto')).setCryptoHashKey(hashKey)
  const { calculateAccountHash } = require(path.join(archiveRoot, 'build/app/calculateAccountHash'))
  for (const type of ['NetworkAccount', 'UserAccount', 'ProfilesAccount', 'ContractsAccount', 'EndorsementsAccount', 'ScoresAccount', 'SkillsAccount']) {
    const account = { id: 'a'.repeat(64), type, timestamp: 1000, hash: '', data: { balance: 10n ** 18n }, revision: 1 }
    if (calculateAccountHash({ ...account }) !== crypto.hashObj(account)) throw new Error(`Archiver hash mismatch for ${type}`)
  }
  return { archiver: require.resolve('@shardus/archiver'), monitor: require.resolve('@shardus/monitor-server') }
}

function jsonWrite(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
}

async function recoverQueue(manifest, database = path.join(directory, 'win-local-archiver', 'archiver-db', 'cycles.sqlite3')) {
  const crypto = require('@shardus/lib-crypto-utils')
  const { Utils } = require('@shardus/lib-types')
  const txList = []
  let lastCycle = null
  if (fs.existsSync(database)) {
    const sqlite = require('sqlite3')
    await new Promise((resolve, reject) => {
      const db = new sqlite.Database(database, sqlite.OPEN_READONLY, error => {
        if (error) return reject(error)
        db.all('SELECT cycleRecord FROM cycles ORDER BY counter ASC', (queryError, rows) => {
          db.close()
          if (queryError) return reject(queryError)
          try {
            for (const row of rows) {
              const cycle = Utils.safeJsonParse(row.cycleRecord)
              if (cycle.counter !== (lastCycle ? lastCycle.counter + 1 : 0)) throw new Error('Local cycle history has a gap; queue recovery cannot be verified')
              for (const added of cycle.txadd || []) {
                const { sign, ...txData } = added.txData
                txList.push({ hash: added.hash, tx: { hash: added.hash, txData, type: added.type, cycle: added.cycle, priority: added.priority, ...(added.subQueueKey && { subQueueKey: added.subQueueKey }) } })
                txList.sort((a, b) => a.tx.cycle - b.tx.cycle || b.tx.priority - a.tx.priority || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
              }
              for (const removed of cycle.txremove || []) {
                const index = txList.findIndex(entry => entry.hash === removed.txHash)
                if (index < 0) throw new Error('Local cycle removes an unknown queued transaction')
                txList.splice(index, 1)
              }
              if (crypto.hashObj(txList) !== cycle.txlisthash) throw new Error(`Local queue hash mismatch at cycle ${cycle.counter}`)
              lastCycle = cycle
            }
            resolve()
          } catch (error) { reject(error) }
        })
      })
    })
  }
  if (lastCycle && lastCycle.mode !== 'shutdown') throw new Error('The saved local network has no shutdown checkpoint. Preserve its data and inspect recovery before restarting.')
  return { networkId: manifest.networkId, cycle: lastCycle?.counter ?? -1, hash: crypto.hashObj(txList), txList }
}

function prepare() {
  const existing = readManifest()
  if (existing) return existing
  const crypto = require('@shardus/lib-crypto-utils')
  crypto.init(hashKey)
  const manifest = { format: 2, root, nodes: 10, networkId: randomBytes(32).toString('hex'), archiver: crypto.generateKeypair(), authority: crypto.generateKeypair() }
  fs.mkdirSync(directory, { mode: 0o700 })
  jsonWrite(manifestPath, manifest)
  return manifest
}

function environment(manifest) {
  return {
    WIN_LOCAL_TEST: '1', WIN_LOCAL_NETWORK_ID: manifest.networkId, WIN_LOCAL_ARCHIVER_VERSION: '1.0.0',
    WIN_LOCAL_AUTHORITY_PUBLIC_KEY: manifest.authority.publicKey,
    APP_IP: '127.0.0.1', APP_MONITOR: '127.0.0.1', APP_SEEDLIST: '127.0.0.1', APP_SEEDLIST_PORT: '4000',
    APP_SEEDLIST_PUBLIC_KEY: manifest.archiver.publicKey,
    EXISTING_ARCHIVERS: JSON.stringify([{ ip: '127.0.0.1', port: 4000, publicKey: manifest.archiver.publicKey }]),
    ARCHIVER_INFO: `127.0.0.1:4000:${manifest.archiver.publicKey}`,
    minNodes: '10', baselineNodes: '10', maxNodes: '10', maxRotatedPerCycle: '0',
    nodesPerConsensusGroup: '10', nodesPerEdge: '5', CYCLE_DURATION: '15',
  }
}

function ecosystem(manifest, resolved, queue) {
  const env = environment(manifest)
  const common = {
    interpreter: process.execPath, node_args: ['--require', path.join(__dirname, 'local-loopback.js')],
    exec_mode: 'fork', instances: 1, autorestart: false, kill_timeout: 15000,
    merge_logs: true, time: true,
  }
  function app(name, script, extraEnv) {
    const cwd = path.join(directory, name)
    fs.mkdirSync(cwd, { recursive: true, mode: 0o700 })
    return { ...common, name, cwd, script, out_file: path.join(cwd, 'stdout.log'), error_file: path.join(cwd, 'stderr.log'), env: { ...env, ...extraEnv } }
  }
  // The package uses paths relative to its own installation for its signed
  // allow-list. Give this local network a runtime copy, leaving node_modules intact.
  const archivePackage = path.dirname(require.resolve('@shardus/archiver/package.json'))
  const archiveRuntime = path.join(directory, 'runtime', 'archiver')
  fs.mkdirSync(archiveRuntime, { recursive: true, mode: 0o700 })
  for (const item of ['build', 'static', 'package.json', 'archiver-log.json', 'tx-list-restore.json']) {
    fs.cpSync(path.join(archivePackage, item), path.join(archiveRuntime, item), { recursive: true })
  }
  const nestedDependencies = path.join(archivePackage, 'node_modules')
  if (fs.existsSync(nestedDependencies) && !fs.existsSync(path.join(archiveRuntime, 'node_modules'))) {
    fs.symlinkSync(nestedDependencies, path.join(archiveRuntime, 'node_modules'), 'dir')
  }
  const crypto = require('@shardus/lib-crypto-utils')
  const signed = { allowedArchivers: JSON.parse(env.EXISTING_ARCHIVERS) }
  crypto.signObj(signed, manifest.authority.secretKey, manifest.authority.publicKey)
  jsonWrite(path.join(archiveRuntime, 'allowed-archivers.json'), { allowedArchivers: signed.allowedArchivers, signatures: [signed.sign] })
  jsonWrite(path.join(archiveRuntime, 'archiver-config.json'), {
    multisigKeys: { [manifest.authority.publicKey]: 3 }, minSigRequiredForArchiverWhitelist: 1,
    isEthereumSigningEnabled: false, archivers: [],
  })
  fs.writeFileSync(path.join(archiveRuntime, 'network-queue.json'), require('@shardus/lib-types').Utils.safeStringify(queue), { mode: 0o600 })
  // The monitor writes backup files next to its compiled code, so isolate that
  // runtime too instead of letting test runs write into the installed package.
  const monitorPackage = path.dirname(require.resolve('@shardus/monitor-server/package.json'))
  const monitorRuntime = path.join(directory, 'runtime', 'monitor')
  fs.mkdirSync(monitorRuntime, { recursive: true, mode: 0o700 })
  for (const item of ['build', 'package.json']) {
    fs.cpSync(path.join(monitorPackage, item), path.join(monitorRuntime, item), {
      recursive: true,
      filter: source => !['req-log', 'cold_nodelist.json', 'cold_networkStat.json'].includes(path.basename(source)),
    })
  }
  if (fs.existsSync(path.join(monitorPackage, 'node_modules')) && !fs.existsSync(path.join(monitorRuntime, 'node_modules'))) {
    fs.symlinkSync(path.join(monitorPackage, 'node_modules'), path.join(monitorRuntime, 'node_modules'), 'dir')
  }
  const apps = [
    app('win-local-archiver', path.join(archiveRuntime, 'build/server.js'), {
      ARCHIVER_IP: '127.0.0.1', ARCHIVER_PORT: '4000', ARCHIVER_HASH_KEY: hashKey,
      ARCHIVER_PUBLIC_KEY: manifest.archiver.publicKey, ARCHIVER_SECRET_KEY: manifest.archiver.secretKey,
      WIN_LOCAL_ARCHIVER_RUNTIME: archiveRuntime,
      // The sole archiver bootstraps itself; advertising itself as an existing
      // peer makes discovery wait for a service that has not started yet.
      ARCHIVER_MODE: 'debug', ARCHIVER_DB: 'archiver-db', ARCHIVER_INFO: '',
      verifyReceiptData: 'true', verifyAccountData: 'true', verifyAppReceiptData: 'true',
    }),
    app('win-local-monitor', path.join(monitorRuntime, path.relative(monitorPackage, resolved.monitor)), { PORT: '3000', HOST: '127.0.0.1', NODE_ENV: 'debug', NAME: 'admin', PASSWORD: 'password' }),
  ]
  apps[0].node_args = [...common.node_args, '--require', path.join(__dirname, 'local-archiver-bootstrap.js')]
  for (let i = 0; i < 10; i++) {
    const port = 9001 + i
    const node = app(`win-local-node-${port}`, path.join(root, 'dist/index.js'), {})
    node.env.BASE_DIR = node.cwd
    const config = { server: {
      baseDir: node.cwd,
      ip: { externalIp: '127.0.0.1', internalIp: '127.0.0.1', externalPort: port, internalPort: 10001 + i },
      p2p: { existingArchivers: JSON.parse(env.EXISTING_ARCHIVERS) },
      reporting: { report: true, recipient: 'http://127.0.0.1:3000/api', interval: 2, console: false },
    } }
    const configPath = path.join(node.cwd, 'config.json')
    if (fs.existsSync(configPath)) {
      if (JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf8'))) !== JSON.stringify(config)) {
        throw new Error(`Local node configuration changed: ${configPath}; refusing to overwrite it`)
      }
    } else jsonWrite(configPath, config)
    const shutdownFile = path.join(node.cwd, 'shutdown-request.json')
    if (fs.existsSync(shutdownFile)) fs.unlinkSync(shutdownFile)
    apps.push(node)
  }
  jsonWrite(ecosystemPath, { apps })
}

function daemonRunning() {
  const file = path.join(directory, '.pm2/pm2.pid')
  if (!fs.existsSync(file)) return false
  const pid = Number(fs.readFileSync(file, 'utf8').trim())
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'EPERM') return true; return false }
}

function pm2(args, capture = false) {
  const env = { ...process.env, PM2_HOME: path.join(directory, '.pm2'), NO_COLOR: '1', PM2_SILENT: 'true' }
  // Do not let shell preload scripts affect the process manager or local services.
  delete env.NODE_OPTIONS
  const result = spawnSync(process.execPath, [require.resolve('pm2/bin/pm2'), ...args], {
    cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 90000,
  })
  if (result.error || result.status !== 0) throw new Error(`Local process manager failed (${args[0]}): ${result.error?.message || result.stderr || result.status}`)
  return result.stdout
}

function processes() {
  if (!daemonRunning()) return []
  return JSON.parse(pm2(['jlist'], true)).map(p => ({ name: p.name, status: p.pm2_env.status, pid: p.pid }))
}

async function availablePorts() {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = net.createServer()
      server.once('error', error => reject(new Error(`Cannot use local port ${port}: ${error.code}. Existing services have not been stopped.`)))
      server.listen(port, '127.0.0.1', () => server.close(resolve))
    })
  }
}

function request(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route, timeout: 3000 }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(new Error('Oversized local response')) })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid JSON response')) }
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Timed out')))
    req.on('error', reject)
  })
}

async function check(manifest) {
  const results = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    const port = 9001 + i
    try {
      const [data, newest] = await Promise.all([request(port, '/network/parameters'), request(port, '/sync-newest-cycle')])
      const cycle = newest.newestCycle
      const fresh = cycle && Math.abs(Date.now() - cycle.start * 1000) < (cycle.duration + 90) * 1000
      const ok = data.protocol?.networkId === manifest.networkId && data.parameters?.current?.archiver?.minVersion === '1.0.0' &&
        cycle?.mode === 'processing' && cycle.active >= 10 && fresh
      const detail = data.protocol?.networkId !== manifest.networkId ? 'WIN parameters unavailable / unexpected network' : `${cycle?.mode || 'starting'} (${cycle?.active ?? 0} active validators)`
      console.log(`Validator ${port}: ${ok ? 'ready' : detail}`)
      return ok
    } catch (error) { console.log(`Validator ${port}: ${error.message}`); return false }
  }))
  try {
    const data = await request(4000, '/cycleinfo/1')
    const cycle = data.cycleInfo?.[0]
    const ok = cycle?.mode === 'processing' && cycle.active >= 10 && Math.abs(Date.now() - cycle.start * 1000) < (cycle.duration + 90) * 1000
    console.log(`Archiver: cycle ${cycle?.counter ?? '?'}, mode ${cycle?.mode ?? '?'}, active validators ${cycle?.active ?? '?'}`)
    results.push(ok)
  } catch (error) { console.log(`Archiver: ${error.message}`); results.push(false) }
  try {
    const whitelist = await request(4000, '/allowed-archivers')
    const crypto = require('@shardus/lib-crypto-utils')
    crypto.init(hashKey)
    crypto.setCustomStringifier(require('@shardus/lib-types').Utils.safeStringify, 'shardus_safeStringify')
    const signature = whitelist.signatures?.find(s => s.owner === manifest.authority.publicKey)
    const valid = Boolean(signature && crypto.verifyObj({ allowedArchivers: whitelist.allowedArchivers, sign: signature }) &&
      whitelist.allowedArchivers.some(a => a.publicKey === manifest.archiver.publicKey && a.ip === '127.0.0.1' && a.port === 4000))
    results.push(valid)
    console.log(`Archiver allow-list: ${valid ? 'local signature verified' : 'invalid'}`)
  } catch (error) { console.log(`Archiver allow-list: ${error.message}`); results.push(false) }
  try {
    const monitor = await request(3000, '/api/status')
    results.push(monitor.status === 'online')
    console.log(`Monitor: ${monitor.status}`)
  } catch (error) { console.log(`Monitor: ${error.message}`); results.push(false) }
  return results.every(Boolean)
}

async function stop(manifest) {
  if (!daemonRunning()) return
  const running = processes().filter(p => p.status === 'online')
  const validators = running.filter(p => p.name.startsWith('win-local-node-'))
  let cycle
  try { cycle = (await request(4000, '/cycleinfo/1')).cycleInfo?.[0] } catch {}
  if (cycle && cycle.mode !== 'shutdown' && validators.length) {
    for (const node of validators) jsonWrite(path.join(directory, node.name, 'shutdown-request.json'), { networkId: manifest.networkId })
    console.log('Requesting a shutdown checkpoint. Waiting for the archiver before stopping services (up to four minutes).')
    let saved = false
    for (let attempt = 0; attempt < 48; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      try {
        const newest = (await request(4000, '/cycleinfo/1')).cycleInfo?.[0]
        if (newest?.mode === 'shutdown' && newest.counter > cycle.counter) { saved = true; break }
      } catch {}
    }
    if (!saved) throw new Error('Shutdown checkpoint was not confirmed. Remaining services were left running to preserve recovery data; inspect the local logs.')
  } else if (!cycle && validators.length) {
    // Refuse to stop potentially active validators when their recovery state is unknown.
    throw new Error('Cannot confirm archiver recovery state; inspect the archiver before stopping validators.')
  }
  pm2(['stop', 'all'])
}

async function main(action) {
  if (!['start', 'stop', 'status', 'check'].includes(action)) throw new Error('Usage: node scripts/local-network.js start|stop|status|check')
  let manifest = readManifest()
  if (action === 'start') {
    const resolved = dependencies()
    const running = processes().filter(p => p.status === 'online' || p.status === 'launching')
    if (running.length) {
      console.log(`${running.length} local services already running; use local:status or local:check. Stop before restarting the complete network.`)
      if (running.length !== 12) process.exitCode = 1
      return
    }
    await availablePorts()
    manifest = prepare()
    const queue = await recoverQueue(manifest)
    ecosystem(manifest, resolved, queue)
    // PM2 can otherwise retain an old script path when an ecosystem entry changes.
    // Only stopped registrations in this network's private process manager are removed.
    if (processes().length) pm2(['delete', 'all'])
    // Named apps live in a dedicated PM2 home; no global PM2 processes are touched.
    pm2(['start', ecosystemPath, '--only', 'win-local-archiver', '--update-env'])
    let archiverReady = false
    for (let i = 0; i < 30; i++) {
      try { await request(4000, '/nodeInfo'); archiverReady = true; break } catch { await new Promise(resolve => setTimeout(resolve, 1000)) }
    }
    if (!archiverReady) throw new Error('Archiver did not start. Inspect instances-local/win-local-archiver/stderr.log and run local:stop before retrying.')
    pm2(['start', ecosystemPath, '--only', ['win-local-monitor', ...Array.from({ length: 10 }, (_, i) => `win-local-node-${9001 + i}`)].join(','), '--update-env'])
    console.log(`Local network starting. Application ID: ${manifest.networkId}`)
    console.log('Monitor: http://127.0.0.1:3000 (admin / password); archiver: http://127.0.0.1:4000')
    console.log('Formation can take several minutes. Run npm run local:check to verify readiness. Wallet funding is not configured.')
  } else if (!manifest) {
    console.log('Local network has not been created. No files changed.')
    if (action === 'check') process.exitCode = 1
  } else if (action === 'stop') {
    await stop(manifest)
    console.log('Local services stopped. Instance data and logs are preserved.')
  } else if (action === 'status') {
    const list = processes()
    console.table(list)
    console.log(`Data: ${directory}\nApplication network ID: ${manifest.networkId}`)
    console.log('Process status alone does not imply network readiness; run npm run local:check.')
  } else {
    if (!await check(manifest)) process.exitCode = 1
  }
}

if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { readManifest, request, check, ports, recoverQueue }
