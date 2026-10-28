// ---------------------- TRANSACTION export interfaceS ------------------

import { ShardusTypes } from '@shardus/core'
import { P2P } from '@shardus/lib-types'
import { StakeCert } from '../transactions/staking/query_certificate'
import { AdminCert } from '../transactions/admin_certificate'
import type { ScoreValue } from '../config/score'

// Define the AJVSchemaEnum with snake case values
export enum AJVSchemaEnum {
  query_cert_req = 'query_cert_req',
  inject_tx_req = 'inject_tx_req',
  internal_tx_base = 'internal_tx_base',
  left_network_early_violation_data = 'left_network_early_violation_data',
  syncing_timeout_violation_data = 'syncing_timeout_violation_data',
  node_refuted_violation_data = 'node_refuted_violation_data',
  sign = 'sign',
  signature = 'signature',
  app_join_data = 'app_join_data',
  stake_resp = 'stake_resp',
  stake_cert = 'stake_cert',
  remove_node_cert = 'remove_node_cert',
  // Transaction types with snake case values matching TXTypes
  init_network = 'init_network',
  register = 'register',
  create = 'create',
  transfer = 'transfer',
  bridge_deposit = 'bridge_deposit',
  bridge_withdraw = 'bridge_withdraw',
  bridge_fund = 'bridge_fund',
  profile = 'profile',
  contract = 'contract',
  endorsement = 'endorsement',
  skill = 'skill',
  message = 'message',
  read = 'read',
  reclaim_toll = 'reclaim_toll',
  update_chat_toll = 'update_chat_toll',
  update_toll_required = 'update_toll_required',
  toll = 'toll',
  change_config = 'change_config',
  apply_change_config = 'apply_change_config',
  change_network_param = 'change_network_param',
  apply_change_network_param = 'apply_change_network_param',
  deposit_stake = 'deposit_stake',
  withdraw_stake = 'withdraw_stake',
  set_cert_time = 'set_cert_time',
  query_certificate = 'query_certificate',
  init_reward = 'init_reward',
  claim_reward = 'claim_reward',
  apply_penalty = 'apply_penalty',
  // New DAO transactions (Phase 1: governance/economic/protocol proposals)
  dao_proposal_create = 'dao_proposal_create',
  dao_committee_vote = 'dao_committee_vote',
  dao_committee_result = 'dao_committee_result',
  dao_vote = 'dao_vote',
  dao_vote_result = 'dao_vote_result',
  dao_apply_parameters = 'dao_apply_parameters',
  dao_unapply_parameters = 'dao_unapply_parameters',
  dao_claim_reward = 'dao_claim_reward',
  dao_burn_reward = 'dao_burn_reward',
  dao_cancel = 'dao_cancel',
  dao_project_start = 'dao_project_start',
  dao_project_milestone_start = 'dao_project_milestone_start',
  dao_project_milestone_end = 'dao_project_milestone_end',
  dao_project_milestone_terminate = 'dao_project_milestone_terminate',
  dao_project_milestone_claim = 'dao_project_milestone_claim',
  dao_project_reclaim_balance = 'dao_project_reclaim_balance',
  dao_project_end = 'dao_project_end',
  dao_project_change_address = 'dao_project_change_address',
}

export enum TXTypes {
  init_network = 'init_network',
  register = 'register',
  create = 'create',
  transfer = 'transfer',
  bridge_deposit = 'bridge_deposit',
  bridge_withdraw = 'bridge_withdraw',
  bridge_fund = 'bridge_fund',
  profile = 'profile',
  contract = 'contract',
  endorsement = 'endorsement',
  skill = 'skill',
  message = 'message',
  read = 'read',
  reclaim_toll = 'reclaim_toll',
  update_chat_toll = 'update_chat_toll',
  update_toll_required = 'update_toll_required',
  toll = 'toll',
  change_config = 'change_config',
  apply_change_config = 'apply_change_config',
  change_network_param = 'change_network_param',
  apply_change_network_param = 'apply_change_network_param',
  deposit_stake = 'deposit_stake',
  withdraw_stake = 'withdraw_stake',
  set_cert_time = 'set_cert_time',
  init_reward = 'init_reward',
  claim_reward = 'claim_reward',
  apply_penalty = 'apply_penalty',
  // New DAO transactions (Phase 1: governance/economic/protocol proposals)
  dao_proposal_create = 'dao_proposal_create',
  dao_committee_vote = 'dao_committee_vote',
  dao_committee_result = 'dao_committee_result',
  dao_vote = 'dao_vote',
  dao_vote_result = 'dao_vote_result',
  dao_apply_parameters = 'dao_apply_parameters',
  dao_unapply_parameters = 'dao_unapply_parameters',
  dao_claim_reward = 'dao_claim_reward',
  dao_burn_reward = 'dao_burn_reward',
  dao_cancel = 'dao_cancel',
  dao_project_start = 'dao_project_start',
  dao_project_milestone_start = 'dao_project_milestone_start',
  dao_project_milestone_end = 'dao_project_milestone_end',
  dao_project_milestone_terminate = 'dao_project_milestone_terminate',
  dao_project_milestone_claim = 'dao_project_milestone_claim',
  dao_project_reclaim_balance = 'dao_project_reclaim_balance',
  dao_project_end = 'dao_project_end',
  dao_project_change_address = 'dao_project_change_address',
}

