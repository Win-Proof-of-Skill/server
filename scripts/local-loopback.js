'use strict'

// Preloaded only by the local launcher. Some bundled HTTP services ignore their
// advertised IP and bind to every interface; constrain their TCP listeners here.
if (process.env.WIN_LOCAL_TEST !== '1') throw new Error('Local listener guard requires WIN_LOCAL_TEST=1')
const net = require('net')
// Shardus uses a native transport for its internal ports, outside Node's Server.
const shardusNet = require('@shardus/lib-net')
const createTransport = shardusNet.Sn
shardusNet.Sn = options => createTransport({ ...options, address: '127.0.0.1' })
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args) {
  if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) {
    args[0] = { ...args[0], host: '127.0.0.1' }
  } else if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1'
    else args.splice(1, 0, '127.0.0.1')
  }
  return listen.apply(this, args)
}
