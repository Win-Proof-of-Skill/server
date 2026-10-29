import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMessage } from 'ethers';
import sqlite3 from 'sqlite3';
import sharp from 'sharp';

export const HOUR = 3600000;
const WINDOW = 120000;
const MAX_BODY = 4 * 1024 * 1024;
const address = value => typeof value === 'string' && /^[a-f0-9]{40}(?:0{24})?$/.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
export const signingMessage = envelope => 'WIN Feed v1\n' + createHash('sha256').update(JSON.stringify([
  envelope.address, envelope.networkId, envelope.origin, envelope.action, envelope.timestamp, envelope.nonce, envelope.data,
])).digest('hex');


export function nativeConnectionReader(gateway, networkId, fetcher = fetch) {
  const url = new URL(gateway);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash)
    throw new Error('WIN_FEED_GATEWAY must be HTTPS or a loopback HTTP native gateway.');
  const endpoint = gateway.replace(/\/$/, '') + '/connections/query';
  return async envelope => {
    let response;
    try { response = await fetcher(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(envelope), signal:AbortSignal.timeout(10000), redirect:'error' }); }
    catch { throw fail(503, 'Unable to verify native profile connections.'); }
    if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? 403 : 503, 'The native network could not authorize this profile.');
    const result = await response.json();
    if (result.networkId !== networkId) throw fail(503, 'Native gateway belongs to another network.');
    return result;
  };
}

