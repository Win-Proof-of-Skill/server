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
5. **Shardus CLI**:
   ```bash
   npm install -g shardus@4.3.1
   ```

### Clone, install, and run (quick start)

```bash
git clone <YOUR-WIN-PSKILL-REPO-URL> win-pskill
cd win-pskill
npm install
```

**Start a local network** (for example, with 10 nodes):

```bash
shardus create 10
```

**Stop the network:**

```bash
shardus stop
```

**Clean the network** (remove residual files and instance data):

```bash
shardus clean
rm -rf instances
```

### For demos and testing

1. Clone this repository.
2. Check out the `dist` branch: `git checkout dist`
3. Install dependencies: `npm i`
4. Compile: `npm run compile`

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
| `shardus create {# of nodes}` | Start a local network of nodes and supporting apps (e.g. `shardus create 10`) |
| `shardus stop` | Stop all nodes and apps |
| `shardus clean` | Clean residual files from the archiver and monitor server; then run `rm -rf instances` for a fresh start |

Local services started with the network:

| Service | URL |
| --- | --- |
| Shardus Monitor | http://localhost:3000 |
| Web Client | http://localhost:3333 |
| Archive Server | http://localhost:4000 |
| Explorer | http://localhost:4444 |

### Interacting with the network via `client.js`

Connect to a node and interact with the network:

```bash
node client.js localhost:9002
```

Replace `localhost:9002` with the host and port of any node in your network (e.g. `localhost:9001`, `localhost:9003`). See the comment block at the top of `client.js` for detailed instructions on creating accounts, registering, transfers, messages, and using the HTTP API.

### Creating a key pair for testing

1. Generate a key pair:

   ```bash
   node -e "
   const crypto = require('@shardus/lib-crypto-utils');
   crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc');
   const pair = crypto.generateKeypair();
   console.log('PUBLIC_KEY:', pair.publicKey);
   console.log('SECRET_KEY:', pair.secretKey);
   " 2>&1
   ```

2. Add the **PUBLIC_KEY** to `src/config/index.ts` in the `devPublicKeys` object (and `multisigKeys` if needed) with `DevSecurityLevel.High`.

3. Set environment variables for the client script:
   - `DEV_PUBLIC_KEY`: your public key
   - `DEV_PRIVATE_KEY`: your secret key

Then run `node client.js localhost:9002`.

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
