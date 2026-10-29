# Profile connections and contact feed

This feature adds a protected native **Connections registry** at `7` followed by 63 zeros, plus an authenticated feed service and Feed/Contacts pages. Deploy the native server, the feed service and the web client together after publishing the changes. Nothing in this working tree has been deployed automatically.

## What is stored where

- Native registry `7000000000000000000000000000000000000000000000000000000000000000` stores connection records: `fromProfileId`, `toProfileId`, status, revision, timestamps and signing-wallet attribution. It is reserved from ordinary transfers and unrelated transactions; it is not a wallet you fund or generate a private key for.
- The source profile’s owner or manager sends a request. Only the receiving profile’s owner or manager can accept or decline it. Only the source controller can cancel a pending request. Either side can remove an accepted connection. Crossed requests never implicitly accept. These are native transactions using the existing metadata fee, shown before confirmation; no new fee rate is introduced.
- Profiles must be distinct and already exist. Active pairs cannot be duplicated. Revisions prevent replaying stale decisions. Declined requests have a 24-hour retry delay. Each profile can have at most 100 pending requests and 500 accepted connections; the existing registry size limit also applies.
- Feed posts and images are stored in the separate server-side SQLite service, not on-chain. Each post belongs to a profile. Any current owner/manager of that profile can publish or delete its posts. The native Connections registry is the source of truth for feed access. A caller-supplied address list never grants access.
- Legacy local address-book entries remain preserved for wallet history/details. They are **not accepted connections** and cannot grant feed access. Users choose their own profile and the other person's **profile ID**, not wallet address, when requesting a connection.
- Connections are native blockchain records, so they are not secret from validators or existing general account-reading interfaces. The new connection-query endpoint itself requires a signed request from a profile controller. Feed media is authenticated but not end-to-end encrypted. Removing a connection blocks subsequent server reads; already downloaded content cannot be recalled.

## Refresh and image rules

The server preserves a snapshot boundary for **one hour per reading profile**, including across restarts and across its controllers/devices. The client automatically refreshes while Feed is open and refreshes on return once due. Publishing is not restricted to one post per hour: “Your posts” shows your updates immediately. Posts published after another profile's snapshot become visible on its next hourly refresh. Local connection changes clear the local feed cache; every new server read rechecks current native authorization.

Each post supports 3,000 characters and **one still JPEG, PNG or WebP image**, up to 2 MB and 20 megapixels. The service decodes/re-encodes images, strips metadata and resizes them to at most 1600×1600. Videos, SVG and animation are rejected. A lost publishing response can be retried from the same composer without duplicating an accepted post. Reloading clears the draft/retry ID; check “Your posts” before composing the same update again.

Initial service limits: 20 posts per page, 10 publishing attempts per wallet per 10 minutes, 10,000 posts and 512 MB stored content. SQLite/WAL overhead requires additional disk space. Keep PM2 at one service instance. Storage exhaustion rejects new posts; it does not silently delete history. Back up feed data separately from native network data.

## 1. Publish and update the native server

The code is currently local. Commit/review/publish both repository changes before running `git pull` on the VPS. Preserve any VPS modifications first; do not reset them blindly.

This adds a native transaction type and protected account. **All validators must run the same updated server code.** For your single-server local-network deployment, schedule a short maintenance period. Stop the existing local network gracefully before updating:

```bash
cd /root/apps/server
npm run local:stop
```

Wait for the checkpoint and stop to complete. Back up `instances-local` while stopped using your existing backup procedure. Keep the existing network identity, authority keys and checkpoint data. Do not delete instances or initialize a fresh network.

```bash
git status --short
git pull --ff-only
npm run local:start
npm run local:check
```

`local:start` compiles the new code. If `local:check` is not ready, inspect logs and wait for recovery rather than clearing the database. No changes to existing native server dependencies are required. Do not deploy only one validator. The Connections account is created lazily by its first successful transaction; do not manually create or fund it.

Confirm the gateway is serving the updated native server:

```bash
curl --fail --silent --show-error \
  https://wallet.win-pskill.com/api/network/parameters
```

Its `protocol.registryAddresses.connections` must be the `7000…0000` address above. The new protected read endpoint is **POST `/connections/query`**, forwarded through the existing gateway. Unsigned requests must return 401:

```bash
curl -i http://127.0.0.1:3030/connections/query \
  -H 'Content-Type: application/json' --data '{}'
```

## 2. Install the separate feed service

```bash
cd /root/apps/server/feeds
node --version
npm ci --omit=dev
npm test
```

Node 20.19+ is required. The service has its own package-lock and isolated dependencies. Do not use `--ignore-scripts`: SQLite may need its native installation step.

Configure the exact native network ID from your deployed `network.js`. For this workspace:

```bash
install -d -m 700 /root/.local/share/win-feed
export WIN_FEED_DATA=/root/.local/share/win-feed
export WIN_FEED_NETWORK_ID=79c84dc9448c0069b6866af47d0f6746f0c4b60c4c66f8c9a675765d1c75c971
export WIN_FEED_ORIGIN=https://wallet.win-pskill.com
export WIN_FEED_GATEWAY=http://127.0.0.1:3030
export WIN_FEED_PORT=8790
cd /root/apps/server/feeds
pm2 start ecosystem.config.cjs --only win-feed
pm2 save
curl --fail --silent --show-error http://127.0.0.1:8790/health
```

If `win-feed` already exists, use `pm2 startOrRestart ecosystem.config.cjs --only win-feed --update-env` after setting these variables instead of creating a duplicate process. Use your existing PM2 startup configuration for reboot recovery.

