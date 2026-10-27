import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const operator = fileURLToPath(new URL('../operator.mjs', import.meta.url))
const launcher = path.join(path.dirname(require.resolve('pm2/package.json')), 'lib/ProcessContainerFork.js')
function run(t, args, entryPoint) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-operator-startup-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = { ...process.env, WIN_BRIDGE_CONFIG: path.join(dir, 'missing-config.json') }
  delete env.pm_exec_path
  if (entryPoint) env.pm_exec_path = entryPoint
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 5000 })
  assert.ifError(result.error)
  return result
}
for (const [name, args, entryPoint] of [
  ['direct Node startup', [operator], undefined],
  ['PM2 ESM startup', [launcher], operator],
]) {
  test(name + ' actually executes configuration loading', (t) => {
    const result = run(t, args, entryPoint)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ENOENT/)
    assert.match(result.stderr, /missing-config\.json/)
  })
}
test('importing the operator from another PM2 application does not start it', (t) => {
  const result = run(t, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(operator).href)})`], launcher)
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
})
