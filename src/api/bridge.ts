import { networkAccount, WIN_NETWORK_ID } from '../config'
import { bridgeConfiguration } from '../config/bridgeConfig'

/** Diagnostic reads only; neither account creation nor bridge payout authorization. */
export const bridgeStatus = (dapp, configuration = bridgeConfiguration(WIN_NETWORK_ID)) => async (_req, res): Promise<void> => {
  try {
    const network = (await dapp.getLocalOrRemoteAccount(networkAccount))?.data
    if (!network || network.networkId !== configuration.networkId) {
      res.status(503).json({ error: 'Matching WIN network account is not available' })
      return
    }
    const reserve = configuration.reserveAddress ? (await dapp.getLocalOrRemoteAccount(configuration.reserveAddress))?.data : null
    if (reserve && (reserve.id !== configuration.reserveAddress || reserve.type !== 'UserAccount' || reserve.private === true ||
        typeof reserve.data?.balance !== 'bigint' || reserve.data.balance < 0n ||
        !Number.isSafeInteger(reserve.data.transferNonce ?? 0) || (reserve.data.transferNonce ?? 0) < 0)) {
      res.status(503).json({ error: 'Bridge reserve must be a public WIN wallet with a valid balance and payment nonce' })
      return
    }
    const missing = []
    if (!configuration.tssAddress) missing.push('tss_address')
    if (!configuration.vaultAddress) missing.push('bsc_vault_address')
    if (configuration.reserveCapAtomic === null) missing.push('reserve_cap')
    if (!configuration.observerUrls.length) missing.push('observer_urls')
    if (!reserve || reserve.data.balance === 0n) missing.push('funded_native_reserve')
    res.json({
      ...configuration,
      operational: false,
      reserve: {
        accountExists: Boolean(reserve),
        balanceAtomic: reserve ? reserve.data.balance.toString() : null,
        transferNonce: reserve ? (reserve.data.transferNonce ?? 0) : null,
        withinConfiguredCap: reserve && configuration.reserveCapAtomic !== null ? reserve.data.balance <= BigInt(configuration.reserveCapAtomic) : null,
      },
      missing,
      pendingImplementation: ['reserve_funding_and_cap_enforcement', 'bsc_vault_integration', 'observers_and_tss', 'durable_source_event_replay_protection', 'round_trip_verification'],
    })
  } catch (error) {
    dapp.log(error)
    res.status(503).json({ error: 'Unable to read bridge status' })
  }
}
