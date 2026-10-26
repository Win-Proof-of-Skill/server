import * as crypto from '@shardus/lib-crypto-utils'
import type { ContractsAccount } from '../@types'
import { contractsAddress } from '../config'

export function contractsAccount(): ContractsAccount {
  const account: ContractsAccount = {
    id: contractsAddress,
    type: 'ContractsAccount',
    hash: '',
    timestamp: 0,
    schemaVersion: 1,
    revision: 0,
    contracts: {},
  }

  account.hash = crypto.hashObj(account)

  return account
}