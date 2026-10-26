/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * WIN manual client: node client.js [host:port]
 * Default node: 127.0.0.1:9001. Start it with npm run local:start, then local:check.
 * Use "testing" in the client for the manual-testing guide. Wallets start unfunded.
 * Profiles/contracts use JSON content files; see docs/MANUAL_TESTING.md.
 * Existing wallet.json keys are preserved and never printed by wallet commands.
 */
if (process.argv.includes('--help')) {
  console.log('Usage: node client.js [host:port] [archiveServer] [monitorServer] [faucetServer]\nDefault: 127.0.0.1:9001\nStart the network: npm run local:start; check readiness: npm run local:check\nInside the client: testing, network, wallet list, balance, transfer, receipt <txId>\nSee docs/MANUAL_TESTING.md. New wallets have no funds; no local faucet is configured.')
  process.exit(0)
}
const fs = require('fs')
const { resolve } = require('path')
const path = require('path')
const vorpal = require('vorpal')()
const crypto = require('@shardus/lib-crypto-utils')
const stringify = require('fast-stable-stringify')
const axios = require('axios')
const { ethers } = require('ethers')
const { Utils } = require('@shardus/lib-types')
const win = require('./scripts/client-win')
const { randomBytes } = require('crypto')
require('dotenv').config()

crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
crypto.setCustomStringifier(Utils.safeStringify, 'shardus_safeStringify')

const devKey = {
  publicKey: process.env.DEV_PUBLIC_KEY,
  secretKey: process.env.DEV_PRIVATE_KEY,
}

const useEthereumSigning = true

let USER
const PROTOCOL = 'http'
let HOST = process.argv[2] || '127.0.0.1:9001'
let HOST_IP = HOST.split(':')[0]
const ARCHIVESERVER = process.argv[3] || 'localhost:4000'
const MONITORSERVER = process.argv[4] || 'localhost:3000'
const FAUCETSERVER = process.argv[5] || process.env.WIN_FAUCET_HOST
console.log(`Using ${HOST} as node for queries and transactions.`)

const network = '0'.repeat(64)
let networkId = ''

let testConfig = {
  server: {
    transactionExpireTime: 5,
    p2p: {
      syncLimit: 180,
      cycleDuration: 30,
      maxRejoinTime: 20,
      difficulty: 2,
      queryDelay: 1,
      gossipRecipients: 8,
      gossipFactor: 4,
      gossipStartSeed: 15,
      gossipSeedFallof: 15,
      gossipTimeout: 180,
      maxSeedNodes: 10,
      minNodesToAllowTxs: 3,
      minNodes: 15,
      maxNodes: 30,
      seedNodeOffset: 4,
      nodeExpiryAge: 30,
      maxJoinedPerCycle: 1,
      maxSyncingPerCycle: 5,
      maxRotatedPerCycle: 1,
      maxPercentOfDelta: 40,
      minScaleReqsNeeded: 5,
      maxScaleReqs: 200,
      scaleConsensusRequired: 0.25,
      amountToGrow: 1,
      amountToShrink: 1,
      startInWitnessMode: false,
    },
    reporting: {
      report: true,
      recipient: 'http://127.0.0.1:3000/api',
      interval: 2,
      console: false,
    },
    loadDetection: {
      queueLimit: 1000,
      desiredTxTime: 15,
      highThreshold: 0.5,
      lowThreshold: 0.2,
    },
    rateLimiting: {
      limitRate: true,
      loadLimit: {
        internal: 0.5,
        external: 0.4,
        txTimeInQueue: 0.2,
        queueLength: 0.2,
      },
    },
  },
}

// USEFUL CONSTANTS FOR TIME IN MILLISECONDS
const ONE_SECOND = 1000
const ONE_MINUTE = 60 * ONE_SECOND
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
const ONE_WEEK = 7 * ONE_DAY
const ONE_YEAR = 365 * ONE_DAY

const walletFile = resolve(process.env.WIN_CLIENT_WALLET_FILE || path.join(__dirname, 'wallet.json'))
const historyFile = resolve(process.env.WIN_CLIENT_HISTORY_FILE || path.join(__dirname, 'client-transactions.json'))
let winClient = makeWinClient(HOST)
function makeWinClient(host) {
  return new win.WinClient(host, { expectedNetworkId: win.localNetworkId(host), historyFile })
}
async function connectWin() {
  const protocol = await winClient.connect()
  networkId = protocol.networkId
  return protocol
}
const stakedNodeListsFile = resolve('./stakedNodeLists.json')
const testConfigFile = resolve(__dirname, 'testConfig.json')
const testConfigFromFile = require(testConfigFile)
let walletEntries = {}

const baseDir = '.'

walletEntries = win.readJson(walletFile, {})
if (!walletEntries || Array.isArray(walletEntries) || typeof walletEntries !== 'object') throw new Error('Invalid wallet file; existing data was preserved')

console.log(`Loaded wallet entries from '${walletFile}'.`)

async function getSeedNodes() {
  const result = await axios.get(`http://${ARCHIVESERVER}/nodelist`) // await utils.getJson(`${glob.seedNode}/nodelist`)

  let seedNodes = []
  const nodelist = result.data.nodeList
  if (nodelist !== null) {
    // Filter out all non-active nodes. don't filter yet no one will say active.
    // nodelist = nodelist.filter(node => node.status ? node.status === 'active' : false)
    seedNodes = nodelist
  }
  return seedNodes
}

async function getFullNodeList() {
  const result = await axios.get(`http://${ARCHIVESERVER}/full-nodelist`)
  return result.data?.nodeList || []
}

function saveEntries(entries, file) {
  win.writePrivateJson(file, entries)
}

function createAccount(keys = null) {
  if (useEthereumSigning) {
    try {
      // Create Ethereum wallet if no keys provided
      const wallet = keys ? new ethers.Wallet(keys.secretKey) : ethers.Wallet.createRandom()
      // get uncompressed public key from the secretKey
      const signingKey = new ethers.SigningKey(wallet.privateKey)
      const uncompressedPublicKey = signingKey.publicKey
      return {
        address: toShardusAddress(wallet.address),
        keys: {
          secretKey: wallet.privateKey,
          publicKey: uncompressedPublicKey.slice(2),
        },
      }
    } catch (e) {
      console.log('Failed to create Ethereum wallet:', e)
    }
  } else {
    // Use existing Shardus crypto
    const newAccount = crypto.generateKeypair()
    return {
      address: keys ? keys.publicKey : newAccount.publicKey,
      keys: keys || newAccount,
    }
  }
}

function createAccounts(num) {
  const accounts = new Array(num).fill().map((account) => createAccount())
  return accounts
}

// Creates an account with a keypair and adds it to the clients walletFile
function createEntry(name, id) {
  const account = createAccount()
  if (typeof id === 'undefined' || id === null) {
    id = crypto.hash(name)
  }
  account.id = id
  walletEntries[name] = account
  saveEntries(walletEntries, walletFile)
  return account
}

function makeTxGenerator(accounts, total = 0, type) {
  function* buildGenerator(txBuilder, accounts, total, type) {
    let account1, offset, account2
    while (total > 0) {
      account1 = accounts[total % accounts.length]
      offset = Math.floor(Math.random() * (accounts.length - 1)) + 1
      account2 = accounts[(total + offset) % accounts.length]

      yield txBuilder({ type: 'create', to: account1, amount: 1 })
      total--
      if (!(total > 0)) break

      switch (type) {
        case 'create': {
          yield txBuilder({ type: 'create', to: account1, amount: 1 })
          break
        }
        case 'transfer': {
          yield txBuilder({
            type: 'transfer',
            from: account1,
            to: account2,
            amount: 1,
          })
          break
        }
        case 'message': {
          const message = stringify({
            body: 'spam1234',
            timestamp: Date.now(),
            handle: account1.address.slice(0, 5),
          })
          yield txBuilder({
            type: 'message',
            from: account1,
            to: account2,
            message: message,
            amount: 1,
          })
          break
        }
        case 'toll': {
          yield txBuilder({
            type: 'toll',
            from: account1,
            toll: Math.ceil(Math.random() * 1000),
            amount: 1,
          })
          break
        }
        default: {
          console.log('Type must be `transfer`, `message`, or `toll`')
        }
      }
      total--
      if (!(total > 0)) break
    }
  }

  const generator = buildGenerator(buildTx, accounts, total, type)
  generator.length = total
  return generator
}

function buildTx({ type, from = {}, to, handle, id, amount, message, toll }) {
  let actualTx
  switch (type) {
    case 'register': {
      actualTx = {
        type,
        from: from.address,
        handle,
        id,
        timestamp: Date.now(),
      }
      console.log(actualTx)
      break
    }
    case 'create': {
      actualTx = {
        type,
        from: '0'.repeat(64),
        to: to.address,
        amount: Number(amount),
        timestamp: Date.now(),
      }
      break
    }
    case 'transfer': {
      actualTx = {
        type,
        from: from.address,
        timestamp: Date.now(),
        to: to.address,
        amount: Number(amount),
      }
      break
    }
    case 'message': {
      actualTx = {
        type,
        from: from.address,
        to: to.address,
        message: message,
        amount: Number(amount),
        timestamp: Date.now(),
      }
      break
    }
    case 'toll': {
      actualTx = {
        type,
        from: from.address,
        toll,
        amount: Number(amount),
        timestamp: Date.now(),
      }
      break
    }
    default: {
      console.log('Type must be `transfer`, `message`, or `toll`')
    }
  }
  signTransaction(actualTx)
  console.log(`actual tx`, actualTx)
  return actualTx
}

const logError = false

function toShardusAddress(addressStr) {
  //change this:0x665eab3be2472e83e3100b4233952a16eed20c76
  //    to this:  665eab3be2472e83e3100b4233952a16eed20c76000000000000000000000000
  return addressStr.slice(2).toLowerCase() + '0'.repeat(24)
}

function signTransaction(tx, keys, useDefaultSigning = false) {
  win.assertId(networkId, 'Connected network ID (run network to reconnect)')
  tx.networkId = networkId
  if (useEthereumSigning && !useDefaultSigning) {
    signEthereumTx(tx, keys ? keys : USER.keys)
  } else {
    crypto.signObj(tx, keys ? keys.secretKey : USER.keys.secretKey, keys ? keys.publicKey : USER.keys.publicKey)
  }
}

function signEthereumTx(tx, keys) {
  if (!keys) {
    throw new Error('Keys are required for signing')
  }

  win.assertId(networkId, 'Connected network ID (run network to reconnect)')
  tx.networkId = networkId
  // Create a copy of the tx without any existing sign field
  const dataToSign = Object.assign({}, tx)
  delete dataToSign.sign

  // Convert the object to a string with BigInt support
  const message = crypto.hashObj(dataToSign)

  try {
    // Create wallet from private key
    const wallet = new ethers.Wallet(keys.secretKey)

    // Sign the message
    const signature = wallet.signMessageSync(message)

    // Add signature to transaction
    tx.sign = {
      owner: toShardusAddress(wallet.address),
      sig: signature,
    }
  } catch (error) {
    throw new Error(`Failed to sign transaction: ${error.message}`)
  }
}

