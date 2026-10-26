import { Shardus, ShardusTypes } from '@shardus/core'
import { Utils } from '@shardus/lib-types'
import type { ProofOfSkillTx, WrappedStates, UserAccount, AppReceiptData, ProfilesAccount, ContractsAccount, ScoresAccount, SkillsAccount, EndorsementsAccount } from '../../@types'
import { profilesAddress, contractsAddress, scoresAddress, skillsAddress, endorsementsAddress, isProtectedAddress, WIN_NETWORK_ID } from '../../config'
import { formulas, transactionFee } from '../../config/formulas'
import * as crypto from '../../crypto'
import { validateProofOfSkillShape } from '../../domain/schema'
import { applyDomainAction, DomainState } from '../../domain/behavior'
import { profilesAccount } from '../../accounts/profile'
import { contractsAccount } from '../../accounts/contract'
import { scoresAccount } from '../../accounts/score'
import { skillsAccount } from '../../accounts/skill'
import { endorsementsAccount } from '../../accounts/endorsement'

const factories = { [profilesAddress]: profilesAccount, [contractsAddress]: contractsAccount, [scoresAddress]: scoresAccount, [skillsAddress]: skillsAccount, [endorsementsAddress]: endorsementsAccount }
const registryTypes = {
  [profilesAddress]: 'ProfilesAccount',
  [contractsAddress]: 'ContractsAccount',
  [scoresAddress]: 'ScoresAccount',
  [skillsAddress]: 'SkillsAccount',
  [endorsementsAddress]: 'EndorsementsAccount',
}
const clone = <T>(value: T): T => Utils.safeJsonParse(Utils.safeStringify(value))

