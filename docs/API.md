# API Documentation

## Network Endpoints

### GET /network/parameters
Returns current network parameters.

The `*UsdStr` fields are the source of truth for transaction fees, staking,
rewards, penalties, and tolls. After the 2.5.2 migration, a stored network
account may still contain retired `transactionFee`, `faucetAmount`,
`nodeRewardAmountUsd`, `nodePenaltyUsd`, `stakeRequiredUsd`, `defaultToll`, and
`minToll` keys. A later apply-path write to the network account strips them;
change-queue updates alone may leave them.
Clients should treat these keys as optional.

`maintenanceInterval` and `maintenanceFee` remain network parameters. With the
current zero fee, maintenance still updates an account's `lastMaintenance` after
each interval.

**Response:**
```json
{
  "parameters": {
    "current": object,
    "listOfChanges": array
  }
}
```

### GET /bridge/status

Read-only diagnostics for the selected Liberdus-style reserve bridge. The native
side will use transfers from/to a TSS-controlled wallet; the existing BSC WIN
token needs a separate lock/release vault because it has no bridge mint/burn API.

Public configuration lives in `src/config/bridge.json`, under a WIN application
network ID in `deployments`. Each entry contains `tssAddress`, `vaultAddress`,
`reserveCapWin` (exact decimal text or null), and `observerUrls`. Unknown fields,
protected custody addresses, inexact amounts and credential-bearing observer URLs
are rejected. The native reserve address is derived from the TSS EVM address by
removing `0x`, lowercasing, and appending 24 zeroes. Do not put private keys or TSS
shares in this file.

The current local test network has `reserveCapWin: "100"`. This is a maximum
reserve balance, **not** an initial allocation or a request to send 100 WIN in one
transaction. Other network IDs do not inherit this setting. Editing configuration
never funds an account or restores deleted genesis allocations.

The response includes `model`, `networkId`, `referenceToken`, public addresses,
`reserveCapAtomic`, actual `reserve.balanceAtomic`, `reserve.transferNonce`,
`reserve.withinConfiguredCap`, `missing`, and `pendingImplementation`. A missing
reserve returns `accountExists: false` and a null balance; an existing unfunded
wallet returns balance `"0"`. Amounts are decimal strings in 18-decimal atomic units.
The endpoint returns 503 for an unavailable/mismatched network or an unsuitable
reserve account. Reads do not alter the ledger.

This step exposes configuration and diagnostics only. `enabled`, `operational`,
`reserveCapEnforced` and `allocationAppliedByConfiguration` remain false, even if
addresses are filled in or the reserve is funded. Funding, cap enforcement, vault
integration, observers, shared signing and durable cross-chain event replay
protection remain implementation steps. `referenceToken` identifies the intended
BSC mainnet asset; it does not connect this local test network to real funds.
Compile and perform a coordinated server restart before querying a newly added
endpoint on a running deployment.

## Account Endpoints

### GET /account/:id
Returns account information for the given ID.

The account is returned as stored. After the 2.5.2 migration, user accounts
may retain or omit the retired `data.friends`, `data.stake`,
`data.remove_stake_request`, `emailHash`, `verified`, and `claimedSnapshot`
fields depending on whether they have been written since activation. Node
accounts may likewise retain or omit the retired `balance` and `nodeRewardTime`
fields. Clients should treat those fields as optional.

**Parameters:**
- `id`: Account identifier

**Response:**
```json
{
  "account": object
}
```

### GET /account/:id/alias
Returns alias information for the given account ID.

**Parameters:**
- `id`: Account identifier

### GET /account/:id/transactions
Returns transactions for the given account ID.

**Parameters:**
- `id`: Account identifier

### GET /account/:id/balance
Returns balance for the given account ID.

**Parameters:**
- `id`: Account identifier

### GET /account/:id/toll
Returns toll information for the given account ID.

**Parameters:**
- `id`: Account identifier

### GET /address/:name
Returns address information for the given name.

**Parameters:**
- `name`: Account name

### GET /account/:id/recentMessages
Returns recent messages for the given account ID.

**Parameters:**
- `id`: Account identifier

## Messages Endpoints

