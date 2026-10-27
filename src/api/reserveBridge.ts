import { WIN_NETWORK_ID, networkAccount } from '../config'
import { reserveBridge, bridgeReserveAddress } from '../config/reserveBridge'
import { bridgeRecordId, bridgeSupply } from '../domain/reserveBridge'

export const reserveBridgeStatus =
  (dapp) =>
  async (_req, res): Promise<void> => {
    try {
      const config = reserveBridge(WIN_NETWORK_ID)
      const network = (await dapp.getLocalOrRemoteAccount(networkAccount))?.data
      if (network?.networkId !== WIN_NETWORK_ID) throw new Error('WIN network unavailable')
      const reserve = (await dapp.getLocalOrRemoteAccount(bridgeReserveAddress))?.data
      const supply = bridgeSupply(reserve, config)
      res.json({
        ...config,
        nativeMinted: supply.minted.toString(),
        nativeBurned: supply.burned.toString(),
        nativeOutstanding: (supply.minted - supply.burned).toString(),
        backedWithdrawalCapacity: (supply.minted - supply.burned).toString(),
        requiresNativePrefunding: false,
        operational: config.configured && config.enabled,
        missing: config.configured ? [] : ['deployed_vault', 'three_operators', 'observer_endpoints'],
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
        record:
          record?.type === 'BridgeRecord' && record.completed
            ? {
                ...record,
                amount: record.amount.toString(),
                fee: record.fee.toString(),
                nativeMinted: record.nativeMinted?.toString(),
                nativeBurned: record.nativeBurned?.toString(),
              }
            : null,
      })
    } catch (error) {
      res.status(503).json({ error: 'Unable to read bridge record' })
    }
  }