export interface BaseWinTx {
  timestamp: number
  type: TXTypes
  sign: Signature
  networkId: string
}

export namespace Tx {
  export interface Create extends BaseWinTx {
    from: string
    to: string
    amount: bigint
  }

  export interface InitNetwork extends BaseWinTx {
    type: TXTypes
    timestamp: number
  }

  export interface Message extends BaseWinTx {
    from: string
    to: string
    chatId: string
    message: string
    amount: bigint
    fee: bigint
  }

  export type MessageRecord = Message

  export interface Read extends BaseWinTx {
    from: string
    to: string
    chatId: string
    timestamp: number // timestamp up to which messages are considered read
    fee?: bigint // Optional fee for the read transaction
  }

  export interface UpdateChatToll extends BaseWinTx {
    from: string
    to: string
    chatId: string
    required: number // 1 if toll required, 0 if not nd 2 to block other party
    timestamp: number // timestamp up to which messages are considered read
  }

  export interface UpdateTollRequired extends BaseWinTx {
    from: string
    to: string
    chatId: string
    required: number // 1 if toll required, 0 if not nd 2 to block other party
    previousRequired?: number
    timestamp: number // timestamp up to which messages are considered read
    fee?: bigint // Optional fee for the update toll transaction
  }

  export type ChatMessageRecord = MessageRecord | Transfer | Read | UpdateTollRequired

  export interface ReclaimToll extends BaseWinTx {
    from: string
    to: string
    chatId: string
    timestamp: number // timestamp up to which messages are considered read
  }

  export interface ChangeConfig extends BaseWinTx {
    from: string
    cycle: number
    config: string
    signs: Signature[]
  }

  export interface ApplyChangeConfig extends BaseWinTx {
    from: string
    change: any
  }

  export interface ChangeNetworkParam extends BaseWinTx {
    from: string
    cycle: number
    config: string
    signs: Signature[]
  }

  export interface ApplyChangeNetworkParam extends BaseWinTx {
    from: string
    change: any
  }

  export interface Register extends BaseWinTx {
    aliasHash: string
    from: string
    alias: string
    publicKey: string
    pqPublicKey?: string
    private?: boolean
  }

  export interface Toll extends BaseWinTx {
    from: string
    toll: bigint
    tollUnit: TollUnit
    fee?: bigint // Optional fee for the toll transaction
  }

  export interface Transfer extends BaseWinTx {
    nonce: number
    from: string
    to: string
    amount: bigint
    memo?: string
    xmemo?: {
      message?: string
    }
    chatId: string
    fee?: bigint // Optional fee for the transfer
    deductTxFeeFromAmount?: boolean // Optional, defaults to false. If true, tx fee is deducted from the transfer amount.
  }

  export interface SetCertTime extends BaseWinTx {
    nominee: string
    nominator: string
    duration: number
  }

  export interface DepositStake extends BaseWinTx {
    nominee: string
    nominator: string
    stake: bigint
  }

  export interface WithdrawStake extends BaseWinTx {
    nominee: string
    nominator: string
    force: boolean
  }

  export interface InitRewardTX extends BaseWinTx {
    nominee: string
    nodeActivatedTime: number
    txData: NodeInitTxData
  }

  export interface ClaimRewardTX extends BaseWinTx {
    nominee: string
    nominator: string
    deactivatedNodeId: string
    nodeDeactivatedTime: number
    txData: NodeRewardTxData
  }

  export interface PenaltyTX extends BaseWinTx {
    reportedNodeId: string
    reportedNodePublickKey: string
    nominator: string
    violationType: ViolationType
    violationData: LeftNetworkEarlyViolationData | SyncingTimeoutViolationData | NodeRefutedViolationData
  }

  // New DAO transaction interfaces (Phase 1: governance/economic/protocol proposals)
  export interface DaoProposalCreate extends BaseWinTx {
    from: string
    proposalId: string
    metaId: string
    emergency: boolean
    proposalType: DaoProposalType
    gracePeriod?: number
    title: string
    description: string
    options: string[]
    governance?: DaoGovernanceData
    economic?: DaoEconomicData
    protocol?: DaoProtocolData
    /**
     * Project proposals supply only what the proposer chooses; every other DaoProjectData field is
     * set by the network (balance and rate at project start, times and endorsements as it runs).
     */
    project?: { milestones: DaoMilestone[]; address: string }
    // Optional: when committee review should begin. Must be >= tx.timestamp (creation time);
    // defaults to tx.timestamp (creationTime) when omitted. See dao_proposal_create.validate.
    startTime?: number
  }

