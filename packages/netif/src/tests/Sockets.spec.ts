import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createSocket, type Socket as UDPSocket} from 'node:dgram'
import {connect, createServer, type Server, type Socket} from 'node:net'
import {
    type BoundSocket,
    type InterfaceAddress,
    listInterfaces,
    NetIfNotSupportedException,
    NetworkInterface,
    type NetworkInterfaceInfo
} from '../exports/Netif.js'
import {addressEnforcement, type Enforcement} from '../lib/Enforcement.js'

const LINUX: boolean = process.platform === 'linux'

function loopback(): NetworkInterfaceInfo {
    return listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!
}

/**
 * Connects to the port of 127.0.0.1: 'connected', or the code of the error
 */
function connectTo(port: number): Promise<string> {
    return new Promise((resolve: (result: string) => void): void => {
        const socket: Socket = connect(port, '127.0.0.1')
        socket.setTimeout(3000, (): void => {
            socket.destroy()
            resolve('timed out')
        })
        socket.once('connect', (): void => {
            socket.destroy()
            resolve('connected')
        })
        socket.once('error', (error: NodeJS.ErrnoException): void => resolve(error.code ?? error.message))
    })
}

describe('A socket bound to an interface', (): void => {

    it('is for Linux only', {skip: LINUX ? 'Linux binds sockets to interfaces' : false}, (): void => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        try {
            assert.throws((): BoundSocket => followed.bindSocket(), NetIfNotSupportedException)
        } finally {
            followed.close()
        }
    })

    it('listens for the connections that come through its interface (TCP)', {skip: LINUX ? false : 'Linux only'}, async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const bound: BoundSocket = followed.bindSocket({port: 0})
        followed.close()
        assert.strictEqual(bound.type, 'tcp')
        assert.ok(bound.port > 0)
        const server: Server = createServer((socket: Socket): void => {
            socket.end()
        })
        await new Promise<void>((resolve: () => void): void => {
            server.listen({fd: bound.fd}, resolve)
        })
        try {
            assert.strictEqual(await connectTo(bound.port), 'connected')
        } finally {
            server.close()
        }
    })

    it('refuses the connections that come through another interface', {skip: LINUX ? false : 'Linux only'}, async (t): Promise<void> => {
        const other: NetworkInterfaceInfo | undefined = listInterfaces().find((entry: NetworkInterfaceInfo): boolean => !entry.loopback && entry.running && entry.addresses.length > 0)
        if (!other) return t.skip('no other interface with an address')
        const followed: NetworkInterface = new NetworkInterface(other.name)
        const bound: BoundSocket = followed.bindSocket()
        followed.close()
        const server: Server = createServer((socket: Socket): void => {
            socket.end()
        })
        await new Promise<void>((resolve: () => void): void => {
            server.listen({fd: bound.fd}, resolve)
        })
        try {
            //127.0.0.1 is reached through the loopback, not through the interface the socket is bound to
            assert.strictEqual(await connectTo(bound.port), 'ECONNREFUSED')
        } finally {
            server.close()
        }
    })

    it('receives the datagrams that come through its interface (UDP)', {skip: LINUX ? false : 'Linux only'}, async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const bound: BoundSocket = followed.bindSocket({type: 'udp'})
        followed.close()
        const socket: UDPSocket = createSocket('udp4')
        await new Promise<void>((resolve: () => void): void => {
            socket.bind({fd: bound.fd}, resolve)
        })
        try {
            const received: Promise<string> = new Promise((resolve: (text: string) => void): void => {
                socket.once('message', (message: Buffer): void => resolve(message.toString()))
            })
            const sender: UDPSocket = createSocket('udp4')
            sender.send('hello', bound.port, '127.0.0.1', (): void => {
                sender.close()
            })
            assert.strictEqual(await received, 'hello')
        } finally {
            socket.close()
        }
    })
})

describe('The guarantee of a listening by address', (): void => {

    it('is the strong host model of Windows and macOS, never on Linux', (): void => {
        const enforcement: Enforcement = addressEnforcement(loopback().index, ['IPv4', 'IPv6'])
        assert.strictEqual(typeof enforcement.enforced, 'boolean')
        if (!enforcement.enforced) assert.match(enforcement.reason ?? '', /\S/)
        if (process.platform === 'linux') {
            assert.strictEqual(enforcement.enforced, false)
            assert.match(enforcement.reason!, /CAP_NET_RAW/)
        }
        if (process.platform === 'darwin' && !enforcement.enforced) assert.match(enforcement.reason!, /check_interface|forwarding/)
    })
})
