import * as crypto from '@shardus/lib-crypto-utils'
import type { SkillsAccount } from '../@types'
import { skillsAddress } from '../config'

export function skillsAccount(): SkillsAccount {
  const account: SkillsAccount = {
    id: skillsAddress,
    type: 'SkillsAccount',
    hash: '',
    timestamp: 0,
    schemaVersion: 1,
    revision: 0,
    skills: {},
  }

  account.hash = crypto.hashObj(account)

  return account
}