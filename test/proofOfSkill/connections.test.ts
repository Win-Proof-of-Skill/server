import { Wallet } from 'ethers'
import { createHash } from 'crypto'
import { Utils } from '@shardus/lib-types'
import { TXTypes, ProofOfSkillTx } from '../../src/@types'
import { DomainState, applyDomainAction } from '../../src/domain/behavior'
import { validateProofOfSkillShape } from '../../src/domain/schema'
import { assertTransactionAccountAccess } from '../../src/domain/routing'
import { profilesAccount } from '../../src/accounts/profile'
import { scoresAccount } from '../../src/accounts/score'
import { connectionsAccount } from '../../src/accounts/connection'
import { WIN_NETWORK_ID, profilesAddress, connectionsAddress } from '../../src/config'
import { connectionQuery } from '../../src/api/connections'
import { keys, memoryPattern } from '../../src/transactions/proofOfSkill'
const id = (n: number) => n.toString(16).padStart(64,'0')
const now = Date.UTC(2026,9,29)
const alice = new Wallet('0x'+'1'.padStart(64,'0')), bob = new Wallet('0x'+'2'.padStart(64,'0')), eve = new Wallet('0x'+'3'.padStart(64,'0'))
const owner = wallet => wallet.address.slice(2).toLowerCase()+'0'.repeat(24)
let state: DomainState
const tx = (action: ProofOfSkillTx['action'], wallet=alice, objectId=id(3), revision=0, payload?: any): ProofOfSkillTx => ({type:TXTypes.connection,action,from:owner(wallet),to:connectionsAddress,objectId,expectedRevision:revision,networkId:WIN_NETWORK_ID,timestamp:now,fee:0n,sign:{owner:owner(wallet),sig:'mock'},...(payload?{payload}:{})})
function run(t:ProofOfSkillTx,at=now){expect(validateProofOfSkillShape(t)).toBeUndefined();const copy=Utils.safeJsonParse(Utils.safeStringify(state));applyDomainAction(t,copy,at,id(99));state=copy}
const request=()=>run(tx('create',alice,id(3),0,{fromProfileId:id(1),toProfileId:id(2)}))
beforeEach(()=>{
 state={profiles:profilesAccount(),scores:scoresAccount(),connections:connectionsAccount()}
 for(const [n,wallet] of [[1,alice],[2,bob]] as const)run({...tx('create',wallet,id(n),0,{type:'person',displayName:'Profile '+n,details:{}}),type:TXTypes.profile,to:profilesAddress})
})
test('connection registry stores exactly the profile pair and requires recipient consent',()=>{
 request();expect(state.connections.connections[id(3)].status).toBe('pending')
 expect(()=>run(tx('accept',alice,id(3),1))).toThrow('receiving profile')
 expect(()=>run(tx('accept',eve,id(3),1))).toThrow('receiving profile')
 run(tx('accept',bob,id(3),1));expect(state.connections.connections[id(3)]).toMatchObject({fromProfileId:id(1),toProfileId:id(2),status:'accepted',acceptedBy:owner(bob),revision:2})
})
test('request author must control the source; both profiles must exist and differ',()=>{
 for(const payload of [{fromProfileId:id(2),toProfileId:id(1)},{fromProfileId:id(1),toProfileId:id(1)},{fromProfileId:id(1),toProfileId:id(9)}])expect(()=>run(tx('create',alice,id(3),0,payload))).toThrow()
})
test('crossed requests never auto-accept; duplicate active pairs and stale revisions fail',()=>{
 request();expect(()=>run(tx('create',bob,id(4),0,{fromProfileId:id(2),toProfileId:id(1)}))).toThrow('already')
 expect(()=>run(tx('accept',bob,id(3),0))).toThrow('changed')
 run(tx('accept',bob,id(3),1));expect(()=>run(tx('create',alice,id(4),0,{fromProfileId:id(1),toProfileId:id(2)}))).toThrow('already')
})
test('cancel, decline cooldown and accepted-connection removal enforce the correct controller',()=>{
 request();expect(()=>run(tx('cancel',bob,id(3),1))).toThrow('requesting')
 run(tx('decline',bob,id(3),1));expect(()=>run(tx('create',alice,id(4),0,{fromProfileId:id(1),toProfileId:id(2)}))).toThrow('24 hours')
 run(tx('create',alice,id(4),0,{fromProfileId:id(1),toProfileId:id(2)}),now+86400000)
 run(tx('accept',bob,id(4),1),now+86400000)
 expect(()=>run(tx('remove',eve,id(4),2),now+86400000)).toThrow('controllers')
 run(tx('remove',alice,id(4),2),now+86400000);expect(state.connections.connections[id(4)].status).toBe('removed')
})
test('request payload cannot forge status or acceptance, and transfers cannot access the registry',()=>{
 expect(validateProofOfSkillShape(tx('create',alice,id(3),0,{fromProfileId:id(1),toProfileId:id(2),status:'accepted'}))).toBeDefined()
 expect(()=>assertTransactionAccountAccess({type:'transfer',from:owner(alice)},[connectionsAddress])).toThrow('protected')
 expect(()=>assertTransactionAccountAccess({type:'connection',from:connectionsAddress},[])).toThrow('cannot sign')
 const transaction=tx('create',alice,id(3),0,{fromProfileId:id(1),toProfileId:id(2)})
 expect(keys(transaction,{sourceKeys:[],targetKeys:[],allKeys:[],timestamp:now}).targetKeys).toContain(connectionsAddress)
 expect(memoryPattern(transaction).rw).toContain(connectionsAddress)
})
async function query(wallet,profileId=id(1),mutate=(e:any)=>e){
 const e:any={address:wallet.address.slice(2).toLowerCase(),networkId:WIN_NETWORK_ID,origin:'https://wallet.example',action:'connections',timestamp:now,nonce:'a'.repeat(32),data:{profileId}}
 const message='WIN Feed v1\n'+createHash('sha256').update(JSON.stringify([e.address,e.networkId,e.origin,e.action,e.timestamp,e.nonce,e.data])).digest('hex')
 e.signature=await wallet.signMessage(message);mutate(e)
 const res:any={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this},json(body){this.body=body}}
 const dapp={shardusGetTime:()=>now,log:()=>{},getLocalOrRemoteAccount:async address=>({data:address===profilesAddress?state.profiles:state.connections})}
 await connectionQuery(dapp)({body:e},res);return res
}
test('connection queries require real signatures and current profile control',async()=>{
 request();expect((await query(eve)).statusCode).toBe(403)
 expect((await query(alice,id(1),e=>{e.data.profileId=id(2)})).statusCode).toBe(401)
 expect((await query(alice,id(1),e=>{e.timestamp=1})).statusCode).toBe(401)
 const pending=await query(alice);expect(pending.statusCode).toBe(200);expect(pending.body.acceptedProfileIds).toEqual([])
 run(tx('accept',bob,id(3),1));expect((await query(alice)).body.acceptedProfileIds).toEqual([id(2)])
 run(tx('remove',bob,id(3),2));expect((await query(alice)).body.acceptedProfileIds).toEqual([])
})
test('signed connection transactions apply atomically, charge the normal metadata fee and preserve scores',async()=>{
 const handler=require('../../src/transactions/proofOfSkill'), crypto=require('../../src/crypto')
 const {userAccount}=require('../../src/accounts/userAccount'), {formulas}=require('../../src/config/formulas')
 const transaction=tx('create',alice,id(3),0,{fromProfileId:id(1),toProfileId:id(2)})
 transaction.fee=handler.proofOfSkillFee(transaction)
 const {sign,...unsigned}=transaction
 transaction.sign.sig=await alice.signMessage(crypto.hashObj(unsigned))
 const wallet=userAccount(owner(alice),now);wallet.data.balance=10n**18n
 const wrapped=Object.fromEntries([wallet,userAccount(formulas.feeRecipient,now),...Object.values(state)].map(data=>[data.id,{data,accountId:data.id,timestamp:data.timestamp,stateId:data.hash}]))
 const before=Utils.safeStringify(wrapped),scores=Utils.safeStringify(state.scores)
 expect(handler.validate(transaction,wrapped,{success:false,reason:''}).success).toBe(true)
 expect(Utils.safeStringify(wrapped)).toBe(before)
 handler.apply(transaction,now,id(91),wrapped,{applyResponseAddReceiptData(){}},{})
 expect(wallet.data.balance).toBe(10n**18n-transaction.fee)
 expect(wrapped[formulas.feeRecipient].data.data.balance).toBe(transaction.fee)
 expect(wrapped[connectionsAddress].data.connections[id(3)].status).toBe('pending')
 expect(Utils.safeStringify(wrapped[state.scores.id].data)).toBe(scores)
 const after=Utils.safeStringify(wrapped)
 expect(()=>handler.apply(transaction,now,id(92),wrapped,{applyResponseAddReceiptData(){}},{})).toThrow('already exists')
 expect(Utils.safeStringify(wrapped)).toBe(after)
})
test.each([TXTypes.profile,TXTypes.contract,TXTypes.endorsement,TXTypes.skill,TXTypes.connection])('declared %s account keys obey protected registry routing',type=>{
 const transaction:ProofOfSkillTx={...tx('create'),type:type as ProofOfSkillTx['type']}
 const declared=keys(transaction,{sourceKeys:[],targetKeys:[],allKeys:[],timestamp:now})
 expect(()=>assertTransactionAccountAccess(transaction,declared.allKeys)).not.toThrow()
 if(type!==TXTypes.connection)expect(declared.allKeys).not.toContain(connectionsAddress)
})
