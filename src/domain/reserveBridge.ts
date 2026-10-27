import { keccak256, toUtf8Bytes, verifyTypedData } from 'ethers'
import { bridgeDomain, depositTypes, bridgeReserveAddress, bridgeAccounting } from '../config/reserveBridge'
import { transferFee } from '../config/formulas'

export const bridgeRecordId = (networkId: string, vault: string, kind: string, id: string): string =>
  keccak256(toUtf8Bytes(`WINBridge:1:${networkId}:${vault.toLowerCase()}:${kind}:${id}`)).slice(2)
export function bridgeQuote(amount: bigint, direction: string) {
  if (typeof amount !== 'bigint' || amount <= 0n || amount > 10n ** 27n) throw new Error('Invalid bridge amount')
  const fee = transferFee(amount)
  if (direction === 'bridge_deposit' && amount <= fee) throw new Error('Deposit must exceed the native fee')
  return { fee, debit: direction === 'bridge_deposit' ? amount : amount + fee, receive: direction === 'bridge_deposit' ? amount - fee : amount }
}
export function verifyDeposit(tx: any, config: any): void {
  if (!Array.isArray(tx.signatures) || tx.signatures.length !== 2) throw new Error('Two independent deposit signatures required')
  const value = { id: '0x' + tx.id, recipient: '0x' + tx.from, amount: tx.amount }
  const recovered = tx.signatures.map((signature) =>
    verifyTypedData(bridgeDomain(config.networkId, config.vaultAddress), depositTypes, value, signature).toLowerCase(),
  )
  if (new Set(recovered).size !== 2 || recovered.some((a) => !config.operators.includes(a))) throw new Error('Invalid deposit quorum')
}
export function bridgeRecord(tx: any, config: any): string {
  return bridgeRecordId(tx.networkId, config.vaultAddress, tx.type, tx.id)
}

// The protected account is now a supply ledger, not a wallet holding native coins.
// Read-only validation: a failed transaction must not initialize or change state.
export function bridgeSupply(account: any, config: any): { minted: bigint; burned: bigint } {
  if (!account) return { minted: 0n, burned: 0n }
  if (account.id !== bridgeReserveAddress || account.type !== 'BridgeReserve') throw new Error('Invalid bridge supply ledger')
  if (account.accounting === undefined) {
    if (account.balance === 0n && account.funded === 0n && account.timestamp === 0 && account.minted === undefined && account.burned === undefined)
      return { minted: 0n, burned: 0n }
    throw new Error('Legacy bridge reserve has activity; an explicit migration is required')
  }
  if (
    account.accounting !== bridgeAccounting ||
    account.networkId !== config.networkId ||
    account.vaultAddress !== config.vaultAddress ||
    typeof account.minted !== 'bigint' ||
    typeof account.burned !== 'bigint' ||
    account.minted < 0n ||
    account.burned < 0n ||
    account.burned > account.minted ||
    (account.balance !== undefined && account.balance !== 0n) ||
    (account.funded !== undefined && account.funded !== 0n)
  )
    throw new Error('Invalid bridge supply ledger')
  return { minted: account.minted, burned: account.burned }
}