function verifyEthereumTx(obj) {
  if (typeof obj !== 'object') {
    throw new TypeError('Input must be an object.')
  }
  if (!obj.sign || !obj.sign.owner || !obj.sign.sig) {
    throw new Error('Object must contain a sign field with the following data: { owner, sig }')
  }
  if (typeof obj.sign.owner !== 'string') {
    throw new TypeError('Owner must be a public key represented as a hex string.')
  }
  if (typeof obj.sign.sig !== 'string') {
    throw new TypeError('Signature must be a valid signature represented as a hex string.')
  }
  const { owner, sig } = obj.sign
  const dataWithoutSign = Object.assign({}, obj)
  delete dataWithoutSign.sign
  const message = crypto.hashObj(dataWithoutSign)

  const recoveredAddress = ethers.verifyMessage(message, sig)
  const recoveredShardusAddress = toShardusAddress(recoveredAddress)
  const isValid = recoveredShardusAddress.toLowerCase() === owner.toLowerCase()

  console.log('Signed Obj', obj)
  console.log('Signature verification result:')
  console.log('Is Valid:', isValid)
  console.log('message', message)
  console.log('Owner Address:', obj.sign.owner)
  console.log('Recovered Address:', recoveredAddress)
  console.log('Recovered Shardus Address:', recoveredShardusAddress)
  return isValid
}

async function sendTx(tx, node = null, verbose = true) {
  if (!tx.sign) {
    tx = buildTx(tx)
  }
  // if (verbose) {
  //   console.log(`Sending tx to ${node}...`)
  //   console.log(tx)
  // }
  try {
    let target = HOST
    if (node != null) {
      target = node
    }
    console.log(target, node)
    const { data } = await axios.post(`${PROTOCOL}://${target}/inject`, tx)
    console.log('Got response:', data)
    return data
  } catch (err) {
    console.log('Stopped spamming due to error', err)
  }
}

async function spamTxs({ txs, rate, nodes = [], saveFile = null }) {
  if (!Array.isArray(nodes)) nodes = [nodes]

  console.log(`Spamming ${nodes.length > 1 ? 'nodes' : 'node'} ${nodes.join()} with ${txs.length ? txs.length + ' ' : ''}txs at ${rate} TPS...`)

  const writeStream = saveFile ? fs.createWriteStream(path.join(baseDir, saveFile)) : null

  const promises = []
  let node

  for (const tx of txs) {
    if (writeStream) writeStream.write(JSON.stringify(tx, null, 2) + '\n')
    node = nodes[Math.floor(Math.random() * nodes.length)]
    promises.push(sendTx(tx, node))
    await _sleep((1 / rate) * 1000)
  }
  if (writeStream) writeStream.end()
  console.log()

  await Promise.all(promises)
  console.log('Done spamming')

  if (writeStream) {
    await new Promise((resolve) => writeStream.on('finish', resolve))
    console.log(`Wrote spammed txs to '${saveFile}'`)
  }
}

async function _sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function injectTx(tx) {
  try {
    const result = await winClient.submit(tx, message => vorpal.log(message))
    vorpal.log(`${result.status}${result.reason ? ': ' + result.reason : ''}`)
    return result
  } catch (error) {
    vorpal.log(error.message)
    return { status: 'unknown', error: error.message }
  }
}

async function takeSnapshot(host) {
  try {
    const res = await axios.get(`http://${host || HOST}/debug/dump`)
    return res.data
  } catch (err) {
    return err
  }
}

async function getAccountData(id) {
  try {
    const res = await axios.get(`${PROTOCOL}://${HOST}/${id ? 'account/' + id : 'accounts'}`)
    if (res.data) return Utils.safeJsonParse(Utils.safeStringify(res.data))
    return res.data
  } catch (err) {
    return err.message
  }
}

async function getToll(friendId, yourId) {
  try {
    const accountData = await getAccountData(friendId)
    if (accountData == null || accountData.account == null) {
      throw new Error(`Error retrieving account data for ${friendId}: ${accountData.error}`)
    }
    console.log(`Account data for ${friendId}:`, accountData.account.data)
    const tollInWei = accountData.account.data.toll
    const tollUnit = accountData.account.data.tollUnit
    console.log(`Toll for ${friendId} is ${tollInWei} wei`)
    return { toll: weiToWin(tollInWei), tollUnit }
  } catch (error) {
    return { error: error }
  }
}

async function getAddress(handle) {
  return winClient.resolveTarget(handle, win.readJson(walletFile, walletEntries))
}

function calculateChatId(to, from) {
  return crypto.hash([from, to].sort((a, b) => a.localeCompare(b)).join(''))
}

async function queryMessages(to, from) {
  try {
    const res = await axios.get(`${PROTOCOL}://${HOST}/messages/${calculateChatId(USER.address, to)}/0`)
    const { messages } = res.data
    return messages
  } catch (error) {
    return error
  }
}

// QUERY'S THE TRANSACTIONS OF THE CURRENT WALLET
async function queryTransactions() {
  try {
    const res = await axios.get(`${PROTOCOL}://${HOST}/account/${USER.address}/transactions`)
    const { transactions } = res.data
    return transactions
  } catch (error) {
    return error
  }
}

// QUERY'S THE CURRENT NETWORK PARAMETERS
async function queryParameters() {
  const res = await axios.get(`${PROTOCOL}://${HOST}/network/parameters`)
  if (res.data.error) {
    return res.data.error
  } else {
    return res.data.parameters
  }
}


// QUERY'S THE CURRENT NETWORK PARAMETERS ON HOST NODE (TESTING)
async function queryNodeParameters() {
  const res = await axios.get(`${PROTOCOL}://${HOST}/network/parameters/node`)
  if (res.data.error) {
    return res.data.error
  } else {
    return res.data.parameters
  }
}

// COMMAND TO SET THE HOST IP:PORT
vorpal.command('use host <host>', 'connect to another WIN validator').action(async function (args, callback) {
  try {
    const next = makeWinClient(args.host)
    const protocol = await next.connect()
    winClient = next
    HOST = args.host
    HOST_IP = HOST.split(':')[0]
    networkId = protocol.networkId
    this.log(`Connected to ${HOST}; WIN network ${networkId}`)
  } catch (error) { this.log(error.message) }
  callback()
})

// COMMAND TO CHANGE SHARDUS CONFIGURATION
vorpal.command('change config', 'Send a stringified JSON config object to be updated by shardus').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'cycle',
      message: 'Enter the cycle on which the change should take place (or "-1" for 3 cycles from now): ',
      default: -1,
      filter: (value) => parseInt(value),
    },
    {
      type: 'input',
      name: 'config',
      message: 'Enter the stringified JSON config object - e.g. { "p2p": { "maxNodes": 300 } }: ',
      // default: '{ "p2p": { "minNodes": 15, "maxNodes": 30 } }', //JSON.stringify(testConfig),
      // default: '{ "p2p": { "initShutdown": true } }',
    },
  ])
  try {
    const config = JSON.parse(answers.config)
    if (typeof config !== 'object') {
      throw new Error('config must be an object')
    }
    this.log(config)
    const tx = {
      type: 'change_config',
      from: devKey.publicKey,
      cycle: answers.cycle,
      config: answers.config,
      networkId,
      timestamp: Date.now(),
    }
    let signedTx = crypto.signObj(tx, devKey.secretKey, devKey.publicKey)
    signedTx.signs = [Object.assign({}, signedTx.sign)]
    delete signedTx.sign
    injectTx(signedTx).then((res) => {
      this.log(res)
      callback()
    })
  } catch (err) {
    this.log(err.message)
  }
})

vorpal.command('change network parameters', 'Send a stringified JSON config object to update the network parameters').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'cycle',
      message: 'Enter the cycle on which the change should take place (or "-1" for 3 cycles from now): ',
      default: -1,
      filter: (value) => parseInt(value),
    },
    {
      type: 'input',
      name: 'config',
      message: 'Enter the stringified JSON config object - e.g. { "latestVersion": "1.1.1" }: ',
      // default: '{ "latestVersion": "2.3.2" }',
    },
  ])
  try {
    const config = JSON.parse(answers.config)
    if (typeof config !== 'object') {
      throw new Error('config must be an object')
    }
    this.log(config)
    const tx = {
      type: 'change_network_param',
      from: devKey.publicKey,
      cycle: answers.cycle,
      config: answers.config,
      timestamp: Date.now(),
      networkId: networkId,
    }
    let signedTx = crypto.signObj(tx, devKey.secretKey, devKey.publicKey)
    signedTx.signs = [Object.assign({}, signedTx.sign)]
    delete signedTx.sign
    injectTx(signedTx).then((res) => {
      this.log(res)
      callback()
    })
  } catch (err) {
    this.log('change network parameters failed', err.message)
    callback()
  }
})

// COMMAND TO REGISTER AN ALIAS FOR A USER ACCOUNT
vorpal.command('register', 'register an optional alias (does not fund the wallet)').action(async function (_, callback) {
  try {
    await connectWin()
    const answers = await this.prompt([
      { type: 'input', name: 'alias', message: 'Alias (1-20 letters/digits): ' },
      { type: 'confirm', name: 'private', message: 'Private account? ', default: false },
    ])
    if (!/^[A-Za-z0-9]{1,20}$/.test(answers.alias)) throw new Error('Alias must contain 1-20 letters or digits')
    const tx = { type: 'register', aliasHash: crypto.hash(answers.alias), from: USER.address,
      alias: answers.alias, publicKey: USER.keys.publicKey, private: answers.private, timestamp: Date.now() }
    signTransaction(tx)
    const result = await injectTx(tx)
    if (result.status === 'confirmed') {
      USER.alias = answers.alias
      walletEntries = win.readJson(walletFile, walletEntries)
      for (const entry of Object.values(walletEntries)) if (entry.address === USER.address) entry.alias = answers.alias
      saveEntries(walletEntries, walletFile)
      this.log(`Alias '${answers.alias}' confirmed. Balance is unchanged.`)
    }
  } catch (error) { this.log(error.message) }
  callback()
})

vorpal.command('create', 'explain why public token creation is disabled').action(function (_, callback) {
  this.log('Public token creation is disabled. New wallets start at 0 WIN. Local test funding is a separate step.')
  callback()
})

vorpal.command('transfer', 'send WIN and wait for a committed receipt').action(async function (_, callback) {
  try {
    await connectWin()
    const answers = await this.prompt([
      { type: 'input', name: 'target', message: 'Recipient wallet name, alias, or address: ' },
      { type: 'input', name: 'amount', message: 'Amount in WIN: ', default: '1' },
      { type: 'input', name: 'memo', message: 'Memo (optional): ' },
    ])
    const to = await getAddress(answers.target)
    const tx = await winClient.payment(USER, to, answers.amount, answers.memo)
    this.log(`Recipient: ${to}\nAmount: ${weiToWinStr(tx.amount)} WIN\nFee: ${weiToWinStr(tx.fee)} WIN\nAmount + fee: ${weiToWinStr(tx.amount + tx.fee)} WIN\nNonce: ${tx.nonce}`)
    const { confirmed } = await this.prompt({ type: 'confirm', name: 'confirmed', message: 'Send this payment?', default: false })
    if (confirmed) await injectTx(tx)
    else this.log('Payment canceled before submission.')
  } catch (error) { this.log(error.message) }
  callback()
})

vorpal.command('deposit stake', 'deposit the stake amount to the node').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'nodeAddress',
      message: 'Enter the node account: ',
    },
    {
      type: 'number',
      name: 'amount',
      message: 'Enter number of tokens to stake: ',
      default: BigInt(10),
      filter: (value) => BigInt(value),
    },
  ])
  const stakeAmount = wintoWei(parseFloat(answers.amount))
  const tx = {
    type: 'deposit_stake',
    nominator: USER.address,
    nominee: answers.nodeAddress,
    stake: stakeAmount,
    timestamp: Date.now(),
  }
  signTransaction(tx)
  injectTx(tx).then((res) => {
    this.log(res)
    callback()
  })
})

