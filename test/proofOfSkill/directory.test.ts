import { Utils } from '@shardus/lib-types'
import { TXTypes, ProofOfSkillTx } from '../../src/@types'
import { applyDomainAction, DomainState } from '../../src/domain/behavior'
import { validateProofOfSkillShape } from '../../src/domain/schema'
import { assertTransactionAccountAccess } from '../../src/domain/routing'
import { profilesAccount } from '../../src/accounts/profile'
import { scoresAccount } from '../../src/accounts/score'
import { skillsAccount } from '../../src/accounts/skill'
import { endorsementsAccount } from '../../src/accounts/endorsement'
import { proofOfSkillDirectory } from '../../src/api/proofOfSkill'
import { WIN_NETWORK_ID, profilesAddress, scoresAddress, skillsAddress, endorsementsAddress } from '../../src/config'
import { proofOfSkillFee, keys, memoryPattern } from '../../src/transactions/proofOfSkill'
const id = (n: number) => n.toString(16).padStart(64, '0')
const now = Date.UTC(2026, 9, 26)
let state: DomainState
function tx(type: TXTypes, objectId: string, payload: any, from = id(900), action = 'create', expectedRevision = 0): ProofOfSkillTx {
 return { type, from, objectId, payload, action, expectedRevision, to: type === 'skill' ? skillsAddress : type === 'endorsement' ? endorsementsAddress : profilesAddress,
   timestamp: now, networkId: WIN_NETWORK_ID, fee: 0n, sign: { owner: from, sig: 'signature' } } as ProofOfSkillTx
}
function run(transaction: ProofOfSkillTx): void {
 expect(validateProofOfSkillShape(transaction)).toBeUndefined()
 const draft = Utils.safeJsonParse(Utils.safeStringify(state))
 applyDomainAction(transaction, draft, now, id(999)); state = draft
}
const endorsement = () => tx(TXTypes.endorsement,id(20),{endorserProfileId:id(1),subjectProfileId:id(2),skillId:id(10),relationship:'colleague',statement:'Delivered excellent accessible interfaces.',durationMonths:12})
beforeEach(()=>{
 state={profiles:profilesAccount(),scores:scoresAccount(),skills:skillsAccount(),endorsements:endorsementsAccount()}
 run(tx(TXTypes.skill,id(10),{name:'Product Design',description:'Design interfaces',category:'Design',kind:'technical'}))
 run(tx(TXTypes.profile,id(1),{type:'person',displayName:'Alice',details:{headline:'Designer',skills:[{skillId:id(10)}]}}))
 run(tx(TXTypes.profile,id(2),{type:'person',displayName:'Bea',details:{headline:'Engineer',skills:[{skillId:id(10)}]}},id(901)))
})
test('skill registration normalizes display names and rejects case-insensitive duplicates and blank names',()=>{
 expect(state.skills.skills[id(10)].name).toBe('Product Design')
 expect(()=>run(tx(TXTypes.skill,id(11),{name:' product design ',description:'',category:'',kind:'technical'}))).toThrow('already exists')
 expect(()=>run(tx(TXTypes.skill,id(11),{name:' ',description:'',category:'',kind:'other'}))).toThrow('required')
})
test('endorsements require both profiles, claimed skill, independent controllers, and exact revision',()=>{
 const original=endorsement()
 for(const changed of [{from:id(901)}, {payload:{...original.payload,subjectProfileId:id(1)}}, {payload:{...original.payload,skillId:id(99)}}, {expectedRevision:1}]) {
  expect(()=>applyDomainAction({...original,...changed},Utils.safeJsonParse(Utils.safeStringify(state)),now,id(9))).toThrow()
 }
 state.profiles.profiles[id(2)].managers.push(id(900))
 expect(()=>run(original)).toThrow('Self endorsements')
})
test('signed endorsements have consensus dates, immutable author identity, no caller score, and no duplicate live attestations',()=>{
 const before=state.scores.scores[id(2)]
 run(endorsement());const e=state.endorsements.endorsements[id(20)]
 expect(e.validFrom).toBe(now);expect(e.validUntil).toBe(Date.UTC(2027,9,26));expect(e.owner).toBe(id(900));expect(e.scoring).toBe(0)
 expect(state.scores.scores[id(2)]).toBe(before)
 expect(()=>run({...endorsement(),objectId:id(21)})).toThrow('active endorsement')
 expect(validateProofOfSkillShape({...endorsement(),payload:{...endorsement().payload,scoring:999}})).toBeDefined()
})
test('revocation is authorized and revision guarded',()=>{
 run(endorsement());const revoke={...endorsement(),payload:undefined,action:'revoke',expectedRevision:1,reason:'Relationship ended'} as ProofOfSkillTx
 delete revoke.payload
 expect(()=>applyDomainAction({...revoke,from:id(901)},state,now,id(9))).toThrow('controller')
 run(revoke);expect(state.endorsements.endorsements[id(20)].status).toBe('revoked')
 expect(()=>run(revoke)).toThrow('revision')
})
test('routing declares endorsement write access without granting contracts access to endorsements',()=>{
 const t=endorsement();const routed=keys(t,{sourceKeys:[],targetKeys:[],allKeys:[],timestamp:now})
 expect(routed.allKeys).toContain(endorsementsAddress);expect(memoryPattern(t).rw).toContain(endorsementsAddress)
 expect(()=>assertTransactionAccountAccess(t,routed.allKeys)).not.toThrow()
 expect(()=>assertTransactionAccountAccess({type:'contract'},[endorsementsAddress])).toThrow()
 expect(proofOfSkillFee(t)).toBe(500000000000000000n)
})
async function directory(query:any,kind:'profiles'|'skills'|'endorsements'='profiles') {
 const map={[profilesAddress]:state.profiles,[scoresAddress]:state.scores,[skillsAddress]:state.skills,[endorsementsAddress]:state.endorsements}
 let code=200,data:any
 const response={status:(n:number)=>{code=n;return response},json:(value:any)=>{data=value}}
 await proofOfSkillDirectory({getLocalOrRemoteAccount:async(address:string)=>({data:map[address]}),shardusGetTime:()=>now,log:()=>{}},kind)({query},response)
 return {code,data}
}
test('directory searches titles and registered skills with normalized case',async()=>{
 expect((await directory({q:'engineer'})).data.records.map(p=>p.displayName)).toEqual(['Bea'])
 expect((await directory({q:'product DESIGN'})).data.total).toBe(2)
 expect((await directory({q:'not found'})).data.records).toEqual([])
})
test('directory pages are stable and expose exact scores, with controlled-profile filters',async()=>{
 state.scores.scores[id(1)]='9007199254740993000000'
 const first=(await directory({limit:'1'})).data
 expect(first.records[0].score).toBe('9007199254740993000000');expect(first.nextCursor).toBe(id(1))
 const second=(await directory({limit:'1',cursor:first.nextCursor})).data;expect(second.records[0].id).toBe(id(2));expect(second.nextCursor).toBeNull()
 expect((await directory({owner:id(900)})).data.total).toBe(1)
})
test('directory rejects injection-shaped filters, invalid IDs, and unbounded limits',async()=>{
 for(const query of [{q:['x']},{limit:'10000'},{limit:'0'},{cursor:'../x'},{owner:'x'},{profileId:{toString:()=>id(1)}}])expect((await directory(query)).code).toBe(400)
})
test('endorsement directory filters subjects and issuers, and reports expiry without changing stored state',async()=>{
 run(endorsement());state.endorsements.endorsements[id(20)].validUntil=now-1
 const result=(await directory({profileId:id(2)},'endorsements')).data
 expect(result.records[0].effectiveStatus).toBe('expired');expect(state.endorsements.endorsements[id(20)].status).toBe('active')
 expect((await directory({profileId:id(3)},'endorsements')).data.total).toBe(0)
})

test('a new network with lazy registries can browse empty directories before its first profile', async () => {
 let code = 200, data: any
 const response = { status: (n: number) => { code = n; return response }, json: (value: any) => { data = value } }
 await proofOfSkillDirectory({ getLocalOrRemoteAccount: async () => null, shardusGetTime: () => now, log: () => {} }, 'profiles')({ query: {} }, response)
 expect(code).toBe(200); expect(data.records).toEqual([]); expect(data.total).toBe(0)
})
