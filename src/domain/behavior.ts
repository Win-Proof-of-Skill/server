import type {
  Contract,
  ContractContent,
  Profile,
  ProfileContent,
  ProofOfSkillTx,
  ProfilesAccount,
  ContractsAccount,
  ScoresAccount,
  SkillsAccount,
  EndorsementsAccount,
  EndorsementContent,
  SkillContent,
} from '../@types'
import * as crypto from '../crypto'
import { formulas, clampScore, contractMonthlyDeltas } from '../config/formulas'
import { scoreValue } from '../config/score'
import { addMonths } from '../config/time'
import { WIN_NETWORK_ID, INITIAL_PARAMETERS } from '../config'

export interface DomainState {
  profiles: ProfilesAccount
  contracts?: ContractsAccount
  scores: ScoresAccount
  skills?: SkillsAccount
  endorsements?: EndorsementsAccount
}
const own = (map: object, id: string): boolean => Object.prototype.hasOwnProperty.call(map, id)
const ensure = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}
const controls = (profile: Profile, wallet: string): boolean => profile.owner === wallet || profile.managers.includes(wallet)

function getProfile(state: DomainState, id: string): Profile {
  ensure(own(state.profiles.profiles, id), `Profile ${id} does not exist`)
  return state.profiles.profiles[id]
}
function dateTime(value: string): number {
  const time = Date.parse(`${value}T00:00:00.000Z`)
  ensure(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value, 'Invalid contract calendar date')
  return time
}
function validateContract(content: ContractContent, now: number): void {
  const start = dateTime(content.terms.startDate)
  const end = content.terms.endDate ? dateTime(content.terms.endDate) : undefined
  ensure(end === undefined || end >= start, 'Contract end date precedes start date')
  ensure(
    (content.workStatus !== 'completed' && content.workStatus !== 'canceled') || (end !== undefined && end <= now),
    'Finished contracts require a past end date',
  )
  ensure(content.workStatus !== 'planned' || content.periodOutcomes.length === 0, 'Planned contracts cannot claim completed periods')
  ensure(content.origin !== 'historical' || start <= now, 'Historical contract start must not be in the future')
  const seen = new Set<number>()
  for (const period of content.periodOutcomes) {
    ensure(!seen.has(period.month) && period.month <= content.terms.durationMonths, 'Duplicate or out-of-range contract month')
    ensure(addMonths(start, period.month) <= Math.min(now, end ?? now), 'Cannot attest a month that has not finished')
    seen.add(period.month)
  }
  ensure(content.workStatus !== 'completed' || seen.size === content.terms.durationMonths, 'Completed contract must describe every completed month')
  ensure(!content.hiringProfileIds.includes(content.workerProfileId), 'Worker cannot be its own hiring profile')
}
function hashTerms(content: ContractContent, termsRevision: number): string {
  return crypto.hashObj({ domain: 'WIN.contract.terms.v1', termsRevision, content })
}
function bump(account: ProfilesAccount | ContractsAccount | ScoresAccount | SkillsAccount | EndorsementsAccount, now: number): void {
  ensure(Number.isSafeInteger(account.revision + 1), 'Registry revision exhausted')
  account.revision += 1
  account.timestamp = now
}

