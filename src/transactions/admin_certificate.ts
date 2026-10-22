import { Shardus, ShardusTypes, nestedCountersInstance } from '@shardus/core'
import { logFlags } from '@shardus/core/dist/logger'
import { Utils } from '@shardus/lib-types'
import config, { WinFlags } from '../config'
import * as crypto from '../crypto'
import { Request } from 'express'
import { DevSecurityLevel } from '@shardus/core'
import { GoldenTicketRequest, NetworkAccount } from '../@types'
import { shardusPost } from '../utils/request'
import * as utils from '../utils'

export interface AdminCert {
  nominee: string
  certCreation: number
  certExp: number
  sign: ShardusTypes.Sign
  goldenTicket: boolean
}

export interface AdminCertResponse {
  success: boolean
  ticket?: AdminCert
  error?: string
  cached?: boolean
}

export interface GoldenTicketFetchResult {
  ticket?: AdminCert
  error?: string
  retryable: boolean
  terminal: boolean
}

export type PutAdminCertRequest = AdminCert

export interface PutAdminCertResult {
  success: boolean
  reason?: string // error message if failed
}

export let adminCert: AdminCert = null
export let isRequestedAdminCert: boolean = false

let nextGoldenTicketRetryAt = 0
let isGoldenTicketRetry = false
let isGoldenTicketFetchInProgress = false

export function isTerminalGoldenTicketError(error?: string): boolean {
  if (!error) return false
  const normalizedError = error.toLowerCase()
  return (
    normalizedError.includes('schema validation failed') ||
    normalizedError.includes('invalid request format') ||
    normalizedError.includes('public key not registered') ||
    normalizedError.includes('inactive') ||
    normalizedError.includes('validator not found') ||
    normalizedError.includes('nonce cannot be empty') ||
    normalizedError.includes('nonce must be') ||
    normalizedError.includes('port must be between') ||
    normalizedError.includes('signature owner does not match registered public key') ||
    normalizedError.includes('invalid signature') ||
    normalizedError.includes('signature validation failed')
  )
}

function createGoldenTicketFetchResult(error?: string): GoldenTicketFetchResult {
  const terminal = isTerminalGoldenTicketError(error)
  return {
    error,
    retryable: !terminal,
    terminal,
  }
}

function validatePutAdminCertRequest(req: PutAdminCertRequest, shardus: Shardus): PutAdminCertResult {
  const publicKey = shardus.crypto.getPublicKey()

  if (utils.isValidAddress(req.nominee) === false) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('win-admin-certificate', `validatePutAdminCertRequest fail req.nominee address invalid`)
    /* prettier-ignore */ if (WinFlags.VerboseLogs) console.log('validatePutAdminCertRequest fail req.nominee address invalid', req)
    return { success: false, reason: 'Invalid nominee address' }
  }
  if (req.nominee != publicKey) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('win-admin-certificate', `validatePutAdminCertRequest fail req.nominee address and the current node public key do not match`)
    /* prettier-ignore */ if (WinFlags.VerboseLogs) console.log('validatePutAdminCertRequest fail req.nominee address and the current node public key do not match', req)
    return { success: false, reason: 'nominee address and the current node public key do not match' }
  }
  try {
    if (!crypto.verifyObj(req, true)) return { success: false, reason: 'Invalid signature for AdminCert' }
  } catch (e) {
    return { success: false, reason: 'Invalid signature for QueryCert tx' }
  }
  try {
    const pkClearance = shardus.getDevPublicKey(req.sign.owner)

    if (pkClearance == null) {
      return { success: false, reason: 'Unauthorized! no getDevPublicKey defined' }
    }

    if (pkClearance && (!shardus.crypto.verify(req, pkClearance) || shardus.ensureKeySecurity(pkClearance, DevSecurityLevel.High) === false))
      return { success: false, reason: 'Unauthorized! Please use higher level auth key.' }
  } catch (e) {
    return { success: false, reason: 'Invalid signature for QueryCert tx' }
  }

  return { success: true, reason: '' }
}

export async function putAdminCertificateHandler(req: Request, shardus: Shardus): Promise<PutAdminCertResult> {
  nestedCountersInstance.countEvent('win-admin-certificate', 'calling putAdminCertificateHandler')

  const certReq = req.body as PutAdminCertRequest
  const reqValidationResult = validatePutAdminCertRequest(certReq, shardus)
  if (!reqValidationResult.success) {
    nestedCountersInstance.countEvent('win-admin-certificate', 'putAdminCertificateHandler: failed validateQueryCertRequest')
    return reqValidationResult
  }
  adminCert = certReq
  return { success: true }
}