vorpal.command('withdraw stake', 'withdraw the stake from the node').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'nodeAddress',
      message: 'Enter the node account: ',
    },
  ])
  const tx = {
    type: 'withdraw_stake',
    nominator: USER.address,
    nominee: answers.nodeAddress,
    force: false,
    timestamp: Date.now(),
  }
  signTransaction(tx)
  injectTx(tx).then((res) => {
    this.log(res)
    callback()
  })
})

// COMMAND TO SEND A MESSAGE TO ANOTHER USER ON THE NETWORK
vorpal.command('message', 'sends a message to another user').action(async function (_, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'to',
      message: 'Enter the alias or publicKey of the target: ',
    },
    {
      type: 'input',
      name: 'message',
      message: 'Enter the message: ',
    },
  ])
  const to = await getAddress(answers.to)
  const data = await getAccountData(USER.address)
  const handle = data.account.alias
  if (to === undefined || to === null) {
    this.log("Account doesn't exist for: ", answers.to)
    callback()
  }
  const result = await getToll(to, USER.address)
  if (result.error) {
    this.log(`There was an error retrieving the toll for ${answers.to}`)
    this.log(result.error)
    callback()
  } else {
    const answer = await this.prompt({
      type: 'list',
      name: 'confirm',
      message: `The toll for sending this user a message is ${result.toll} ${result.tollUnit}, continue? `,
      choices: [
        { name: 'yes', value: true, short: true },
        { name: 'no', value: false, short: false },
      ],
      default: 'yes',
    })
    if (answer.confirm) {
      const message = stringify({
        body: answers.message,
        handle,
        timestamp: Date.now(),
      })
      // const encryptedMsg = crypto.encrypt(message, crypto.convertSkToCurve(USER.keys.secretKey), crypto.convertPkToCurve(to))
      const encryptedMsg = message
      const tx = {
        type: 'message',
        from: USER.address,
        to: to,
        chatId: calculateChatId(to, USER.address),
        message: encryptedMsg,
        timestamp: Date.now(),
      }
      signTransaction(tx)
      injectTx(tx).then((res) => {
        this.log(res)
        callback()
      })
    } else {
      callback()
    }
  }
})

vorpal.command('read', 'sends a message to another user').action(async function (_, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'to',
      message: 'Enter the alias or publicKey of the target: ',
    },
  ])
  const to = await getAddress(answers.to)
  const data = await getAccountData(USER.address)
  const handle = data.account.alias
  if (to === undefined || to === null) {
    this.log("Account doesn't exist for: ", answers.to)
    callback()
  }
  const result = await queryMessages(to, USER.address)
  let hasNewMessages = true
  if (result.error) {
    this.log(`There was an error retrieving the toll for ${answers.to}`)
    this.log(result.error)
    callback()
  } else {
    const answer = await this.prompt({
      type: 'list',
      name: 'confirm',
      message: `would you like to read the message and send "read" tx? `,
      choices: [
        { name: 'yes', value: true, short: true },
        { name: 'no', value: false, short: false },
      ],
      default: 'yes',
    })
    if (answer.confirm) {
      // const encryptedMsg = crypto.encrypt(message, crypto.convertSkToCurve(USER.keys.secretKey), crypto.convertPkToCurve(to))
      const tx = {
        type: 'read',
        from: USER.address,
        to: to,
        chatId: calculateChatId(to, USER.address),
        timestamp: Date.now(),
      }
      signTransaction(tx)
      injectTx(tx).then((res) => {
        this.log(res)
        callback()
      })
    } else {
      callback()
    }
  }
})

vorpal.command('update chat toll', 'set the toll requirement or block').action(async function (_, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'to',
      message: 'Enter the alias or publicKey of the targe: ',
    },
  ])
  const to = await getAddress(answers.to)
  const data = await getAccountData(USER.address)
  const handle = data.account.alias
  if (to === undefined || to === null) {
    console.log(`Account doesn't exist for: ${answers.to}`)
    callback()
  }

  const answer = await this.prompt({
    type: 'input',
    name: 'required',
    message: 'Enter the toll required: ',
  })

  if (answer.required) {
    const tx = {
      type: 'update_toll_required',
      from: USER.address,
      to: to,
      required: parseInt(answer.required),
      chatId: calculateChatId(to, USER.address),
      timestamp: Date.now(),
    }
    signTransaction(tx)
    injectTx(tx).then((res) => {
      this.log(res)
      callback()
    })
  }
})

vorpal.command('reclaim toll', 'Reclaim the toll from unread message').action(async function (_, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'to',
      message: 'Enter the alias or publicKey of the targe: ',
    },
  ])
  const to = await getAddress(answers.to)
  const data = await getAccountData(USER.address)
  const handle = data.account.alias
  if (to === undefined || to === null) {
    console.log(`Account doesn't exist for: ${answers.to}`)
    callback()
  }

  const answer = true

  if (answer) {
    const tx = {
      type: 'reclaim_toll',
      from: USER.address,
      to: to,
      chatId: calculateChatId(to, USER.address),
      timestamp: Date.now(),
    }
    signTransaction(tx)
    injectTx(tx).then((res) => {
      this.log(res)
      callback()
    })
  }
})

// COMMAND TO SET THE TOLL FOR INCOMING MESSAGES
vorpal.command('toll', 'sets a toll people must you in order to send you messages').action(async function (_, callback) {
  const answer = await this.prompt([
    {
      type: 'string',
      name: 'tollUnit',
      message: 'Enter the unit of toll: ',
      default: 'WIN',
    },
    {
      type: 'number',
      name: 'toll',
      message: 'Enter the toll: ',
      filter: (value) => parseFloat(value),
    },
  ])
  const tx = {
    type: 'toll',
    from: USER.address,
    toll: wintoWei(answer.toll),
    tollUnit: answer.tollUnit,
    timestamp: Date.now(),
  }
  signTransaction(tx)
  injectTx(tx).then((res) => {
    this.log(res)
    callback()
  })
})

// COMMAND TO POLL FOR MESSAGES BETWEEN TWO USERS
vorpal.command('message poll <to>', 'gets messages between you and <to>').action(async function (args, callback) {
  const to = await getAddress(args.to)
  let messages = await queryMessages(USER.address, to)
  // messages = messages.map(message => JSON.parse(crypto.decrypt(message, crypto.convertSkToCurve(USER.keys.secretKey), crypto.convertPkToCurve(to)).message))
  this.log(messages)
  callback()
})

// QUERY'S A LOCAL WALLET ACCOUNT OR ALL ACCOUNTS ON THE HOST IF LEFT BLANK
vorpal
  .command('query [account]', 'gets data for the account associated with the given [wallet]. Otherwise, gets all network data.')
  .action(async function (args, callback) {
    let address
    if (args.account !== undefined) {
      try { address = await getAddress(args.account) } catch (error) { this.log(error.message); callback(); return }
    }
    this.log(`Querying network for ${address ? args.account : 'all data'} `)
    this.log(address)
    getAccountData(address).then((res) => {
      try {
        this.log(res)
      } catch (err) {
        this.log(err)
      } finally {
        callback()
      }
    })
  })

vorpal.command('spam transactions <type> <accounts> <count> <tps> <ports>', 'legacy load generator (unavailable without minting)').action(function (_, callback) {
  this.log('Legacy load generation depends on disabled token minting. Use transfer with funded wallets instead.')
  callback()
})

// COMMAND TO LOG OUT QUERY'S FOR NETWORK DATA (ISSUES - PROPOSALS - DEV_PROPOSALS)
// TODO ADD MORE query's HERE
vorpal.command('get <type>', 'query the network for <type> account').action(async function (args, callback) {
  switch (args.type) {
    case 'params': {
      this.log(await queryParameters())
      break
    }
    case 'config': {
      const params = await queryParameters()
      for (const change of params.listOfChanges) {
        this.log(change.cycle, change.change)
      }
      break
    }
    case 'nodeParams': {
      this.log(await queryNodeParameters())
      break
    }
    case 'account': {
      const answer = await this.prompt({
        type: 'input',
        name: 'alias',
        message: 'Enter alias: ',
      })
      const address = await getAddress(answer.alias)
      if (address) {
        this.log(await getAccountData(address))
      }
      break
    }
    default: {
      this.log('Query type unknown')
    }
  }
  callback()
})

function selectWallet(name) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Wallet name must contain 1-64 letters, digits, underscores, or hyphens')
  walletEntries = win.readJson(walletFile, {})
  const existing = Object.prototype.hasOwnProperty.call(walletEntries, name) ? walletEntries[name] : null
  if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Choose another wallet name')
  USER = existing || createEntry(name)
  return USER
}

vorpal.command('init', 'select a wallet and connect to the WIN network').action(async function (_, callback) {
  try {
    const { user } = await this.prompt({ type: 'input', name: 'user', message: 'Enter wallet name: ', default: 'alice' })
    selectWallet(user)
    this.log(`Using ${user}: ${USER.address}`)
    await connectWin()
    this.log(`WIN network ID: ${networkId}`)
  } catch (error) { networkId = ''; this.log(error.message) }
  this.log('Type "testing" for the manual-testing guide. New wallets have no WIN funding.')
  callback()
})

vorpal.command('wallet create <name>', 'create/select a local wallet; does not issue WIN').action(function (args, callback) {
  try {
    const user = selectWallet(args.name)
    this.log(`Using ${args.name}: ${user.address}`)
    if (callback) callback()
    return user
  } catch (error) { this.log(error.message); if (callback) callback() }
})

vorpal.command('wallet list [name]', 'show saved wallet addresses (keys remain private)').action(function (args, callback) {
  try {
    walletEntries = win.readJson(walletFile, {})
    for (const [name, entry] of Object.entries(walletEntries)) {
      if (!args.name || args.name === name) this.log(`${name}: ${entry.address}${entry.alias ? ' | alias: ' + entry.alias : ''}`)
    }
  } catch (error) { this.log(error.message) }
  callback()
})

vorpal.command('use <name>', 'select or create a local wallet').action(function (args, callback) {
  try { selectWallet(args.name); this.log(`Using ${args.name}: ${USER.address}`) } catch (error) { this.log(error.message) }
  callback()
})

vorpal.command('transactions', 'list transactions submitted by this client on the connected network').action(async function (_, callback) {
  try {
    await connectWin()
    const entries = winClient.entries().filter(e => e.networkId === networkId && e.from === USER.address)
    if (!entries.length) this.log('No locally recorded transactions for this wallet on this network.')
    for (const entry of entries) this.log(`${entry.txId} | ${entry.type} | ${entry.status}${entry.objectId ? ' | object: ' + entry.objectId : ''}`)
    this.log('Use receipt <txId> to refresh a status. This is the client journal, not complete network history.')
  } catch (error) { this.log(error.message) }
  callback()
})

vorpal.command('kill node <host>', 'Kicks node running on host <host>').action(async function (args, callback) {
  await axios.post(`http://${args.host}/exit`)
  callback()
})

vorpal
  .command('debug snapshot [host]', 'takes a snapshot of the heap on node [host] or the host you are connected to (if not defined)')
  .action(async function (args, callback) {
    if (args.host) {
      this.log(await takeSnapshot(args.host))
    } else {
      this.log(await takeSnapshot(HOST))
    }
    callback()
  })

vorpal
  .command('debug exit <code> [host]', 'kills node running on [host] with exit code <code>. Use current host if no [host] provided')
  .action(async function (args, callback) {
    if (args.code === undefined) {
      this.log('Must provide an exit code')
    } else {
      await axios.post(`http://${args.host || HOST}/debug/exit`, { code: args.code })
    }
    callback()
  })

