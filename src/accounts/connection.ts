import * as crypto from '@shardus/lib-crypto-utils'
import type { ConnectionsAccount } from '../@types'
import { connectionsAddress } from '../config'
export function connectionsAccount(): ConnectionsAccount {
  const account: ConnectionsAccount = { id: connectionsAddress, type: 'ConnectionsAccount', hash: '', timestamp: 0, schemaVersion: 1, revision: 0, connections: {} }
  account.hash = crypto.hashObj(account)
  return account
}