### GET /messages/:chatId
Returns messages for a specific chat.

**Parameters:**
- `chatId`: Chat identifier

**Response:**
```json
{
  "messages": array
}
```

## Debug Endpoints

### GET /debug/dump
Returns debug dump information.

### POST /debug/exit
Triggers application exit.

## Staking Endpoints

### PUT /query-certificate
Query staking certificate information.

**Response:**
- Success: Returns signed stake certificate
- Error: Returns error message with 500 status code

## Transaction Inject Endpoint

### POST /inject
Injects a transaction into the system.

**Request Body:**
```json
{
  "tx": string  // JSON stringified transaction object
}
```

**Response:**
```json
{
  "result": object  // Result of transaction processing
}
```

**Error Response:**
```json
{
  "error": string  // Error message if injection fails
}
```

The inject endpoint allows you to submit transactions to the system. The transaction must be provided as a JSON stringified string in the request body's `tx` field. The system will parse the transaction, process it, and return the result or any error that occurred during processing.

## Available Transaction Types

Network Management:
- `init_network`: Initialize the network
- `change_config`: Change network configuration
- `apply_change_config`: Apply configuration changes

Account Management:
- `register`: Register new account
- `create`: Disabled unrestricted mint transaction
- `transfer`: Transfer between accounts

Messaging and Social:
- `message`: Send messages
- `toll`: Manage toll operations

Staking and Rewards:
- `deposit_stake`: Deposit stake
- `withdraw_stake`: Withdraw stake
- `set_cert_time`: Set certificate time
- `query_certificate`: Query certificate
- `init_reward`: Initialize rewards
- `claim_reward`: Claim rewards
- `apply_penalty`: Apply penalties

Each transaction type requires specific parameters and follows a particular format. The transaction object must include a `type` field matching one of the above transaction types.

## Network Management Transactions

Note: All network management transactions interact with the network account, which maintains global parameters. These transactions typically require appropriate permissions and valid signatures.

#### `init_network`
Initializes the network account with initial configuration.

**Transaction Parameters:**
```json
{
  "type": "init_network",
  "timestamp": number
}
```

#### `change_config`
Submits configuration changes to be applied to the network at a specified cycle.

**Transaction Parameters:**
```json
{
  "type": "change_config",
  "from": string,  // Account ID initiating the change
  "cycle": number, // Target cycle number (-1 for latest cycle + 3)
  "config": string, // JSON stringified configuration changes
  "timestamp": number
}
```

Requirements:
- The `config` field must be a valid JSON string
- The transaction must target the network account
- If `cycle` is -1, the change will be scheduled for 3 cycles after the current cycle
- The account specified in `from` must exist in the system

The transaction schedules a configuration change to be applied at the specified cycle. When successful, it triggers an `apply_change_config` transaction to be executed at the appropriate time.

#### `apply_change_config`
Applies scheduled configuration changes to the network.

**Transaction Parameters:**
```json
{
  "type": "apply_change_config",
  "timestamp": number,
  "network": string,  // Network account ID
  "change": {
    "cycle": number,  // Cycle number when change should be applied
    "change": object  // Parsed configuration changes
  }
}
```

This transaction is automatically triggered by the system to apply configuration changes that were previously submitted through `change_config`. It executes after a short delay (typically 10 seconds) from the original change_config transaction.

## Account Management Transactions

Note: Account management transactions handle user account creation, registration, and token transfers. These transactions typically require valid signatures and sufficient balances where applicable.

#### `register`
Registers an alias for a user account.

**Transaction Parameters:**
```json
{
  "type": "register",
  "from": string,    // Account ID registering the alias
  "alias": string,   // Desired alias (max 20 characters)
  "aliasHash": string, // Hash of the alias
  "timestamp": number,
  "sign": {
    "owner": string  // Must match 'from' field
  }
}
```

Requirements:
- Alias must be less than 21 characters
- Alias must contain only alphanumeric characters
- Account must not already have a registered alias
- Requested alias must not be already taken
- Must be signed by the account specified in 'from' field
- Signature must be cryptographically valid

#### `create`

