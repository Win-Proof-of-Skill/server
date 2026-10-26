import * as crypto from '@shardus/lib-crypto-utils'
import type { ProfilesAccount } from '../@types'
import { profilesAddress } from '../config'

export function profilesAccount(): ProfilesAccount {
  const account: ProfilesAccount = {
    id: profilesAddress,
    type: 'ProfilesAccount',
    hash: '',
    timestamp: 0,
    schemaVersion: 1,
    revision: 0,
    profiles: {},
  }

  account.hash = crypto.hashObj(account)

  return account
}