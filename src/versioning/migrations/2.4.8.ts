import { nestedCountersInstance } from '@shardus/core'
import { Migration } from '../types'
import { WinFlags } from '../../config'

export const migrate: Migration = async () => {
  console.log('migrate 2.4.8')
  nestedCountersInstance.countEvent('migrate', 'calling migrate 2.4.8')

  WinFlags.versionFlags.weiToWinStringFormat = true
  WinFlags.versionFlags.nodeRewardedStatusCheck = true
  WinFlags.versionFlags.includeTxToKeyInReadTx = true
}