vorpal.command('check staked balances', 'check balances of staked accounts and show which ones need funding').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'minimumBalance',
      message: 'Enter minimum balance threshold (WIN): ',
      default: 100,
      filter: (value) => parseFloat(value),
    },
  ])

  try {
    const stakedNodeLists = await loadStakedNodeLists()
    const nodeIds = Object.keys(stakedNodeLists)

    if (nodeIds.length === 0) {
      this.log('No staked accounts found in stakedNodeLists.json')
      callback()
      return
    }

    this.log(`Checking ${nodeIds.length} staked accounts (minimum balance: ${answers.minimumBalance} WIN)...\n`)

    const lowBalanceAccounts = []
    const healthyAccounts = []

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i]
      const account = stakedNodeLists[nodeId]

      // Convert to Shardus address
      const address = toShardusAddress(new ethers.Wallet(account.secretKey).address)

      try {
        const accountData = await getAccountData(address)
        let balance = 0

        if (accountData && accountData.account && accountData.account.data) {
          balance = weiToWin(accountData.account.data.balance || 0)
        }

        const status = balance >= answers.minimumBalance ? '✅' : '⚠️'
        this.log(`${status} ${address.slice(0, 12)}... - ${balance.toFixed(2)} WIN`)

        if (balance < answers.minimumBalance) {
          lowBalanceAccounts.push({
            nodeId,
            address,
            balance,
            needed: answers.minimumBalance - balance,
          })
        } else {
          healthyAccounts.push({ nodeId, address, balance })
        }
      } catch (error) {
        this.log(`❌ ${address.slice(0, 12)}... - Error checking balance`)
        lowBalanceAccounts.push({
          nodeId,
          address,
          balance: 0,
          needed: answers.minimumBalance,
          error: true,
        })
      }
    }

    this.log(`\n📊 Summary:`)
    this.log(`✅ Healthy accounts: ${healthyAccounts.length}`)
    this.log(`⚠️  Need funding: ${lowBalanceAccounts.length}`)

    if (lowBalanceAccounts.length > 0) {
      this.log(`\n💰 Accounts that need funding:`)
      for (const account of lowBalanceAccounts) {
        this.log(`   ${account.address.slice(0, 12)}... needs ${account.needed.toFixed(2)} WIN`)
      }
    }
  } catch (error) {
    this.log(`Error: ${error.message}`)
  }

  callback()
})

vorpal.command('show staked accounts', 'display information about staked accounts from stakedNodeLists.json').action(async function (args, callback) {
  try {
    const stakedNodeLists = await loadStakedNodeLists()
    const nodeIds = Object.keys(stakedNodeLists)

    if (nodeIds.length === 0) {
      this.log('No staked accounts found in stakedNodeLists.json')
      callback()
      return
    }

    this.log(`Found ${nodeIds.length} staked nodes:\n`)

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i]
      const account = stakedNodeLists[nodeId]

      // Convert to Shardus address
      const address = toShardusAddress(new ethers.Wallet(account.secretKey).address)

      this.log(`${i + 1}. Node: ${nodeId.slice(0, 12)}...`)
      this.log(`   Staking Account: ${address.slice(0, 12)}...`)

      // Try to get account balance
      try {
        const accountData = await getAccountData(address)
        if (accountData && accountData.account && accountData.account.data) {
          const balance = weiToWin(accountData.account.data.balance || 0)
          this.log(`   Balance: ${balance} WIN`)
        } else {
          this.log(`   Balance: Account not found or no balance`)
        }
      } catch (error) {
        this.log(`   Balance: Error retrieving balance`)
      }

      this.log('') // Empty line for readability
    }
  } catch (error) {
    this.log(`Error: ${error.message}`)
  }

  callback()
})

vorpal.command('fund staked accounts', 'load and fund accounts from stakedNodeLists.json').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'amount',
      message: 'Enter number of tokens to fund each staked account: ',
      default: 1000,
      filter: (value) => parseFloat(value),
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: 'This will fund all accounts from stakedNodeLists.json. Continue?',
      default: false,
    },
  ])

  if (!answers.confirm) {
    this.log('Operation cancelled')
    callback()
    return
  }

  this.log(`Loading and funding staked accounts with ${answers.amount} tokens each...`)

  try {
    const result = await loadAndFundStakedAccounts(answers.amount)

    if (result.success) {
      this.log(`✅ Successfully funded ${result.funded}/${result.total} staked accounts`)

      // Show detailed results
      for (const accountResult of result.results) {
        const status = accountResult.success ? '✅' : '❌'
        this.log(`${status} ${accountResult.address.slice(0, 12)}... - ${accountResult.success ? 'Funded' : 'Failed'}`)
      }
    } else {
      this.log(`❌ Failed to fund staked accounts: ${result.message || result.error}`)
    }
  } catch (error) {
    this.log(`❌ Error: ${error.message}`)
  }

  callback()
})

vorpal.command('deposit stake all', 'deposit the stake amount to the joining/active nodes in the network').action(async function (args, callback) {
  const answers = await this.prompt([
    // ask the node type "joining" or "active"
    {
      type: 'list',
      name: 'nodeType',
      message: 'Enter the node type to stake: ',
      choices: ['joining', 'active'],
    },
    {
      type: 'number',
      name: 'amount',
      message: 'Enter number of tokens to stake: ',
      default: 10,
      filter: (value) => BigInt(value),
    },
  ])
  const nodeList = answers.nodeType === 'joining' ? await getJoiningNodes() : await getActiveNodes()
  if (nodeList.length === 0) {
    this.log('No nodes')
    callback()
    return
  }

  // Filter out nodes that already have sufficient stake
  const nodesToStake = []
  for (const publicKey of nodeList) {
    const nodeAccount = await getAccountData(publicKey)
    console.log(`Checking node: ${publicKey} with stakeLock: ${nodeAccount?.account?.stakeLock || 0}, required: ${wintoWei(Number(answers.amount))}`)

    // Only include nodes that don't have sufficient stake
    if (!nodeAccount || !nodeAccount.account || nodeAccount.account.stakeLock < wintoWei(Number(answers.amount))) {
      nodesToStake.push(publicKey)
    }
  }

  if (nodesToStake.length === 0) {
    this.log('All nodes already have sufficient stake')
    callback()
    return
  }

  // Load the staked nodeLists from the json file
  const stakedNodeLists = await loadStakedNodeLists()

  // Separate nodes into those with existing accounts and those needing new accounts
  const nodesWithExistingAccounts = nodesToStake.filter((node) => Object.keys(stakedNodeLists).includes(node))
  const nodesNeedingNewAccounts = nodesToStake.filter((node) => !Object.keys(stakedNodeLists).includes(node))

  this.log(`Found ${nodesToStake.length} nodes to stake:`)
  this.log(`- ${nodesWithExistingAccounts.length} nodes with existing accounts`)
  this.log(`- ${nodesNeedingNewAccounts.length} nodes needing new accounts`)

  // Create new accounts only for nodes that don't have existing accounts
  let newAccounts = []
  if (nodesNeedingNewAccounts.length > 0) {
    newAccounts = createAccounts(nodesNeedingNewAccounts.length)

    // Fund the new accounts
    this.log('Creating and funding new accounts...')
    for (let i = 0; i < newAccounts.length; i++) {
      const createTx = {
        type: 'create',
        from: newAccounts[i].address,
        to: newAccounts[i].address,
        amount: wintoWei(2000), // 2000 tokens
        timestamp: Date.now(),
      }
      signTransaction(createTx, newAccounts[i].keys)
      let res = await injectTx(createTx)
      this.log(`New account ${i + 1}/${newAccounts.length}: ${res?.result?.success ? 'SUCCESS' : 'FAILED'}`)
      await _sleep(ONE_SECOND * 1)
    }

    await _sleep(5 * ONE_SECOND) // Wait for account creation to propagate
  }

  // Fund all existing accounts with 2000 tokens
  if (nodesWithExistingAccounts.length > 0) {
    this.log('Funding existing accounts...')
    for (let i = 0; i < nodesWithExistingAccounts.length; i++) {
      const nodeId = nodesWithExistingAccounts[i]
      const existingAccount = stakedNodeLists[nodeId]

      // Convert existing account to proper format
      const accountInfo = {
        address: toShardusAddress(new ethers.Wallet(existingAccount.secretKey).address),
        keys: existingAccount,
      }

      const createTx = {
        type: 'create',
        from: accountInfo.address,
        to: accountInfo.address,
        amount: wintoWei(2000), // 2000 tokens
        timestamp: Date.now(),
      }

      signTransaction(createTx, accountInfo.keys)
      const res = await injectTx(createTx)
      this.log(`Existing account ${i + 1}/${nodesWithExistingAccounts.length}: ${res?.result?.success ? 'SUCCESS' : 'FAILED'}`)
      await _sleep(ONE_SECOND * 1)
    }

    await _sleep(5 * ONE_SECOND) // Wait for funding to propagate
  }

  // Process nodes with existing accounts first
  if (nodesWithExistingAccounts.length > 0) {
    this.log('Staking nodes with existing accounts...')
    for (let i = 0; i < nodesWithExistingAccounts.length; i++) {
      const nodeId = nodesWithExistingAccounts[i]
      const existingAccount = stakedNodeLists[nodeId]

      // Convert existing account to proper format
      const accountInfo = {
        address: toShardusAddress(new ethers.Wallet(existingAccount.secretKey).address),
        keys: existingAccount,
      }

      const depositStateTx = {
        type: 'deposit_stake',
        nominator: accountInfo.address,
        nominee: nodeId,
        stake: wintoWei(parseFloat(answers.amount)),
        timestamp: Date.now(),
      }

      signTransaction(depositStateTx, accountInfo.keys)
      const res = await injectTx(depositStateTx)
      this.log(`Existing account ${i + 1}/${nodesWithExistingAccounts.length} (${nodeId.slice(0, 12)}...): ${res?.result?.success ? 'SUCCESS' : 'FAILED'}`)
      await _sleep(ONE_SECOND * 1)
    }
  }

  // Process nodes needing new accounts
  if (nodesNeedingNewAccounts.length > 0) {
    this.log('Staking nodes with new accounts...')
    for (let i = 0; i < nodesNeedingNewAccounts.length; i++) {
      const nodeId = nodesNeedingNewAccounts[i]
      const account = newAccounts[i]

      const depositStateTx = {
        type: 'deposit_stake',
        nominator: account.address,
        nominee: nodeId,
        stake: wintoWei(parseFloat(answers.amount)),
        timestamp: Date.now(),
      }

      signTransaction(depositStateTx, account.keys)
      const res = await injectTx(depositStateTx)
      console.log('Stake response:', res)
      this.log(`New account ${i + 1}/${nodesNeedingNewAccounts.length} (${nodeId.slice(0, 12)}...): ${res?.result?.success ? 'SUCCESS' : 'FAILED'}`)

      // Add successful new stakes to the staked node lists
      if (res?.result?.success) {
        stakedNodeLists[nodeId] = account.keys
      }
      await _sleep(ONE_SECOND * 1)
    }

    // Save the updated staked nodeLists to the json file
    fs.writeFile('./stakedNodeLists.json', JSON.stringify(stakedNodeLists), 'utf8', (err) => {
      if (err) {
        console.error(err)
        return
      }
      console.log('stakedNodeLists updated and saved')
    })
  }

  this.log('\n✅ Staking process completed!')
  callback()
})

