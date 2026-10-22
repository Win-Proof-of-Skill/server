import { nestedCountersInstance, Shardus } from '@shardus/core'
import { putAdminCertificateHandler } from '../../transactions/admin_certificate'
import { WinFlags } from '../../config'
import { logFlags } from '@shardus/core/dist/logger'

export const handlePutAdminCertificate =
  (dapp: Shardus) =>
  async (req, res): Promise<void> => {
    try {
      nestedCountersInstance.countEvent('win-admin-certificate', 'called PUT admin-certificate')

      const certRes = await putAdminCertificateHandler(req, dapp)
      if (WinFlags.VerboseLogs) console.log('certRes', certRes)
      if (certRes.success) {
        nestedCountersInstance.countEvent('win-admin-certificate', `putAdminCertificateHandler success`)
      } else {
        nestedCountersInstance.countEvent('win-admin-certificate', `putAdminCertificateHandler failed with reason: ${certRes.reason}`)
      }

      res.json(certRes)
    } catch (error) {
      if (logFlags.error) console.error('Error in processing admin-certificate request:', error)
      res.status(500).json({ error: 'Internal Server Error' })
    }
  }
