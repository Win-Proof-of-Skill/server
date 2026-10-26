import * as crypto from '@shardus/lib-crypto-utils'
import type { EndorsementsAccount } from '../@types'
import { endorsementsAddress } from '../config'

export function endorsementsAccount(): EndorsementsAccount {
  const account: EndorsementsAccount = {
    id: endorsementsAddress,
    type: 'EndorsementsAccount',
    hash: '',
    timestamp: 0,
    schemaVersion: 1,
    revision: 0,
    endorsements: {},
  }

  account.hash = crypto.hashObj(account)

  return account
}