  export interface DaoCommitteeVote extends BaseWinTx {
    from: string
    proposalId: string
    vote: 'accept' | 'withhold'
    // Required when vote === 'withhold'; the voter must supply a reason.
    withheldReason?: string
  }

  export interface DaoCommitteeResult extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoVote extends BaseWinTx {
    from: string
    proposalId: string
    // Relative weight the voter assigns to each proposal option, mapped 1:1 by index onto
    // proposal.options (e.g. weights: [3, 5, 0, 2] for options [bob, tom, sam, jim]).
    // Replaces the old single-option `optionIndex` — a vote can now spread its spend-weight
    // across multiple options proportionally. Must have the same length as proposal.options,
    // contain non-negative finite numbers, and sum to > 0.
    weights: number[]
    spend: bigint
  }

  export interface DaoVoteResult extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoApplyParameters extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoUnapplyParameters extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoClaimReward extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoBurnReward extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoCancel extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoProjectStart extends BaseWinTx {
    from: string
    proposalId: string
  }

  /**
   * No milestone number: the policy says "start the next milestone", so the handler derives it as
   * the first one still pending rather than taking it from the sender.
   */
  export interface DaoProjectMilestoneStart extends BaseWinTx {
    from: string
    proposalId: string
    /** Present when proposing a time; absent when endorsing the pending one. */
    proposedTime?: number
  }

  /** Likewise derived — "end the current milestone", the one that is executing. */
  export interface DaoProjectMilestoneEnd extends BaseWinTx {
    from: string
    proposalId: string
    proposedTime?: number
  }

  export interface DaoProjectMilestoneTerminate extends BaseWinTx {
    from: string
    proposalId: string
    milestoneNumber: number
    reason: string
  }

  export interface DaoProjectMilestoneClaim extends BaseWinTx {
    from: string
    proposalId: string
    milestoneNumber: number
  }

  export interface DaoProjectChangeAddress extends BaseWinTx {
    from: string
    proposalId: string
    /** Present when proposing a replacement; absent when endorsing the pending one. */
    proposedAddress?: string
  }

  export interface DaoProjectEnd extends BaseWinTx {
    from: string
    proposalId: string
  }

  export interface DaoProjectReclaimBalance extends BaseWinTx {
    from: string
    proposalId: string
  }
}

export interface Signature {
  owner: string
  sig: string
}

export enum TollUnit {
  win = 'WIN',
  usd = 'USD',
}

/**
 * ---------------------- ACCOUNT export interfaceS ----------------------
 */

export interface UserAccount {
  id: string
  type: string
  data: {
    balance: bigint
    /** Last consumed payment nonce; absent legacy wallets start at zero. */
    transferNonce?: number
    toll: bigint | null
    tollUnit: TollUnit
    chats: chatMessages
    chatTimestamp: number
  }
  alias: string | null
  lastMaintenance: number
  timestamp: number
  hash: string
  operatorAccountInfo?: OperatorAccountInfo
  publicKey: string
  pqPublicKey?: string
  private?: boolean
}

interface chatMessages {
  [address: string]: {
    receivedTimestamp: number
    chatId: string
  }
}

export interface OperatorAccountInfo {
  stake: bigint
  nominee: string
  certExp: number
  lastStakeTimestamp: number
  operatorStats: OperatorStats
}

export interface OperatorStats {
  //update when node is rewarded/penalized (exits)
  totalNodeReward: bigint
  totalNodePenalty: bigint
  totalNodeTime: number
  //push begin and end times when rewarded (deprecated - removed in 2.4.5)
  history?: { b: number; e: number }[]

  //update then unstaked
  totalUnstakeReward: bigint
  unstakeCount: number

  lastStakedNodeKey: string
}

export interface NodeAccount {
  id: string
  type: string
  hash: string
  timestamp: number
  nominator: string
  stakeLock: bigint //amount of coins in
  stakeTimestamp: number
  reward: bigint
  rewardStartTime: number
  rewardEndTime: number
  penalty: bigint
  nodeAccountStats: NodeAccountStats
  rewarded: boolean // This helps to prevent double rewards
  rewardRate: bigint
}

export interface NodeAccountStats {
  //update when node is rewarded/penalized (exits)
  totalReward: bigint
  totalPenalty: bigint
  //push begin and end times when rewarded
  history: { b: number; e: number }[]
  lastPenaltyTime: number
  penaltyHistory: { type: ViolationType; amount: bigint; timestamp: number }[]
}

export interface ChatAccount {
  id: string
  hash: string
  type: string
  timestamp: number
  messages: Tx.ChatMessageRecord[]
  toll: {
    required: [number, number] // 1 if toll required, 0 if not
    payOnRead: [bigint, bigint] // amount to be paid when reading
    payOnReply: [bigint, bigint] // amount to be paid when replying
  }
  read: [number, number] // timestamps of last read
  replied: [number, number] // timestamps of last reply
  hasChats: boolean // if chat has messages
}

export interface AliasAccount {
  id: string
  type: string
  hash: string
  inbox: string
  address: string
  timestamp: number
}

