import { contractsAddress, profilesAddress, scoresAddress, skillsAddress, endorsementsAddress, isProtectedAddress } from '../config'

export function isProofOfSkillTransaction(type: string): boolean {
  return ['profile', 'contract', 'endorsement', 'skill'].includes(type)
}

/** Only these handlers may access these registry accounts; fields remain schema-validated. */
export function assertTransactionAccountAccess(tx: { type: string; from?: string }, ids: readonly string[]): void {
  if (tx.from && isProtectedAddress(tx.from)) throw new Error('A protected registry cannot sign transactions')
  const allowed =
    tx.type === 'profile' ? [profilesAddress, scoresAddress] : tx.type === 'contract' ? [profilesAddress, contractsAddress, scoresAddress, skillsAddress] : tx.type === 'endorsement' ? [profilesAddress, scoresAddress, skillsAddress, endorsementsAddress] : tx.type === 'skill' ? [profilesAddress, scoresAddress, skillsAddress] : []
  for (const id of ids) {
    if (isProtectedAddress(id) && !allowed.includes(id)) throw new Error(`Transaction cannot use protected account ${id}`)
  }
}
