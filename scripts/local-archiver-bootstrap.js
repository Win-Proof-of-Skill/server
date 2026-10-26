'use strict'

// Restore the native network-transaction queue through the archiver's public API
// before its main module starts. The launcher reconstructs and checks this snapshot
// against persisted consensus cycles; no receipt/account verification is disabled.
if (process.env.WIN_LOCAL_TEST !== '1') throw new Error('Local archiver bootstrap requires WIN_LOCAL_TEST=1')
const fs = require('fs')
const path = require('path')
const { Utils } = require('@shardus/lib-types')
const runtime = process.env.WIN_LOCAL_ARCHIVER_RUNTIME
if (!runtime || !path.isAbsolute(runtime)) throw new Error('Missing local archiver runtime')
const snapshot = Utils.safeJsonParse(fs.readFileSync(path.join(runtime, 'network-queue.json'), 'utf8'))
const crypto = require(path.join(runtime, 'build/Crypto'))
crypto.setCryptoHashKey(process.env.ARCHIVER_HASH_KEY)
if (snapshot.networkId !== process.env.WIN_LOCAL_NETWORK_ID || crypto.hashObj(snapshot.txList) !== snapshot.hash) {
  throw new Error('Local network queue snapshot does not match its signing domain or hash')
}
require(path.join(runtime, 'build/ServiceQueue')).setTxList(snapshot.txList)