export interface NetworkAccount {
  id: string
  networkId: string
  type: string
  listOfChanges: Array<{
    cycle: number
    change: any
    appData: any
  }>
  current: NetworkParameters
  hash: string
  timestamp: number
}

export interface DevAccount {
  id: string
  type: string
  hash: string
  timestamp: number
}

// New DAO account types (Phase 1: governance/economic/protocol proposals)
/**
 * `applied` is reachable only by parameter proposals; `executing`/`completed`/`terminated` only by
 * project proposals. Widening this union does NOT flag the hand-maintained status allowlists in
 * dao_claim_reward/dao_burn_reward — they are string comparisons TypeScript cannot check.
 */
export type DaoProposalStatus = 'review' | 'withheld' | 'voting' | 'rejected' | 'accepted' | 'canceled' | 'applied' | 'executing' | 'completed' | 'terminated'
export type DaoProposalType = 'governance' | 'economic' | 'protocol' | 'project'
export type DaoMilestoneStatus = 'pending' | 'executing' | 'completed' | 'terminated'
export interface DaoParamChange {
  key: string
  value: string
  current: string
}
export type DaoParamChanges = DaoParamChange[] | DaoParamChange[][]

export interface DaoGovernanceData {
  changes: DaoParamChanges
}

export interface DaoEconomicData {
  changes: DaoParamChanges
}

export interface DaoProtocolData {
  changes: DaoParamChanges
}

/** One committee submission toward terminating a milestone. The reason is required by policy. */
export interface DaoTerminateVote {
  address: string
  reason: string
  timestamp: number
}

/** The eight transactions that can append to a project's audit trail. */
export type DaoProjectTxType =
  | 'dao_project_start'
  | 'dao_project_milestone_start'
  | 'dao_project_milestone_end'
  | 'dao_project_milestone_terminate'
  | 'dao_project_milestone_claim'
  | 'dao_project_change_address'
  | 'dao_project_end'
  | 'dao_project_reclaim_balance'

/** Append-only audit trail entry. The trail starts when the project enters `executing`. */
export interface DaoProjectLogEntry {
  caller: string
  timestamp: number
  txType: DaoProjectTxType
  /**
   * What identifies the action, never what resulted from it.
   *
   * In practice the sender's own fields, plus an identifier the handler had to derive to know what
   * it was acting on. Outcomes stay out: amounts minted, paid, owed or reclaimed are products of
   * the handler and are already recoverable from the account state and the transaction receipt.
   * Keeping them out also means no value here is ever a bigint.
   */
  params: Record<string, string | number | boolean>
}

export interface DaoMilestone {
  title: string
  description: string
  deliverable: string
  /** Planned duration in ms; bonus/penalty compare the actual elapsed time against this. */
  duration: number
  costUsdStr: string
  penaltyUsdStr: string
  bonusUsdStr: string
  startTime?: number
  endTime?: number
  /**
   * Staged start or end time awaiting endorsement. Cleared on each commit, so endorsements
   * collected for a start cannot carry into the end — the two share these fields.
   */
  proposedTime?: number
  /** Endorsers, proposer first. Index 0 may be the contractor; later entries must be committee. */
  endorsedTime: string[]
  terminateVotes: DaoTerminateVote[]
  status: DaoMilestoneStatus
  /**
   * Amount paid out, in wei, and the settled marker: non-zero means claimed.
   *
   * A zero payout is unreachable, so the two meanings cannot diverge. `penalty < cost` is enforced
   * at proposal creation and repeated in wei at dao_project_start, which together keep every payout
   * branch strictly positive.
   */
  paid: bigint
}

export interface DaoProjectData {
  milestones: DaoMilestone[]
  startTime?: number
  endTime?: number
  /** WIN minted at project start, in wei; drawn down by milestone claims. */
  balance: bigint
  /** USD/WIN rate fixed when balance was minted. Every payout converts at this, not the live rate. */
  rateUsdStr: string
  /** Contractor address permitted to claim completed milestones. */
  address: string
  proposedAddress?: string
  /** Endorsers of proposedAddress, proposer first. Committee only — the contractor cannot propose. */
  endorsedAddress: string[]
  durationBonusPercentage: number
  durationPenaltyPercentage: number
  logs: DaoProjectLogEntry[]
}

/**
 * One entry in the DaoProposalsMeta proposal index. `timestamp` is the txTimestamp of the
 * transaction that created the proposal or last changed its status — not the proposal account's
 * own timestamp (backfilled entries carry that instead, so they are approximate).
 */
export interface DaoProposalIndexEntry {
  /** Sequential proposal number, matching DaoProposalAccount.number. */
  proposal: number
  status: DaoProposalStatus
  emergencyFlag: boolean
  timestamp: number
}

export interface DaoProposalsMeta {
  id: string
  type: string
  count: number
  /**
   * Every proposal, most-recent-timestamp first. Optional so pre-index accounts still deserialize —
   * read it through getProposalIndex().
   */
  proposals?: DaoProposalIndexEntry[]
  hash: string
  /** Account timestamp — distinct from the per-entry timestamps in `proposals`. */
  timestamp: number
}

