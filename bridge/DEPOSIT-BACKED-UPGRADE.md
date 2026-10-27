# Upgrade an existing WIN vault to deposit-backed native issuance

This changes the native validators, operators and wallet. The existing BNB vault and its three keys stay in place. No deployer key, new vault, native reserve funding, or network reset is required. The helper checks the vault's on-chain code hash, token, network and operators before writing configuration. It never sends a transaction or reads an operator key.

The deployed vault supplied for this installation is `0x98c52fc739888b744907cc9d3e08223edc00f787`, on native network `79c84dc9448c0069b6866af47d0f6746f0c4b60c4c66f8c9a675765d1c75c971`. Commands read the actual values from `/root/.config/win-bridge/deployed-vault.json` and cross-check `/root/.config/win-bridge/operator-config.json`.

## 1. Install the updated code and restart operators

Copy/pull the reviewed server and web-client changes to their existing VPS checkouts first. The changes must be published before `git pull` can obtain them; a local Codex edit alone does not update the VPS. Keep `/root/.config/win-bridge` and `/root/apps/server/instances-local` intact.

```bash
cd /root/apps/server
npm run compile

cd /root/apps/server/bridge
npm ci --ignore-scripts
npm test
pm2 restart /root/.config/win-bridge/ecosystem.config.cjs --update-env

for number in 1 2 3; do
  curl --fail --silent --show-error --max-time 15 --write-out '\n' \
    "https://bridge.win-pskill.com/operator-${number}/health"
done
```

All three responses must contain `"accounting":"deposit-backed-v1"`, distinct expected operator addresses, the same vault and native network. Their existing single-gateway setting remains supported. Do not enable conversions if an old operator is still running.

## 2. Prepare the native configuration, initially disabled

```bash
cd /root/apps/server/bridge
export WIN_BRIDGE_HOME=/root/.config/win-bridge
export WIN_NATIVE_GATEWAY=http://127.0.0.1:3030
node configure-native.mjs
```

This writes the public deployment entry to `/root/apps/server/src/config/bridge-v2.json` with `accounting: "deposit-backed-v1"` and `enabled: false`. It preserves other network entries and backs up a changed file. No reserve cap or prefunding amount is needed. It refuses conflicting existing configuration, nonempty legacy reserves, wrong networks and old operators. For another installation, supply `WIN_OBSERVER_URLS` as a JSON array of the three HTTPS base URLs in operator order.

## 3. Restart the native network with the upgrade

Stop successfully before making a consistent backup or starting again:

```bash
cd /root/apps/server
npm run local:stop
```

After it reports that local services stopped:

```bash
(
  umask 077
  tar --exclude='instances-local/.pm2/*.sock' \
    -czf "/root/win-network-before-issuance-$(date +%Y%m%d-%H%M%S).tar.gz" \
    -C /root/apps/server instances-local
)
```

Wait for the backup to complete successfully, then:

```bash
npm run local:start
npm run local:check
```

Network formation takes time. Proceed only once the validators and archiver are healthy. If startup times out or checks fail, inspect the logs and resolve startup; do not delete instance data or generate another network ID. Apply the same code/config to every validator. This launcher starts all three local validators from the same compiled checkout.

```bash
for port in 9001 9002 9003; do
  curl --fail --silent --show-error --max-time 15 --write-out '\n' \
    "http://127.0.0.1:${port}/bridge/v2/status"
done
```

Every response should have `configured: true`, `enabled: false`, `accounting: "deposit-backed-v1"` and `requiresNativePrefunding: false`. The first deployment should report zero `nativeMinted`, `nativeBurned` and `nativeOutstanding`. If previously used reserve accounting is detected, stop and plan a migration; never edit ledger balances to bypass it.

## 4. Serve the updated wallet, then enable the configured bridge

Serve the updated web-client files from the wallet's existing PM2 application. Reload the browser after restarting the wallet:

```bash
pm2 restart win-wallet
```

The new wallet removes the prefunding requirement and requires upgraded operator health and mint/burn records. Until the next step, conversions remain disabled.

```bash
cd /root/apps/server/bridge
node configure-native.mjs --enable

cd /root/apps/server
npm run local:stop && npm run local:start
npm run local:check

curl --fail --silent --show-error --max-time 15 --write-out '\n' \
  https://wallet.win-pskill.com/api/bridge/v2/status
```

Wait for healthy network checks. Verify `configured`, `enabled` and `operational` are true, the vault/network match, and `requiresNativePrefunding` is false. Check all three validators as in step 3, now with `enabled: true`. Enabling config does not issue coins. `operational` describes native configuration, not live BNB/operator availability; the wallet checks those separately.

## 5. Verify a small round trip through the wallet

Use **Convert WIN**, not a direct token transfer to the vault. Only a finalized `Deposited` vault event can issue native WIN. The BNB wallet needs some BNB for gas and real WIN for the deposit; no native WIN is needed beforehand.

For example, a 2 WIN deposit locks 2 WIN on BNB, issues 1.99 native WIN to the depositor and 0.01 native WIN to the configured fee account. Withdrawing 1 WIN burns 1 native WIN, transfers a separate 0.005 native fee, and releases 1 WIN on BNB. Keep enough native balance for the withdrawal fee.

Check the native receipt and BNB release, including after a wallet reload. After that example, the native ledger should show 2 minted, 1 burned and 1 outstanding WIN (values are reported as atomic strings with 18 decimals). The BNB vault retains backing for the remaining native WIN, including fee-account balances. A pending release may temporarily leave more WIN in the vault than outstanding native issuance because the burn happens first.

Do not roll validators back to reserve accounting after accepting a deposit. Preserve the ledger, replay records, operator keys and wallet backups. The existing vault has no administrative refund or key rotation path; a committed burn can be released later with the same withdrawal ID after an outage, without burning again. Three keys on your one VPS still share that server's trust boundary.
