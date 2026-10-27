import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import ganache from 'ganache'
import { BrowserProvider, ContractFactory, Wallet } from 'ethers'
import { compile } from '../compile.mjs'
import { ACCOUNTING, domain, types, withdrawalEvidence, depositEvidence } from '../operator.mjs'
const require = createRequire(import.meta.url)
const { Utils } = require('@shardus/lib-types')
const crypto = require('../../dist/crypto')
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
crypto.setCustomStringifier(Utils.safeStringify)
const config = require('../../dist/config/reserveBridge')
const { WIN_NETWORK_ID, networkAccount, WinFlags } = require('../../dist/config')
WinFlags.VerboseLogs = false
const { formulas } = require('../../dist/config/formulas')
const handler = require('../../dist/transactions/bridge')
const { serializeAccounts, deserializeAccounts } = require('../../dist/accounts')
const api = require('../../dist/api/reserveBridge')
test('unchanged vault locks WIN, native handler issues from zero, committed burn authorizes exactly one BNB release', async () => {
  const output = compile({
    'Token.sol': {
      content:
        'pragma solidity ^0.8.24; import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; contract Token is ERC20 { constructor() ERC20("Test WIN","WIN"){_mint(msg.sender,1000 ether);} }',
    },
  })
  const chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 56 }, wallet: { deterministic: true } })
  const previous = config.reserveBridge
  const provider = new BrowserProvider(chain)
  provider.pollingInterval = 10
  try {
    const owner = await provider.getSigner(),
      operators = [1, 2, 3].map((i) => new Wallet(i.toString(16).padStart(64, '0')))
    const nativeSigner = operators[0],
      from = nativeSigner.address.toLowerCase().slice(2) + '0'.repeat(24)
    const deploy = async (file, name, args = []) => {
      const a = output[file][name],
        contract = await new ContractFactory(a.abi, a.evm.bytecode.object, owner).deploy(...args)
      await contract.waitForDeployment()
      return contract
    }
    const token = await deploy('Token.sol', 'Token')
    const vault = await deploy('WINBridge.sol', 'WINBridge', [await token.getAddress(), '0x' + WIN_NETWORK_ID, operators.map((w) => w.address)])
    const c = {
      networkId: WIN_NETWORK_ID,
      vaultAddress: (await vault.getAddress()).toLowerCase(),
      operators: operators.map((w) => w.address.toLowerCase()),
      configured: true,
      enabled: true,
      accounting: ACCOUNTING,
      nativeGatewayMode: 'single',
      nativeGateways: ['http://127.0.0.1:3030'],
      referenceToken: { address: (await token.getAddress()).toLowerCase() },
    }
    config.reserveBridge = () => c
    const amount = 100n * 10n ** 18n
    await (await token.approve(c.vaultAddress, amount)).wait()
    const locked = await (await vault.deposit(amount, '0x' + from)).wait()
    const evidence = await depositEvidence(provider, vault, c, locked.hash)
    assert.equal(evidence.amount, amount.toString())
    assert.equal(await token.balanceOf(c.vaultAddress), amount)
    let states = {}
    const receipts = {}
    const dapp = {
      createWrappedResponse: (accountId, _created, _hash, _time, data) => ({ accountId, data }),
      applyResponseAddReceiptData: (_response, receipt) => {
        receipts[receipt.txId] = receipt
      },
      getLocalOrRemoteAccount: async (id) => (id === networkAccount ? { data: { networkId: WIN_NETWORK_ID } } : states[id]),
    }
    const submit = async (tx) => {
      tx.sign = { owner: from, sig: await nativeSigner.signMessage(crypto.hashObj(tx)) }
      for (const id of handler.keys(tx, {}).allKeys) states[id] ??= handler.createRelevantAccount(dapp, null, id, tx)
      const validated = handler.validate(tx, states, {})
      assert.equal(validated.success, true, validated.reason)
      handler.apply(tx, Date.now(), crypto.hashObj(tx), states, dapp, {})
    }
    const deposit = {
      type: 'bridge_deposit',
      from,
      to: config.bridgeReserveAddress,
      networkId: WIN_NETWORK_ID,
      amount,
      fee: amount / 200n,
      nonce: 1,
      timestamp: Date.now(),
      id: evidence.id.slice(2),
      signatures: await Promise.all(operators.slice(0, 2).map((w) => w.signTypedData(domain(c), { Deposit: types.Deposit }, evidence))),
    }
    await submit(deposit)
    assert.equal(states[from].data.data.balance, amount - deposit.fee)
    assert.equal(states[formulas.feeRecipient].data.data.balance, deposit.fee)
    assert.equal(states[config.bridgeReserveAddress].data.minted, amount)
    // A persisted/reloaded ledger and event still reject the original deposit.
    states = Object.fromEntries(Object.entries(states).map(([id, w]) => [id, { ...w, data: deserializeAccounts(serializeAccounts(w.data).getBuffer()) }]))
    assert.equal(handler.validate(deposit, states, {}).success, false)
    const read = async (url) => {
      if (url.includes('/transaction/')) return JSON.parse(Utils.safeStringify({ transaction: receipts[url.split('/').at(-1)] }))
      const res = {
        status() {
          return this
        },
        json(body) {
          this.body = body
        },
      }
      await api.reserveBridgeRecord(dapp)({ params: { kind: 'bridge_withdraw', id: url.split('/').at(-1) } }, res)
      return JSON.parse(Utils.safeStringify(res.body))
    }
    const withdrawal = {
      type: 'bridge_withdraw',
      from,
      to: config.bridgeReserveAddress,
      networkId: WIN_NETWORK_ID,
      amount: 99n * 10n ** 18n,
      fee: 495n * 10n ** 15n,
      nonce: 2,
      timestamp: Date.now(),
      id: 'f'.repeat(64),
      recipient: (await owner.getAddress()).toLowerCase(),
    }
    await assert.rejects(withdrawalEvidence(c, withdrawal.id, read), /gateway/)
    await submit(withdrawal)
    const ledger = states[config.bridgeReserveAddress].data
    assert.equal(ledger.burned, withdrawal.amount)
    const proof = await withdrawalEvidence(c, withdrawal.id, read)
    const signatures = await Promise.all(operators.slice(0, 2).map((w) => w.signTypedData(domain(c), { Withdrawal: types.Withdrawal }, proof)))
    await (await vault.release(proof.id, proof.recipient, proof.amount, signatures)).wait()
    assert.equal(await token.balanceOf(c.vaultAddress), ledger.minted - ledger.burned)
    assert.equal(states[from].data.data.balance + states[formulas.feeRecipient].data.data.balance, ledger.minted - ledger.burned)
    await assert.rejects(vault.release(proof.id, proof.recipient, proof.amount, signatures))
    assert.equal(handler.validate(withdrawal, states, {}).success, false)
  } finally {
    config.reserveBridge = previous
    provider.destroy()
    await chain.disconnect()
  }
})