export interface DaoProposalAccount {
  id: string
  type: string
  status: DaoProposalStatus
  emergency: boolean
  proposalType: DaoProposalType
  number: number
  // creationTime/startTime always stored; every other timing field is derived — see
  // getReviewEnd/getVotingStart/getVotingEnd/getClaimEnd/getApplyEligibleAt in
  // src/accounts/daoProposalAccount.ts (single source of truth for the formulas).
  creationTime: number
  startTime: number
  // Set once dao_committee_result/dao_vote_result actually runs for regular proposals —
  // emergency proposals never enter community voting, so these stay absent there. Until set,
  // daoProposalAccount.ts's getters use reviewEnd/votingEnd instead.
  votingStartedAt?: number
  // Not the same as votingEnd (the scheduled deadline) — this is the real time dao_vote_result
  // ran, which can be later than votingEnd if it's submitted late.
  votingEndedAt?: number
  gracePeriod: number
  // Snapshot of DAO network params captured at proposal creation time.
  // USD-string values, converted to Wei via utils.usdStrToWei(...) at each point of use, against the current exchange rate.
  proposalFeeUsdStr: string
  voteThresholdUsdStr: string
  minimumSpendUsdStr: string
  voteExponent: number
  pctBurned: number
  reviewDuration: number
  votingDuration: number
  graceDuration: number
  claimDuration: number
  committeeAddresses: string[]
  // Committee review tracking — one entry per member; switching a vote replaces (not appends)
  // that member's entry, so withheldReason always stays attributed to the member's current vote.
  committeeVotes: Array<{ memberAddress: string; vote: 'accept' | 'withhold'; withheldReason?: string }>
  // Committee addresses that have submitted dao_unapply_parameters for this proposal. Only
  // meaningful once status is 'applied'; created lazily on first use (not defaulted), and reset
  // to [] once the threshold flips status back to accepted. Read defensively — usually absent.
  unapplyVotes?: string[]
  // Voting state
  options: string[]
  totalVote: bigint[]
  winningOptionIndex?: number
  // Fixed once dao_vote_result runs (post-burn pool); accumulates pre-burn (proposalFeeWei +
  // sum of vote spends). claimedReward tracks the running total paid out via dao_claim_reward;
  // remaining unclaimed = voterRewardPool - claimedReward.
  voterRewardPool: bigint
  claimedReward: bigint
  // initialBurnedReward - the amount burned before the claim period (decisive committee withhold).
  // finalBurnedReward - the amount burned after the claim period (unclaimed remainder via dao_burn_reward).
  initialBurnedReward: bigint
  finalBurnedReward: bigint
  voterList: Array<{ address: string; timestamp: number }>
  claimList: string[]
  // Proposal content
  title: string
  description: string
  governance?: DaoGovernanceData
  economic?: DaoEconomicData
  protocol?: DaoProtocolData
  project?: DaoProjectData
  hash: string
  timestamp: number
}

export type Accounts = NetworkAccount & UserAccount & AliasAccount & NodeAccount & ChatAccount & DaoProposalsMeta & DaoProposalAccount

export type AccountVariant =
  | NetworkAccount
  | UserAccount
  | AliasAccount
  | NodeAccount
  | ChatAccount
  | DevAccount
  | DaoProposalsMeta
  | DaoProposalAccount
  | ProofOfSkillAccount
  | { id: string; type: 'BridgeReserve' | 'BridgeRecord'; hash: string; timestamp: number; [key: string]: any }

/**
 * ---------------------- NETWORK DATA export interfaceS ----------------------
 */

export interface NetworkParameters {
  title: string
  description: string
  maxSupply: bigint
  maxTransactionBytes: number
  maxParties: number
  maxSkills: number
  maxEvidence: number
  maxClockSkewMs: number
  contractApprovalWindowMs: number
  joinProofLifetimeMs: number
  nodeRewardInterval: number
  maintenanceInterval: number
  maintenanceFee: bigint
  restakeCooldown: number
  stabilityScaleMul: number
  stabilityScaleDiv: number
  minVersion: string
  activeVersion: string
  latestVersion: string
  archiver: {
    minVersion: string
    activeVersion: string
    latestVersion: string
  }
  txPause: boolean
  certCycleDuration: number
  enableNodeSlashing: boolean
  tollNetworkTaxPercent: number
  tollTimeout: number
  messageMaxLength: number // Maximum length of chat message
  messageRetentionDays: number // Number of days to retain chat messages
  slashing: {
    enableLeftNetworkEarlySlashing: boolean
    enableSyncTimeoutSlashing: boolean
    enableNodeRefutedSlashing: boolean
    leftNetworkEarlyPenaltyPercent: number
    syncTimeoutPenaltyPercent: number
    nodeRefutedPenaltyPercent: number
  }
  stakeLockTime: number
  nodeRewardAmountUsdStr: string
  nodePenaltyUsdStr: string
  stakeRequiredUsdStr: string
  transactionFeeUsdStr: string
  stabilityFactorStr: string
  minTollUsdStr: string
  defaultTollUsdStr: string
  goldenTicketServerUrl: string
  dao: {
    proposalFeeUsdStr: string
    voteThresholdUsdStr: string
    minimumSpendUsdStr: string
    voteExponent: number
    pctBurned: number
    reviewDuration: number
    votingDuration: number
    graceDuration: number
    claimDuration: number
    committeeAddresses: string[]
  }
}