/** Mutates only the supplied draft. Handlers publish the draft atomically after validation. */
export function applyDomainAction(tx: ProofOfSkillTx, state: DomainState, now: number, txId: string): void {
  ensure(Number.isSafeInteger(now) && now > 0, 'Invalid consensus timestamp')
  ensure(tx.networkId === WIN_NETWORK_ID, 'Wrong WIN network')
  if (tx.type === 'skill') {
    ensure(state.skills, 'Skill registry is missing')
    const content = tx.payload as SkillContent
    const name = content.name.trim().normalize('NFKC')
    ensure(name.length > 0, 'Skill name is required')
    ensure(tx.action === 'create' && tx.expectedRevision === 0 && !own(state.skills.skills, tx.objectId), 'Skill revision conflict')
    ensure(
      !Object.values(state.skills.skills).some((s) => s.name.normalize('NFKC').toLowerCase() === name.toLowerCase()),
      'Skill already exists; select it from the directory',
    )
    state.skills.skills[tx.objectId] = {
      ...content,
      name,
      id: tx.objectId,
      owner: tx.from,
      managers: [],
      schemaVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      aliases: [],
      relatedSkillIds: [],
      assessmentCriteria: [],
    }
    bump(state.skills, now)
    return
  }
  if (tx.type === 'endorsement') {
    ensure(state.endorsements && state.skills, 'Endorsement registries are missing')
    const records = state.endorsements.endorsements
    const previous = own(records, tx.objectId) ? records[tx.objectId] : undefined
    if (tx.action === 'revoke') {
      ensure(previous && previous.revision === tx.expectedRevision, 'Endorsement revision conflict')
      ensure(controls(getProfile(state, previous.endorserProfileId), tx.from), 'Only the endorsing profile controller can revoke')
      ensure(previous.status === 'active', 'Endorsement is already revoked')
      previous.status = 'revoked'
      previous.revokedAt = now
      previous.revocationReason = tx.reason
      previous.updatedAt = now
      previous.revision += 1
    } else {
      ensure(tx.action === 'create' && !previous && tx.expectedRevision === 0, 'Endorsement revision conflict')
      const content = tx.payload as EndorsementContent
      const source = getProfile(state, content.endorserProfileId)
      const target = getProfile(state, content.subjectProfileId)
      ensure(controls(source, tx.from), 'Only the endorsing profile controller may sign')
      ensure(
        source.id !== target.id && !controls(target, tx.from) && !controls(target, source.owner) && !controls(source, target.owner),
        'Self endorsements are not allowed',
      )
      ensure(own(state.skills.skills, content.skillId), 'Skill does not exist')
      ensure(target.type === 'person' && target.details.skills?.some((s) => s.skillId === content.skillId), 'Subject must claim the endorsed skill')
      ensure(content.statement.trim().length > 0, 'Endorsement statement is required')
      ensure(
        !Object.values(records).some(
          (e) =>
            e.endorserProfileId === source.id &&
            e.subjectProfileId === target.id &&
            e.skillId === content.skillId &&
            e.status === 'active' &&
            e.validUntil > now,
        ),
        'An active endorsement already exists',
      )
      // Skill attestations are visible evidence. Only the established contract-outcome
      // protocol changes aggregate scores; endorsements cannot mint arbitrary score.
      records[tx.objectId] = {
        ...content,
        id: tx.objectId,
        owner: source.owner,
        managers: [],
        schemaVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        evidence: [],
        validFrom: now,
        validUntil: addMonths(now, content.durationMonths),
        status: 'active',
        scoring: 0,
      }
    }
    bump(state.endorsements, now)
    return
  }
  if (tx.type === 'profile') {
    const existing = own(state.profiles.profiles, tx.objectId) ? state.profiles.profiles[tx.objectId] : undefined
    ensure(
      tx.action === 'create' ? !existing && tx.expectedRevision === 0 : !!existing && existing.revision === tx.expectedRevision,
      'Profile revision conflict',
    )
    ensure(!existing || controls(existing, tx.from), 'Only the profile owner or manager can edit it')
    const content = tx.payload as ProfileContent
    ensure(!existing || existing.type === content.type, 'Profile type is immutable')
    const profile = {
      ...content,
      id: tx.objectId,
      owner: existing?.owner ?? tx.from,
      managers: existing?.managers ?? [],
      schemaVersion: 1 as const,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    } as Profile
    ensure(Number.isSafeInteger(profile.revision), 'Profile revision exhausted')
    state.profiles.profiles[tx.objectId] = profile
    bump(state.profiles, now)
    if (!existing) {
      ensure(!own(state.scores.scores, tx.objectId), 'Score already exists for this profile')
      state.scores.scores[tx.objectId] = formulas.initialScore
      bump(state.scores, now)
    }
    return
  }

  const registry = state.contracts
  ensure(registry && state.skills, 'Contract registries are missing')
  const existing = own(registry.contracts, tx.objectId) ? registry.contracts[tx.objectId] : undefined
  ensure(
    tx.action === 'create' ? !existing && tx.expectedRevision === 0 : !!existing && existing.revision === tx.expectedRevision,
    'Contract revision conflict',
  )

  if (tx.action === 'create' || tx.action === 'update') {
    const content = tx.payload as ContractContent
    validateContract(content, now)
    const worker = getProfile(state, content.workerProfileId)
    ensure(controls(worker, tx.from), 'Only the worker profile controller can submit its work record')
    ensure(!existing || existing.owner === tx.from || existing.managers.includes(tx.from), 'Only the contract owner or manager can edit it')
    ensure(!existing || existing.creditedMonths.length === 0, 'Credited contracts require a separate score-correction protocol before editing')
    ensure(!existing || (existing.workerProfileId === content.workerProfileId && existing.origin === content.origin), 'Worker and origin are immutable')
    for (const id of content.hiringProfileIds) {
      const hiring = getProfile(state, id)
      ensure(
        content.contractType !== 'student' || ['university', 'school'].includes(hiring.type),
        'Student contracts require a university or school for every hiring profile',
      )
      ensure(!controls(hiring, worker.owner), 'Worker cannot approve its own hiring relationship')
    }
    for (const id of content.skillIds) ensure(own(state.skills.skills, id), `Skill ${id} does not exist`)
    const termsRevision = (existing?.termsRevision ?? 0) + 1
    const contract: Contract = {
      ...content,
      id: tx.objectId,
      owner: existing?.owner ?? tx.from,
      managers: existing?.managers ?? [],
      createdBy: existing?.createdBy ?? tx.from,
      schemaVersion: 1,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      termsRevision,
      termsHash: hashTerms(content, termsRevision),
      approvalStatus: 'not_requested',
      approvals: [],
      creditedMonths: [],
    }
    registry.contracts[tx.objectId] = contract
    bump(registry, now)
    return
  }

  const contract = existing
  const request = contract.approvalRequest
  if (tx.action === 'request_approval') {
    ensure(contract.owner === tx.from || contract.managers.includes(tx.from), 'Only the contract controller can request approval')
    ensure(controls(getProfile(state, contract.workerProfileId), tx.from), 'Worker authorization is required')
    ensure(contract.approvalStatus !== 'approved' && contract.creditedMonths.length === 0, 'Contract has already been approved')
    ensure(contract.approvalStatus !== 'pending' || request.expiresAt < now, 'An approval request is already pending')
    const authorities: Record<string, string[]> = {}
    const scoreSnapshot = {}
    for (const id of [contract.workerProfileId, ...contract.hiringProfileIds]) {
      const profile = getProfile(state, id)
      ensure(own(state.scores.scores, id), 'Profile score is missing')
      scoreSnapshot[id] = state.scores.scores[id]
      if (id !== contract.workerProfileId) {
        authorities[id] = [profile.owner, ...profile.managers].sort()
        ensure(!authorities[id].includes(tx.from), 'Worker cannot sign as a hiring entity')
      }
    }
    const commitment = {
      domain: 'WIN.contract.approval.v1',
      contractId: contract.id,
      termsHash: contract.termsHash,
      termsRevision: contract.termsRevision,
      workerProfileId: contract.workerProfileId,
      hiringProfileIds: contract.hiringProfileIds,
      id: txId,
      requestedAt: now,
      expiresAt: now + INITIAL_PARAMETERS.contractApprovalWindowMs,
      networkId: tx.networkId,
      rulesVersion: formulas.rulesVersion,
      authorities,
      scoreSnapshot,
    }
    contract.approvalRequest = { ...commitment, hash: crypto.hashObj(commitment) }
    contract.approvalStatus = 'pending'
    contract.approvals = []
    delete contract.rejection
  } else if (tx.action === 'expire') {
    ensure(contract.approvalStatus === 'pending' && request && now > request.expiresAt, 'Approval request has not expired')
    contract.approvalStatus = 'expired'
  } else {
    ensure(contract.approvalStatus === 'pending' && request && now <= request.expiresAt, 'No live approval request')
    ensure(tx.requestHash === request.hash && request.termsRevision === contract.termsRevision, 'Approval hash or terms revision mismatch')
    ensure(contract.hiringProfileIds.includes(tx.hiringProfileId), 'Signer is not a requested hiring profile')
    ensure(
      request.authorities[tx.hiringProfileId].includes(tx.from) && controls(getProfile(state, tx.hiringProfileId), tx.from),
      'Signer does not control the hiring profile',
    )
    ensure(!controls(getProfile(state, contract.workerProfileId), tx.from), 'Worker cannot attest its own contract')
    ensure(!contract.approvals.some((approval) => approval.profileId === tx.hiringProfileId), 'Hiring profile has already approved')
    if (tx.action === 'reject') {
      contract.approvalStatus = 'rejected'
      contract.rejection = { profileId: tx.hiringProfileId, signer: tx.from, rejectedAt: now, reason: tx.reason }
    } else {
      ensure(tx.action === 'approve', 'Unknown contract action')
      contract.approvals.push({ profileId: tx.hiringProfileId, signer: tx.from, requestHash: request.hash, approvedAt: now, approvalTxId: txId })
      if (contract.approvals.length === contract.hiringProfileIds.length) {
        contract.approvalStatus = 'approved'
        // No score is earned for disputed or planned work. Compensation is descriptive:
        // neither creation nor approval pays salaries or creates escrow.
        if (contract.workStatus !== 'disputed' && contract.workStatus !== 'planned' && contract.periodOutcomes.length > 0) {
          const hires = Object.fromEntries(contract.hiringProfileIds.map((id) => [id, request.scoreSnapshot[id]]))
          const deltas = contractMonthlyDeltas(request.scoreSnapshot[contract.workerProfileId], hires, contract.terms.durationMonths)
          for (const period of [...contract.periodOutcomes].sort((a, b) => a.month - b.month)) {
            ensure(!contract.creditedMonths.includes(period.month), 'Contract month already credited')
            const sign = period.outcome === 'success' ? 1n : -1n
            for (const [id, delta] of [[contract.workerProfileId, deltas.employee], ...Object.entries(deltas.hires)] as [string, bigint][]) {
              state.scores.scores[id] = scoreValue(clampScore(BigInt(state.scores.scores[id]) + sign * delta))
            }
            contract.creditedMonths.push(period.month)
          }
          bump(state.scores, now)
        }
      }
    }
  }
  contract.revision += 1
  ensure(Number.isSafeInteger(contract.revision), 'Contract revision exhausted')
  contract.updatedAt = now
  bump(registry, now)
}