Disabled in the WIN application network. Public transactions cannot mint tokens.
Ordinary wallet creation starts with zero WIN. Preset genesis wallet allocations
and their startup loader have been removed; existing ledger state is not erased.
Governance issuance remains a separate policy requiring review before using
externally backed tokens. Importing a profile or contract never funds a wallet.

#### `transfer`

Transfers atomic WIN between ordinary wallets. Use the existing signed transaction
format and `Utils.safeStringify` BigInt encoding; JSON numbers must not carry amounts.

Required fields: `type: "transfer"`, `from`, `to`, `amount: bigint`, `fee: bigint`,
`nonce`, `chatId`, `timestamp`, `networkId`, and `sign`. The signature covers all of
these fields. `chatId` uses the existing deterministic sender/recipient calculation.

- `amount` must be positive. One WIN is `10^18` atomic units.
- The fixed transfer fee is `100000000000000000` atomic units (0.1 WIN), matching
  `src/config/formulas.ts`. `/network/parameters` exposes the exact fee and network ID
  in `protocol`; other transaction types retain their own fee rules.
- `nonce` is a positive safe integer equal to `sender.data.transferNonce + 1`.
  Legacy accounts without that field begin at zero. Successful payments consume it
  atomically; rejected payments change neither balances nor nonce and charge no fee.
- A missing recipient can be initialized at zero by the server; the sender must exist.
  Public/private account compatibility and existing memo-toll rules still apply.
- No payment key, including sender, recipient or chat ID, may use a protected registry.
- `deductTxFeeFromAmount: true`, when enabled, makes the recipient receive
  `amount - fee`; otherwise the sender pays the fee on top of the amount.
- Required sender balance includes any applicable maintenance amount.

A successful `/inject` response means submitted, not confirmed. Only a committed
receipt matching `txId`, `networkId`, `type: "transfer"`, and `success: true` confirms
the payment. Missing receipts, response loss, and timeouts remain unknown. Keep the
signed transaction and nonce; do not automatically issue a second payment. A failed
committed receipt or a definitive submission rejection is a failure.

## WIN profiles and contract records

The five fixed native accounts contain maps of current records: profiles at `1`
followed by 63 zeroes, contracts at `2`, endorsements at `3`, scores at `4`, and skills
at `5`. Internal addresses have no `0x` prefix. Only the matching typed handlers can
access these registries. There is no general client-writable score transaction.

Submit new `profile` and `contract` transactions to `/inject` using the existing
stringified signed envelope. The common fields are:

```ts
{
  type: 'profile' | 'contract',
  action: 'create' | 'update' | 'request_approval' | 'approve' | 'reject' | 'expire',
  from: walletAddress,
  to: registryAddress,
  objectId: stable64CharacterHexId,
  expectedRevision: 0, // creation: zero; later actions: current record revision
  payload: content,   // create/update only
  fee: atomicBigInt,
  timestamp: currentTimestamp,
  networkId: winApplicationNetworkId,
  sign: { owner: walletAddress, sig: signature }
}
```

Strict, mandatory schemas in `src/domain/schema.ts` reject unexpected fields even
when legacy AJV validation is disabled. IDs are chosen once and retained on updates.
The server controls owner, managers, schemaVersion, revisions, createdAt and updatedAt.
Current manager lists begin empty; there is no manager-administration action yet.
Updates replace one map entry, preserving other objects. A revision conflict must be
resolved by reading the current record. Normal transaction receipts and core recovery
history are not deleted by this latest-record policy.

Profile actions are `create` and `update`. Common content is displayName, optional
summary/avatarUrl/coverImageUrl/contact, type, and details. Types are person,
organization, government, company, university, and school. Type cannot change after
creation. Person details retain the complete CV fields in `PersonDetails`. Entity
details require legalName; government also requires jurisdiction. A profile creates
its initial scalar score (1,000,000 integer millionths), but creates no WIN balance.
Large scalar scores use exact decimal strings, following the attached formula helper.

Profile fees are the metadata formula (0.01 WIN + 0.001 WIN per started KiB of the
canonical unsigned envelope, excluding fee and sign). Contract actions cost 1 WIN.
The sender must already have a funded ordinary wallet. Failed object operations
change no records or balances.

