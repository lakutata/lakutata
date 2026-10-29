import {createSocket, type RemoteInfo, type Socket} from 'node:dgram'
import {isIP} from 'node:net'
import {NetIfException} from '../exceptions/NetIfException.js'
import {NetIfNotSupportedException} from '../exceptions/NetIfNotSupportedException.js'
import {Attachment, type Endpoint, type Target} from './Attachment.js'
import {type Family} from './Enforcement.js'
import {nativeMembership} from './Native.js'
import {type NetworkInterface} from './NetworkInterface.js'
import {type InterfaceAddress} from './Types.js'

/**
 * The options of `createUDPSocket()`.
 */
export interface UDPSocketOptions {
    /**
     * The port. 0: one the system chooses, kept when the socket is bound again.
     */
    port: number

    /**
     * The families: `'IPv4'`, `'IPv6'` or `'both'` (by default, a socket of each family inside). With `'both'`, a system
     * without IPv6 is bound in IPv4.
     */
    family?: 'IPv4' | 'IPv6' | 'both'

    /**
     * `true`: refused (a `NetIfNotEnforcedException`) where the system cannot refuse the datagrams reaching the addresses
     * of the interface through another interface, and stopped while that guarantee is lost. `false` by default.
     */
    strict?: boolean
}

/**
 * The events of an `InterfaceUDPSocket` and their arguments.
 */
export interface InterfaceUDPSocketEvents {
    /**
     * A datagram received: its content, and where it came from (as `dgram` gives it).
     */
    message: [message: Buffer, remote: RemoteInfo]

    /**
     * The interface is bound, after `createUDPSocket()` and each time it is bound again (an address added, the interface
     * plugged back).
     */
    listening: []

    /**
     * An error of a binding again, retried a little later, or of a socket; with `strict`, the guarantee lost (a
     * `NetIfNotEnforcedException`). Without a listener of `error`, the error is thrown, as for a `dgram` socket.
     */
    error: [error: Error]

    /**
     * Whether the datagrams coming through another interface are refused changed: its new value.
     */
    enforced: [enforced: boolean]

    /**
     * The socket was closed.
     */
    close: []
}

/**
 * Whether an IPv4 address is in the network of an address of the interface
 */
function sameNetwork(destination: string, address: InterfaceAddress): boolean {
    const toNumber = (text: string): number => text.split('.').reduce((value: number, part: string): number => value * 256 + Number(part), 0)
    const mask: number = toNumber(address.netmask)
    return (toNumber(destination) & mask) >>> 0 === (toNumber(address.address) & mask) >>> 0 || destination === '255.255.255.255'
}

/**
 * A UDP socket of a network interface: `NetworkInterface.createUDPSocket()`. Its methods and events are the ones of a
 * `dgram` socket. On Linux its sockets (one by family) are bound to the interface: they receive what comes through it,
 * its broadcasts and the multicast of the groups joined there, whatever its addresses, and send through it. On Windows
 * and macOS a socket is bound to each address of the interface, again when they change. The datagrams that arrive while
 * the socket is bound again are lost (UDP never guarantees their delivery).
 * @example
 * ```typescript
 * import {type InterfaceUDPSocket, NetworkInterface} from '@lakutata/netif'
 *
 * const lan: NetworkInterface = new NetworkInterface('eth1')
 * const socket: InterfaceUDPSocket = await lan.createUDPSocket({port: 5353})
 * socket.addMembership('224.0.0.251')
 * socket.on('message', (message, remote) => console.log(`${remote.address}:${remote.port}`, message.length))
 * socket.send('hello', 5353, '224.0.0.251')
 * ```
 */
export class InterfaceUDPSocket extends Attachment<InterfaceUDPSocketEvents, Socket> {

    protected readonly stream: boolean = false

    #broadcast: boolean = false

    readonly #groups: Set<string> = new Set()

    readonly #descriptors: WeakMap<Socket, number> = new WeakMap()

    /**
     * Internal: made by `NetworkInterface.createUDPSocket()`; `start()` binds it.
     * @param networkInterface The interface.
     * @param options The options of `createUDPSocket()`.
     * @param ownsInterface Whether the interface is closed with the socket.
     */
    constructor(networkInterface: NetworkInterface, options: UDPSocketOptions, ownsInterface: boolean = false) {
        super(networkInterface, options, ownsInterface)
    }

    protected openHandle(target: Target, family: Family): Promise<Socket> {
        const socket: Socket = createSocket({type: family === 'IPv4' ? 'udp4' : 'udp6'})
        return new Promise((resolve: (socket: Socket) => void, reject: (error: Error) => void): void => {
            const failed = (error: Error): void => {
                try {
                    socket.close()
                } catch {
                    //Not bound
                }
                reject(error)
            }
            const bound = (): void => {
                socket.off('error', failed)
                socket.on('error', (error: Error): void => this.failed(error))
                socket.on('message', (message: Buffer, remote: RemoteInfo): void => {
                    this.emit('message', message, remote)
                })
                resolve(socket)
            }
            socket.once('error', failed)
            if ('fd' in target) {
                this.#descriptors.set(socket, target.fd)
                socket.bind({fd: target.fd}, bound)
            } else {
                socket.bind({address: target.host, port: target.port, exclusive: true}, bound)
            }
        })
    }