vorpal.command('admin certificate', 'put admin certificate').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'nodeAddress',
      message: 'Enter the node account: ',
    },
    {
      type: 'confirm',
      name: 'goldenTicket',
      message: 'Enable golden ticket: ',
      default: false,
    },
    {
      type: 'input',
      name: 'certHours',
      message: 'Certificate expiry in hours: ',
      default: 24,
    },
  ])
  const currentTime = Date.now()
  const certExpHours = answers.certHours
  const expiration = currentTime + 1000 * 60 * 60 * certExpHours
  const adminCert = {
    nominee: answers.nodeAddress,
    certCreation: currentTime,
    certExp: expiration,
    goldenTicket: answers.goldenTicket,
  }
  console.log(adminCert)
  signTransaction(adminCert, devKey, true)
  const res = await putAdminCert(adminCert)
  this.log(res)
  callback()
})

vorpal.command('set cert time', 'Create stake certificate for the staked node').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'input',
      name: 'nominator',
      message: 'Enter the norminator address: ',
    },
    {
      type: 'number',
      name: 'certDurationCycle',
      message: 'Enter the cert expiry in cycles: ',
      default: 30,
      filter: (value) => parseInt(value),
    },
  ])
  const tx = {
    type: 'set_cert_time',
    nominee: devKey.publicKey, // Note: The devKey is the nodeAcccount keypairs
    nominator: answers.nominator,
    duration: answers.certDurationCycle,
    timestamp: Date.now(),
  }
  signTransaction(tx, devKey, true)
  injectTx(tx).then((res) => {
    this.log(res)
    callback()
  })
})

const putAdminCert = async (adminCert) => {
  console.log(`Sending admin certificate to ${HOST}...`)
  try {
    const res = await axios.put(`${PROTOCOL}://${HOST}/admin-certificate`, adminCert)
    return res.data
  } catch (err) {
    return err.message
  }
}

const getJoiningNodes = async () => {
  const res = await axios.get(`http://${MONITORSERVER}/api/report`)
  if (!res.data.nodes) return []
  const joining = Object.keys(res.data.nodes.joining)
  console.log('Joining nodes: ', joining)
  return joining
}

const getActiveNodes = async () => {
  const nodes = await getFullNodeList()
  if (!nodes || nodes.length === 0) return []
  const active = nodes.map(({ publicKey }) => publicKey)
  console.log('Active nodes: ', active)
  return active
}

const loadStakedNodeLists = async () => {
  try {
    const data = await fs.promises.readFile(stakedNodeListsFile, 'utf8')
    console.log('stakedNodeLists', data)
    return JSON.parse(data)
  } catch (err) {
    saveEntries({}, stakedNodeListsFile)
    console.log(`Created stakedNodeLists file '${stakedNodeListsFile}'.`)
    return {}
  }
}

// Function to load and fund accounts from staked node lists
const loadAndFundStakedAccounts = async (fundAmount) => {
  try {
    const stakedNodeLists = await loadStakedNodeLists()
    const stakedAccounts = Object.values(stakedNodeLists)

    if (stakedAccounts.length === 0) {
      console.log('No staked accounts found in stakedNodeLists.json')
      return { success: false, message: 'No staked accounts found' }
    }

    console.log(`Found ${stakedAccounts.length} staked accounts. Funding each with ${fundAmount} tokens...`)

    const results = []
    for (let i = 0; i < stakedAccounts.length; i++) {
      const account = stakedAccounts[i]

      // Convert the account keys to the expected format
      const accountInfo = {
        address: toShardusAddress(new ethers.Wallet(account.secretKey).address),
        keys: account,
      }

      console.log(`Funding account ${i + 1}/${stakedAccounts.length}: ${accountInfo.address}`)

      // Create funding transaction
      const createTx = {
        type: 'create',
        from: accountInfo.address,
        to: accountInfo.address,
        amount: wintoWei(fundAmount),
        timestamp: Date.now(),
      }

      // Sign and send transaction
      signTransaction(createTx, accountInfo.keys)
      const res = await injectTx(createTx)

      results.push({
        address: accountInfo.address,
        result: res,
        success: res && res.result && res.result.success,
      })

      console.log(`Account ${accountInfo.address}: ${res && res.result && res.result.success ? 'SUCCESS' : 'FAILED'}`)

      // Small delay between transactions
      await _sleep(ONE_SECOND * 1)
    }

    const successCount = results.filter((r) => r.success).length
    console.log(`\nFunding complete: ${successCount}/${stakedAccounts.length} accounts funded successfully`)

    return {
      success: true,
      total: stakedAccounts.length,
      funded: successCount,
      results: results,
    }
  } catch (error) {
    console.error('Error loading and funding staked accounts:', error)
    return { success: false, error: error.message }
  }
}
// Custom JSON stringify replacer for BigInt
const jsonStringifyReplacer = (key, value) => {
  if (typeof value === 'bigint') {
    return {
      type: 'BigInt',
      value: value.toString(),
    }
  }
  return value
}

function wintoWei(value) {
  return ethers.parseEther(String(value))
}

function weiToWin(wei) {
  return Number(wei) / 10 ** 18
}

// Full-precision wei → WIN string using ethers.formatEther (avoids Number() truncation on large
// BigInt values). Use this for all DAO display where exact amounts matter.
function weiToWinStr(wei) {
  try {
    return ethers.formatEther(BigInt(wei))
  } catch {
    return (Number(wei) / 10 ** 18).toString()
  }
}

// COMMAND TO REQUEST TOKENS FROM THE FAUCET
vorpal.command('faucet', 'requests tokens from the faucet server').action(async function (_, callback) {
  if (!FAUCETSERVER) {
    this.log('No faucet is configured. The local test network does not fund wallets automatically.')
    callback()
    return
  }
  try { await connectWin() } catch (error) { this.log(error.message); callback(); return }
  // Check if user has registered an alias
  if (!USER.alias) {
    this.log('You need to register an alias first using the "register" command')
    callback()
    return
  }

  const answer = await this.prompt({
    type: 'input',
    name: 'nodeAddress',
    message: 'Enter the node address (optional, press enter to skip): ',
  })

  try {
    // Prepare the faucet request data
    const faucetData = {
      username: USER.alias, // Using registered alias as username
      userAddress: USER.address,
      networkId: networkId,
    }

    // Add nodeAddress if provided
    if (answer.nodeAddress && answer.nodeAddress.trim() !== '') {
      faucetData.nodeAddress = answer.nodeAddress.trim()
    }

    // Sign the faucet request using Ethereum signature
    signTransaction(faucetData)

    this.log('Sending faucet request...')
    this.log('Request data:', faucetData)

    // Send POST request to faucet server
    const response = await axios.post(`${PROTOCOL}://${FAUCETSERVER}/faucet`, faucetData)

    // Display the response
    this.log('\n--- Faucet Response ---')
    this.log(`Success: ${response.data.success}`)
    this.log(`Request ID: ${response.data.requestId}`)
    if (response.data.txHash) {
      this.log(`Transaction Hash: ${response.data.txHash}`)
    }
    this.log(`Message: ${response.data.message}`)
    this.log('----------------------\n')

    callback()
  } catch (error) {
    this.log('Error requesting tokens from faucet:')
    if (error.response) {
      this.log(`Status: ${error.response.status}`)
      this.log(`Message: ${error.response.data?.message || error.response.statusText}`)
    } else {
      this.log(error.message)
    }
    callback()
  }
})

// =============================================================================
// DAO COMMANDS (Phase 1: governance / economic / protocol proposals)
// =============================================================================

// Helper: compute the proposals meta account address
function daoMetaId() {
  return crypto.hash('dao proposals meta')
}

// Helper: compute a proposal account address by proposal number
function daoProposalId(n) {
  return crypto.hash(`dao proposal #${n}`)
}

// DAO API responses use res.send(Utils.safeStringify(...)) — body may be a JSON string.
function parseDaoApiBody(data) {
  // If axios ever leaves the body as a raw JSON string (e.g. silentJSONParsing fallback),
  // parse it directly — re-stringifying a string would double-encode it and safeJsonParse
  // would hand back the original string unparsed.
  if (typeof data === 'string') return Utils.safeJsonParse(data)
  // Otherwise, round-trip through safeStringify + safeJsonParse so Shardus-serialized BigInt
  // objects ({ dataType: 'bi', value: '<hex>' }) that axios leaves as plain JS objects are
  // properly revived as native BigInt values before any display or arithmetic.
  return Utils.safeJsonParse(Utils.safeStringify(data))
}

function asBigIntForDisplay(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' || typeof value === 'number') return BigInt(value)
  return 0n
}

function formatDaoProposalChanges(p) {
  const payload = p.governance || p.economic || p.protocol
  const changes = payload?.changes
  if (!Array.isArray(changes)) return ''
  if (Array.isArray(changes[0])) {
    return changes
      .map((changeSet, i) => `${p.options?.[i + 1] || `option ${i + 1}`}: ${JSON.stringify(changeSet)}`)
      .join('\n              ')
  }
  return JSON.stringify(changes)
}