Contract content is defined by `ContractContent` in `src/@types/index.ts`:
origin, title, publicDescription, optional encryptedDescription, workerProfileId,
hiringProfileIds, skillIds, terms, optional compensation, workStatus, periodOutcomes,
evidence, and optional cancellationReason. All registry data is published; do not
put unencrypted confidential descriptions in it. Referenced profiles and skills must
exist. An empty skillIds list is allowed until skills are registered.

Work status is planned, active, completed, canceled, or disputed. Approval status is
separate: not_requested, pending, approved, rejected, or expired. Work dates are
strict YYYY-MM-DD dates. Period outcomes contain unique 1-based calendar months and
success/failure outcomes. Claimed periods must have finished by the current consensus
time and any contract end date. Completed contracts describe every duration month;
canceled contracts may describe only the periods actually worked.

Historical creation stores original dates with a current transaction timestamp and
approvalStatus not_requested. Compensation is descriptive: neither creation nor
approval pays salaries, creates escrow, or awards unapproved score. The worker's
profile controller creates the record; ownership is checked on later edits.

`request_approval` is authorized by the contract controller and current worker
controller. It creates a commitment binding network/rules, contract ID, exact terms
hash/revision (including work status and outcomes), parties, hiring authorities,
request ID, expiry, and score snapshots. A hash alone is not an approval.

`approve` and `reject` include `requestHash` and `hiringProfileId`; reject also includes
reason. The transaction signer must be both an authority captured in the request
and a current controller of that hiring profile. A worker cannot approve its own
relationship. Every hiring profile must approve. Record revision changes do not
change the terms revision or request hash during collection of approvals.

The final approval applies eligible monthly formula deltas atomically to the score
registry using the fixed request snapshots. Successful periods add deltas; failed
periods subtract them, with formula clamping. Planned/disputed work receives no new
credit. Credited month counters reject repeated credit. There are no salary effects.

Edits to uncredited contracts invalidate previous requests and approvals. Contracts
that have already credited periods currently reject edits: retroactive score
correction and ongoing monthly extension require a separate protocol. This avoids
silently rewriting evidence for already-awarded score.

Late approvals fail. Anyone may submit `expire` after a pending request expires;
the owner can also start a new request after expiry or rejection. Read endpoints are
`GET /profiles/:id`, `/contracts/:id`, and `/scores/:id`, returning `record` and
`registryRevision`. Contract reads also return effectiveApprovalStatus without
mutating stored state. A missing record returns 404, and unavailable state returns 503.

Each object transaction is capped at 256 KiB and each registry draft at 4 MiB. These
bounds keep the current five-account architecture within finite resource limits;
raising capacity requires a coordinated protocol/resource-limit change.

## Messaging and Social Transactions

Note: Messaging and social transactions handle user interactions and messaging fees. These transactions typically require valid signatures and may involve toll payments for messaging.

#### `message`
Sends a message to another user.

**Transaction Parameters:**
```json
{
  "type": "message",
  "from": string,    // Sender account ID
  "to": string,      // Recipient account ID
  "chatId": string,  // Chat identifier
  "message": string, // Message content (max 5kb)
  "timestamp": number,
  "sign": {
    "owner": string  // Must match 'from' field
  }
}
```

Requirements:
- Both sender and recipient accounts must exist
- Message size must be less than 5kb
- Sender must have sufficient balance to cover:
  - Transaction fee
  - Toll fee (when required)
  - Maintenance amount
- Must be signed by the sender account
- Signature must be cryptographically valid

The transaction will:
1. Deduct fees from sender account
2. Add toll payment to recipient account (when required)
3. Store message in chat history
4. Update chat references for both users
5. Update timestamps for all affected accounts

#### `toll`
Sets the toll amount required for senders to send messages.

**Transaction Parameters:**
```json
{
  "type": "toll",
  "from": string,    // Account ID setting the toll
  "toll": bigint,    // Toll amount (1 to 1,000,000 tokens)
  "timestamp": number,
  "sign": {
    "owner": string  // Must match 'from' field
  }
}
```