    protected portOf(handle: Socket): number | undefined {
        return handle.address().port
    }

    protected closeHandle(handle: Socket): void {
        try {
            handle.close()
        } catch {
            //Closed already
        }
    }

    /**
     * A socket made: the broadcasts and the groups of the socket applied to it
     */
    protected prepare(endpoint: Endpoint<Socket>): void {
        if (endpoint.family === 'IPv4' && this.#broadcast) endpoint.handle.setBroadcast(true)
        for (const group of this.#groups) {
            if ((isIP(group) === 4 ? 'IPv4' : 'IPv6') !== endpoint.family) continue
            try {
                this.#membership(endpoint, group, true)
            } catch (error) {
                this.failed(error)
            }
        }
    }

    #membership(endpoint: Endpoint<Socket>, group: string, join: boolean): void {
        if (this.boundToInterface) {
            nativeMembership(this.#descriptors.get(endpoint.handle)!, group, this.networkInterface.index ?? 0, join)
            return
        }
        //Windows: the group on the interface of the address of the socket (IPv6: by the index of the interface)
        const via: string = endpoint.family === 'IPv4' ? endpoint.address!.address : `::%${this.networkInterface.index ?? 0}`
        if (join) {
            endpoint.handle.addMembership(group, via)
        } else {
            endpoint.handle.dropMembership(group, via)
        }
    }

    /**
     * Sends a datagram through the interface, from the socket of the family of the address (from the address of the
     * interface in the network of the destination, where its addresses are bound).
     * @param message The content.
     * @param port The port of the destination.
     * @param address The address of the destination (a broadcast address with `setBroadcast(true)`, a multicast group).
     * @param callback Called once it is sent, with the error if it could not be; without it, the error is an `error`
     * event.
     */
    public send(message: string | Uint8Array, port: number, address: string, callback?: (error: Error | null, bytes?: number) => void): void {
        const family: Family = isIP(address.split('%')[0]) === 6 ? 'IPv6' : 'IPv4'
        const endpoints: Endpoint<Socket>[] = this.endpoints().filter((endpoint: Endpoint<Socket>): boolean => endpoint.family === family)
        let chosen: Endpoint<Socket> | undefined = endpoints[0]
        if (!this.boundToInterface && endpoints.length > 1) {
            if (family === 'IPv4') {
                chosen = endpoints.find((endpoint: Endpoint<Socket>): boolean => sameNetwork(address, endpoint.address!)) ?? chosen
            } else {
                const linkLocal: boolean = address.toLowerCase().startsWith('fe80:')
                chosen = endpoints.find((endpoint: Endpoint<Socket>): boolean => endpoint.address!.address.startsWith('fe80:') === linkLocal) ?? chosen
            }
        }
        if (!chosen) {
            const error: NetIfException = new NetIfException(`No ${family} socket is bound to the interface now: it does not exist${this.boundToInterface ? '' : ` or has no ${family} address`}`)
            if (callback) {
                queueMicrotask((): void => callback(error))
            } else {
                queueMicrotask((): void => {
                    this.emit('error', error)
                })
            }
            return
        }
        chosen.handle.send(message, port, address, (error: Error | null, bytes?: number): void => {
            if (callback) {
                callback(error, bytes)
            } else if (error) {
                this.emit('error', error)
            }
        })
    }

    /**
     * Whether the datagrams may be sent to broadcast addresses (`SO_BROADCAST`), kept when the socket is bound again.
     * Where the addresses are bound (macOS, and Linux without the permission to bind to the interface) the broadcasts can
     * be sent, not received.
     * @param flag Whether they may.
     */
    public setBroadcast(flag: boolean): void {
        this.#broadcast = flag
        for (const endpoint of this.endpoints()) {
            if (endpoint.family === 'IPv4') endpoint.handle.setBroadcast(flag)
        }
    }

    /**
     * Joins a multicast group on the interface, kept when the socket is bound again: its datagrams are received.
     * @param group The address of the group: `'224.0.0.251'`, `'ff02::fb'`.
     * @throws NetIfNotSupportedException Where the addresses are bound on macOS and Linux: a socket bound to an address
     * receives no multicast.
     * @throws NetIfException The system refused, its code as `errno`.
     */
    public addMembership(group: string): void {
        if (!isIP(group)) throw new TypeError(`${group} is not the address of a multicast group`)
        if (!this.boundToInterface && process.platform !== 'win32') {
            throw new NetIfNotSupportedException(`A UDP socket bound to the addresses of an interface receives no multicast on ${process.platform === 'darwin' ? 'macOS' : process.platform}: only Linux binds a socket to the interface itself`)
        }
        this.#groups.add(group)
        const family: Family = isIP(group) === 4 ? 'IPv4' : 'IPv6'
        for (const endpoint of this.endpoints()) {
            if (endpoint.family === family) this.#membership(endpoint, group, true)
        }
    }

    /**
     * Leaves a multicast group joined.
     * @param group The address of the group.
     */
    public dropMembership(group: string): void {
        if (!this.#groups.delete(group)) return
        const family: Family = isIP(group) === 4 ? 'IPv4' : 'IPv6'
        for (const endpoint of this.endpoints()) {
            if (endpoint.family !== family) continue
            try {
                this.#membership(endpoint, group, false)
            } catch {
                //Left already (the socket made again since)
            }
        }
    }
}
