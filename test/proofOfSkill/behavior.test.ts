import { Utils } from '@shardus/lib-types'
import { TXTypes, ProofOfSkillTx, ContractContent, Contract, ProfileContent } from '../../src/@types'
import { applyDomainAction, DomainState } from '../../src/domain/behavior'
import { validateProofOfSkillShape } from '../../src/domain/schema'
import { assertTransactionAccountAccess } from '../../src/domain/routing'
import { profilesAccount } from '../../src/accounts/profile'
import { contractsAccount } from '../../src/accounts/contract'
import { scoresAccount } from '../../src/accounts/score'
import { skillsAccount } from '../../src/accounts/skill'
import { serializeAccounts, deserializeAccounts } from '../../src/accounts'
import { WIN_NETWORK_ID, profilesAddress, contractsAddress, scoresAddress } from '../../src/config'
import { formulas, contractMonthlyDeltas } from '../../src/config/formulas'
import { validate_fields, proofOfSkillFee } from '../../src/transactions/proofOfSkill'
import * as crypto from '../../src/crypto'

const id = (n: number) => n.toString(16).padStart(64, '0')
const now = Date.UTC(2026, 9, 25)
let state: DomainState
let sequence: number
const sender = id(901)
const employer = id(902)
function tx(
  type: TXTypes.profile | TXTypes.contract,
  objectId: string,
  action: ProofOfSkillTx['action'],
  expectedRevision: number,
  payload?: any,
  from = sender,
): ProofOfSkillTx {
  return {
    type,
    from,
    to: type === TXTypes.profile ? profilesAddress : contractsAddress,
    objectId,
    action,
    expectedRevision,
    ...(payload ? { payload } : {}),
    timestamp: now,
    networkId: WIN_NETWORK_ID,
    fee: 0n,
    sign: { owner: from, sig: 'signature' },
  }
}
function run(transaction: ProofOfSkillTx, at = now): void {
  expect(validateProofOfSkillShape(transaction)).toBeUndefined()
  const draft = Utils.safeJsonParse(Utils.safeStringify(state))
  applyDomainAction(transaction, draft, at, id(++sequence))
  state = draft
}
const content = (workStatus: ContractContent['workStatus'] = 'completed'): ContractContent => ({
  origin: 'historical',
  title: 'Developer',
  publicDescription: 'Past employment',
  workerProfileId: id(1),
  hiringProfileIds: [id(2)],
  skillIds: [],
  terms: { startDate: '2024-01-31', endDate: '2024-03-31', durationMonths: 2, responsibilities: [], acceptanceCriteria: [] },
  workStatus,
  periodOutcomes: [
    { month: 1, outcome: 'success' },
    { month: 2, outcome: 'success' },
  ],
  evidence: [],
  compensation: { amount: '999999999999999999.123456789012345678', currency: 'WIN', frequency: 'monthly' },
})
const contract = (): Contract => state.contracts.contracts[id(3)]
function request(): void {
  run(tx(TXTypes.contract, id(3), 'request_approval', contract().revision))
}
function approve(profile = id(2), from = employer): void {
  run({
    ...tx(TXTypes.contract, id(3), 'approve', contract().revision, undefined, from),
    requestHash: contract().approvalRequest.hash,
    hiringProfileId: profile,
  })
}
beforeEach(() => {
  state = { profiles: profilesAccount(), contracts: contractsAccount(), scores: scoresAccount(), skills: skillsAccount() }
  sequence = 100
  run(tx(TXTypes.profile, id(1), 'create', 0, { type: 'person', displayName: 'Worker', details: {} }))
  run(tx(TXTypes.profile, id(2), 'create', 0, { type: 'company', displayName: 'Employer', details: { legalName: 'Employer' } }, employer))
})
test.each(['person', 'organization', 'government', 'company', 'university', 'school'])('validates and stores %s profiles', (type) => {
  const details =
    type === 'person'
      ? { education: [{ id: 'degree', startDate: '2020', institution: 'School', qualification: 'Degree' }] }
      : { legalName: 'Entity', ...(type === 'government' ? { jurisdiction: 'TN' } : {}) }
  run(tx(TXTypes.profile, id(10), 'create', 0, { type, displayName: 'Example', details }))
  expect(state.profiles.profiles[id(10)].type).toBe(type)
})
test('rejects caller-owned timestamps, score injection, and mismatched type details', () => {
  for (const payload of [
    { type: 'person', displayName: 'A', details: {}, updatedAt: 1 },
    { type: 'person', displayName: 'A', details: {}, score: 999999 },
    { type: 'school', displayName: 'A', details: { firstName: 'Wrong' } },
  ])
    expect(validateProofOfSkillShape(tx(TXTypes.profile, id(10), 'create', 0, payload))).toBeDefined()
})
test('updates replace the latest profile, preserve others and createdAt, and reject stale or unauthorized writes', () => {
  const data: ProfileContent = { type: 'person', displayName: 'Changed', details: {} }
  run(tx(TXTypes.profile, id(1), 'update', 1, data), now + 100)
  expect(state.profiles.profiles[id(1)]).toMatchObject({ revision: 2, createdAt: now, updatedAt: now + 100 })
  expect(state.profiles.profiles[id(2)].displayName).toBe('Employer')
  expect(() => run(tx(TXTypes.profile, id(1), 'update', 1, data))).toThrow('revision')
  expect(() => run(tx(TXTypes.profile, id(1), 'update', 2, data, employer))).toThrow('owner')
})
test('historical import preserves work dates, has no approval or score effect, and needs no escrow', () => {
  const scores = { ...state.scores.scores }
  run(tx(TXTypes.contract, id(3), 'create', 0, content()))
  expect(contract()).toMatchObject({ createdAt: now, approvalStatus: 'not_requested', creditedMonths: [], terms: { startDate: '2024-01-31' } })
  expect(state.scores.scores).toEqual(scores)
  expect(contract()).not.toHaveProperty('escrow')
})
test('final approval credits historical months immediately and rejects replays', () => {
  run(tx(TXTypes.contract, id(3), 'create', 0, content()))
  request()
  const before = state.scores.scores[id(1)]
  const delta = contractMonthlyDeltas(before, { [id(2)]: state.scores.scores[id(2)] }, 2)
  approve()
  expect(BigInt(state.scores.scores[id(1)])).toBe(BigInt(before) + 2n * delta.employee)
  expect(contract()).toMatchObject({ approvalStatus: 'approved', creditedMonths: [1, 2] })
  expect(() => approve()).toThrow('No live')
  expect(() => request()).toThrow('already been approved')
})
test('approval binds the hash and current hiring authority', () => {
  run(tx(TXTypes.contract, id(3), 'create', 0, content()))
  request()
  const approval = { ...tx(TXTypes.contract, id(3), 'approve', 2, undefined, employer), hiringProfileId: id(2), requestHash: id(777) }
  expect(() => run(approval)).toThrow('hash')
  expect(() => approve(id(2), id(903))).toThrow('control')
})
test('multiple employers approve the same request even as the record revision increases', () => {
  run(tx(TXTypes.profile, id(4), 'create', 0, { type: 'school', displayName: 'School', details: { legalName: 'School' } }, id(904)))
  run(tx(TXTypes.contract, id(3), 'create', 0, { ...content(), hiringProfileIds: [id(2), id(4)] }))
  request()
  const hash = contract().approvalRequest.hash
  approve()
  expect(contract().approvalStatus).toBe('pending')
  expect(state.scores.scores[id(1)]).toBe(formulas.initialScore)
  expect(contract().approvalRequest.hash).toBe(hash)
  approve(id(4), id(904))
  expect(contract().approvalStatus).toBe('approved')
})
test('terms edits invalidate outstanding approvals', () => {
  run(tx(TXTypes.contract, id(3), 'create', 0, content()))
  request()
  const oldHash = contract().approvalRequest.hash
  run(tx(TXTypes.contract, id(3), 'update', 2, { ...content(), title: 'Corrected' }))
  expect(contract().approvalStatus).toBe('not_requested')
  expect(contract().approvalRequest).toBeUndefined()
  request()
  expect(contract().approvalRequest.hash).not.toBe(oldHash)
})
test('disputed work gets no credit; canceled work uses attested outcomes', () => {
  run(tx(TXTypes.contract, id(3), 'create', 0, content('disputed')))
  request()
  approve()
  expect(state.scores.scores[id(1)]).toBe(formulas.initialScore)
  expect(contract().creditedMonths).toEqual([])
  run(
    tx(TXTypes.contract, id(3), 'update', 3, {
      ...content('canceled'),
      periodOutcomes: [
        { month: 1, outcome: 'success' },
        { month: 2, outcome: 'failure' },
      ],
    }),
  )
  request()
  approve()
  expect(state.scores.scores[id(1)]).toBe(formulas.initialScore)
  expect(contract().creditedMonths).toEqual([1, 2])
})
test('rejects impossible dates, duplicate months, and premature credit', () => {
  for (const data of [
    { ...content(), terms: { ...content().terms, startDate: '2024-02-31' } },
    {
      ...content(),
      periodOutcomes: [
        { month: 1, outcome: 'success' },
        { month: 1, outcome: 'success' },
      ],
    },
    { ...content(), terms: { ...content().terms, endDate: '2024-02-01' } },
  ])
    expect(() => run(tx(TXTypes.contract, id(3), 'create', 0, data))).toThrow()
})
test('expired requests cannot be approved and can be explicitly expired', () => {
  run(tx(TXTypes.contract, id(3), 'create', 0, content()))
  request()
  const expiry = contract().approvalRequest.expiresAt
  expect(() =>
    run(
      { ...tx(TXTypes.contract, id(3), 'approve', 2, undefined, employer), requestHash: contract().approvalRequest.hash, hiringProfileId: id(2) },
      expiry + 1,
    ),
  ).toThrow('No live')
  run(tx(TXTypes.contract, id(3), 'expire', 2), expiry + 1)
  expect(contract().approvalStatus).toBe('expired')
})
test('registries round trip through existing serialization', () => {
  for (const registry of Object.values(state)) expect(deserializeAccounts(serializeAccounts(registry).getBuffer())).toEqual(registry)
})
test('protected access is per handler and includes non-destination keys', () => {
  expect(() => assertTransactionAccountAccess({ type: 'transfer', from: sender }, [sender, scoresAddress])).toThrow('protected')
  expect(() => assertTransactionAccountAccess({ type: 'profile', from: sender }, [contractsAddress])).toThrow('protected')
  expect(() => assertTransactionAccountAccess({ type: 'contract', from: profilesAddress }, [profilesAddress])).toThrow('sign')
  expect(() => assertTransactionAccountAccess({ type: 'contract', from: sender }, [profilesAddress, contractsAddress, scoresAddress])).not.toThrow()
})
test('field validation requires a real signature independently of global AJV flags', () => {
  const transaction = tx(TXTypes.profile, id(10), 'create', 0, { type: 'person', displayName: 'Test', details: {} })
  transaction.fee = proofOfSkillFee(transaction)
  const spy = jest.spyOn(crypto, 'verifyObj').mockReturnValue(false)
  expect(validate_fields(transaction, { success: false, reason: '' }).success).toBe(false)
  spy.mockRestore()
})

