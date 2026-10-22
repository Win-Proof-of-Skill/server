import { nestedCountersInstance } from '@shardus/core'
import { Migration } from '../types'
import { WinFlags } from '../../config'

export const migrate: Migration = async () => {
  console.log('migrate 2.4.9')
  nestedCountersInstance.countEvent('migrate', 'calling migrate 2.4.9')

  WinFlags.versionFlags.updateTollRequiredTxInChatHistory = true
  WinFlags.versionFlags.supportDeductTxFeeFromAmount = true
}
