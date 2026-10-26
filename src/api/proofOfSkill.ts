import { contractsAddress, profilesAddress, scoresAddress, skillsAddress, endorsementsAddress } from '../config'

/** Read the current committed record, not an application-maintained version history. */
export const proofOfSkillRecord =
  (dapp, kind: 'profiles' | 'contracts' | 'scores' | 'skills' | 'endorsements') =>
  async (req, res): Promise<void> => {
    const id = req.params.id
    if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) {
      res.status(400).json({ error: 'Invalid object ID' })
      return
    }
    try {
      const address = { profiles: profilesAddress, contracts: contractsAddress, scores: scoresAddress, skills: skillsAddress, endorsements: endorsementsAddress }[kind]
      const wrapped = await dapp.getLocalOrRemoteAccount(address)
      const records = wrapped?.data?.[kind]
      if (!records || !Object.prototype.hasOwnProperty.call(records, id)) {
        res.status(404).json({ error: 'Record not found' })
        return
      }
      // Expiry is presented at read time without mutating consensus state.
      // The explicit expire action can persist that transition.
      const record = records[id]
      const effectiveApprovalStatus =
        kind === 'contracts' && record.approvalStatus === 'pending' && record.approvalRequest.expiresAt < dapp.shardusGetTime()
          ? 'expired'
          : record.approvalStatus
      res.json({ record, registryRevision: wrapped.data.revision, ...(kind === 'contracts' ? { effectiveApprovalStatus } : {}) })
    } catch (error) {
      dapp.log(error)
      res.status(503).json({ error: 'Unable to read committed record' })
    }
  }


/** Bounded pages of committed public records. Never expose account keys or private messages. */
export const proofOfSkillDirectory = (dapp, kind: 'profiles' | 'contracts' | 'skills' | 'endorsements') => async (req, res): Promise<void> => {
  const { q = '', owner = '', profileId = '', cursor = '', limit = '24' } = req.query || {}
  const id = /^[0-9a-f]{64}$/
  if ([q, owner, profileId, cursor, limit].some(v => typeof v !== 'string') || q.length > 250 ||
      (owner && !id.test(owner)) || (profileId && !id.test(profileId)) || (cursor && !id.test(cursor)) || !/^(?:[1-9][0-9]?|100)$/.test(limit)) {
    res.status(400).json({ error: 'Invalid directory filters or page size (1–100)' }); return
  }
  try {
    const addresses = { profiles: profilesAddress, contracts: contractsAddress, skills: skillsAddress, endorsements: endorsementsAddress }
    const registry = (await dapp.getLocalOrRemoteAccount(addresses[kind]))?.data
    // Registries are created lazily by the first valid transaction. An absent
    // registry is an empty directory; transport failures still take the 503 path.
    if (!registry) { res.json({ records: [], total: 0, nextCursor: null, registryRevision: 0 }); return }
    if (!registry[kind]) { res.status(503).json({ error: 'Directory is not available yet' }); return }
    const [skillRegistry, scoreRegistry] = kind === 'profiles' ? await Promise.all([
      dapp.getLocalOrRemoteAccount(skillsAddress), dapp.getLocalOrRemoteAccount(scoresAddress),
    ]) : [null, null]
    const skills = skillRegistry?.data?.skills || {}
    const query = q.normalize('NFKC').toLowerCase().trim()
    const records = Object.values(registry[kind]) as any[]
    const filtered = records.filter(record => {
      if (owner && record.owner !== owner && !record.managers?.includes(owner)) return false
      if (profileId && (kind === 'contracts' ? record.workerProfileId !== profileId && !record.hiringProfileIds.includes(profileId)
        : kind === 'endorsements' ? record.subjectProfileId !== profileId && record.endorserProfileId !== profileId : record.id !== profileId)) return false
      const words = kind === 'profiles' ? [record.displayName, record.details?.headline, record.details?.industry, record.details?.organizationKind,
        ...(record.details?.skills || []).flatMap(s => [skills[s.skillId]?.name, ...(skills[s.skillId]?.aliases || [])]),
        ...(record.details?.experience || []).map(e => e.jobTitle)] : [record.name, record.title, record.statement]
      return !query || words.filter(Boolean).join(' ').normalize('NFKC').toLowerCase().includes(query)
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const after = filtered.filter(r => !cursor || r.id > cursor)
    const page = after.slice(0, Number(limit))
    const now = dapp.shardusGetTime()
    res.json({ records: page.map(record => ({ ...record,
      ...(kind === 'profiles' ? { score: scoreRegistry?.data?.scores?.[record.id] ?? null } : {}),
      ...(kind === 'contracts' ? { effectiveApprovalStatus: record.approvalStatus === 'pending' && record.approvalRequest?.expiresAt < now ? 'expired' : record.approvalStatus } : {}),
      ...(kind === 'endorsements' ? { effectiveStatus: record.status === 'active' && record.validUntil <= now ? 'expired' : record.status } : {}),
    })), total: filtered.length, nextCursor: after.length > page.length ? page[page.length - 1].id : null, registryRevision: registry.revision })
  } catch (error) { dapp.log(error); res.status(503).json({ error: 'Unable to read directory' }) }
}
