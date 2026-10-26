import { WIN_NETWORK_ID, networkAccount } from '../config'
import { reserveBridge, bridgeReserveAddress } from '../config/reserveBridge'
import { bridgeRecordId } from '../domain/reserveBridge'

export const reserveBridgeStatus =
  (dapp) =>
  async (_req, res): Promise<void> => {
    try {
      const config = reserveBridge(WIN_NETWORK_ID)
      const network = (await dapp.getLocalOrRemoteAccount(networkAccount))?.data
      if (network?.networkId !== WIN_NETWORK_ID) throw new Error('WIN network unavailable')
      const reserve = (await dapp.getLocalOrRemoteAccount(bridgeReserveAddress))?.data
      if (
        reserve &&
        (reserve.id !== bridgeReserveAddress ||
          reserve.type !== 'BridgeReserve' ||
          typeof reserve.balance !== 'bigint' ||
          reserve.balance < 0n ||
          typeof reserve.funded !== 'bigint' ||
          reserve.funded < reserve.balance)
      )
        throw new Error('Invalid reserve account')
      res.json({
        ...config,
        nativeLiquidity: reserve?.balance?.toString() || '0',
        backedWithdrawalCapacity: reserve ? (reserve.funded - reserve.balance).toString() : '0',
        operational: config.configured && config.enabled,
        missing: config.configured ? [] : ['deployed_vault', 'three_independent_operators', 'observer_endpoints', 'funded_liquidity'],
      })
    } catch (error) {
      res.status(503).json({ error: error.message })
    }
  }
export const reserveBridgeRecord =
  (dapp) =>
  async (req, res): Promise<void> => {
    try {
      if (!['bridge_deposit', 'bridge_withdraw'].includes(req.params.kind) || !/^[a-f0-9]{64}$/.test(req.params.id)) {
        res.status(400).json({ error: 'Invalid bridge event' })
        return
      }
      const config = reserveBridge(WIN_NETWORK_ID)
      if (!config.configured) {
        res.status(503).json({ error: 'Bridge not configured' })
        return
      }
      const id = bridgeRecordId(WIN_NETWORK_ID, config.vaultAddress, req.params.kind, req.params.id)
      const record = (await dapp.getLocalOrRemoteAccount(id, { useRICache: false, canThrowException: true }))?.data
      res.json({
        networkId: WIN_NETWORK_ID,
        record: record?.type === 'BridgeRecord' && record.completed ? { ...record, amount: record.amount.toString(), fee: record.fee.toString() } : null,
      })
    } catch (error) {
      res.status(503).json({ error: 'Unable to read bridge record' })
    }
  }