// Pre-title proposals deserialize without `title`; treat missing/empty as untitled.
function formatDaoTitle(title, maxLen = Infinity) {
  const text = typeof title === 'string' && title.length > 0 ? title : '(untitled)'
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

// Mirrors utils.usdStrToWei on the server — converts a USD-string snapshot to Wei at the
// given exchange rate.
function usdStrToWei(usdStr, stabilityFactorStr) {
  const stabilityFactor = ethers.parseEther(stabilityFactorStr)
  const usdBigInt = ethers.parseEther(usdStr)
  return (usdBigInt * 10n ** 18n) / stabilityFactor
}

async function getStabilityFactorStr() {
  const res = await axios.get(`${PROTOCOL}://${HOST}/network/parameters`)
  return res.data?.parameters?.current?.stabilityFactorStr ?? '1'
}

// Helper: fetch the meta account to get current count
async function getDaoMeta() {
  const res = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/meta`)
  const body = parseDaoApiBody(res.data)
  return body?.meta ?? null
}

async function getDaoGraceDurationMs() {
  const res = await axios.get(`${PROTOCOL}://${HOST}/network/parameters`)
  return res.data?.parameters?.current?.dao?.graceDuration ?? 7 * ONE_DAY
}

// ---------------------------------------------------------------------------
// dao proposal create
// ---------------------------------------------------------------------------
vorpal.command('dao proposal create', 'create a new DAO governance/economic/protocol/project proposal').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'list',
      name: 'proposalType',
      message: 'Proposal type:',
      choices: ['governance', 'economic', 'protocol', 'project'],
    },
    {
      type: 'confirm',
      name: 'emergency',
      message: 'Is this an emergency proposal?',
      default: false,
    },
    {
      type: 'input',
      name: 'title',
      message: 'Enter a title for the proposal:',
      validate: (value) => {
        const title = value.trim()
        if (title.length === 0) return 'Title must not be empty.'
        if (title.length > 100) return 'Title must be at most 100 characters.'
        return true
      },
      filter: (value) => value.trim(),
    },
    {
      type: 'input',
      name: 'description',
      message: 'Enter a description for the proposal:',
    },
    {
      type: 'input',
      name: 'options',
      message: 'Enter ballot options as comma-separated list (e.g. no,Increase burn,Decrease burn):',
      default: 'no,yes',
    },
    {
      type: 'input',
      name: 'contractorAddress',
      message: 'Contractor address (project only):',
      when: (a) => a.proposalType === 'project',
    },
    {
      type: 'input',
      name: 'milestonesJson',
      message:
        'Milestones as a JSON array (project only) — e.g. ' +
        '[{"title":"Design","description":"Design it","deliverable":"A doc","duration":604800000,' +
        '"costUsdStr":"1000","penaltyUsdStr":"100","bonusUsdStr":"50"}]:',
      when: (a) => a.proposalType === 'project',
    },
    {
      type: 'input',
      name: 'changesJson',
      message:
        'Enter parameter change sets as JSON array — one set per action option, so the options example above needs two ' +
        '(e.g. [[{"key":"pctBurned","value":"60","current":"50"}],[{"key":"pctBurned","value":"40","current":"50"}]]):',
      default: '[]',
      when: (a) => a.proposalType !== 'project',
    },
    {
      type: 'number',
      name: 'gracePeriodDays',
      message: 'Grace period in days (0 = use full network graceDuration):',
      default: 0,
    },
  ])

  try {
    const meta = await getDaoMeta()
    const nextCount = meta ? meta.count + 1 : 1
    const metaId = daoMetaId()
    const proposalId = daoProposalId(nextCount)

    const options = answers.options.split(',').map((s) => s.trim())
    // Projects supply milestones and a contractor; changesJson is ignored for them.
    const changes = answers.proposalType === 'project' ? [] : JSON.parse(answers.changesJson)
    const maxGraceMs = await getDaoGraceDurationMs()
    const gracePeriod =
      answers.gracePeriodDays <= 0
        ? maxGraceMs
        : Math.min(answers.gracePeriodDays * ONE_DAY, maxGraceMs)

    const typePayload = {}
    if (answers.proposalType === 'project') {
      typePayload.project = { milestones: JSON.parse(answers.milestonesJson), address: answers.contractorAddress.trim() }
    } else if (answers.proposalType === 'governance') typePayload.governance = { changes }
    else if (answers.proposalType === 'economic') typePayload.economic = { changes }
    else if (answers.proposalType === 'protocol') typePayload.protocol = { changes }

    const tx = {
      type: 'dao_proposal_create',
      from: USER.address,
      proposalId,
      metaId,
      emergency: answers.emergency,
      proposalType: answers.proposalType,
      gracePeriod,
      title: answers.title,
      description: answers.description,
      options,
      ...typePayload,
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
    this.log(`Proposal #${nextCount} submitted. Address: ${proposalId}`)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao committee vote
// ---------------------------------------------------------------------------
vorpal.command('dao committee vote', 'cast a committee accept/withhold vote on a proposal').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'proposalNumber',
      message: 'Enter proposal number:',
    },
    {
      type: 'list',
      name: 'vote',
      message: 'Your vote:',
      choices: ['accept', 'withhold'],
    },
    {
      // NOTE: the server schema (schemaDaoCommitteeVoteTX, additionalProperties: false) and
      // dao_committee_vote.validate_fields() expect "withheldReason" (a required, non-empty
      // string when vote === 'withhold') — NOT "reason". Sending "reason" gets the whole tx
      // rejected by AJV before it ever reaches the handler.
      type: 'input',
      name: 'withheldReason',
      message: 'Reason for withholding:',
      when: (currentAnswers) => currentAnswers.vote === 'withhold',
      validate: (input) => (typeof input === 'string' && input.trim().length > 0) || 'A non-empty reason is required when withholding',
    },
  ])

  try {
    const proposalId = daoProposalId(answers.proposalNumber)
    const tx = {
      type: 'dao_committee_vote',
      from: USER.address,
      proposalId,
      vote: answers.vote,
      timestamp: Date.now(),
    }
    if (answers.vote === 'withhold') {
      tx.withheldReason = answers.withheldReason.trim()
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao committee result
// ---------------------------------------------------------------------------
vorpal.command('dao committee result', 'finalize committee review after review period ends').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'proposalNumber',
      message: 'Enter proposal number:',
    },
  ])

  try {
    const proposalId = daoProposalId(answers.proposalNumber)
    const tx = {
      type: 'dao_committee_result',
      from: USER.address,
      proposalId,
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao vote
// ---------------------------------------------------------------------------
vorpal.command('dao vote', 'cast a community vote on a proposal').action(async function (args, callback) {
  try {
    const { proposalNumber } = await this.prompt([
      {
        type: 'number',
        name: 'proposalNumber',
        message: 'Enter proposal number:',
      },
    ])

    const proposalId = daoProposalId(proposalNumber)

    // NOTE: the v2 dao_vote schema/handler expect "weights" — an array of per-option weights
    // sized to proposal.options.length (NOT a single "optionIndex"; see schemaDaoVoteTX,
    // additionalProperties: false — sending optionIndex gets the whole tx rejected by AJV).
    // Fetch the proposal first so we know how many options exist and can build that array.
    const proposalRes = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/${proposalNumber}`)
    const body = parseDaoApiBody(proposalRes.data)
    const proposal = body?.proposal
    if (!proposal || !Array.isArray(proposal.options) || proposal.options.length < 2) {
      this.log(`Proposal #${proposalNumber} not found or has no votable options.`)
      return callback()
    }

    const stabilityFactorStr = await getStabilityFactorStr()
    const minimumSpendWei = usdStrToWei(proposal.minimumSpendUsdStr, stabilityFactorStr)

    const { optionIndex, spendWin } = await this.prompt([
      {
        type: 'list',
        name: 'optionIndex',
        message: 'Select an option to vote for:',
        choices: proposal.options.map((opt, i) => ({ name: `${i}: ${opt}`, value: i })),
      },
      {
        type: 'number',
        name: 'spendWin',
        message: `Amount of WIN to spend on this vote (minimum = ${weiToWinStr(minimumSpendWei)} WIN):`,
        default: Number(weiToWinStr(minimumSpendWei)),
      },
    ])

    // Put the entire selection weight on the chosen option — equivalent to the old
    // single-choice "optionIndex" UX, expressed in the new additive weights[] model
    // (weights[i] maps 1:1 onto proposal.options[i]; see dao_vote.ts validate_fields).
    const weights = proposal.options.map((_, i) => (i === optionIndex ? 1 : 0))

    const tx = {
      type: 'dao_vote',
      from: USER.address,
      proposalId,
      weights,
      spend: wintoWei(spendWin),
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao vote result
// ---------------------------------------------------------------------------
vorpal.command('dao vote result', 'finalize community vote after voting period ends').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'proposalNumber',
      message: 'Enter proposal number:',
    },
  ])

  try {
    const proposalId = daoProposalId(answers.proposalNumber)
    const tx = {
      type: 'dao_vote_result',
      from: USER.address,
      proposalId,
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao apply parameters
// ---------------------------------------------------------------------------
vorpal.command('dao apply parameters', 'apply an accepted proposal after the grace period').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'proposalNumber',
      message: 'Enter proposal number:',
    },
  ])

  try {
    const proposalId = daoProposalId(answers.proposalNumber)
    const tx = {
      type: 'dao_apply_parameters',
      from: USER.address,
      proposalId,
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao unapply parameters
// ---------------------------------------------------------------------------
vorpal
  .command('dao unapply parameters', 'submit a committee vote to revert an applied proposal back to accepted')
  .action(async function (args, callback) {
    const answers = await this.prompt([
      {
        type: 'number',
        name: 'proposalNumber',
        message: 'Enter proposal number:',
      },
    ])

    try {
      const proposalId = daoProposalId(answers.proposalNumber)
      const tx = {
        type: 'dao_unapply_parameters',
        from: USER.address,
        proposalId,
        timestamp: Date.now(),
      }
      signTransaction(tx)
      const res = await injectTx(tx)
      this.log(res)
    } catch (err) {
      this.log('Error:', err.message)
    }
    callback()
  })

// ---------------------------------------------------------------------------
// dao cancel
// ---------------------------------------------------------------------------
vorpal
  .command('dao cancel', 'cancel a proposal that is in review, voting or accepted status (committee only)')
  .action(async function (args, callback) {
    const answers = await this.prompt([
      {
        type: 'number',
        name: 'proposalNumber',
        message: 'Enter proposal number:',
      },
    ])

    try {
      const proposalId = daoProposalId(answers.proposalNumber)
      const tx = {
        type: 'dao_cancel',
        from: USER.address,
        proposalId,
        timestamp: Date.now(),
      }
      signTransaction(tx)
      const res = await injectTx(tx)
      this.log(res)
    } catch (err) {
      this.log('Error:', err.message)
    }
    callback()
  })

// ---------------------------------------------------------------------------
// dao claim reward
// ---------------------------------------------------------------------------
vorpal.command('dao claim reward', 'claim your voter reward for a proposal').action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'proposalNumber',
      message: 'Enter proposal number:',
    },
  ])

  try {
    const proposalId = daoProposalId(answers.proposalNumber)
    const tx = {
      type: 'dao_claim_reward',
      from: USER.address,
      proposalId,
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao burn reward
// ---------------------------------------------------------------------------
vorpal.command('dao burn reward', "burn the unclaimed voter reward for a proposal after the claim period ends").action(async function (args, callback) {
  const answers = await this.prompt([
    {
      type: 'number',
      name: 'proposalNumber',
      message: 'Enter proposal number:',
    },
  ])

  try {
    const proposalId = daoProposalId(answers.proposalNumber)
    const tx = {
      type: 'dao_burn_reward',
      from: USER.address,
      proposalId,
      timestamp: Date.now(),
    }
    signTransaction(tx)
    const res = await injectTx(tx)
    this.log(res)
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao proposals  (query — fetches meta for count, then each proposal by number)
// ---------------------------------------------------------------------------
// Deliberately still the full O(N) historical scan, not migrated to the index. The index is
// populated by status transitions, and older proposals are backfilled only once a proposal is
// created after the upgrade, so listing
// from it would silently omit proposals that exist but have not been backfilled yet — wrong for
// the command whose job is the complete list. `dao summary` is the fast recent-activity path;
// this one stays exhaustive.
const VALID_DAO_STATUSES = ['review', 'withheld', 'voting', 'rejected', 'accepted', 'applied', 'canceled', 'executing', 'completed', 'terminated']

vorpal.command('dao proposals [status]', `list DAO proposals, optionally filtered by status (${VALID_DAO_STATUSES.join('/')})`).action(async function (args, callback) {
  if (args.status && !VALID_DAO_STATUSES.includes(args.status)) {
    this.log(`Unknown status "${args.status}". Valid values: ${VALID_DAO_STATUSES.join(', ')}`)
    callback()
    return
  }
  try {
    const metaRes = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/meta`)
    const metaBody = parseDaoApiBody(metaRes.data)
    const count = metaBody?.meta?.count ?? 0
    if (count === 0) {
      this.log('No proposals found.')
      callback()
      return
    }
    const BATCH = 10
    const proposals = []
    for (let start = 1; start <= count; start += BATCH) {
      const end = Math.min(start + BATCH - 1, count)
      const batch = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, k) => start + k).map(async i => {
          try {
            const res = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/${i}`)
            return parseDaoApiBody(res.data)?.proposal ?? null
          } catch (err) {
            if (err.response?.status === 404) return null  // not yet visible on this node
            throw err  // network failure or server error — propagate
          }
        })
      )
      proposals.push(...batch.filter(Boolean))
    }
    const filtered = args.status ? proposals.filter(p => p.status === args.status) : proposals
    if (filtered.length === 0) {
      this.log('No proposals found.')
    } else {
      for (const p of filtered) {
        const title = formatDaoTitle(p.title, 80)
        const options = Array.isArray(p.options) ? p.options.join('/') : ''
        this.log(`#${p.number} [${p.status}] ${p.proposalType} | ${title} | options: ${options} | pool: ${weiToWinStr(asBigIntForDisplay(p.voterRewardPool))} WIN`)
      }
    }
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao project ...  (project proposal lifecycle)
// ---------------------------------------------------------------------------
// Every project tx takes a proposal number and, where relevant, a 1-based milestone number —
// milestones are numbered from 1 in transactions but stored 0-based, and the server converts.
function projectTx(type, proposalNumber, extra = {}) {
  return { type, from: USER.address, proposalId: daoProposalId(proposalNumber), ...extra, timestamp: Date.now() }
}

async function submitProjectTx(ctx, tx) {
  try {
    signTransaction(tx)
    ctx.log(await injectTx(tx))
  } catch (err) {
    ctx.log('Error:', err.message)
  }
}

vorpal.command('dao project <number>', 'show a project proposal: milestones, balance and rate').action(async function (args, callback) {
  try {
    const res = await axios.get(`${PROTOCOL}://${HOST}/dao/projects/${args.number}`)
    const body = parseDaoApiBody(res.data)
    if (!body || body.error) {
      this.log(body?.error ?? `Project #${args.number} not found.`)
      callback()
      return
    }
    const p = body.project
    this.log(`\n--- Project #${body.number} [${body.status}] ---`)
    this.log(`Contractor:   ${p.address}`)
    if (p.proposedAddress) this.log(`Proposed:     ${p.proposedAddress} (${p.endorsedAddress?.length ?? 0} endorsements)`)
    this.log(`Balance:      ${weiToWinStr(asBigIntForDisplay(p.balance))} WIN  @ rate ${p.rateUsdStr}`)
    this.log(`Bonus/penalty thresholds: ${p.durationBonusPercentage}% / ${p.durationPenaltyPercentage}%`)
    if (p.startTime) this.log(`Started:      ${new Date(p.startTime).toISOString()}`)
    if (p.endTime) this.log(`Ended:        ${new Date(p.endTime).toISOString()}`)
    this.log(`Log entries:  ${body.logCount}`)
    this.log('Milestones:')
    ;(p.milestones ?? []).forEach((m, i) => {
      const paid = asBigIntForDisplay(m.paid)
      const timing = m.startTime && m.endTime ? ` ${Math.round((m.endTime - m.startTime) / 86400000)}d of ${Math.round(m.duration / 86400000)}d planned` : ''
      const pending = m.proposedTime ? ` | proposed ${new Date(m.proposedTime).toISOString()} (${m.endorsedTime?.length ?? 0} endorsements)` : ''
      const votes = m.terminateVotes?.length ? ` | ${m.terminateVotes.length} terminate vote(s)` : ''
      this.log(`  ${i + 1}. [${m.status}] ${m.title} | cost ${m.costUsdStr} USD${timing} | paid ${weiToWinStr(paid)} WIN${pending}${votes}`)
    })
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

vorpal.command('dao project logs <number>', 'show a project audit trail').action(async function (args, callback) {
  try {
    const res = await axios.get(`${PROTOCOL}://${HOST}/dao/projects/${args.number}/logs`)
    const logs = parseDaoApiBody(res.data)?.logs ?? []
    if (logs.length === 0) this.log('No log entries.')
    for (const l of logs) {
      // params is a structured object; render it as key=value pairs rather than stringifying it.
      const params = Object.entries(l.params ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
      this.log(`${new Date(l.timestamp).toISOString()} ${l.txType} by ${l.caller}${params ? ` | ${params}` : ''}`)
    }
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

vorpal.command('dao project start <number>', 'start an accepted project and mint its balance (committee only)').action(async function (args, callback) {
  await submitProjectTx(this, projectTx('dao_project_start', args.number))
  callback()
})

vorpal.command('dao project end <number>', 'end a project once every milestone is finished (committee only)').action(async function (args, callback) {
  await submitProjectTx(this, projectTx('dao_project_end', args.number))
  callback()
})

vorpal.command('dao project reclaim <number>', 'reclaim an unclaimed project balance after the delay (committee only)').action(async function (args, callback) {
  await submitProjectTx(this, projectTx('dao_project_reclaim_balance', args.number))
  callback()
})

vorpal
  .command('dao project address <number>', 'propose or endorse a new contractor address (committee only)')
  .action(async function (args, callback) {
    // Blank endorses whatever is pending; a value proposes a replacement and resets endorsements.
    const answers = await this.prompt([{ type: 'input', name: 'proposedAddress', message: 'New contractor address (blank to endorse the pending one):' }])
    const extra = answers.proposedAddress?.trim() ? { proposedAddress: answers.proposedAddress.trim() } : {}
    await submitProjectTx(this, projectTx('dao_project_change_address', args.number, extra))
    callback()
  })

// No milestone argument: the server acts on the next pending milestone for a start and the
// executing one for an end, as the policy specifies.
for (const [command, type, verb] of [
  ['dao milestone start <number>', 'dao_project_milestone_start', 'start'],
  ['dao milestone end <number>', 'dao_project_milestone_end', 'end'],
]) {
  vorpal.command(command, `propose or endorse a milestone ${verb} time (contractor or committee)`).action(async function (args, callback) {
    // Blank endorses the pending time; the first value proposes one. A time can only be proposed
    // once per milestone, and may not be in the future — the server rejects both rather than
    // resetting the endorsements or crediting unserved duration.
    const answers = await this.prompt([{ type: 'input', name: 'proposedTime', message: `Proposed ${verb} time in ms since epoch (blank to endorse):` }])
    const extra = answers.proposedTime?.trim() ? { proposedTime: Number(answers.proposedTime.trim()) } : {}
    await submitProjectTx(this, projectTx(type, args.number, extra))
    callback()
  })
}

vorpal
  .command('dao milestone terminate <number> <milestone>', 'vote to terminate a milestone (committee only)')
  .action(async function (args, callback) {
    const answers = await this.prompt([{ type: 'input', name: 'reason', message: 'Reason for terminating:' }])
    await submitProjectTx(this, projectTx('dao_project_milestone_terminate', args.number, { milestoneNumber: args.milestone, reason: answers.reason }))
    callback()
  })

vorpal.command('dao milestone claim <number> <milestone>', 'claim payment for a completed milestone (contractor only)').action(async function (args, callback) {
  await submitProjectTx(this, projectTx('dao_project_milestone_claim', args.number, { milestoneNumber: args.milestone }))
  callback()
})

// ---------------------------------------------------------------------------
// dao summary  (query — the recently-active index, then details for just those)
// ---------------------------------------------------------------------------
// Separate command rather than a `dao proposals` sub-word: `dao proposals [status]` would parse
// "summary" as a status and reject it.
vorpal
  .command('dao summary [status]', `list the 20 most recently active DAO proposals, optionally filtering those entries by status (${VALID_DAO_STATUSES.join('/')})`)
  .action(async function (args, callback) {
    if (args.status && !VALID_DAO_STATUSES.includes(args.status)) {
      this.log(`Unknown status "${args.status}". Valid values: ${VALID_DAO_STATUSES.join(', ')}`)
      callback()
      return
    }
    try {
      const summaryRes = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/summary`)
      const summary = parseDaoApiBody(summaryRes.data) ?? {}
      const entries = summary.proposals ?? []
      const selected = args.status ? entries.filter(e => e.status === args.status) : entries
      if (selected.length === 0) {
        // An empty index on a network that has proposals is expected until dao_proposal_create
        // has backfilled them — `dao proposals` still lists everything by walking meta.count.
        const countText = typeof summary.count === 'number' && summary.count > 0 ? ` (${summary.count} total proposals)` : ''
        this.log(`No proposals in the recent-activity index${countText}.`)
        callback()
        return
      }
      // Step two: one detail fetch per selected entry, not per proposal on the network. This is
      // what the index buys — the list stays 20 requests wide however many proposals exist.
      const details = await Promise.all(
        selected.map(async e => {
          try {
            const res = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/${e.proposal}`)
            return parseDaoApiBody(res.data)?.proposal ?? null
          } catch (err) {
            if (err.response?.status === 404) return null // not yet visible on this node
            throw err // network failure or server error — propagate
          }
        })
      )
      selected.forEach((e, i) => {
        const active = new Date(e.timestamp).toISOString()
        const flag = e.emergencyFlag ? ' [emergency]' : ''
        const p = details[i]
        if (!p) {
          // Index entry without a reachable account — show what the index knows rather than
          // dropping the row, so a gap is visible instead of silent.
          this.log(`#${e.proposal} [${e.status}]${flag} | active ${active} | (details unavailable on this node)`)
          return
        }
        const title = formatDaoTitle(p.title, 60)
        this.log(`#${e.proposal} [${e.status}]${flag} | active ${active} | ${p.proposalType} | ${title} | pool: ${weiToWinStr(asBigIntForDisplay(p.voterRewardPool))} WIN`)
      })
    } catch (err) {
      this.log('Error:', err.message)
    }
    callback()
  })

// ---------------------------------------------------------------------------
// dao proposal <n>  (query single)
// ---------------------------------------------------------------------------
function deriveTiming(p) {
  const reviewEnd = p.startTime + p.reviewDuration
  // Uses the real dao_committee_result time once it's run (see daoProposalAccount.ts);
  // falls back to the scheduled time otherwise.
  const votingStart = p.votingStartedAt ?? reviewEnd
  const votingEnd = p.emergency ? votingStart : votingStart + p.votingDuration
  const votingEndedAt = p.votingEndedAt ?? votingEnd
  const claimEnd = votingEndedAt + p.claimDuration
  const applyEligibleAt = votingEndedAt + p.gracePeriod
  return { reviewEnd, votingStart, votingEnd, claimEnd, applyEligibleAt }
}

vorpal.command('dao proposal <number>', 'show details of a single DAO proposal').action(async function (args, callback) {
  try {
    const res = await axios.get(`${PROTOCOL}://${HOST}/dao/proposals/${args.number}`)
    const body = parseDaoApiBody(res.data)
    const p = body?.proposal
    if (!p) {
      this.log(`Proposal #${args.number} not found.`)
    } else {
      this.log(`\n--- Proposal #${p.number} ---`)
      this.log(`Title:        ${formatDaoTitle(p.title)}`)
      this.log(`ID:           ${p.id}`)
      this.log(`Status:       ${p.status}`)
      this.log(`Type:         ${p.proposalType}${p.emergency ? ' (EMERGENCY)' : ''}`)
      // Economics snapshot (USD-string fields converted to WIN at the live rate)
      const stabilityFactorStr = await getStabilityFactorStr()
      this.log(`Proposal fee: ${p.emergency ? '0 WIN (waived - emergency)' : `${weiToWinStr(usdStrToWei(p.proposalFeeUsdStr, stabilityFactorStr))} WIN (${p.proposalFeeUsdStr} USD)`}`)
      this.log(`Vote thresh:  ${weiToWinStr(usdStrToWei(p.voteThresholdUsdStr, stabilityFactorStr))} WIN (${p.voteThresholdUsdStr} USD)`)
      this.log(`Min spend:    ${weiToWinStr(usdStrToWei(p.minimumSpendUsdStr, stabilityFactorStr))} WIN (${p.minimumSpendUsdStr} USD)`)
      this.log(`Pct burned:   ${p.pctBurned}% (after vote result)`)
      // Voting state
      this.log(`Options:      ${p.options.join(', ')}`)
      this.log(`Total weight: ${p.totalVote.map((w) => asBigIntForDisplay(w).toString()).join(', ')}`)
      if (p.winningOptionIndex !== undefined) {
        const winnerLabel = p.options?.[p.winningOptionIndex] ?? `index ${p.winningOptionIndex}`
        // Index 0 is the rejection lane, so a winning 0 means no change set applies at all.
        const outcome = p.winningOptionIndex > 0 ? `change set ${p.winningOptionIndex} applies` : 'rejection lane — no change set applies'
        this.log(`Winner:       [${p.winningOptionIndex}] ${winnerLabel}  (${outcome})`)
      }
      const voterRewardPool = asBigIntForDisplay(p.voterRewardPool)
      const claimedReward = asBigIntForDisplay(p.claimedReward)
      const initialBurnedReward = asBigIntForDisplay(p.initialBurnedReward)
      const finalBurnedReward = asBigIntForDisplay(p.finalBurnedReward)
      const claimableTotal = voterRewardPool > 0n ? voterRewardPool : claimedReward + finalBurnedReward
      this.log(`Reward pool:  ${weiToWinStr(voterRewardPool)} WIN`)
      this.log(`Burned:       initialBurnedReward: ${weiToWinStr(initialBurnedReward)} WIN | finalBurnedReward: ${weiToWinStr(finalBurnedReward)} WIN`)
      if (p.status === 'accepted' || p.status === 'rejected' || p.status === 'applied')
        this.log(`Claimed:      ${weiToWinStr(claimedReward)} / ${weiToWinStr(claimableTotal)} WIN`)
      this.log(`Voters:       ${p.voterList.length} | Claims: ${p.claimList.length}`)
      // Committee votes
      const committeeSize = Array.isArray(p.committeeAddresses) ? p.committeeAddresses.length : 0
      const votes = Array.isArray(p.committeeVotes) ? p.committeeVotes : []
      const acceptCount = votes.filter((v) => v.vote === 'accept').length
      const withholdCount = votes.filter((v) => v.vote === 'withhold').length
      this.log(`Committee:    ${votes.length}/${committeeSize} voted  (accept: ${acceptCount}, withhold: ${withholdCount})`)
      if (votes.length > 0) {
        for (const v of votes) {
          const addr = `${v.memberAddress.slice(0, 8)}...`
          const label = v.vote === 'withhold' ? `withhold — ${v.withheldReason || ''}` : v.vote
          this.log(`  ${addr}  ${label}`)
        }
      }
      // Threshold is live-configurable per network, so show the count alone — a hardcoded
      // "/N" could go stale after an operator changes it.
      if (p.status === 'applied') {
        const unapplyVotes = Array.isArray(p.unapplyVotes) ? p.unapplyVotes : []
        this.log(`Unapply:      ${unapplyVotes.length} committee approval(s) submitted`)
      }
      // Timeline (derived locally from stored duration snapshots)
      const timing = deriveTiming(p)
      this.log(`Current time: ${new Date().toISOString()}`)
      if (p.creationTime) this.log(`Created:      ${new Date(p.creationTime).toISOString()}`)
      if (p.startTime)    this.log(`Starts:       ${new Date(p.startTime).toISOString()}`)
      this.log(`Review ends:  ${new Date(timing.reviewEnd).toISOString()}`)
      if (!p.emergency)   this.log(`Voting ends:  ${new Date(timing.votingEnd).toISOString()}`)
      this.log(`Apply after:  ${new Date(timing.applyEligibleAt).toISOString()}`)
      this.log(`Claim ends:   ${new Date(timing.claimEnd).toISOString()}`)
      // Content
      this.log(`Description:  ${p.description}`)
      this.log(`Changes:      ${formatDaoProposalChanges(p)}`)
    }
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// ---------------------------------------------------------------------------
// dao voters <number>  (query by proposal number)
// ---------------------------------------------------------------------------
vorpal.command('dao voters <number>', 'show the voter list and claim list for proposal #N').action(async function (args, callback) {
  try {
    const proposalId = daoProposalId(parseInt(args.number, 10))
    const res = await axios.get(`${PROTOCOL}://${HOST}/dao/voters/${proposalId}`)
    const data = parseDaoApiBody(res.data)
    this.log(`Voters (${data.voterCount}):`)
    for (const v of data.voterList) {
      const claimed = data.claimList.includes(v.address) ? ' [claimed]' : ''
      this.log(`  ${v.address} at ${new Date(v.timestamp).toISOString()}${claimed}`)
    }
  } catch (err) {
    this.log('Error:', err.message)
  }
  callback()
})

// Manual WIN testing commands. Keep legacy administration/DAO commands above.
function manualCommand(command, description, action) {
  vorpal.command(command, description).action(async function (args, callback) {
    try { await action.call(this, args) } catch (error) { this.log(error.response?.data?.error || error.message) }
    callback()
  })
}
function showJson(ctx, value) {
  ctx.log(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2))
}
function readContent(file) {
  const location = resolve(file)
  if (fs.statSync(location).size > 256 * 1024) throw new Error('Content file exceeds 256 KiB')
  return JSON.parse(fs.readFileSync(location, 'utf8'))
}
function writeTemplate(file, content) {
  fs.writeFileSync(resolve(file), JSON.stringify(content, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}
async function confirmObject(ctx, tx) {
  ctx.log(`Action: ${tx.type} ${tx.action}\nObject ID: ${tx.objectId}\nExpected revision: ${tx.expectedRevision}\nFee: ${weiToWinStr(tx.fee)} WIN`)
  if (tx.requestHash) ctx.log(`Approval request hash: ${tx.requestHash}\nHiring profile: ${tx.hiringProfileId}`)
  const { confirmed } = await ctx.prompt({ type: 'confirm', name: 'confirmed', message: 'Submit this transaction?', default: false })
  if (confirmed) await injectTx(tx)
  else ctx.log('Canceled before submission.')
}

manualCommand('testing', 'show the manual WIN testing guide', async function () {
  this.log(`Manual WIN testing:
  network                       Check connection, ID, fee, and processing cycle
  bridge status                 Read bridge configuration and missing components
  wallet create alice           Create/select a local wallet (0 WIN)
  wallet create bob              Create/select another wallet
  wallet list                   Show public addresses
  use alice                     Select the sender
  address                       Show the current wallet address
  balance [wallet-or-address]   Read committed balance and payment nonce
  register                      Optional alias registration; does not fund wallet
  transfer                      Send WIN after reviewing amount, fee, and recipient
  transactions                  Show this client's submission journal
  receipt <txId>                Refresh a committed transaction status
  profile template person person.json
  profile create person.json    Save a profile; prints its object ID
  profile get <id>              Read current profile and revision
  profile update <id> <revision> person.json
  contract template contract.json
  contract create contract.json Save a work record without awarding score
  contract get <id>             Inspect work status, revision, and approval hash
  contract request <id>         Request approval from hiring profile controllers
  contract approve <id> <hiringProfileId> <requestHash>
  contract reject <id> <hiringProfileId> <requestHash>
  score <profileId>             Read the profile's numerical score

Profiles/contracts/payments require funded wallets. No local faucet is configured.
Endorsement and skill creation are not implemented on the server yet.
Edit generated JSON files before submission. See docs/MANUAL_TESTING.md.`)
})
manualCommand('network', 'check the current WIN network and payment fee', async function () {
  const protocol = await connectWin()
  this.log(`Node: ${HOST}\nNetwork ID: ${protocol.networkId}\nCurrency: WIN (18 decimals)\nTransfer fee: ${weiToWinStr(protocol.transferFee)} WIN`)
  const cycle = await winClient.ready()
  this.log(`Ready: cycle ${cycle.counter}, ${cycle.active} active validators.`)
})
manualCommand('address', 'show the selected wallet address', async function () {
  this.log(USER ? USER.address : 'Select a wallet with use <name>.')
})
manualCommand('bridge status', 'read bridge configuration and reserve status (does not move funds)', async function () {
  const protocol = await connectWin()
  const status = await winClient.get('/bridge/status')
  if (status.networkId !== protocol.networkId) throw new Error('Bridge status belongs to a different WIN network')
  showJson(this, status)
})
manualCommand('balance [wallet]', 'read the balance and next payment nonce', async function (args) {
  await connectWin()
  const id = args.wallet ? await getAddress(args.wallet) : USER.address
  const account = await winClient.account(id)
  this.log(`Address: ${id}`)
  if (!account) { this.log('0 WIN — wallet has no committed account yet. No automatic funding is available.'); return }
  if (account.type !== 'UserAccount') throw new Error('This address is not a wallet account')
  this.log(`Balance: ${weiToWinStr(account.data.balance)} WIN\nNext payment nonce: ${(account.data.transferNonce ?? 0) + 1}${account.alias ? '\nAlias: ' + account.alias : ''}`)
})
manualCommand('receipt <id>', 'read a committed receipt; absence means pending/unknown', async function (args) {
  const result = await winClient.receipt(args.id)
  this.log(`${result.txId}: ${result.status}`)
  if (result.receipt) showJson(this, result.receipt)
  else this.log(result.reason)
})
manualCommand('profile template <type> <file>', 'write a new profile content template (never overwrite)', async function (args) {
  writeTemplate(args.file, win.profileTemplate(args.type))
  this.log(`Created ${resolve(args.file)}. Edit it before running profile create.`)
})
manualCommand('contract template <file>', 'write a historical contract template (never overwrite)', async function (args) {
  writeTemplate(args.file, win.contractTemplate())
  this.log(`Created ${resolve(args.file)}. Replace the worker/hiring profile IDs and work details before submission.`)
})
for (const kind of ['profile', 'contract']) {
  manualCommand(`${kind} get <id>`, `read the current committed ${kind}`, async function (args) {
    showJson(this, await winClient.record(`${kind}s`, args.id))
  })
  manualCommand(`${kind} create <file> [id]`, `create a ${kind} from a JSON content file`, async function (args) {
    const tx = await winClient.objectTransaction(USER, kind, 'create', args.id || randomBytes(32).toString('hex'), 0, { payload: readContent(args.file) })
    await confirmObject(this, tx)
  })
  manualCommand(`${kind} update <id> <revision> <file>`, `replace ${kind} content at the revision you reviewed`, async function (args) {
    if (!/^[1-9][0-9]*$/.test(String(args.revision))) throw new Error('Use the committed revision shown by the get command')
    const tx = await winClient.objectTransaction(USER, kind, 'update', args.id, Number(args.revision), { payload: readContent(args.file) })
    await confirmObject(this, tx)
  })
}
for (const [command, action] of [['request', 'request_approval'], ['expire', 'expire'], ['approve', 'approve'], ['reject', 'reject']]) {
  const decision = action === 'approve' || action === 'reject'
  manualCommand(`contract ${command} <id>${decision ? ' <hiringProfileId> <requestHash>' : ''}`, `${command} the current contract approval request`, async function (args) {
    const { record } = await winClient.record('contracts', args.id)
    showJson(this, record)
    const extra = {}
    if (decision) {
      win.assertId(args.hiringProfileId, 'Hiring profile ID')
      win.assertId(args.requestHash, 'Request hash')
      if (record.approvalRequest?.hash !== args.requestHash) throw new Error('Request hash differs from the committed contract. Review contract get before approving.')
      extra.hiringProfileId = args.hiringProfileId
      extra.requestHash = args.requestHash
      if (action === 'reject') extra.reason = (await this.prompt({ type: 'input', name: 'reason', message: 'Rejection reason: ' })).reason
    }
    const tx = await winClient.objectTransaction(USER, 'contract', action, args.id, record.revision, extra)
    await confirmObject(this, tx)
  })
}
manualCommand('score <id>', 'read the numerical score of a profile', async function (args) {
  const { record } = await winClient.record('scores', args.id)
  this.log(`Stored score: ${record} (integer millionths)\nScore: ${ethers.formatUnits(BigInt(record), 6)}`)
})

vorpal.delimiter('>').show()
vorpal.exec('init').catch(error => vorpal.log(error.message))
