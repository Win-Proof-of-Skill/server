// Unrestricted minting and preset genesis wallet allocations are disabled.
// Any external-token funding mechanism must be implemented and authorized separately.
import { Shardus, ShardusTypes } from '@shardus/core'
import { Tx, WrappedStates } from '../@types'
const reason = 'Unrestricted create transactions are disabled; use authorized issuance'
export const validate_fields = (_tx: Tx.Create, response: ShardusTypes.IncomingTransactionResult) => {
  response.success = false
  response.reason = reason
  return response
}
export const validate = (_tx: Tx.Create, _states: WrappedStates, response: ShardusTypes.IncomingTransactionResult, _dapp?: Shardus) => validate_fields(_tx, response)
export const apply = (..._args: unknown[]): never => { throw new Error(reason) }
export const createRelevantAccount = (..._args: unknown[]): never => { throw new Error(reason) }
export const keys = (_tx: Tx.Create, _result: ShardusTypes.TransactionKeys): ShardusTypes.TransactionKeys => { throw new Error(reason) }
export const memoryPattern = (..._args: unknown[]): ShardusTypes.ShardusMemoryPatternsInput => { throw new Error(reason) }
export const createFailedAppReceiptData = (_tx: Tx.Create, _time: number, _id: string, _states: WrappedStates, dapp: Shardus, response: ShardusTypes.ApplyResponse): void => {
  dapp.applyResponseSetFailed(response, reason)
}
