# WIN reserve bridge deployment

The wallet implementation supports BNB-chain WIN ↔ native WIN. **No vault is deployed by this change and no real funds were transferred.** The shipped `src/config/bridge-v2.json` is empty and all conversions remain disabled. This is a new protocol requiring independent review and a full deployment round trip before accepting public funds.

The existing asset is chain 56, token `0x8a27363dd26f78b09014338e106b16055fcb9799`, with 18 decimals. The vault uses exact ERC-20 transfers; it neither mints that token nor grants an administrator a withdrawal path. Native transfers between existing wallets and the protected reserve preserve native supply. There is no faucet or configuration-driven allocation.

## Amounts and fees

- 100 BNB WIN deposited: reserve debited 100, user receives 99.5 native WIN, fee account receives 0.5 native WIN.
- 100 WIN withdrawn: user debited 100.5 native WIN, reserve credited 100, fee account credited 0.5, vault releases 100 BNB WIN.
- Native transfers charge an additional 0.5%. Round fees upward to the smallest atomic unit (18 decimals); a deposit must exceed its fee.
- Profile/skill metadata, contract and endorsement fees retain their existing schedules and now credit the fee account.
- Fee account: `9fe734826be44b76f06d1d3262130dce45076a3c000000000000000000000000`.
- BNB network gas is separate and paid by the wallet on approvals, deposits and releases. Operators only sign; they do not need to hold a gas balance.

## Trust and replay protection

Two of three configured operators must attest. For independent protection, run each signer under separate control, with separate keys and infrastructure. The explicitly centralized [single-server setup](SINGLE-SERVER.md) keeps the two-signature requirement but shares a host and one trusted native gateway. Two compromised operators can authorize false deposits or payouts. Native validators verify EIP-712 attestations; this is not an on-chain BNB light client.

Deposit operators require a successful vault event in a canonical block at or before BNB's `finalized` block. By default, withdrawal operators require two of three **trusted, independently operated native gateways** to agree on both the committed record and its successful receipt. Explicit `nativeGatewayMode: "single"` accepts exactly one configured gateway, while still requiring both the matching committed record and successful receipt. An unavailable gateway fails closed; the default mode never falls back to one gateway. Gateway trust is part of this design; the observer does not verify native consensus certificates itself. Do not configure three names for the same backend and call them independent.

The EIP-712 domain binds chain, vault, protocol version and native network ID. Native event records, wallet nonces and the vault's release map prevent duplicate payouts. The native reserve tracks total funding and reserves outgoing value at withdrawal commitment: withdrawals cannot exceed prior verified deposits, even before pending BNB releases settle. A supply cap limits total native reserve funding. Failed native validation changes no balances and charges no fee.

The wallet saves signed transactions in its encrypted account backup before submission, rebroadcasts the same bytes after a lost response, and checks committed records before resubmitting native operations. Reverted BNB transactions can be retried without charging the native conversion again. Keep wallet backups, including pending bridge records. A committed withdrawal cannot be canceled; operator/network outages can delay recovery. There is no administrative refund or emergency key rotation in this vault version; changing operators requires a separately reviewed migration.

## Deployment sequence

1. Install pinned tooling: `cd bridge && npm ci --ignore-scripts`; run `npm run compile` and `npm test`.
2. Generate three operator keys outside the repository. Keep private keys only on their respective operator hosts. Prepare a deployment JSON with `networkId`, `bnbRpc` and three `operators` addresses. Use the exact application network ID, not a core cycle ID.
3. Review the contract and deployment values. `deploy.mjs` requires `WIN_BRIDGE_DEPLOYMENT`, `WIN_BRIDGE_DEPLOYER_KEY`, and `CONFIRM_WIN_MAINNET_DEPLOYMENT=yes`. Running it spends BNB gas. It prints the deployed address and **runtime** bytecode hash, which includes immutable values. Verify/publish the contract source on BscScan separately.
4. Configure the identical entry on every validator in `src/config/bridge-v2.json`:

   ```json
   {
     "schemaVersion": 2,
     "deployments": {
       "<64-character native network ID>": {
         "enabled": false,
         "vaultAddress": "<deployed lower-case address>",
         "vaultCodeHash": "<0x-prefixed runtime code hash>",
         "operators": ["<operator 1>", "<operator 2>", "<operator 3>"],
         "observerUrls": ["https://operator1.example", "https://operator2.example", "https://operator3.example"],
         "reserveCapAtomic": "100000000000000000000"
       }
     }
   }
   ```

   Example cap is 100 WIN; choose the funded liquidity limit deliberately. This is a consensus upgrade: deploy compatible validator code/config together, preserve account data, and do not change the application network ID. The previous `bridge.json` diagnostics remain for compatibility; the wallet uses `/bridge/v2/status`.
