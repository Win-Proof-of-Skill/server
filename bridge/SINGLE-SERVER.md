# Three WIN operators on one VPS

This setup uses three distinct signing keys and three PM2 processes on ports 8081–8083, with one native gateway at `http://127.0.0.1:3030`. The BNB contract, native validators and wallet still require two different operator signatures. A single compromised VPS or native gateway can compromise the bridge; this is a centralized deployment. There is no automatic downgrade from the default gateway quorum mode.

Use these commands only after copying the updated bridge code to the VPS. The examples assume `/root/apps/server/bridge` and the root user's PM2 installation. These setup commands do not deploy a contract, transfer funds, change Caddy, or enable conversions automatically.

## 1. Install and prepare the keys

```sh
cd /root/apps/server/bridge
npm ci --ignore-scripts
npm run compile
npm test
export WIN_BRIDGE_HOME=/root/.config/win-bridge
node setup-operators.mjs keys
```

The helper preserves the existing `operator-key.json` and creates missing `operator-2-key.json` and `operator-3-key.json`. All key files remain outside the repository, with mode 600. Back up these files privately. The printed `operators` array contains public addresses only; use that exact order in `deployment.json`.

If the vault is already deployed, restore its three original matching keys into these files. Never generate new addresses for an existing vault. When `deployed-vault.json` exists, the helper refuses to generate missing replacement keys or use mismatched keys. It never overwrites existing keys.

## 2. Complete vault deployment before starting operators

Follow [the vault deployment steps](README.md#deployment-sequence) using the three addresses above. The helper does not deploy a vault. Keep both files in `/root/.config/win-bridge`:

- `deployment.json`: the native network ID, BNB RPC and three operator addresses passed to `deploy.mjs`.
- `deployed-vault.json`: the successful JSON output of `deploy.mjs`, containing `vaultAddress`, `vaultCodeHash`, `networkId` and `operators`.

Do not rerun `deploy.mjs` if the vault already exists. The setup helper checks that both files agree with the local keys, including address order.

## 3. Prepare the local gateway and PM2 configuration

```sh
cd /root/apps/server/bridge
export WIN_BRIDGE_HOME=/root/.config/win-bridge
export WIN_NATIVE_GATEWAY=http://127.0.0.1:3030
export WIN_WALLET_ORIGIN=https://wallet.win-pskill.com
node setup-operators.mjs configure
```

This writes `operator-config.json` and `ecosystem.config.cjs` in the private configuration directory. The explicit configuration is `nativeGatewayMode: "single"` with exactly one `nativeGateways` entry. PM2 receives key file paths, not private key values. Matching existing generated files are retained; conflicting manual edits cause an error instead of being overwritten.

Default operator configurations without `nativeGatewayMode` continue to require three distinct gateway URLs and agreement from at least two. To change an existing deployment's gateway policy, edit the private `operator-config.json` deliberately and restart the operators. Never point `nativeGateways` to the operator endpoints; these URLs must serve native records and transaction receipts.

## 4. Start and check all three processes

First check that ports 8081, 8082 and 8083 are available:

```sh
pm2 list
ss -ltnp '( sport = :8081 or sport = :8082 or sport = :8083 )'
```

If you previously started the old single process named `win-bridge-operator`, stop that process before replacing it: `pm2 stop win-bridge-operator`. Do not stop unrelated applications.

```sh
pm2 start /root/.config/win-bridge/ecosystem.config.cjs
pm2 list
for port in 8081 8082 8083; do
  curl --fail --silent --show-error --max-time 10 --write-out '\n' "http://127.0.0.1:${port}/health"
done
```

All three health responses must show different `operator` addresses matching your deployed vault, the same vault/network, `nativeGatewayMode: "single"`, and `nativeGatewayQuorum: 1`. That quorum describes native gateway evidence; the contract signature requirement remains two of three.

The services check the deployed vault on startup. A wrong key, wrong vault, wrong chain, invalid code hash or unavailable BNB RPC prevents successful startup. To inspect one service, use `pm2 logs win-bridge-operator-1 --lines 50` (Ctrl+C exits the log view). Use `pm2 restart /root/.config/win-bridge/ecosystem.config.cjs --update-env` after reviewed configuration changes.

Once all three services are healthy:

```sh
pm2 save
pm2 startup
```

Follow any startup command PM2 prints to enable restart after a server reboot. See [PM2 startup documentation](https://pm2.keymetrics.io/docs/usage/startup/).

## 5. Expose the operators through Caddy

Replace only the existing `bridge.win-pskill.com` block with the following. Its fallback preserves your existing bridge service on port 8788; the new operator routes use ports 8081–8083.

```caddyfile
bridge.win-pskill.com {
    encode zstd gzip
    handle_path /operator-1/* {
        reverse_proxy 127.0.0.1:8081
    }
    handle_path /operator-2/* {
        reverse_proxy 127.0.0.1:8082
    }
    handle_path /operator-3/* {
        reverse_proxy 127.0.0.1:8083
    }
    handle {
        reverse_proxy 127.0.0.1:8788 {
            header_up Host 127.0.0.1:8788
        }
    }
}
```

```sh
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
for number in 1 2 3; do
  curl --fail --silent --show-error --max-time 10 --write-out '\n' "https://bridge.win-pskill.com/operator-${number}/health"
done
```

Use these exact base URLs in every validator's bridge deployment `observerUrls`:

```json
[
  "https://bridge.win-pskill.com/operator-1",
  "https://bridge.win-pskill.com/operator-2",
  "https://bridge.win-pskill.com/operator-3"
]
```

[Caddy's `handle_path`](https://caddyserver.com/docs/caddyfile/directives/handle_path) removes the operator path prefix before forwarding. These are three different operator processes sharing a host, not independent native gateways.

Running the services does not enable the bridge. Upgrade the native validators, configure the identical vault entry, fund the native reserve, and verify a controlled round trip before enabling public conversions, as described in [the deployment guide](README.md).
