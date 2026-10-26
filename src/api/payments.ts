import { Shardus } from '@shardus/core'
/** Native payment history remains available when messaging is removed from clients. */
export const paymentMessages =
  (dapp: Shardus) =>
  async (req, res): Promise<void> => {
    try {
      const { chatId, timestamp } = req.params
      if (!/^[a-f0-9]{64}$/.test(chatId) || !/^\d{1,16}$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
        res.status(400).json({ error: 'Invalid payment history request' })
        return
      }
      const account: any = (await dapp.getLocalOrRemoteAccount(chatId))?.data
      if (!account || account.type !== 'ChatAccount' || account.id !== chatId) {
        res.json({ messages: [] })
        return
      }
      res.json({ messages: account.messages.filter((tx) => tx.type === 'transfer' && tx.timestamp >= Number(timestamp)) })
    } catch (_) {
      res.status(503).json({ error: 'Unable to read payment history' })
    }
  }
