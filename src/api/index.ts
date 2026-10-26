import { proofOfSkillRecord, proofOfSkillDirectory } from './proofOfSkill'
import { bridgeStatus } from './bridge'
import { inject } from './inject'
import network from './network'
import accounts from './accounts'
import messages from './messages'
import debug from './debug'
import staking from './staking'
import node from './node'
import { handlePutAdminCertificate } from './admin_certificate'
import { debug_win_flags, set_win_flag } from './win_flags'
import dao from './dao'
import { Shardus } from '@shardus/core'
export default (dapp: Shardus): void => {
  dapp.registerExternalPost('inject', inject(dapp))
  dapp.registerExternalGet('profiles/:id', proofOfSkillRecord(dapp, 'profiles'))
  dapp.registerExternalGet('contracts/:id', proofOfSkillRecord(dapp, 'contracts'))
  dapp.registerExternalGet('scores/:id', proofOfSkillRecord(dapp, 'scores'))
  for (const kind of ['profiles', 'contracts', 'skills', 'endorsements'] as const) {
    if (kind === 'skills' || kind === 'endorsements') dapp.registerExternalGet(`${kind}/:id`, proofOfSkillRecord(dapp, kind))
    dapp.registerExternalGet(kind, proofOfSkillDirectory(dapp, kind))
  }

  dapp.registerExternalGet('network/parameters', network.current(dapp))
  dapp.registerExternalGet('bridge/status', bridgeStatus(dapp))

  // New DAO API routes — Shardus applies registerExternalGet routes in LIFO order
  // (last registered = first matched in Express), so register specific paths last.
  dapp.registerExternalGet('dao/proposals/:id', dao.proposals.get(dapp))
  dapp.registerExternalGet('dao/proposals/meta', dao.proposals.meta(dapp))
  dapp.registerExternalGet('dao/proposals/summary', dao.proposals.summary(dapp))
  dapp.registerExternalGet('dao/projects/:id', dao.proposals.project(dapp))
  dapp.registerExternalGet('dao/projects/:id/logs', dao.proposals.projectLogs(dapp))
  dapp.registerExternalGet('dao/voters/:proposalId', dao.voters.list(dapp))

  dapp.registerExternalGet('account/:id', accounts.account(dapp))
  dapp.registerExternalGet('account/:id/alias', accounts.alias(dapp))
  dapp.registerExternalGet('account/:id/balance', accounts.balance(dapp))
  dapp.registerExternalGet('account/:id/toll', accounts.toll(dapp))
  dapp.registerExternalGet('address/:name', accounts.address(dapp))
  dapp.registerExternalGet('account/:id/recentMessages', accounts.recentMessages(dapp))
  dapp.registerExternalGet('account/:id/chats/:timestamp', accounts.chats(dapp))
  // dapp.registerExternalGet('accounts', accounts.all(dapp))

  dapp.registerExternalGet('transaction/:id', accounts.transactions(dapp))

  dapp.registerExternalGet('messages/:chatId/:timestamp', messages.messages(dapp))
  dapp.registerExternalGet('messages/:chatId/toll', messages.toll(dapp))

  dapp.registerExternalGet('timestamp', (req, res) => {
    res.json({ timestamp: dapp.shardusGetTime() })
  })

  dapp.registerExternalGet('debug/dump', debug.dump(dapp))
  dapp.registerExternalPost('debug/exit', debug.exit)

  dapp.registerExternalGet('stake', staking.stake())
  dapp.registerExternalGet('canStake/:nominee', staking.canStake(dapp))
  dapp.registerExternalGet('canUnstake/:nominee/:nominator', staking.canUnstake(dapp))

  dapp.registerExternalGet('node/rotation', node.rotationInfo(dapp))

  dapp.registerExternalPut('query-certificate', staking.queryCertificate(dapp))
  dapp.registerExternalPut('admin-certificate', handlePutAdminCertificate(dapp))

  // Win Flags
  dapp.registerExternalGet('debug-win-flags', debug_win_flags(dapp))
  dapp.registerExternalGet('debug-set-win-flag', set_win_flag(dapp))
}
