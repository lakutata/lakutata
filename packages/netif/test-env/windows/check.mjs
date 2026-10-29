//The checks of Windows that need a real interface (run as an administrator, on a machine whose addresses are not
//changed): the interface given listened on at each of its addresses (site-local and link-local IPv6 included) and
//reached from this machine; a strict listener while another interface (the loopback) receives with the weak host model
//for a moment (Set-NetIPInterface in the active store, set back at once): enforced false, the listening stopped, then
//enforced and listening again; a UDP socket joining an IPv4 and an IPv6 multicast group by address.
//   node test-env/windows/check.mjs 以太网
import {execFileSync} from 'node:child_process'
import {createSocket} from 'node:dgram'
import {createServer} from 'node:http'
import {connect} from 'node:net'
import {listenOn, NetworkInterface} from '../../dist/esm/exports/Netif.js'

const name = process.argv[2]
function check(description, ok, detail = '') {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` ${detail}` : ''}`)
    if (!ok) process.exitCode = 1
}
function connectTo(host, port) {
    return new Promise(resolve => {
        const socket = connect({host, port})
        socket.setTimeout(3000, () => {
            socket.destroy()
            resolve('timed out')
        })
        socket.on('data', data => {
            socket.destroy()
            resolve(String(data))
        })
        socket.on('error', error => resolve(error.code))
    })
}
function powershell(command) {
    execFileSync('powershell', ['-NoProfile', '-Command', command], {stdio: 'inherit'})
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

//Each address of the interface listened on and reached
const server = createServer()
server.on('connection', socket => socket.end('hello'))
const listener = await listenOn(name, server, {port: 0})
listener.on('error', error => console.log(`error ${error.message}`))
check('listening', listener.listening, `enforced=${listener.enforced} ${listener.reason ?? ''}`)
for (const address of listener.addresses) {
    const host = address.family === 'IPv6' && address.scopeid ? `${address.address}%${address.scopeid}` : address.address
    check(`reached at ${host}`, await connectTo(host, address.port) === 'hello')
}
await listener.close()

//strict while the loopback receives with the weak host model for a moment
const strict = await listenOn(name, createServer(), {port: 0, family: 'IPv4', strict: true})
const events = []
strict.on('enforced', enforced => events.push(`enforced ${enforced}`))
strict.on('error', error => events.push(`error ${error.name}`))
strict.on('listening', () => events.push('listening'))
try {
    powershell('Set-NetIPInterface -InterfaceAlias "Loopback Pseudo-Interface 1" -AddressFamily IPv4 -WeakHostReceive Enabled -PolicyStore ActiveStore')
    await wait(1500)
    check('the guarantee lost: the listening stopped', !strict.enforced && !strict.listening, strict.reason ?? '')
} finally {
    powershell('Set-NetIPInterface -InterfaceAlias "Loopback Pseudo-Interface 1" -AddressFamily IPv4 -WeakHostReceive Disabled -PolicyStore ActiveStore')
}
await wait(1500)
check('the guarantee back: listening again', strict.enforced && strict.listening)
check('the events', events.join(', ') === 'enforced false, error NetIfNotEnforcedException, enforced true, listening', events.join(', '))
await strict.close()

//Multicast by address
const followed = new NetworkInterface(name)
const udp = await followed.createUDPSocket({port: 0})
const received = []
udp.on('message', message => received.push(String(message)))
udp.on('error', error => console.log(`udp error ${error.message}`))
udp.addMembership('239.255.0.9')
udp.addMembership('ff15::9')
const ipv4 = followed.addresses.find(address => address.family === 'IPv4')
for (const [group, type, via] of [['239.255.0.9', 'udp4', ipv4?.address], ['ff15::9', 'udp6', `::%${followed.index}`]]) {
    const sender = createSocket(type)
    await new Promise(resolve => sender.bind(0, resolve))
    sender.setMulticastInterface(via)
    sender.setMulticastLoopback(true)
    sender.send(`to ${group}`, udp.port, group)
    await wait(1000)
    sender.close()
    //Once: the groups are joined on one socket of the family, whatever the number of its addresses
    check(`multicast ${group} received once`, received.filter(text => text === `to ${group}`).length === 1, JSON.stringify(received))
}
followed.close()
