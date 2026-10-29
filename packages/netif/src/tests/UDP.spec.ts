import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createSocket, type RemoteInfo, type Socket} from 'node:dgram'
import {
    type InterfaceAddress,
    type InterfaceUDPSocket,
    listInterfaces,
    NetIfException,
    NetIfNotSupportedException,
    NetworkInterface,
    type NetworkInterfaceInfo
} from '../exports/Netif.js'

function loopback(): NetworkInterfaceInfo {
    return listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!
}

function hasIPv6Loopback(): boolean {
    return loopback().addresses.some((address: InterfaceAddress): boolean => address.address === '::1')
}

/**
 * A datagram sent to the port of the host by a socket of its own, and the answer it gets (or 'no answer')
 */
async function exchange(host: string, port: number, text: string): Promise<string> {
    const sender: Socket = createSocket(host.includes(':') ? 'udp6' : 'udp4')
    try {
        return await new Promise((resolve: (answer: string) => void): void => {
            const timer: NodeJS.Timeout = setTimeout((): void => resolve('no answer'), 3000)
            sender.once('message', (message: Buffer): void => {
                clearTimeout(timer)
                resolve(message.toString())
            })
            sender.send(text, port, host)
        })
    } finally {
        sender.close()
    }
}

/**
 * The socket answers each datagram with its text, upper case
 */
function echo(socket: InterfaceUDPSocket): void {
    socket.on('message', (message: Buffer, remote: RemoteInfo): void => {
        socket.send(message.toString().toUpperCase(), remote.port, remote.address)
    })
}

describe('A UDP socket of an interface', (): void => {

    it('receives the datagrams of the interface and answers through it', async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const socket: InterfaceUDPSocket = await followed.createUDPSocket({port: 0, family: 'IPv4'})
        try {
            echo(socket)
            assert.strictEqual(socket.listening, true)
            assert.ok(socket.port! > 0)
            assert.ok(socket.addresses.some(address => address.address === '127.0.0.1'))
            assert.strictEqual(await exchange('127.0.0.1', socket.port!, 'ping'), 'PING')
        } finally {
            await socket.close()
            followed.close()
        }
        assert.strictEqual(socket.closed, true)
        assert.strictEqual(socket.listening, false)
    })

    it('is bound in both families by default', {skip: hasIPv6Loopback() ? false : 'no ::1'}, async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const socket: InterfaceUDPSocket = await followed.createUDPSocket({port: 0})
        try {
            echo(socket)
            assert.strictEqual(await exchange('127.0.0.1', socket.port!, 'four'), 'FOUR')
            assert.strictEqual(await exchange('::1', socket.port!, 'six'), 'SIX')
        } finally {
            followed.close()
        }
        assert.strictEqual(socket.closed, true)
    })

    it('sends broadcasts once allowed', async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const socket: InterfaceUDPSocket = await followed.createUDPSocket({port: 0, family: 'IPv4'})
        try {
            socket.setBroadcast(true)
            socket.setBroadcast(false)
        } finally {
            followed.close()
        }
    })

    it('joins multicast groups where its sockets are bound to the interface', async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const socket: InterfaceUDPSocket = await followed.createUDPSocket({port: 0, family: 'IPv4'})
        try {
            if (process.platform === 'darwin') {
                assert.throws((): void => socket.addMembership('239.255.0.9'), NetIfNotSupportedException)
            }
            assert.throws((): void => socket.addMembership('not a group'), TypeError)
        } finally {
            followed.close()
        }
    })

    it('tells a datagram it cannot send while it has no socket of the family', async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface('netif-absent0')
        const socket: InterfaceUDPSocket = await followed.createUDPSocket({port: 0, family: 'IPv4'})
        try {
            assert.strictEqual(socket.listening, false)
            const error: Error | null = await new Promise((resolve: (error: Error | null) => void): void => {
                socket.send('lost', 9, '127.0.0.1', resolve)
            })
            assert.ok(error instanceof NetIfException)
        } finally {
            followed.close()
        }
    })
})