export async function createFeedService({ directory, networkId, origin, now = Date.now, maxBytes = 512 * 1024 * 1024, gateway, readAccess }) {
  if (!/^[a-f0-9]{64}$/.test(networkId || '')) throw new Error('WIN_FEED_NETWORK_ID must be your 64-character WIN network ID.');
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    throw new Error('WIN_FEED_ORIGIN must be the wallet HTTPS origin (loopback HTTP is allowed for development).');
  if (!directory || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 * 1024) throw new Error('Invalid storage configuration.');
  const access = readAccess || nativeConnectionReader(gateway, networkId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const dbFile = path.join(directory, 'feed.sqlite');
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(dbFile, error => error ? reject(error) : resolve(connection));
  });
  await chmod(dbFile, 0o600);
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(error) { error ? reject(error) : resolve(this); }));
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows)));
  await run('PRAGMA journal_mode=WAL');
  await run('PRAGMA busy_timeout=5000');
  await run('CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, text TEXT NOT NULL, image BLOB, created INTEGER NOT NULL, requestId TEXT UNIQUE NOT NULL)');
  await run('CREATE INDEX IF NOT EXISTS posts_author_id ON posts(author, id DESC)');
  await run('CREATE TABLE IF NOT EXISTS snapshots (reader TEXT PRIMARY KEY, refreshed INTEGER NOT NULL, upperId INTEGER NOT NULL)');
  await run('CREATE TABLE IF NOT EXISTS nonces (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  await run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const savedNetwork = await get("SELECT value FROM settings WHERE key='network'");
  if (savedNetwork && savedNetwork.value !== networkId) { db.close(); throw new Error('Feed database belongs to another network.'); }
  await run("INSERT OR IGNORE INTO settings(key,value) VALUES('network',?)", [networkId]);
  let serial = Promise.resolve();
  const serialize = task => { const result = serial.then(task); serial = result.catch(() => {}); return result; };
  const buckets = new Map();
  function rate(key, limit, period) {
    const time = now();
    if (buckets.size > 10000) for (const [id, value] of buckets) if (value.until <= time) buckets.delete(id);
    const current = buckets.get(key);
    if (!current && buckets.size > 20000) throw fail(503, 'Feed is busy. Try again shortly.');
    const bucket = !current || current.until <= time ? { count: 0, until: time + period } : current;
    if (++bucket.count > limit) throw fail(429, 'Too many requests. Please try again shortly.');
    buckets.set(key, bucket);
  }
  async function authenticate(e) {
    if (!e || !address(e.address) || e.address.length !== 40 || e.networkId !== networkId || e.origin !== origin ||
        !['feed', 'mine', 'publish', 'delete', 'image', 'connections'].includes(e.action) || !Number.isSafeInteger(e.timestamp) ||
        Math.abs(now() - e.timestamp) > WINDOW || !/^[a-f0-9]{32}$/.test(e.nonce || '') ||
        !e.data || typeof e.data !== 'object' || Array.isArray(e.data) || !/^0x[a-fA-F0-9]{130}$/.test(e.signature || ''))
      throw fail(401, 'Invalid or expired wallet authorization. Check your device clock and try again.');
    let signer;
    try { signer = verifyMessage(signingMessage(e), e.signature).slice(2).toLowerCase(); } catch { throw fail(401, 'Invalid wallet signature.'); }
    if (signer !== e.address) throw fail(401, 'Wallet signature does not match the author.');
    rate('wallet:' + signer, 180, 60000);
    await run('DELETE FROM nonces WHERE expires < ?', [now()]);
    try { await run('INSERT INTO nonces(id,expires) VALUES(?,?)', [signer + ':' + e.nonce, now() + 2 * WINDOW]); }
    catch (error) { if (error.code === 'SQLITE_CONSTRAINT') throw fail(409, 'Request already used. Retry with fresh authorization.'); throw error; }
    return signer;
  }
  const publicPost = p => ({ id: String(p.id), author: p.author, text: p.text, hasImage: !!p.hasImage, created: p.created });
  async function operation(e) {
    const owner = await authenticate(e);
    const data = e.data;
    if (!/^[a-f0-9]{64}$/.test(data.profileId || '')) throw fail(400, 'Choose a profile before using the feed.');
    // Every read rechecks current profile control and accepted on-chain pairs.
    const permission = await access(e);
    if (permission.networkId !== networkId || permission.profileId !== data.profileId || !Array.isArray(permission.acceptedProfileIds) || permission.acceptedProfileIds.length > 500 || permission.acceptedProfileIds.some(id => !/^[a-f0-9]{64}$/.test(id)))
      throw fail(503, 'Native connection verification is unavailable.');
    const profileId = data.profileId;
    if (e.action === 'connections') return permission;
    if (e.action === 'publish') {
      if (typeof data.text !== 'string' || data.text.trim().length > 3000 || !/^[a-f0-9]{32}$/.test(data.requestId || ''))
        throw fail(400, 'Enter up to 3,000 characters.');
      const previous = await get('SELECT id,author,text,created,image IS NOT NULL AS hasImage FROM posts WHERE requestId=?', [profileId + ':' + data.requestId]);
      if (previous) return { post: publicPost(previous), duplicate: true };
      rate('publish:' + owner, 10, 600000);
      let image = null;
      if (data.image != null) {
        if (typeof data.image !== 'string' || data.image.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.image))
          throw fail(400, 'Choose a JPEG, PNG, or WebP image under 2 MB.');
        const input = Buffer.from(data.image, 'base64');
        if (input.length > 2 * 1024 * 1024) throw fail(413, 'Image exceeds 2 MB.');
        try {
          const decoder = sharp(input, { limitInputPixels: 20000000, failOn: 'warning' }).timeout({ seconds: 5 });
          const meta = await decoder.metadata();
          if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('Unsupported image');
          // Decode and re-encode: strip metadata and reject SVG, video, animation and malformed files.
          image = await decoder.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        } catch { throw fail(400, 'Use a valid, still JPEG, PNG, or WebP image (maximum 20 megapixels). Videos are not supported.'); }
      }
      if (!data.text.trim() && !image) throw fail(400, 'Write a post or choose an image.');
      const quota = await get('SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(length(image),0)+length(CAST(text AS BLOB))),0) AS bytes FROM posts');
      if (quota.count >= 10000 || quota.bytes + (image?.length || 0) + Buffer.byteLength(data.text) > maxBytes)
        throw fail(507, 'Feed storage is full. Contact the server administrator.');
      const created = now();
      const result = await run('INSERT INTO posts(author,text,image,created,requestId) VALUES(?,?,?,?,?)', [profileId, data.text.trim(), image, created, profileId + ':' + data.requestId]);
      return { post: { id: String(result.lastID), author: profileId, text: data.text.trim(), hasImage: !!image, created } };
    }
    if (e.action === 'delete') {
      if (!/^[1-9][0-9]{0,15}$/.test(data.id || '')) throw fail(400, 'Invalid post.');
      const removed = await run('DELETE FROM posts WHERE id=? AND author=?', [data.id, profileId]);
      if (!removed.changes) throw fail(404, 'Post not found or not owned by this wallet.');
      return { deleted: true };
    }
    if (e.action === 'image') {
      const contacts = permission.acceptedProfileIds;
      if (!/^[1-9][0-9]{0,15}$/.test(data.id || '')) throw fail(400, 'Invalid image.');
      const post = await get('SELECT author,image FROM posts WHERE id=?', [data.id]);
      if (!post?.image || (post.author !== profileId && !contacts.includes(post.author))) throw fail(404, 'Image is not in your selected contacts.');
      return { binary: post.image };
    }
    const contacts = e.action === 'mine' ? [profileId] : permission.acceptedProfileIds;
    let snapshot = { refreshed: now(), upperId: (await get('SELECT COALESCE(MAX(id),0) AS id FROM posts')).id };
    if (e.action === 'feed') {
      const saved = await get('SELECT refreshed,upperId FROM snapshots WHERE reader=?', [profileId]);
      if (saved && now() < saved.refreshed + HOUR) snapshot = saved;
      else await run('INSERT OR REPLACE INTO snapshots(reader,refreshed,upperId) VALUES(?,?,?)', [profileId, snapshot.refreshed, snapshot.upperId]);
      // Bound inactive per-reader state; active snapshots retain their one-hour window.
      await run('DELETE FROM snapshots WHERE refreshed < ?', [now() - 7 * 24 * HOUR]);
    }
    let before = snapshot.upperId + 1;
    if (data.before != null) {
      if (!/^[1-9][0-9]{0,15}$/.test(data.before)) throw fail(400, 'Invalid page cursor.');
      before = Math.min(before, Number(data.before));
    }
    const rows = contacts.length ? await all(`SELECT id,author,text,created,image IS NOT NULL AS hasImage FROM posts WHERE author IN (${contacts.map(() => '?').join(',')}) AND id<? ORDER BY id DESC LIMIT 21`, [...contacts, before]) : [];
    return { posts: rows.slice(0, 20).map(publicPost), nextCursor: rows.length > 20 ? String(rows[19].id) : null,
      refreshedAt: snapshot.refreshed, nextRefreshAt: snapshot.refreshed + HOUR };
  }
  let active = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return json(200, { service: 'win-feed', ready: true });
    if (req.method !== 'POST' || req.url !== '/v1') return json(404, { error: 'Not found' });
    if (active >= 16) return json(503, { error: 'Feed is busy. Try again shortly.' });
    active++;
    try {
      if (req.headers.origin !== origin) throw fail(403, 'Request origin is not allowed.');
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'JSON required.');
      // Caddy must overwrite this header; the listener is loopback-only.
      rate('ip:' + (req.headers['x-real-ip'] || req.socket.remoteAddress), 240, 60000);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw fail(413, 'Request too large.'); chunks.push(chunk); }
      let envelope;
      try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON.'); }
      const result = await serialize(() => operation(envelope));
      if (result.binary) { res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Disposition': 'inline; filename="post.webp"' }); res.end(result.binary); }
      else json(200, result);
    } catch (error) {
      if (!res.destroyed) json(error.status || 500, { error: error.status ? error.message : 'Feed service could not complete the request.' });
      if (!error.status) console.error('Feed operation failed:', error.code || error.name);
    } finally { active--; }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return { server, async close() { await new Promise(resolve => server.close(resolve)); await serial; await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const port = Number(process.env.WIN_FEED_PORT || 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WIN_FEED_PORT');
  const service = await createFeedService({ directory: process.env.WIN_FEED_DATA,
    networkId: process.env.WIN_FEED_NETWORK_ID, origin: process.env.WIN_FEED_ORIGIN, gateway: process.env.WIN_FEED_GATEWAY });
  service.server.listen(port, '127.0.0.1', () => console.log(`WIN feed listening on 127.0.0.1:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void service.close().then(() => process.exit(0)); });
}