5. Fund native reserve `6000000000000000000000000000000000000000000000000000000000000000` using the `bridge_fund` operation. Ordinary transfers to that protected address are rejected. `fund-reserve.mjs` defaults to preparing a signed transaction only. Set `WIN_NATIVE_GATEWAY`, `WIN_NATIVE_FUNDING_KEY`, `WIN_RESERVE_AMOUNT` (decimal WIN), and `WIN_RESERVE_TX_FILE` (private file outside the repository). Review its amount, then explicitly set `CONFIRM_NATIVE_RESERVE_FUNDING=yes` and rerun with `--broadcast`. The same saved transaction is reused for retries. Confirm its successful native receipt. Funding uses existing coins and is not recoverable through a reserve-admin withdrawal.
6. Each operator needs an external JSON file containing `networkId`, `vaultAddress`, `vaultCodeHash`, `operators`, `bnbRpc`, exactly three `nativeGateways`, and `walletOrigin` (the HTTPS wallet origin). Set `WIN_BRIDGE_CONFIG` to that file. Supply the key through `WIN_BRIDGE_KEY_FILE` (a private JSON file containing `privateKey` and optionally `address`) or the existing `WIN_BRIDGE_OPERATOR_KEY` environment setting, never both. For three processes using one local gateway, follow [the single-server guide](SINGLE-SERVER.md). Never commit keys or put them in client JavaScript.
7. Run each operator on its own host:

   ```sh
   pm2 start ecosystem.config.cjs
   pm2 save
   ```

   The service binds `127.0.0.1:8081`; place an HTTPS reverse proxy in front of it with request size/rate limits. Keep PM2 process state and environment private. `/health` returns public deployment identity. Configure the BNB RPC to support finalized-block reads; unsupported finality fails closed.
8. Set `enabled:true` identically on validators once reserve, vault and operators have been checked. Configure the client's HTTPS/WSS native gateway in `network.js`; the existing HTTP public URL is intentionally blocked. Serve the static wallet via HTTPS (PM2 can serve files behind the same reverse proxy).
9. Perform a small controlled deposit, native receipt check, withdrawal and finalized BNB release with the deployment owner present. Check both liquidity balances and native fee receipts. Test an operator outage and wallet reload/recovery. Only then make the bridge available publicly.

## Linux dependency installation

The lockfile explicitly marks Ganache's nested `fsevents@2.3.2` dependency as optional. It is a macOS-only file watcher; Linux must skip it. Keep this flag if regenerating the lockfile, and verify a clean `npm ci --ignore-scripts` on Linux afterward. See the [npm shrinkwrap/platform issue](https://github.com/npm/cli/issues/7622).

If an older checkout fails with `EBADPLATFORM` for `fsevents`, update to the corrected lockfile. To repair that older copy directly, run this from `server/bridge`:

```sh
node <<'NODE'
const fs = require('node:fs');
const path = 'package-lock.json';
const lock = JSON.parse(fs.readFileSync(path, 'utf8'));
const entry = lock.packages['node_modules/ganache/node_modules/fsevents'];
if (!entry || entry.version !== '2.3.2' || !entry.os?.includes('darwin')) {
  throw new Error('Unexpected dependency entry; use the updated bridge lockfile.');
}
entry.optional = true;
fs.writeFileSync(path, JSON.stringify(lock, null, 2) + '\n');
NODE
npm ci --ignore-scripts
npm run compile
npm test
```

This preserves all pinned versions and integrity hashes. Do not bypass platform checks with `--force` or delete the lockfile to work around this error. No keys or live network transactions are needed for these checks.

## Verification performed

Local EVM tests exercise a real compiled vault and synthetic ERC-20, valid payout, replay, duplicate signatures, changed amounts and wrong signing domain. Native handler tests cover conservation, 0.5% fees, reserve caps, source replay, invalid signatures and serialization across restart. Client companion tests cover ABI compatibility with ethers, signature recovery, finality, distinct quorum, fee rounding and resumed deposit/withdrawal flows. Additional operator tests cover explicit single-gateway validation, successful receipt requirements, preservation of the default quorum during outages, existing-key preservation, deployment/key matching, private key-file permissions, and three concurrently running local HTTP services against a simulated BNB RPC. No live BNB or multi-validator end-to-end bridge deployment was exercised.

References: [BNB finality](https://docs.bnbchain.org/bnb-smart-chain/introduction/), [OpenZeppelin cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography).
