import { createHash } from 'crypto'
import { verifyMessage } from 'ethers'
import { connectionsAddress, profilesAddress, WIN_NETWORK_ID } from '../config'
import type { ConnectionsAccount, ProfilesAccount, Connection } from '../@types'

/** Read-only, wallet-authenticated view of a controlled profile's connections. */
export const connectionQuery = dapp => async (req, res): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store')
  const e = req.body
  try {
    if (!e || typeof e !== 'object' || Buffer.byteLength(JSON.stringify(e)) > 4 * 1024 * 1024 ||
        !/^[a-f0-9]{40}$/.test(e.address || '') || e.networkId !== WIN_NETWORK_ID ||
        typeof e.origin !== 'string' || e.origin.length > 250 || !/^https?:\/\//.test(e.origin) ||
        !['connections', 'feed', 'mine', 'publish', 'delete', 'image'].includes(e.action) ||
        !Number.isSafeInteger(e.timestamp) || Math.abs(dapp.shardusGetTime() - e.timestamp) > 120000 ||
        !/^[a-f0-9]{32}$/.test(e.nonce || '') || !e.data || !/^[a-f0-9]{64}$/.test(e.data.profileId || '') ||
        !/^0x[a-fA-F0-9]{130}$/.test(e.signature || '')) {
      res.status(401).json({ error:'A fresh signed profile authorization is required' }); return
    }
    const message = 'WIN Feed v1\n' + createHash('sha256').update(JSON.stringify([e.address,e.networkId,e.origin,e.action,e.timestamp,e.nonce,e.data])).digest('hex')
    let signer: string
    try { signer = verifyMessage(message,e.signature).slice(2).toLowerCase() } catch { res.status(401).json({ error:'Invalid wallet signature' }); return }
    if (signer !== e.address) { res.status(401).json({ error:'Wallet signature mismatch' }); return }
    const profileId = e.data.profileId, wallet = signer + '0'.repeat(24)
    const profiles = (await dapp.getLocalOrRemoteAccount(profilesAddress))?.data as ProfilesAccount
    const profile = profiles?.profiles?.[profileId]
    if (!profile || (profile.owner !== wallet && !profile.managers.includes(wallet))) {
      res.status(403).json({ error:'Only this profile’s owner or manager can read its connections' }); return
    }
    const registry = (await dapp.getLocalOrRemoteAccount(connectionsAddress))?.data as ConnectionsAccount
    if (registry && registry.type !== 'ConnectionsAccount') throw new Error('Invalid connections registry')
    const records = (Object.values(registry?.connections || {}) as Connection[]).filter(c => c.fromProfileId === profileId || c.toProfileId === profileId).sort((a,b) => a.id.localeCompare(b.id))
    const acceptedProfileIds = [...new Set(records.filter(c => c.status === 'accepted').map(c => c.fromProfileId === profileId ? c.toProfileId : c.fromProfileId))]
    if (e.action !== 'connections') { res.json({ networkId:WIN_NETWORK_ID,profileId,acceptedProfileIds }); return }
    const cursor = e.data.cursor || ''
    if (typeof cursor !== 'string' || (cursor && !/^[a-f0-9]{64}$/.test(cursor))) { res.status(400).json({ error:'Invalid page cursor' }); return }
    const after = records.filter(c => !cursor || c.id > cursor), page = after.slice(0,100)
    res.json({ networkId:WIN_NETWORK_ID, profileId, acceptedProfileIds, records:page, total:records.length,
      nextCursor:after.length > page.length ? page[page.length-1].id : null, registryRevision:registry?.revision || 0 })
  } catch (error) { dapp.log(error); res.status(503).json({ error:'Connections are unavailable' }) }
}
