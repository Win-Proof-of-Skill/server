import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Wallet } from 'ethers';
import sharp from 'sharp';
import { createFeedService, signingMessage, HOUR } from './service.mjs';
const networkId = 'a'.repeat(64), origin = 'https://wallet.example';
const alice = Wallet.createRandom(), bob = Wallet.createRandom(), eve = Wallet.createRandom();
const address = wallet => wallet.address.slice(2).toLowerCase();
const profile = wallet => address(wallet).padEnd(64,'0');
const id = () => randomBytes(16).toString('hex');
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'win-feed-test-'));
  let clock = Date.now(), service, base;
  const accepted = new Map([[profile(alice),new Set([profile(bob)])],[profile(bob),new Set([profile(alice)])]]);
  const readAccess = async envelope => {
    if(envelope.data.profileId !== envelope.address.padEnd(64,'0')) throw Object.assign(new Error('Profile is not controlled by this wallet'),{status:403});
    return {networkId,profileId:envelope.data.profileId,acceptedProfileIds:[...(accepted.get(envelope.data.profileId)||[])]};
  };
  const start = async () => {
    service = await createFeedService({ directory, networkId, origin, now: () => clock, readAccess, ...options });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${service.server.address().port}`;
  };
  await start();
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const envelope = async (wallet, action, data, extra = {}) => {
    const e = { address: address(wallet), networkId, origin, action, timestamp: clock, nonce: id(), data: {profileId:profile(wallet),...data}, ...extra };
    e.signature = await wallet.signMessage(signingMessage(e)); return e;
  };
  const send = (e, headers = {}) => fetch(base + '/v1', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(e) });
  const request = async (wallet, action, data, extra) => send(await envelope(wallet, action, data, extra));
  const publish = async (wallet, text = 'A professional update', image = null, requestId = id()) => {
    const response = await request(wallet, 'publish', { text, image, requestId });
    assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).post;
  };
  return { envelope, send, request, publish,
    disconnect() { accepted.clear(); }, connect() {accepted.set(profile(alice),new Set([profile(bob)]));accepted.set(profile(bob),new Set([profile(alice)]));},
    advance(ms) { clock += ms; }, async restart() { await service.close(); await start(); } };
}
test('wallet authorization rejects unsigned, forged, expired, wrong-network and wrong-origin requests', async t => {
  const f = await fixture(t);
  assert.equal((await f.send({})).status, 401);
  const forged = await f.envelope(alice, 'feed', { contacts: [] }); forged.address = address(bob);
  assert.equal((await f.send(forged)).status, 401);
  assert.equal((await f.request(alice, 'feed', { contacts: [] }, { networkId: 'b'.repeat(64) })).status, 401);
  assert.equal((await f.request(alice, 'feed', { contacts: [] }, { timestamp: 1 })).status, 401);
  const signed = await f.envelope(alice, 'feed', { contacts: [] });
  assert.equal((await f.send(signed, { Origin: 'https://evil.example' })).status, 403);
  signed.data.contacts = [address(bob)];
  assert.equal((await f.send(signed)).status, 401);
});
test('signed requests are single-use across service restarts', async t => {
  const f = await fixture(t), signed = await f.envelope(alice, 'feed', { contacts: [] });
  assert.equal((await f.send(signed)).status, 200);
  assert.equal((await f.send(signed)).status, 409);
  await f.restart();
  assert.equal((await f.send(signed)).status, 409);
});
test('feed includes only selected contacts and freezes new posts for one hour, including after restart', async t => {
  const f = await fixture(t);
  const first = await f.publish(alice, 'First'); await f.publish(eve, 'Not a contact');
  const read = async contacts => (await f.request(bob, 'feed', { contacts })).json();
  assert.deepEqual((await read([address(alice)])).posts.map(p => p.id), [first.id]);
  const next = await f.publish(alice, 'Second');
  assert.deepEqual((await read([address(alice)])).posts.map(p => p.id), [first.id]);
  f.disconnect();
  assert.equal((await read([address(alice)])).posts.length, 0);
  f.connect();
  await f.restart();
  assert.deepEqual((await read([address(alice)])).posts.map(p => p.id), [first.id]);
  f.advance(HOUR);
  assert.deepEqual((await read([address(alice)])).posts.map(p => p.id), [next.id, first.id]);
});
test('multiple posts per hour are allowed; own posts appear immediately and retries are idempotent', async t => {
  const f = await fixture(t), requestId = id();
  const one = await f.publish(alice, 'First', null, requestId);
  const retry = await f.publish(alice, 'First', null, requestId);
  assert.equal(one.id, retry.id);
  await f.publish(alice, 'Second');
  const result = await (await f.request(alice, 'mine', {})).json();
  assert.equal(result.posts.length, 2);
});
test('only the author can delete a post; deleted posts disappear from hourly snapshots', async t => {
  const f = await fixture(t), p = await f.publish(alice);
  await f.request(bob, 'feed', { contacts: [address(alice)] });
  assert.equal((await f.request(bob, 'delete', { id: p.id })).status, 404);
  assert.equal((await f.request(alice, 'delete', { id: p.id })).status, 200);
  assert.equal((await (await f.request(bob, 'feed', { contacts: [address(alice)] })).json()).posts.length, 0);
});
test('images require accepted native connections; caller-supplied contacts cannot grant access', async t => {
  const f = await fixture(t);
  const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#006c35' } }).png().toBuffer();
  const p = await f.publish(alice, '', input.toString('base64'));
  assert.equal(p.hasImage, true);
  f.disconnect();
  assert.equal((await f.request(bob, 'image', { id: p.id, contacts: [address(alice)] })).status, 404);
  f.connect();
  const response = await f.request(bob, 'image', { id: p.id, contacts: [address(alice)] });
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined);
});
test('invalid, SVG, video and oversized image payloads are rejected', async t => {
  const f = await fixture(t);
  for (const contents of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<html>hello</html>', '\x00\x00\x00\x18ftypmp42video']) {
    assert.equal((await f.request(alice, 'publish', { text: '', image: Buffer.from(contents).toString('base64'), requestId: id() })).status, 400);
  }
  assert.equal((await f.request(alice, 'publish', { text: '', image: 'A'.repeat(2800004), requestId: id() })).status, 400);
});
test('empty or overlong posts, unauthorized profiles and malformed cursors fail validation', async t => {
  const f = await fixture(t);
  for (const text of ['', 'x'.repeat(3001)]) assert.equal((await f.request(alice, 'publish', { text, requestId: id() })).status, 400);
  assert.equal((await f.request(alice, 'feed', { profileId: profile(bob) })).status, 403);
  assert.equal((await f.request(alice, 'feed', { contacts: [], before: '-1' })).status, 400);
  assert.equal((await f.request(alice, 'feed', { profileId: 'bad' })).status, 400);
});
test('paginated contact posts are ordered without leaking noncontacts', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 23; i++) { if (i % 9 === 0) f.advance(600001); await f.publish(alice, 'Post ' + i); }
  await f.publish(eve, 'Outside feed');
  const first = await (await f.request(bob, 'feed', { contacts: [address(alice)] })).json();
  assert.equal(first.posts.length, 20);
  const second = await (await f.request(bob, 'feed', { contacts: [address(alice)], before: first.nextCursor })).json();
  assert.equal(second.posts.length, 3); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.posts, ...second.posts].map(p => p.id)).size, 23);
});

test('gateway authorization failures fail closed for posts and images', async t => {
  const f=await fixture(t,{readAccess:async()=>{throw Object.assign(new Error('Gateway unavailable'),{status:503});}});
  assert.equal((await f.request(alice,'publish',{text:'No bypass',requestId:id()})).status,503);
  assert.equal((await f.request(alice,'feed',{})).status,503);
  assert.equal((await f.request(alice,'image',{id:'1'})).status,503);
});