/**
 * ---------------------- SDK DATA export interfaceS ----------------------
 */

export interface ValidationResponse {
  result: string
  reason: string
  txnTimestamp?: number
}

export interface WrappedAccount extends ShardusTypes.WrappedResponse {
  data: Accounts
}

export interface WrappedStates {
  [id: string]: WrappedAccount
}

export type KeyResult = {
  timestamp: number
  keys: ShardusTypes.TransactionKeys
  shardusMemoryPatterns: ShardusTypes.ShardusMemoryPatternsInput
}

export interface GlobalMessage extends Omit<P2P.GlobalAccountsTypes.SetGlobalTx, 'txId'> {
  value: Tx.InitNetwork | Tx.ApplyChangeConfig | Tx.ApplyChangeNetworkParam
}

export interface OurAppDefinedData {
  globalMsg: GlobalMessage
}

export interface InjectTxResponse {
  success: boolean
  reason?: string
}

export interface ValidatorError {
  success: boolean
  reason: string
}

export interface AccountAxiosResponse {
  account: Accounts
  error: string
}

export interface AccountQueryResponse {
  success: boolean
  account?: Accounts
}

export interface InjectTxResponse {
  success: boolean
  reason?: string
}

export interface NodeInfoAppData {
  appVersion: string
  minVersion: string
  activeVersion: string
  latestVersion: string
  operatorCLIVersion: string
  operatorGUIVersion: string
}

export interface AppJoinData {
  version: string
  stakeCert: StakeCert
  adminCert: AdminCert
}

export interface NodeRewardTxData {
  publicKey: string
  nodeId: string
  endTime: number
}

export interface SignedNodeRewardTxData extends NodeRewardTxData {
  sign: ShardusTypes.Sign
}

export interface NodeInitTxData {
  publicKey: string
  nodeId: string
  startTime: number
}

export interface SignedNodeInitTxData extends NodeInitTxData {
  sign: ShardusTypes.Sign
}

export enum ViolationType {
  // 0-999 reserved for shardus core
  WinMinID = 999,
  LeftNetworkEarly = 1000,
  SyncingTooLong = 1001,
  DoubleVote = 1002,
  NodeRefuted = 1003,
  WinMaxID = 2000,
}

export interface SyncingTimeoutViolationData {
  nodeLostCycle: number
  nodeDroppedTime: number
}

export interface LeftNetworkEarlyViolationData {
  nodeLostCycle: number
  nodeDroppedCycle: number
  nodeDroppedTime: number
}

export interface NodeRefutedViolationData {
  nodeRefutedCycle: number
  nodeRefutedTime: number
}

export interface AppReceiptData {
  networkId?: string
  txId: string
  timestamp: number
  success: boolean
  reason?: string // Can be undefined if the transaction was successful
  from: string
  to?: string // Can be undefined if the transaction is not directed to any account or is directed more than one account
  type: string
  transactionFee: bigint
  additionalInfo?: object // Can add any additional info related to the transaction that are not in the original transaction data
}

export interface GoldenTicketRequest {
  publicKey: string
  nonce: number
  timestamp: number
  ip: string
  port: number
  sign: Signature
}

export interface EditableObjectMetadata {
  id: string
  owner: string
  managers: string[]
  schemaVersion: 1
  revision: number
  createdAt: number
  updatedAt: number
}

export type ContractWorkStatus = 'planned' | 'active' | 'completed' | 'canceled' | 'disputed'
export type ContractApprovalStatus = 'not_requested' | 'pending' | 'approved' | 'rejected' | 'expired'

export interface ContractContent {
  // Absent on legacy records; clients display those as employee contracts.
  contractType?: 'employee' | 'student' | 'internship'
  origin: 'new' | 'historical'
  title: string
  publicDescription: string
  // Published registry data is public; this field must contain ciphertext only.
  encryptedDescription?: string
  workerProfileId: string
  hiringProfileIds: string[]
  skillIds: string[]
  terms: {
    responsibilities: string[]
    acceptanceCriteria: string[]
    startDate: string
    endDate?: string
    durationMonths: number
    workMode?: 'onsite' | 'remote' | 'hybrid'
    location?: string
  }
  compensation?: {
    amount: string
    currency: string
    frequency: 'once' | 'hourly' | 'monthly' | 'milestone'
  }
  workStatus: ContractWorkStatus
  // Months are 1-based calendar anniversaries from terms.startDate.
  periodOutcomes: { month: number; outcome: 'success' | 'failure' }[]
  evidence: { id: string; description: string; url?: string; contentHash?: string }[]
  cancellationReason?: string
}