export async function tryAndFetchGoldenTicket(publicKey: string, network: NetworkAccount, dapp: Shardus, isRetry = false): Promise<GoldenTicketFetchResult> {
  try {
    if (WinFlags.VerboseLogs) console.log('Fetching golden ticket from', network.current.goldenTicketServerUrl, 'for publicKey', publicKey, 'node')
    const goldenTicketRequest: any = {
      publicKey,
      ip: config.server.ip.externalIp,
      port: config.server.ip.externalPort,
      timestamp: dapp.shardusGetTime() + (isRetry ? 1000 : 0),
      nonce: Math.floor(Math.random() * 1e6),
    }
    const signedGoldenTicketRequest: GoldenTicketRequest = dapp.signAsNode(goldenTicketRequest)
    if (WinFlags.VerboseLogs) console.log('Golden Ticket request', signedGoldenTicketRequest)
    const response = await shardusPost<AdminCertResponse>(network.current.goldenTicketServerUrl, signedGoldenTicketRequest, { timeout: 5000 })
    if (WinFlags.VerboseLogs) console.log('Golden Ticket response', response.data)
    if (response.data && response.data.success && response.data.ticket) {
      return {
        ticket: response.data.ticket,
        retryable: false,
        terminal: false,
      }
    } else {
      const error = response.data?.error || 'No golden ticket received'
      console.error(error)
      return createGoldenTicketFetchResult(error)
    }
  } catch (error) {
    const axiosError = error as { message?: string; response?: { data?: AdminCertResponse; status?: number } }
    const responseError = axiosError.response?.data?.error
    const errorMessage = responseError || axiosError.message || 'Unknown Golden Ticket fetch error'
    console.error(`Error fetching golden ticket from - ${errorMessage}`)
    return createGoldenTicketFetchResult(errorMessage)
  }
}

/**
 * Fetches a Golden Ticket when the node has not requested one yet or its Golden Ticket has expired.
 * Retryable failures are retried after WinFlags.goldenTicketRetryInterval; terminal failures stop retrying.
 */
export async function fetchGoldenTicketIfNeeded(publicKey: string, network: NetworkAccount, dapp: Shardus): Promise<void> {
  const hasExpiredGoldenTicket = adminCert && adminCert.certExp <= dapp.shardusGetTime() && adminCert.goldenTicket === true
  if ((isRequestedAdminCert && !hasExpiredGoldenTicket) || dapp.shardusGetTime() < nextGoldenTicketRetryAt || isGoldenTicketFetchInProgress) return

  isGoldenTicketFetchInProgress = true
  try {
    const goldenTicketResult = await tryAndFetchGoldenTicket(publicKey, network, dapp, isGoldenTicketRetry)
    if (goldenTicketResult.ticket) {
      setAdminCertificate(goldenTicketResult.ticket)
      markRequestedAdminCert()
      isGoldenTicketRetry = false
      /* prettier-ignore */
      if (WinFlags.VerboseLogs) console.log(`fetched golden ticket: ${Utils.safeStringify(goldenTicketResult.ticket)}`)
      nestedCountersInstance.countEvent('win-staking', 'fetched golden ticket from server')
      console.log(`Admin certificate is set to `, adminCert)
    } else if (goldenTicketResult.terminal) {
      // An expired ticket otherwise keeps hasExpiredGoldenTicket true and
      // bypasses isRequestedAdminCert on every isReadyToJoin invocation.
      if (hasExpiredGoldenTicket) setAdminCertificate(null)
      markRequestedAdminCert()
      isGoldenTicketRetry = false
      /* prettier-ignore */
      if (WinFlags.VerboseLogs) console.log(`terminal golden ticket fetch error: ${goldenTicketResult.error}`)
      nestedCountersInstance.countEvent('win-staking', 'terminal golden ticket fetch error')
    } else {
      scheduleGoldenTicketRetry(dapp)
      /* prettier-ignore */
      if (WinFlags.VerboseLogs) console.log(`no golden ticket available from server, retrying in ${WinFlags.goldenTicketRetryInterval}ms`)
      nestedCountersInstance.countEvent('win-staking', 'no golden ticket available from server, retry scheduled')
    }
  } catch (e) {
    scheduleGoldenTicketRetry(dapp)
    /* prettier-ignore */
    if (logFlags.error) console.log(`Error fetching golden ticket: ${e.message}; retrying in ${WinFlags.goldenTicketRetryInterval}ms`) // non fatal
  } finally {
    isGoldenTicketFetchInProgress = false
  }
}

function scheduleGoldenTicketRetry(dapp: Shardus): void {
  nextGoldenTicketRetryAt = dapp.shardusGetTime() + WinFlags.goldenTicketRetryInterval
  isGoldenTicketRetry = true
}

export function setAdminCertificate(cert: AdminCert): void {
  adminCert = cert
}

export function markRequestedAdminCert(): void {
  isRequestedAdminCert = true
}