export function proofOfSkillFee(tx: ProofOfSkillTx): bigint {
  // Excluding the signature keeps the fee stable while a client prepares the signature.
  const { sign, fee, ...body } = tx
  return tx.type === 'contract' ? formulas.contractFee : tx.type === 'endorsement' ? formulas.endorsementFee : transactionFee(Buffer.byteLength(Utils.safeStringify(body), 'utf8'))
}
export function validate_fields(tx: ProofOfSkillTx, response: ShardusTypes.IncomingTransactionResult): ShardusTypes.IncomingTransactionResult {
  response.success = false
  try {
    if (Buffer.byteLength(Utils.safeStringify(tx), 'utf8') > 256 * 1024) throw new Error('Object transaction exceeds 256 KiB')
    const error = validateProofOfSkillShape(tx)
    if (error) throw new Error(error)
    if (tx.networkId !== WIN_NETWORK_ID || isProtectedAddress(tx.from)) throw new Error('Invalid network or sender')
    if (tx.sign.owner !== tx.from || !crypto.verifyObj(tx)) throw new Error('Invalid object transaction signature')
    if (tx.fee !== proofOfSkillFee(tx)) throw new Error('Object transaction fee does not match the WIN rules')
    response.success = true
  } catch (error) {
    response.reason = error.message
  }
  return response
}
function draft(tx: ProofOfSkillTx, states: WrappedStates, now: number, txId: string): { state: DomainState; sender: UserAccount } {
  const fieldResult = validate_fields(tx, { success: false, reason: '' })
  if (!fieldResult.success) throw new Error(fieldResult.reason)
  const sender = states[tx.from]?.data as UserAccount
  if (sender?.type !== 'UserAccount' || sender.data.balance < tx.fee) throw new Error('Existing funded sender wallet required')
  const read = <T>(id: string): T => {
    const data = states[id]?.data
    if (!data || data.id !== id || data.type !== registryTypes[id]) throw new Error(`Invalid registry ${id}`)
    return clone(data) as unknown as T
  }
  const state: DomainState = {
    profiles: read<ProfilesAccount>(profilesAddress),
    scores: read<ScoresAccount>(scoresAddress),
    ...(tx.type === 'contract' ? { contracts: read<ContractsAccount>(contractsAddress) } : {}),
    ...(tx.type !== 'profile' ? { skills: read<SkillsAccount>(skillsAddress) } : {}),
    ...(tx.type === 'endorsement' ? { endorsements: read<EndorsementsAccount>(endorsementsAddress) } : {}),
  }
  applyDomainAction(tx, state, now, txId)
  for (const registry of Object.values(state)) {
    if (Buffer.byteLength(Utils.safeStringify(registry), 'utf8') > 4 * 1024 * 1024) throw new Error('Registry capacity reached')
  }
  return { state, sender }
}
export function validate(tx: ProofOfSkillTx, states: WrappedStates, response: ShardusTypes.IncomingTransactionResult): ShardusTypes.IncomingTransactionResult {
  response.success = false
  try {
    draft(tx, states, tx.timestamp, crypto.hashObj(tx))
    response.success = true
  } catch (error) {
    response.reason = error.message
  }
  return response
}
export function apply(tx: ProofOfSkillTx, now: number, txId: string, states: WrappedStates, dapp: Shardus, response: ShardusTypes.ApplyResponse): void {
  const { state, sender } = draft(tx, states, now, txId)
  for (const registry of Object.values(state)) {
    // A prior transaction can share a timestamp; revisions identify this draft's writes.
    if (registry.revision !== states[registry.id].data['revision']) states[registry.id].data = registry as never
  }
  sender.data.balance -= tx.fee
  sender.timestamp = now
  const receipt: AppReceiptData = {
    networkId: tx.networkId,
    txId,
    timestamp: now,
    type: tx.type,
    from: tx.from,
    to: tx.to,
    transactionFee: tx.fee,
    success: true,
    additionalInfo: { objectId: tx.objectId, action: tx.action },
  }
  dapp.applyResponseAddReceiptData(response, receipt, crypto.hashObj(receipt))
}
export function createFailedAppReceiptData(
  tx: ProofOfSkillTx,
  now: number,
  txId: string,
  _states: WrappedStates,
  dapp: Shardus,
  response: ShardusTypes.ApplyResponse,
  reason: string,
): void {
  const receipt: AppReceiptData = { networkId: tx.networkId, txId, timestamp: now, type: tx.type, from: tx.from, to: tx.to, transactionFee: 0n, success: false, reason }
  dapp.applyResponseAddReceiptData(response, receipt, crypto.hashObj(receipt))
}
export function keys(tx: ProofOfSkillTx, result: ShardusTypes.TransactionKeys): ShardusTypes.TransactionKeys {
  result.sourceKeys = [tx.from]
  result.targetKeys = tx.type === 'profile' ? [profilesAddress, scoresAddress] : tx.type === 'contract' ? [profilesAddress, contractsAddress, scoresAddress, skillsAddress] : tx.type === 'endorsement' ? [profilesAddress, scoresAddress, skillsAddress, endorsementsAddress] : [profilesAddress, scoresAddress, skillsAddress]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}
export function memoryPattern(tx: ProofOfSkillTx): ShardusTypes.ShardusMemoryPatternsInput {
  return {
    rw: tx.type === 'profile' ? [tx.from, profilesAddress, scoresAddress] : tx.type === 'contract' ? [tx.from, contractsAddress, scoresAddress] : tx.type === 'endorsement' ? [tx.from, endorsementsAddress] : [tx.from, skillsAddress],
    ro: tx.type === 'contract' ? [profilesAddress, skillsAddress] : tx.type === 'endorsement' ? [profilesAddress, scoresAddress, skillsAddress] : tx.type === 'skill' ? [profilesAddress, scoresAddress] : [],
    wo: [],
    on: [],
    ri: [],
  }
}
export function createRelevantAccount(dapp: Shardus, data: any, accountId: string, tx: ProofOfSkillTx, accountCreated = false): ShardusTypes.WrappedResponse {
  const permitted = keys(tx, { sourceKeys: [], targetKeys: [], allKeys: [], timestamp: tx.timestamp }).allKeys
  if (!permitted.includes(accountId)) throw new Error('Undeclared object transaction account')
  if (!data) {
    if (accountId === tx.from) throw new Error('Sender wallet does not exist')
    data = factories[accountId]()
    accountCreated = true
  }
  if (registryTypes[accountId] && data.type !== registryTypes[accountId]) throw new Error('Protected address contains the wrong account type')
  return dapp.createWrappedResponse(accountId, accountCreated, data.hash, data.timestamp, data)
}