test('handler validation does not mutate state, and applying a profile only charges its metadata fee', () => {
  const handler = require('../../src/transactions/proofOfSkill')
  const { userAccount } = require('../../src/accounts/userAccount')
  const transaction = tx(TXTypes.profile, id(10), 'create', 0, { type: 'person', displayName: 'New profile', details: {} })
  transaction.fee = handler.proofOfSkillFee(transaction)
  const wallet = userAccount(sender, now)
  wallet.data.balance = 10n ** 18n
  const accounts = [wallet, state.profiles, state.scores]
  const wrapped = Object.fromEntries(accounts.map((data) => [data.id, { data, accountId: data.id, timestamp: data.timestamp, stateId: data.hash }]))
  const previous = Utils.safeStringify(wrapped)
  const signature = jest.spyOn(crypto, 'verifyObj').mockReturnValue(true)
  const dapp = {
    applyResponseAddReceiptData: (result, receipt) => {
      result.receipt = receipt
    },
  }
  try {
    expect(handler.validate(transaction, wrapped, { success: false, reason: '' }).success).toBe(true)
    expect(Utils.safeStringify(wrapped)).toBe(previous)
    handler.apply(transaction, now, id(501), wrapped, dapp, {})
    expect(wallet.data.balance).toBe(10n ** 18n - transaction.fee)
    expect(wrapped[profilesAddress].data.profiles[id(10)]).toMatchObject({ owner: sender, revision: 1, createdAt: now })
    expect(wrapped[scoresAddress].data.scores[id(10)]).toBe(formulas.initialScore)
    const after = Utils.safeStringify(wrapped)
    expect(() => handler.apply(transaction, now, id(502), wrapped, dapp, {})).toThrow('revision')
    handler.createFailedAppReceiptData(transaction, now, id(502), wrapped, dapp, {}, 'revision conflict')
    expect(Utils.safeStringify(wrapped)).toBe(after)
  } finally {
    signature.mockRestore()
  }
})