Requirements:
- Account must exist
- Toll amount must be between 1 and 1,000,000 tokens
- Account must have sufficient balance for transaction fee
- Must be signed by the account
- Signature must be cryptographically valid

The transaction will:
1. Deduct transaction fee from account
2. Set new toll amount for the account
3. Update account timestamp

Note: If a user has not set a toll amount, the system's default toll will be used for messages.

## Staking and Rewards Transactions

#### `deposit_stake`
Deposits stake for a node operator (nominee) from a nominator.

**Transaction Parameters:**
```json
{
  "type": "deposit_stake",
  "nominator": string,  // Account ID providing stake
  "nominee": string,    // Node operator receiving stake
  "stake": bigint,     // Amount to stake (must be > 0)
  "timestamp": number,
  "sign": {
    "owner": string    // Must match nominator field
  }
}
```

Requirements:
- Nominator account must exist
- Nominator must have sufficient balance for stake + fees
- Combined stake (existing + new) must meet minimum requirement
- Nominator can only stake to one nominee at a time
- Nominee must not be staked by another nominator
- Must wait for restake cooldown period if applicable
- Must be signed by the nominator
- Signature must be cryptographically valid

The transaction will:
1. Deduct stake amount + fees from nominator
2. Update nominator's operator info with stake and nominee
3. Link nominee to nominator
4. Update stake lock and timestamp for nominee
5. Update timestamps for both accounts

#### `withdraw_stake`
Withdraws stake from a node operator, returning it to the nominator.

**Transaction Parameters:**
```json
{
  "type": "withdraw_stake",
  "nominator": string,  // Account ID withdrawing stake
  "nominee": string,    // Node operator to withdraw from
  "force": boolean,     // Whether to force withdrawal
  "timestamp": number,
  "sign": {
    "owner": string    // Must match nominator field
  }
}
```

Requirements:
- Both nominator and nominee accounts must exist
- Nominator must have active stake with the nominee
- Node must not be in standby list or active in network
- Stake certificate must be expired
- Must be signed by the nominator
- Signature must be cryptographically valid

The transaction will:
1. Calculate rewards (if any)
2. Return stake + rewards to nominator (minus fees)
3. Clear stake information from both accounts
4. Update operator statistics
5. Reset node's reward/penalty information
6. Update timestamps for both accounts

Note: Force withdrawal may be allowed in certain conditions based on system flags.

#### `init_reward`
Initializes reward tracking for a node when it becomes active in the network.

**Transaction Parameters:**
```json
{
  "type": "init_reward",
  "nominee": string,         // Node account ID
  "nodeActivatedTime": number, // Time node became active
  "timestamp": number,
  "sign": {
    "owner": string         // Node signature
  }
}
```

Requirements:
- Node account must exist
- Node must have a nominator
- Node must not have reward start time set for this activation
- Node activation time must be valid
- Must be signed by the node
- Signature must be cryptographically valid

The transaction will:
1. Set node's reward start time
2. Clear reward end time
3. Set reward rate from current network parameters
4. Reset rewarded flag
5. Update node timestamp

Note: This transaction is typically triggered automatically by the system when a node joins the network.

#### `set_cert_time`
Sets or renews the certificate expiration time for a node operator.

**Transaction Parameters:**
```json
{
  "type": "set_cert_time",
  "nominee": string,     // Node account ID
  "nominator": string,   // Operator account ID
  "duration": number,    // Certificate duration in cycles
  "timestamp": number,
  "sign": {
    "owner": string     // Must match nominee field
  }
}
```

Requirements:
- Both nominee and nominator accounts must exist
- Duration must be greater than 0 and not exceed certCycleDuration
- Nominator must have sufficient stake (>= minimum required stake)
- Must be signed by the nominee (node)
- Signature must be cryptographically valid

The transaction will:
1. Calculate certificate expiration time
2. Update operator's certificate expiration
3. Deduct transaction fee (if applicable)
4. Update account timestamps

Note: Transaction fee may be waived if current certificate is more than 50% expired.

#### `query_certificate`
Queries and validates stake certificates for node operators.

