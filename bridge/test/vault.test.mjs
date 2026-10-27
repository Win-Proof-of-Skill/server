import test from 'node:test'
import assert from 'node:assert/strict'
import ganache from 'ganache'
import { BrowserProvider, ContractFactory, Wallet, Interface } from 'ethers'
import { compile } from '../compile.mjs'
import { domain, types, withdrawalEvidence, depositEvidence } from '../operator.mjs'
const output = compile({
  'Token.sol': {
    content:
      'pragma solidity ^0.8.24; import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; contract Token is ERC20 { constructor() ERC20("Test WIN","WIN"){_mint(msg.sender,1000000 ether);} }',
  },
})
test('real EVM lock/release preserves tokens and rejects replay, duplicate signatures and cross-domain signatures', async () => {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { deterministic: true } })
  try {
    const provider = new BrowserProvider(chain)
    provider.pollingInterval = 10
    const owner = await provider.getSigner(),
      operators = [1, 2, 3].map((i) => new Wallet(i.toString(16).padStart(64, '0')))
    const deploy = async (file, name, args = []) => {
      const a = output[file][name],
        c = await new ContractFactory(a.abi, a.evm.bytecode.object, owner).deploy(...args)
      await c.waitForDeployment()
      return c
    }
    const token = await deploy('Token.sol', 'Token'),
      networkId = 'a'.repeat(64),
      vault = await deploy('WINBridge.sol', 'WINBridge', [await token.getAddress(), '0x' + networkId, operators.map((w) => w.address)])
    const c = { networkId, vaultAddress: await vault.getAddress() }
    const recipient = (await owner.getAddress()).toLowerCase(),
      native = '0x' + recipient.slice(2) + '0'.repeat(24),
      amount = 100n * 10n ** 18n
    await (await token.approve(c.vaultAddress, amount)).wait()
    const deposit = await (await vault.deposit(amount, native)).wait()
    const event = deposit.logs
      .map((l) => {
        try {
          return vault.interface.parseLog(l)
        } catch {
          return null
        }
      })
      .find((e) => e?.name === 'Deposited')
    assert.equal(event.args.amount, amount)
    assert.equal(await token.balanceOf(c.vaultAddress), amount)
    const v = { id: '0x' + 'b'.repeat(64), recipient, amount: 99n * 10n ** 18n }
    const sigs = await Promise.all(operators.slice(0, 2).map((w) => w.signTypedData(domain(c), { Withdrawal: types.Withdrawal }, v)))
    await assert.rejects(vault.release(v.id, recipient, v.amount, [sigs[0], sigs[0]]))
    await assert.rejects(vault.release(v.id, recipient, v.amount + 1n, sigs))
    const other = await operators[1].signTypedData(domain({ ...c, networkId: 'c'.repeat(64) }), { Withdrawal: types.Withdrawal }, v)
    await assert.rejects(vault.release(v.id, recipient, v.amount, [sigs[0], other]))
    const before = await token.balanceOf(recipient)
    await (await vault.release(v.id, recipient, v.amount, sigs)).wait()
    assert.equal(await token.balanceOf(recipient), before + v.amount)
    assert.equal(await token.balanceOf(c.vaultAddress), amount - v.amount)
    await assert.rejects(vault.release(v.id, recipient, v.amount, sigs))
    assert.equal(await vault.released(v.id), true)
    await assert.rejects(vault.deposit(1n, native))
  } finally {
    await chain.disconnect()
  }
})
test('operator refuses unfinalized, reverted and noncanonical BNB deposits', async () => {
  const c = { vaultAddress: '0x' + '1'.repeat(40) },
    hash = '0x' + 'a'.repeat(64)
  const receipt = { status: 1, blockNumber: 10, blockHash: 'canonical', logs: [] }
  const provider = { getTransactionReceipt: async () => receipt, send: async (_m, args) => (args[0] === 'finalized' ? { number: '0x9' } : { hash: 'wrong' }) }
  await assert.rejects(depositEvidence(provider, {}, c, hash), /not finalized/)
  provider.send = async (_m, args) => (args[0] === 'finalized' ? { number: '0xa' } : { hash: 'wrong' })
  await assert.rejects(depositEvidence(provider, {}, c, hash), /Noncanonical/)
  receipt.status = 0
  await assert.rejects(depositEvidence(provider, {}, c, hash), /not finalized/)
})
test('operator requires matching committed withdrawal and receipt from two trusted native gateways', async () => {
  const id = 'a'.repeat(64),
    c = { networkId: 'b'.repeat(64), vaultAddress: '0x' + 'c'.repeat(40), nativeGateways: ['https://one', 'https://two', 'https://three'] }
  const record = {
    id: 'd'.repeat(64),
    completed: true,
    type: 'BridgeRecord',
    networkId: c.networkId,
    vaultAddress: c.vaultAddress,
    eventId: id,
    operation: 'bridge_withdraw', accounting: 'deposit-backed-v1', nativeMinted: '0', nativeBurned: '100',
    from: 'f'.repeat(64),
    recipient: '0x' + 'e'.repeat(40),
    amount: '100',
    txId: 'tx',
  }
  const receipt = {
    success: true,
    txId: 'tx',
    networkId: c.networkId,
    type: 'bridge_withdraw',
    from: record.from,
    additionalInfo: { recordId: record.id, bridgeId: id, accounting: 'deposit-backed-v1', nativeMinted: '0', nativeBurned: '100', amount: '100' },
  }
  const read = async (url) => (url.includes('/transaction/') ? { transaction: receipt } : { networkId: c.networkId, record })
  assert.equal((await withdrawalEvidence(c, id, read)).amount, '100')
  receipt.success = false
  await assert.rejects(withdrawalEvidence(c, id, read), /Two trusted/)
})
