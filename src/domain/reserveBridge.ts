import { keccak256, toUtf8Bytes, verifyTypedData } from 'ethers'
import { bridgeDomain, depositTypes, bridgeReserveAddress } from '../config/reserveBridge'
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
  return tx.type === 'bridge_fund' ? bridgeReserveAddress : bridgeRecordId(tx.networkId, config.vaultAddress, tx.type, tx.id)
}
