# Manual WIN network testing

Run commands from the server checkout. Start the network in one terminal:

```bash
npm run local:start
npm run local:check
```

Wait for all validators to report ready, then open the client:

```bash
npm run client
# Or select another local validator:
node client.js 127.0.0.1:9002
```

Enter a wallet name, such as `alice`. Inside the client, `testing` shows the main
commands and `help` lists every command, including legacy administration/DAO tools.
`exit` closes the client. It does not stop the network.

The client reads the WIN signing network ID from the node's `/network/parameters`.
For local ports 9001–9010, it also checks the generated `instances-local` manifest
when present. It does not use the consensus cycle's separate network ID.

## Wallets and balances

```text
network
bridge status
wallet create alice
wallet create bob
wallet list
use alice
address
balance
balance bob
```

Wallet creation generates local keys, selects that wallet, and saves it in the
existing `wallet.json` in the server directory. It does not create money or fund an
on-chain account. Wallet listings show public addresses, never private keys.
The file contains private keys; new writes use owner-only permissions. Back it up.

`register` optionally registers an alias on-chain, without funding the wallet.
Payments accept local wallet names, aliases, 64-character WIN addresses, or
`0x` Ethereum addresses. An alias is not needed to receive a payment.

**Test funding is not configured yet.** You can test connections, wallet creation,
alias registration, and queries now. Payments and profile/contract writes require
funded wallets. `create` explains that public minting is disabled; `faucet` explains
that no faucet is available unless one is explicitly configured. These client
changes do not change issuance rules or enable a faucet.

`bridge status` reads the new `/bridge/status` endpoint. The chosen bridge design
uses Liberdus-style native reserves and shared signing, with a separate vault for
the existing BSC WIN token. The current local network has a configured maximum
reserve of 100 WIN; no amount has been allocated. Each future transfer will use
its requested amount, subject to balance, fees and limits. The command reports
the reserve's actual balance separately from its configured ceiling.

The bridge remains inactive: reserve funding/cap enforcement, the vault and the
observer/signer services are not implemented in this step. Configuring the cap
does not enforce it in consensus or authorize deposits. On an already running
network, the endpoint becomes available after the usual coordinated stop/start
with the compiled server. This code change does not restart or reset that network.

## Payments and receipts

```text
use alice
transfer
transactions
receipt TRANSACTION_ID
```

`transfer` asks for the recipient, decimal WIN amount, and optional memo. It reads
the current fee and sender nonce, checks funds and protected addresses, and shows
the amount and fee before asking whether to submit. Amounts retain all 18 decimal
places; do not use exponent notation or thousands separators.

Submission prints the transaction ID and waits up to 45 seconds for a committed
receipt. `pending` means the node accepted submission. Only a matching successful
receipt means `confirmed`. A rejected submission or failed receipt is `failed`.
Missing receipts or transport timeouts become `unknown`; do not assume success or
resend. Use `receipt ID` to check again. Recent receipts come from the validator's
cache; an old transaction without a saved receipt may remain unknown.

`client-transactions.json` records submissions by network and wallet. `transactions`
shows this client journal, not complete network history. Unresolved payments block
reuse of their nonce. No transaction is automatically rebroadcast. Previously
verified receipts remain in the journal after the node cache expires.

## Profiles

Create a content template and edit the generated JSON file in your editor:

```text
profile template person person.json
profile template company company.json
```

Supported types: `person`, `organization`, `government`, `company`, `university`,
`school`. The person template includes CV section arrays. Content must match
`src/domain/schema.ts`; do not add server-managed fields such as `owner`, `revision`,
or timestamps. Template commands refuse to overwrite an existing file.

After funding is configured:

```text
use alice
profile create person.json
profile get PROFILE_ID
score PROFILE_ID
profile update PROFILE_ID REVISION person.json
```

Creation prints a randomly generated object ID; save it with the transaction ID.
You can supply your own 64-character lowercase hex ID as the last create argument.
Update requires the revision shown by `profile get`, and replaces the entire
content. The server assigns the next revision and timestamps. Fees use the compiled
server rules, including the UTF-8 payload size. Run `npm run compile` after changing
those rules. The score command shows both the stored integer and its decimal value
(one million stored units equals a score of one).

Create the hiring entity's profile using a different wallet, for example `bob`.
A worker cannot approve their own hiring relationship.

## Historical contracts and hiring approval

```text
contract template contract.json
```

Edit the template: replace the worker and hiring profile IDs, dates, duration,
responsibilities, and month outcomes. It starts with a completed, one-month
historical contract. `skillIds` can remain empty while skill creation is unavailable.
Completed contracts must describe every completed month; canceled contracts need
an end date. Do not put an approval status in the content: the server controls it.

```text
use alice
contract create contract.json
contract get CONTRACT_ID
contract request CONTRACT_ID
contract get CONTRACT_ID
```

Saving the record does not award score, charge historical salaries, or lock escrow.
After the request is confirmed, copy `approvalRequest.hash` from `contract get`.
Review the record as the hiring entity, then submit that exact hash:

```text
use bob
contract get CONTRACT_ID
contract approve CONTRACT_ID HIRING_PROFILE_ID REQUEST_HASH
```

Each hiring entity approves with its own controlling wallet. The client displays
the current record and hash before asking for confirmation. A changed hash requires
another review. On final approval, the server credits eligible completed months
according to work status and the configured formulas.

Other supported commands:

```text
contract reject CONTRACT_ID HIRING_PROFILE_ID REQUEST_HASH
contract expire CONTRACT_ID
contract update CONTRACT_ID REVISION contract.json
score WORKER_PROFILE_ID
```

Rejection asks for a reason. Expiry is allowed only after the request expires.
Updating uncredited content invalidates previous approval. Already credited
contracts cannot be edited until the server supports score correction.
Endorsement creation, skill creation, and PDF export are not implemented by this
command-line client.

## Stop and test

Exit the client, then save a network shutdown checkpoint:

```bash
npm run local:stop
```

Run client protocol tests with `npm run client:test`. For isolated manual sessions,
`WIN_CLIENT_WALLET_FILE` and `WIN_CLIENT_HISTORY_FILE` can point to files in an
existing private directory. Existing malformed wallet/history files cause an error
instead of being overwritten.