export interface Contract extends EditableObjectMetadata, ContractContent {
  createdBy: string
  termsRevision: number
  termsHash: string
  approvalStatus: ContractApprovalStatus
  approvalRequest?: {
    id: string
    hash: string
    termsRevision: number
    requestedAt: number
    expiresAt: number
    networkId: string
    rulesVersion: number
    // Authorities and scores are fixed when the worker requests approval.
    authorities: Record<string, string[]>
    scoreSnapshot: Record<string, ScoreValue>
  }
  approvals: { profileId: string; signer: string; requestHash: string; approvedAt: number; approvalTxId: string }[]
  rejection?: { profileId: string; signer: string; rejectedAt: number; reason: string }
  creditedMonths: number[]
}

export interface Endorsement extends EditableObjectMetadata {
  id: string
  createdAt: number
  updatedAt: number

  endorserProfileId: string
  subjectProfileId: string
  skillId: string

  relationship: 'employer' | 'colleague' | 'client' | 'teacher' | 'mentor' | 'collaborator' | 'other'

  statement: string
  contractId?: string // Optional supporting work contract

  evidence: {
    id: string
    description: string
    url?: string
    contentHash?: string
  }[]

  durationMonths: number
  validFrom: number
  validUntil: number

  status: 'active' | 'revoked' | 'expired'
  revokedAt?: number
  revocationReason?: string

  scoring: number

  schemaVersion: 1
  revision: number
}

export interface ProfileLink {
  label: string
  url: string
}

export interface DateRange {
  startDate: string // YYYY or YYYY-MM
  endDate?: string // Omit while ongoing
  current?: boolean
}

export type ProfileType = 'person' | 'organization' | 'government' | 'company' | 'university' | 'school'

export interface ProfileCommon extends EditableObjectMetadata {
  displayName: string
  summary?: string
  avatarUrl?: string
  coverImageUrl?: string
  // Contact information
  contact?: {
    email?: string
    phone?: string
    website?: string
    location?: {
      city?: string
      region?: string
      countryCode?: string // ISO two-letter code, e.g. TN
    }
    links?: ProfileLink[] // LinkedIn, GitHub, portfolio, etc.
  }
}

export interface EntityDetails {
  legalName: string
  registrationNumber?: string
  countryCode?: string
  foundedOn?: string
  website?: string
}
export interface OrganizationDetails extends EntityDetails {
  organizationKind?: string
  mission?: string
}
export interface CompanyDetails extends EntityDetails {
  industry?: string
  legalForm?: string
  services?: string[]
}
export interface GovernmentDetails extends EntityDetails {
  jurisdiction: string
  level?: 'national' | 'regional' | 'local'
  department?: string
}
export interface UniversityDetails extends EntityDetails {
  accreditations?: string[]
  faculties?: string[]
  programs?: string[]
}
export interface SchoolDetails extends EntityDetails {
  educationLevels?: string[]
  accreditations?: string[]
  curriculum?: string
}
export type Profile = ProfileCommon &
  (
    | { type: 'person'; details: PersonDetails }
    | { type: 'organization'; details: OrganizationDetails }
    | { type: 'government'; details: GovernmentDetails }
    | { type: 'company'; details: CompanyDetails }
    | { type: 'university'; details: UniversityDetails }
    | { type: 'school'; details: SchoolDetails }
  )

export type ProfileContent = Pick<ProfileCommon, 'displayName' | 'summary' | 'avatarUrl' | 'coverImageUrl' | 'contact'> &
  (
    | { type: 'person'; details: PersonDetails }
    | { type: 'organization'; details: OrganizationDetails }
    | { type: 'government'; details: GovernmentDetails }
    | { type: 'company'; details: CompanyDetails }
    | { type: 'university'; details: UniversityDetails }
    | { type: 'school'; details: SchoolDetails }
  )

export type SkillContent = Pick<Skill, 'name' | 'description' | 'category' | 'kind'>
export type EndorsementContent = Pick<Endorsement, 'endorserProfileId' | 'subjectProfileId' | 'skillId' | 'relationship' | 'statement' | 'durationMonths'>

export interface ProofOfSkillTx extends BaseWinTx {
  type: TXTypes.profile | TXTypes.contract | TXTypes.endorsement | TXTypes.skill
  from: string
  to: string
  objectId: string
  expectedRevision: number
  fee: bigint
  action: 'create' | 'update' | 'request_approval' | 'approve' | 'reject' | 'expire' | 'revoke'
  payload?: ProfileContent | ContractContent | EndorsementContent | SkillContent
  requestHash?: string
  hiringProfileId?: string
  reason?: string
}

export interface PersonDetails {
  firstName?: string
  lastName?: string
  headline?: string // Example: "Full-stack developer"

  // Skills claimed by the profile owner
  skills?: {
    skillId: string // Reference to the protected skills account
    yearsOfExperience?: number
    selfAssessedLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert'
    evidenceIds?: string[]
  }[]