test('handler approval atomically changes the contract and score registries and charges no salary', () => {
  const handler = require('../../src/transactions/proofOfSkill')
  const { userAccount } = require('../../src/accounts/userAccount')
  run(tx(TXTypes.contract, id(3), 'create', 0, content()))
  request()
  const transaction = {
    ...tx(TXTypes.contract, id(3), 'approve', 2, undefined, employer),
    requestHash: contract().approvalRequest.hash,
    hiringProfileId: id(2),
  }
  transaction.fee = formulas.contractFee
  const wallet = userAccount(employer, now)
  wallet.data.balance = 3n * formulas.contractFee
  const wrapped = Object.fromEntries(
    [wallet, ...Object.values(state)].map((data) => [data.id, { data, accountId: data.id, timestamp: data.timestamp, stateId: data.hash }]),
  )
  const signature = jest.spyOn(crypto, 'verifyObj').mockReturnValue(true)
  try {
    handler.apply(transaction, now + 100, id(503), wrapped, { applyResponseAddReceiptData() {} }, {})
    expect(wallet.data.balance).toBe(2n * formulas.contractFee)
    expect(wrapped[contractsAddress].data.contracts[id(3)]).toMatchObject({ approvalStatus: 'approved', creditedMonths: [1, 2] })
    expect(wrapped[contractsAddress].data.timestamp).toBe(now + 100)
    expect(wrapped[scoresAddress].data.timestamp).toBe(now + 100)
    expect(BigInt(wrapped[scoresAddress].data.scores[id(1)])).toBeGreaterThan(BigInt(formulas.initialScore))
  } finally {
    signature.mockRestore()
  }
})
