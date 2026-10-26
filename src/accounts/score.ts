import * as crypto from '@shardus/lib-crypto-utils'
import type { ScoresAccount } from '../@types'
import { scoresAddress } from '../config'

export function scoresAccount(): ScoresAccount {
  const account: ScoresAccount = {
    id: scoresAddress,
    type: 'ScoresAccount',
    hash: '',
    timestamp: 0,
    schemaVersion: 1,
    revision: 0,
    scores: {},
  }

  account.hash = crypto.hashObj(account)

  return account
}