  // Employment history
  experience?: (DateRange & {
    id: string
    jobTitle: string
    organization: string
    organizationUrl?: string
    employmentType?: 'full_time' | 'part_time' | 'contract' | 'freelance' | 'internship' | 'apprenticeship' | 'self_employed'
    location?: string
    workMode?: 'onsite' | 'remote' | 'hybrid'
    description?: string
    responsibilities?: string[]
    achievements?: string[]
    skillIds?: string[]
    contractIds?: string[] // References to WIN contract records
    links?: ProfileLink[]
  })[]

  // Education
  education?: (DateRange & {
    id: string
    institution: string
    institutionUrl?: string
    qualification: string // Degree, diploma, etc.
    fieldOfStudy?: string
    location?: string
    grade?: string
    coursework?: string[]
    thesisTitle?: string
    honors?: string[]
    description?: string
    links?: ProfileLink[]
  })[]

  // Professional certifications and licenses
  certifications?: {
    id: string
    name: string
    issuer: string
    issuedOn?: string
    expiresOn?: string
    doesNotExpire?: boolean
    credentialId?: string
    credentialUrl?: string
    skillIds?: string[]
  }[]

  // Projects and portfolio
  projects?: (DateRange & {
    id: string
    title: string
    role?: string
    organization?: string
    description?: string
    achievements?: string[]
    skillIds?: string[]
    contractIds?: string[]
    links?: ProfileLink[] // Demo, repository, case study, etc.
  })[]

  // Spoken and written languages
  languages?: {
    languageCode: string // Example: ar, fr, en
    proficiency: 'elementary' | 'limited_working' | 'professional_working' | 'full_professional' | 'native_or_bilingual'
    cefrLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
    certificationId?: string
  }[]

  // Awards, honors, competitions, and scholarships
  awards?: {
    id: string
    title: string
    issuer: string
    awardedOn?: string
    description?: string
    url?: string
  }[]

  // Articles, papers, books, and other publications
  publications?: {
    id: string
    title: string
    publisher?: string
    publishedOn?: string
    authors?: string[]
    description?: string
    doi?: string
    url?: string
  }[]

  // Patents
  patents?: {
    id: string
    title: string
    patentNumber?: string
    patentOffice?: string
    status?: 'pending' | 'granted' | 'expired'
    filedOn?: string
    grantedOn?: string
    inventors?: string[]
    description?: string
    url?: string
  }[]

  // Courses and professional development
  courses?: {
    id: string
    title: string
    provider: string
    completedOn?: string
    durationHours?: number
    certificateUrl?: string
    skillIds?: string[]
  }[]

  // Volunteering and community involvement
  volunteering?: (DateRange & {
    id: string
    organization: string
    role: string
    cause?: string
    description?: string
    achievements?: string[]
    links?: ProfileLink[]
  })[]

  // Professional associations
  memberships?: (DateRange & {
    id: string
    organization: string
    role?: string
    description?: string
    url?: string
  })[]

  // Conferences, presentations, and workshops
  speaking?: {
    id: string
    title: string
    event: string
    date?: string
    location?: string
    description?: string
    links?: ProfileLink[]
  }[]

  interests?: string[]
  referencesAvailableOnRequest?: boolean

  // Optional job-search preferences
  preferences?: {
    openToWork?: boolean
    desiredRoles?: string[]
    employmentTypes?: string[]
    workModes?: ('onsite' | 'remote' | 'hybrid')[]
    preferredLocations?: string[]
    willingToRelocate?: boolean
    availableFrom?: string
    noticePeriodDays?: number
  }
}

export interface Skill extends EditableObjectMetadata {
  id: string
  name: string
  description: string

  category: string // Example: "Software development"
  kind: 'technical' | 'interpersonal' | 'language' | 'other'

  aliases: string[]
  relatedSkillIds: string[]

  // Criteria for demonstrating this skill.
  assessmentCriteria: {
    id: string
    description: string
  }[]
  createdAt: number
  updatedAt: number
  schemaVersion: 1
  revision: number
}

export interface RegistryAccountBase {
  id: string
  hash: string
  timestamp: number
  schemaVersion: 1
  revision: number
}

export interface ProfilesAccount extends RegistryAccountBase {
  type: 'ProfilesAccount'
  profiles: Record<string, Profile>
}

export interface ContractsAccount extends RegistryAccountBase {
  type: 'ContractsAccount'
  contracts: Record<string, Contract>
}

export interface EndorsementsAccount extends RegistryAccountBase {
  type: 'EndorsementsAccount'
  endorsements: Record<string, Endorsement>
}

export interface ScoresAccount extends RegistryAccountBase {
  type: 'ScoresAccount'
  scores: Record<string, ScoreValue>
}

export interface SkillsAccount extends RegistryAccountBase {
  type: 'SkillsAccount'
  skills: Record<string, Skill>
}

export type ProofOfSkillAccount = ProfilesAccount | ContractsAccount | EndorsementsAccount | ScoresAccount | SkillsAccount
