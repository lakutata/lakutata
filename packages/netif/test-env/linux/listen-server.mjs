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
