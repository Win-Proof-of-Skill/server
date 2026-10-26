# Win Proof of Skill (WIN-PSKILL)

**Website:** [win-pskill.com](https://win-pskill.com)

## Introduction

Win Proof of Skill is a network built around one idea: rewards should go to people who can demonstrate real ability. Instead of rewarding capital or raw computing power, the network lets participants prove their skill and win based on merit, with the rules enforced transparently on a distributed ledger.

The project runs on the [Shardus](https://github.com/shardeum/shardus-global-server) distributed ledger framework, which gives it linear scalability: the network gets more capacity as more nodes join, with fast transaction processing and low fees.

## Fork Notice

Win Proof of Skill is a **fork of [Liberdus](https://github.com/Liberdus/server)**, the payment network and first application built on Shardus. We are grateful to the Liberdus team for the foundation this project builds on, including the account model, transaction handling, networking, and tooling.

- Upstream project: [Liberdus/server](https://github.com/Liberdus/server)
- Liberdus whitepaper: [Liberdus Whitepaper](https://liberdus.com/Liberdus-Whitepaper-19.10.19.pdf)

Win Proof of Skill is an independent project. It is not affiliated with or endorsed by the Liberdus team, and changes made here do not necessarily reflect Liberdus's goals or roadmap. Original copyright and license notices from upstream are retained.

## Installation

### Prerequisites

1. **Node.js v20.19.3** (recommended via [nvm](https://github.com/nvm-sh/nvm)):
   ```bash
   nvm install 20.19.3
   ```
2. **Build tools** (Linux):
   ```bash
   sudo apt-get install -y build-essential libssl-dev pkg-config
   ```
3. **Rust 1.82**, installed with [rustup](https://www.rust-lang.org/tools/install):
   ```bash
   rustup default 1.82
   ```
4. **npm** (included with Node.js; update with `npm install -g npm` if needed)
5. The local launcher uses the dependencies installed in this checkout; no global
   Shardus CLI installation is required.

### Clone, install, and run (quick start)

```bash
git clone <YOUR-WIN-PSKILL-REPO-URL> win-pskill
cd win-pskill
npm install
```

**Start the isolated local network** (10 validators, one archiver, one monitor):

```bash
npm run local:start
```

**Stop the network:**

```bash
npm run local:stop
```

**Check process status and network readiness:**

```bash
npm run local:status
npm run local:check
```

Startup compiles the current source. Allow several minutes for network formation;
the local launcher uses 15-second consensus rounds to shorten development checks.
`local:check` exits successfully only when all ten validators report the local WIN
network, a recent processing cycle with ten active validators is available from
the validators and archiver, and the monitor responds. A running process alone
does not establish network readiness.

Data, logs, generated archiver keys, and the local process manager live under
`instances-local/` (ignored by Git). Starting or stopping never deletes this data.
The local signing network ID is generated once and persisted there, separately
from the deployment network ID. Existing instance directories and the public
server at `162.35.97.118` are not used. There is intentionally no automatic reset.

The launcher binds HTTP services to loopback, checks ports before starting, and
uses the installed WIN archiver **1.0.0** with account/receipt verification enabled.
It copies the packaged archiver runtime into `instances-local/runtime/archiver/`
to supply a locally signed archiver allow-list without changing installed packages.
A generated local authority signs that list; only its public key is configured
on the local validators. Deployment authority keys remain unchanged.
Local validators allow that exact archiver version; deployment defaults remain
unchanged. Local staking requirements and Golden Ticket requests are disabled.
Preset genesis wallet allocations have been removed in every mode; new wallets
start at zero. Funding/payment tests are a separate step.
This configuration is for a developer's computer, not a public deployment.

Stopping requests a consensus shutdown checkpoint through private files in the
local instance directories and waits up to four minutes for the archiver to save
it. If the checkpoint cannot be confirmed, the command reports failure and leaves
remaining services running instead of pretending that a recoverable stop succeeded.
On restart, pending internal network transactions are reconstructed from archived
cycles and each queue hash is verified before the archiver starts. Missing history,
a hash mismatch, or a ledger without a shutdown checkpoint stops the launch.
No public shutdown API is added. Run `npm run local:test` for the launcher isolation
checks after installing dependencies.

If startup fails, inspect `instances-local/<service>/stderr.log` and the service's
own logs. Run `local:stop` before retrying a partially started network. The launcher
refuses to overwrite an unrecognized local directory or modified node configuration.

### For Shardus-level development

1. Ensure you have access to [`shardus-global-server`](https://gitlab.com/shardus/global/shardus-global-server).
2. Make sure git caches credentials: `git config --global credential.helper cache`
3. Clone `shardus-global-server` to force git to prompt for credentials.
4. In another directory, clone this repository.
5. Install dependencies: `npm i`
6. Compile: `npm run compile`

## Usage

| Command | Description |
| --- | --- |
| `npm start` / `npm run local:start` | Compile and start the isolated local network |
| `npm stop` / `npm run local:stop` | Stop its services and preserve data |
| `npm run local:status` | Show local process status |
| `npm run local:check` | Check local network readiness; nonzero exit when not ready |

Local services started with the network:

| Service | URL |
| --- | --- |
| Shardus Monitor | http://127.0.0.1:3000 (local login: `admin` / `password`) |
| Archive Server | http://127.0.0.1:4000 |
| Validator APIs | http://127.0.0.1:9001 through http://127.0.0.1:9010 |

The web client, gateway, and explorer are not started by this backend launcher.
The web client's deployment endpoints are not changed by the local commands.

### Interacting with the network via `client.js`

Start the local network, wait for readiness, then open the interactive client:

```bash
npm run local:start
npm run local:check
npm run client
```

The default node is `127.0.0.1:9001`; use `node client.js 127.0.0.1:9002` to select
another validator. Enter a wallet name, then run `testing` for the command guide.
Use `network`, `balance`, `transfer`, and `receipt <txId>` for payment tests. Profile
and contract commands accept editable JSON files and support hiring approval hashes.
See [the manual testing guide](docs/MANUAL_TESTING.md) for the full workflow.

New wallets have zero WIN. Alias registration does not fund them, public minting
is disabled, and no local faucet is configured. Funding is a separate setup step.

### Creating wallets for testing

Inside the client:

```text
wallet create alice
wallet create bob
wallet list
use alice
address
```

These are ordinary wallet keys, saved in `wallet.json`; no server authority-key
changes are needed. Keep that file private and backed up. Transaction submission
statuses and verified receipts are saved separately in `client-transactions.json`.
Neither file is tracked by Git. Run `npm run client:test` to check the client protocol.

### Querying a node via HTTP

You can query any node directly with a browser or `curl`.

- **Account** (by account ID / address):
  ```bash
  curl "http://localhost:9002/account/<ACCOUNT_ID>"
  ```

- **Account transactions:**
  ```bash
  curl "http://localhost:9004/account/<ACCOUNT_ID>/transactions"
  ```

- **Messages (chat).** The chatId is the first path segment after `/messages/`:
  ```bash
  curl "http://localhost:9002/messages/<CHAT_ID>/0"
  ```
  The response is JSON with a `messages` array. The chatId is derived from the two participants' addresses (sorted and hashed), and can be obtained from the client with `message poll <alias>`.

## Contributing

Issues and pull requests are welcome. If a fix or feature is relevant to the shared codebase, please consider contributing it upstream to [Liberdus/server](https://github.com/Liberdus/server) as well.

## Links

- Website: [win-pskill.com](https://win-pskill.com)
- Upstream (Liberdus): [github.com/Liberdus/server](https://github.com/Liberdus/server)

## License

This project inherits the license of the upstream Liberdus repository. See the `LICENSE` file for details.


## WIN application behavior deployment

This work targets the server and sibling web-client. It does not deploy services.
The application signing network ID is:

```
f4ad1838b012fe4af28cfbcc01c30044e3e225ef6be7e8461343d1de369949d9
```

It is shared by `src/config/index.ts` and `../web-client/network.js`. Shardus still
creates its own independent cycle network ID. Wallet transactions and the global
WIN account use the application ID; CLI discovery uses `/network/parameters`.
A node holding a different application's global network account rejects these
transactions. No existing ledger has been reset, migrated, or deleted. Use a fresh
WIN deployment or design a coordinated existing-ledger migration before rollout.
All validators and clients must adopt this protocol together.

The web gateway is configured as `http://162.35.97.118:3030` and WebSocket gateway
as `ws://162.35.97.118:3031`, following the existing gateway port convention. These
are gateway ports, not validator ports. The addresses have not been deployed or
connectivity-tested. An HTTPS-hosted web client needs an HTTPS/WSS endpoint with a
valid certificate instead; browsers block mixed HTTP/HTTPS requests.

Ordinary wallets start at zero and public `create` minting is disabled. The old
`src/config/genesis.json` allocations and their startup loader have been removed.
This prevents preset wallet funding on a fresh network; it does not erase accounts
from an existing ledger. Network and developer-authority records remain because
they contain configuration/authorization state, not spendable wallet balances.
Governance project issuance and validator rewards still need a separate funding
policy before internal balances can represent externally backed WIN tokens. The
selected bridge model uses Liberdus-style funded native bridge accounts,
observers and shared signing, adapted with a lock/release vault for the existing
BSC WIN token. `src/config/bridge.json` records public setup per application network
ID. The current local network's reserve ceiling is 100 WIN, not an initial funding
amount. `/bridge/status` and the client's `bridge status` command report setup and
actual reserve balances without writing accounts or moving funds. This first step
does not activate bridging or enforce the reserve cap; funding/cap enforcement,
vault integration, observer/TSS services and cross-chain recovery remain pending.
The intended BSC token is a reference only, not an active mainnet connection. The
inherited Liberdus faucet, bridges and auxiliary service URLs are disabled in the
WIN web configuration until WIN services are supplied.

The current step provides payment screens, backend profiles/contracts, strict schemas,
revision checks, historical approvals, and immediate eligible scoring. Profile/CV
editing screens, approval inbox screens, endorsement/skill handlers and PDF export
remain subsequent steps. See `docs/API.md` for the implemented envelopes and limits.

Validation: `./node_modules/.bin/tsc --noEmit -p .` and
`./node_modules/.bin/jest --runInBand --coverage=false --silent`.
The web-client's prescribed companion repository was fetched at main commit
`2fc3036`, but that published tree lacks AGENTS.md, local-tests/README.md, and the
local-tests runner. Its suite is unavailable, not passed. Local client syntax and
12 temporary VM behavior checks cover exact amounts, protected targets, pending/
unknown states, receipt identity, and replay-safe submission. No client companion
changes were committed or published; companion regression integration remains a
follow-up once the documented runner is available. No commits or PRs were created.
