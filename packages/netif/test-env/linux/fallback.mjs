//Run by a user who may not bind a socket to an interface (Linux before 5.7 without CAP_NET_RAW): the interface given is
//listened on at its addresses, enforced false with its reason; strict, bindSocket() and multicast refused. Then it
//serves http on 8080 and echoes UDP on 8081 for the given seconds, for the requests of another machine.
//   node test-env/linux/fallback.mjs enp0s1 60
import {createServer} from 'node:http'
import {listenOn, NetIfNotEnforcedException, NetIfNotSupportedException, NetworkInterface} from '../../dist/esm/exports/Netif.js'

const [name, seconds] = process.argv.slice(2)
function check(description, ok, detail = '') {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` ${detail}` : ''}`)
    if (!ok) process.exitCode = 1
}
const server = createServer((request, response) => {
    response.setHeader('connection', 'close')
    response.end(`via ${request.socket.localAddress}`)
})
const listener = await listenOn(name, server, {port: 8080})
listener.on('error', error => console.log(`error ${error.message}`))
check('listened on by address, without the guarantee', listener.listening && listener.enforced === false, JSON.stringify(listener.addresses.map(address => address.address)))
check('the reason names CAP_NET_RAW', /CAP_NET_RAW/.test(listener.reason ?? ''))
try {
    await listenOn(name, createServer(), {port: 8090, strict: true})
    check('strict refused', false)
} catch (error) {
    check('strict refused', error instanceof NetIfNotEnforcedException, error.message.slice(0, 80))
}
const followed = new NetworkInterface(name)
try {
    followed.bindSocket()
    check('bindSocket() refused', false)
} catch (error) {
    check('bindSocket() refused', error instanceof NetIfNotEnforcedException)
}
const socket = await followed.createUDPSocket({port: 8081, family: 'IPv4'})
socket.on('error', error => console.log(`udp error ${error.message}`))
check('UDP bound by address, without the guarantee', socket.listening && socket.enforced === false)
try {
    socket.addMembership('239.255.0.9')
    check('multicast refused', false)
} catch (error) {
    check('multicast refused', error instanceof NetIfNotSupportedException)
}
socket.on('message', (message, remote) => {
    console.log(`udp ${message} from ${remote.address}`)
    socket.send(String(message).toUpperCase(), remote.port, remote.address)
})
console.log('ready')
setTimeout(() => process.exit(), Number(seconds ?? 60) * 1000)
