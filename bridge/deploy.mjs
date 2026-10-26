// Run explicitly after reviewing deployment parameters. This spends BNB gas.
import fs from 'node:fs'
import { JsonRpcProvider, Wallet, ContractFactory, keccak256 } from 'ethers'
const c = JSON.parse(fs.readFileSync(process.env.WIN_BRIDGE_DEPLOYMENT, 'utf8'))
if (!/^[a-f0-9]{64}$/.test(c.networkId) || c.operators?.length !== 3) throw new Error('Network and three operators required')
if (process.env.CONFIRM_WIN_MAINNET_DEPLOYMENT !== 'yes') throw new Error('Set CONFIRM_WIN_MAINNET_DEPLOYMENT=yes only after reviewing configuration')
const provider = new JsonRpcProvider(c.bnbRpc)
if ((await provider.getNetwork()).chainId !== 56n) throw new Error('BNB mainnet required')
const signer = new Wallet(process.env.WIN_BRIDGE_DEPLOYER_KEY, provider)
const artifact = JSON.parse(fs.readFileSync(new URL('./artifacts/WINBridge.json', import.meta.url)))
const vault = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(
  '0x8a27363dd26f78b09014338e106b16055fcb9799',
  '0x' + c.networkId,
  c.operators,
)
await vault.waitForDeployment()
const vaultAddress = (await vault.getAddress()).toLowerCase()
console.log(
  JSON.stringify({ vaultAddress, vaultCodeHash: keccak256(await provider.getCode(vaultAddress)), networkId: c.networkId, operators: c.operators }, null, 2),
)