No private key is configured on this service. It relays each caller's signed authorization to the native gateway, which verifies current ownership/management of the selected profile before returning connection information. If native authorization is unavailable, the feed fails closed. Health reports the feed process/database readiness only; it does not prove native connectivity. The data directory belongs to one network ID and is not portable to a different network.

## 3. Add the HTTPS route in Caddy

Inside the existing `wallet.win-pskill.com` block, alongside `/api/*` and `/ws`, add this handler. Keep the existing wallet website fallback unchanged:

```caddy
handle_path /feed-api/* {
    request_body {
        max_size 4MB
    }
    reverse_proxy 127.0.0.1:8790 {
        header_up X-Real-IP {remote_host}
    }
}
```

A reusable copy is in the client `deployment/wallet-feed.caddy`. The listener is loopback-only; Caddy must overwrite `X-Real-IP` as shown. Keep the origin exactly `https://wallet.win-pskill.com`, without a trailing slash. Caddy and the service must share the host/network namespace.

```bash
caddy validate --config /etc/caddy/Caddyfile
```

Only after validation succeeds:

```bash
systemctl reload caddy
curl --fail --silent --show-error https://wallet.win-pskill.com/feed-api/health
curl -i https://wallet.win-pskill.com/feed-api/v1 \
  -H 'Origin: https://wallet.win-pskill.com' \
  -H 'Content-Type: application/json' --data '{}'
```

Expected: health returns `{"service":"win-feed","ready":true}` and the unsigned API request returns 401. Missing/different Origin is rejected with 403. `/v1` supports POST only. Connection, post and image queries all require fresh wallet signatures; state-changing connection actions go through native transaction signing/validation instead.

## 4. Deploy the web client

Use `pm2 describe win-wallet` to locate the actual client directory. There, preserve local changes and pull the published client update. Include `win-feed.mjs`, `win-connections.mjs`, and modified app/navigation/domain/styles/index/version files. No frontend build or dependency installation is needed.

```bash
pm2 restart win-wallet
curl --fail --silent --show-error https://wallet.win-pskill.com/version.html
```

Expected version: `2026.1029.0001`. Reload and accept the update. Existing bridge operators and contracts do not need modifications for this feature.

## 5. Verify the complete flow

1. Use two wallets that control distinct profiles and have enough native WIN for the existing transaction fee.
2. Wallet A opens Contacts, chooses its profile, clicks +, enters B's **profile ID**, reviews the fee and sends the request.
3. B opens Contacts, chooses the receiving profile, refreshes and accepts the incoming request after reviewing the fee.
4. After the transaction confirms, both profiles appear under Connections. Pending/rejected requests must not appear as accepted contacts.
5. Publish a text/image post in Feed using A's profile. B sees it on its next hourly snapshot. Your own new post appears immediately in “Your posts.”
6. Remove the connection. Subsequent server post/image reads must no longer authorize the former peer. Adding a saved wallet address or forging the browser's contact filter must not bypass this.

For logs:

```bash
pm2 logs win-feed --lines 80 --nostream
```

For a consistent offline feed backup, stop only `win-feed`, copy its whole data directory including SQLite sidecars, then start it again. Do not delete its database to fix a routing problem. A native upgrade should be rolled back only with a coordinated compatible recovery plan once connection transactions have been accepted; old validators do not understand the new type.

## Tests and publication

Native tests live in `test/proofOfSkill/connections.test.ts`; feed HTTP/storage tests live in `feeds/service.test.mjs`. The client companion worktree is `/tmp/win-feed-tests`, topic branch `codex/contact-feed-tests`, with `local-tests/tests/win-feed.test.mjs` and `win-connections.test.mjs` plus the offline browser harness. Tests use synthetic wallets and disposable databases, not real transactions.

The published companion main was fetched but lacks its documented AGENTS.md, local-tests/README.md and runner. Direct Node tests are used. Set `WEB_CLIENT_ROOT`, `FEED_SERVICE_ROOT`, `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` before running the focused suites. FEED_SERVICE_ROOT must point to an installed server/feeds directory for crypto compatibility checks.

Client base: `3383b6a2c4b31ae5c1b139306891f0f54f852c8d`. Server base: `f3cab368bb6adea9aa359aea55a65f4ec98acc0f`. Companion base: `2fc3036c11900073e0616cf9ddcdf3cf233904e3`. Results apply to these bases plus local feature changes.

The companion commit attempt failed because the configured SSH signing key could not be unlocked (`ssh-askpass` unavailable). Signing was not bypassed. Client/server/companion commits, pushes, linked PRs and review remain pending. Keep the companion feature tests unmerged until the required client/server changes land and the tests are rerun against those revisions. Nothing is deployed yet.

Final validation (2026-10-29): server TypeScript compilation passed; all 79 proof-of-skill/payment/bridge/connection tests passed; 10 installed feed-service HTTP/storage tests passed; 47 client tests passed (14 new feed/connection checks and 33 existing navigation/statistics/workspace checks). Total: **136 passing checks**. Desktop/mobile layouts were inspected. The new service's production dependency audit reported zero known vulnerabilities. No live network transaction or production deployment was performed.

A focused routing regression exposed an unintended connection-registry key on contract transactions during implementation; it failed before correction and passed after the key was removed. Existing contract routing remains unchanged. The first public-query proposal was replaced with the implemented wallet-authenticated query; unauthenticated relationship query endpoints were not added.
