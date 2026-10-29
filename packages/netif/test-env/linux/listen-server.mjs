//The server of test-env/linux/listen.sh: an http server listening on eth1 by listenOn(), answering with the address
//each connection reached; the events of its listener printed
import {createServer} from 'node:http'
import {listenOn} from '../../dist/esm/exports/Netif.js'

const server = createServer((request, response) => {
    response.setHeader('connection', 'close')
    response.end(`via ${request.socket.localAddress}`)
})
const listener = await listenOn('eth1', server, {port: 8080})
console.log(`listening enforced=${listener.enforced} ${JSON.stringify(listener.addresses.map(address => address.address))}`)
listener.on('listening', () => console.log(`listening again ${JSON.stringify(listener.addresses.map(address => address.address))}`))
listener.on('enforced', enforced => console.log(`enforced ${enforced}`))
listener.on('error', error => console.log(`error ${error.message}`))
listener.networkInterface.on('removed', () => console.log('eth1 removed'))
listener.networkInterface.on('added', () => console.log('eth1 added'))

//A UDP socket on eth1 (port 8081): its datagrams printed and answered upper case; the group 239.255.0.9 and ff15::9
const socket = await listener.networkInterface.createUDPSocket({port: 8081})
socket.setBroadcast(true)
socket.addMembership('239.255.0.9')
socket.addMembership('ff15::9')
console.log(`udp bound enforced=${socket.enforced}`)
socket.on('message', (message, remote) => {
    console.log(`udp ${message} from ${remote.address}`)
    socket.send(String(message).toUpperCase(), remote.port, remote.address)
})
socket.on('error', error => console.log(`udp error ${error.message}`))
