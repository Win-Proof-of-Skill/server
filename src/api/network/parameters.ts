import { formulas } from '../../config/formulas'
import * as configs from '../../config'
import {NetworkAccount} from '../../@types'

export const current = dapp => async (req, res): Promise<void> => {
  try {
    const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
    const network: NetworkAccount = account.data
    res.json({
      protocol: {
        networkId: configs.WIN_NETWORK_ID,
        currency: 'WIN',
        decimals: 18,
        transferFeeBps: formulas.transferFeeBps,
        feeRecipient: formulas.feeRecipient,
        transferNonceRequired: true,
        proofOfSkill: { rulesVersion: formulas.rulesVersion, scoreScale: formulas.scoreScale,
          contractFee: formulas.contractFee.toString(), endorsementFee: formulas.endorsementFee.toString(),
          baseFee: formulas.baseFee.toString(), feePerKiB: formulas.feePerKiB.toString() },
        registryAddresses: configs.proofOfSkillAddresses,
      },
      parameters: {
        current: network.current,
        listOfChanges: network.listOfChanges,
      },
    })
  } catch (error) {
    dapp.log(error)
    res.json({ error })
  }
}