**Transaction Parameters:**
```json
{
  "type": "query_certificate",
  "nominee": string,    // Node account ID
  "nominator": string,  // Operator account ID
  "sign": {
    "owner": string    // Must match nominee field
  }
}
```

Requirements:
- Both nominee and nominator accounts must exist
- Operator must have valid certificate
- Certificate must not be expired
- Must be signed by the nominee (node)
- Signature must be cryptographically valid

The transaction will:
1. Verify operator account status
2. Check certificate validity
3. Return signed stake certificate with:
   - Nominator and nominee IDs
   - Stake amount
   - Certificate expiration time
   - Validator signatures

Note: This transaction is used to verify node operator status and stake commitments.

#### `claim_reward`
Claims rewards for a node's participation in the network.

**Transaction Parameters:**
```json
{
  "type": "claim_reward",
  "nominee": string,              // Node account ID
  "nominator": string,            // Operator account ID
  "deactivatedNodeId": string,    // ID of deactivated node
  "nodeDeactivatedTime": number,  // Time node was deactivated
  "cycle": number,                // Cycle number
  "timestamp": number,
  "sign": {
    "owner": string              // Node signature
  }
}
```

Requirements:
- Node account must exist and have a nominator
- Node must have valid reward start time
- Node must not have reward end time set for this period
- Node must not have been already rewarded
- Must be signed by the node
- Signature must be cryptographically valid

The transaction will:
1. Calculate reward based on:
   - Node's reward rate
   - Duration in network
   - Network reward interval
2. Update node account:
   - Add reward amount
   - Set reward end time
   - Update node statistics
3. Update operator account:
   - Update operator statistics
   - Record node operation history
4. Update timestamps for both accounts

#### `apply_penalty`
Applies penalties to nodes for violations of network rules.

**Transaction Parameters:**
```json
{
  "type": "apply_penalty",
  "reportedNodeId": string,           // ID of node being penalized
  "reportedNodePublickKey": string,   // Public key of node
  "nominator": string,                // Operator account ID
  "violationType": number,            // Type of violation
  "violationData": object,            // Details of violation
  "timestamp": number,
  "sign": {
    "owner": string                   // Node signature
  }
}
```

Violation Types:
- Left Network Early: Node left before proper deactivation
- Node Refuted: Node was proven to act maliciously
- Syncing Too Long: Node failed to sync in required time
- Double Vote: Node voted multiple times (not implemented)

Requirements:
- Node and operator accounts must exist
- Violation type must be valid
- Violation must not have been already penalized
- Corresponding slashing must be enabled in network
- Must be signed by reporting node
- Signature must be cryptographically valid

The transaction will:
1. Calculate penalty amount based on violation type
2. Update operator account:
   - Reduce stake by penalty amount
   - Update penalty statistics
3. Update node account:
   - Reduce stake lock by penalty amount
   - Add penalty amount
   - Update penalty history
   - Set reward end time if applicable
4. Update timestamps for both accounts

Note: Penalty amounts are typically a percentage of staked amount, configured per violation type.


## GET /bridge/v2/status (deposit-backed wallet bridge)

This is the active wallet bridge endpoint; `/bridge/status` above is legacy diagnostics.
The deployment must explicitly set `accounting: "deposit-backed-v1"`. The response includes
`protocol:2`, `configured`, `enabled`, `operational`, pinned vault/operator identity,
`requiresNativePrefunding:false`, and decimal atomic strings `nativeMinted`, `nativeBurned`,
`nativeOutstanding` and `backedWithdrawalCapacity`. The last two are both minted minus burned,
not a live measurement of the vault's BNB balance. Zero initial issuance is valid. A pending
BNB release has already reduced native supply. Configuration flags do not measure operator
or BNB RPC uptime. An invalid, used legacy or cross-deployment ledger returns HTTP 503.

`/bridge/v2/records/:kind/:id` returns the committed replay record, including `accounting`,
`nativeMinted` and `nativeBurned` as decimal atomic strings. Operators require a matching
successful native receipt proving the same principal was burned before signing a release.
`bridge_fund` is retired. See [deployment](../bridge/DEPOSIT-BACKED-UPGRADE.md).
