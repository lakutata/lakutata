import {
    type RemoteInfo,
    type Socket,
    type SocketType,
    createSocket
} from 'node:dgram'

import * as net from 'node:net'
import * as tls from 'node:tls'

import {type AddressInfo, type Socket as TcpSocket, connect} from 'node:net'
import {debug} from './log.js'
import {
    type Address,
    type InterfaceAddresses,
    findPort,
    interfaceAddress,
    randomPort,
    normalizeFamilyNodeV18
} from './network.js'

const log = debug('webrtc/common/transport')

type StreamTransportType = 'tcp' | 'tls'
type StreamSocket = TcpSocket | tls.TLSSocket
type StreamConnectEvent = 'connect' | 'secureConnect'

export type TlsConnectionOptions = Omit<
    tls.ConnectionOptions,
  'host' | 'port' | 'socket'
>

export interface StreamTransportOptions {
    /** Maximum time to wait for TCP/TLS connection establishment, in milliseconds. */
    connectTimeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 8000

/**
 * The receive buffer of the UDP sockets of the connections and of the TURN server at least, in bytes. It holds what
 * the receive window of SCTP (1 MiB) lets the other side send before the process reads it: about 900 packets, each
 * taking 2 KiB of buffer or more in the system. With 1 MiB, a sender faster than the receiver overflowed it before the
 * window stopped it (about 2% of the packets of a bulk transfer lost, and resent); the default of Linux (208 KiB) drops
 * the packets of a burst too (15% of 50,000 packets a second). A size the system caps: net.core.rmem_max on Linux,
 * 208 KiB by default, kern.ipc.maxsockbuf on macOS (8 MiB). The memory is taken only while packets wait in it
 */
const RECEIVE_BUFFER_SIZE = 4 * 1024 * 1024

/**
 * Grow the receive buffer of a bound UDP socket to 4 MiB, as far as the system allows (net.core.rmem_max on Linux); a
 * buffer larger already is kept
 * @param socket
 */
export function growReceiveBuffer(socket: Socket): void {
    try {
        if (socket.getRecvBufferSize() < RECEIVE_BUFFER_SIZE) socket.setRecvBufferSize(RECEIVE_BUFFER_SIZE)
    } catch (error) {
        log('the receive buffer cannot grow', error)
    }
}

/**
 * Whether two addresses are the same
 * @param a
 * @param b
 */
function sameAddress(a: Address, b: Address): boolean {
    return a === b || (a[1] === b[1] && a[0] === b[0])
}

export class UdpTransport implements Transport {
    readonly type = 'udp'
    readonly socket: Socket
    rinfo?: Partial<Pick<RemoteInfo, 'address' | 'port'>>
    onData: (data: Buffer, addr: Address) => void = () => {}
    closed: boolean = false
    //The only address the socket sends to once connected: its sends skip the lookup and the routing of an address, and
    //the system drops the packets of the other addresses
    private connected?: Address
    //The address to connect to once application data comes from it, and the one being connected to
    private connectOnReceive?: Address
    private connecting?: Address
    //What is sent until the callback of a connect comes, with its address: a send given an address meanwhile would be
    //refused by the socket connected before its lookup ends (EISCONN), and lost
    private waiting?: [Buffer, Address | undefined][]

    private constructor(
        private socketType: SocketType,
        private options: {
            portRange?: [number, number]
            interfaceAddresses?: InterfaceAddresses
            port?: number
        } = {}
    ) {
        this.socket = createSocket(socketType)
        this.socket.on('message', (data, info) => {
            if (normalizeFamilyNodeV18(info.family) === 6) {
                [info.address] = info.address.split('%') // example fe80::1d3a:8751:4ffd:eb80%wlp82s0
            }
            this.rinfo = info
            //Application data (not STUN, whose first byte is 0 to 3) from the address: the other side sends on the pair
            if (this.connectOnReceive && data[0] > 3 && info.port === this.connectOnReceive[1] && info.address === this.connectOnReceive[0]) this.connectNow(this.connectOnReceive)
            try {
                this.onData(data, [info.address, info.port])
            } catch (error) {
                log('onData error', error)
            }
        })
    }

    static async init(
        type: SocketType,
        options: {
            portRange?: [number, number]
            port?: number
            interfaceAddresses?: InterfaceAddresses
        } = {}
    ) {
        const transport = new UdpTransport(type, options)
        await transport.init()
        return transport
    }

    private async init() {
        const address = interfaceAddress(
            this.socketType,
            this.options.interfaceAddresses
        )
        if (this.options.port) {
            this.socket.bind({port: this.options.port, address})
        } else if (this.options.portRange) {
            const port = await findPort(
                this.options.portRange[0],
                this.options.portRange[1],
                this.socketType,
                this.options.interfaceAddresses
            )
            this.socket.bind({port, address})
        } else {
            //A port the system chooses, given to bind: Linux frees a port it chose for a bind to port 0 when the socket
            //disconnects (the socket of the pair ICE selected does, before an ICE restart), a port given to bind is kept
            this.socket.bind({port: await randomPort(this.socketType, this.options.interfaceAddresses), address})
        }
        await new Promise<void>((resolve, reject) => {
            const failed = (error: Error) => reject(error)
            this.socket.once('error', failed)
            this.socket.once('listening', () => {
                this.socket.off('error', failed)
                resolve()
            })
        })
        //A connected socket is told the errors of its address (ICMP port unreachable on Linux): they only end the
        //packets sent there, which ICE notices
        this.socket.on('error', (error) => log('socket error', error))
        growReceiveBuffer(this.socket)
    }

    /**
     * Send only to an address from now on (the other side of the pair ICE selected), once application data comes from
     * it: the other side sends its data on the pair then (a reply to a check does not tell it). Connected, the socket
     * sends without the lookup and the routing of the address of each packet, and drops what it is asked to send
     * elsewhere; the system drops the packets of the other addresses
     * @param addr An IP address
     */
    connectTo(addr: Address) {
        if (this.closed || this.connected || this.waiting || !net.isIP(addr[0])) return
        this.connectOnReceive = addr
    }

    /**
     * Send to any address again
     */
    disconnect() {
        this.connectOnReceive = undefined
        this.connecting = undefined
        if (!this.connected) return
        this.connected = undefined
        try {
            this.socket.disconnect()
        } catch (error) {
            log('disconnect', error)
        }
    }

    private connectNow(addr: Address) {
        this.connectOnReceive = undefined
        this.connecting = addr
        const waiting: [Buffer, Address | undefined][] = []
        this.waiting = waiting
        const done = (error?: Error) => {
            if (this.waiting === waiting) this.waiting = undefined
            //Disconnected meanwhile
            const wanted = this.connecting === addr
            if (wanted) this.connecting = undefined
            if (this.closed) return
            if (error) {
                log('connect', addr, error)
            } else if (wanted) {
                this.connected = addr
            } else {
                this.socket.disconnect()
            }
            for (const [data, to] of waiting) this.send(data, to).catch((error) => log('send', error))
        }
        try {
            this.socket.connect(addr[1], addr[0], done)
        } catch (error) {
            done(error as Error)
        }
    }

    send = async (data: Buffer, addr?: Address) => {
        const connected = this.connected
        if (connected) {
            if (!addr || sameAddress(addr, connected)) {
                this.socket.send(data)
            } else {
                //Another pair: a check retransmitted after the selection, which the connected socket cannot send
                log('not sent to an address other than the connected one', addr)
            }
            return
        }
        if (this.waiting) {
            this.waiting.push([data, addr])
            return
        }
        if (addr && !net.isIP(addr[0])) {
            // if address is not resolved, need to use send callback to handle dns failure.
            return new Promise<void>((r, f) => {
                this.socket.send(data, addr![1], addr![0], (error) => {
                    if (error) {
                        log('send error', addr, data)
                        f(error)
                    } else {
                        r()
                    }
                })
            })
        } else {
            addr = addr ?? [this.rinfo!.address!, this.rinfo!.port!]
            // a preestablished remote address does not need a callback to verify dns.
            // this is faster because event loop is not used per packet.
            this.socket.send(data, addr[1], addr[0])
        }
    }

    get address() {
        return this.socket.address()
    }

    /** IP family of the bound socket: 4 for udp4, 6 for udp6. */
    get addressFamily(): IpAddressFamily {
        return this.socketType === 'udp6' ? 6 : 4
    }

    get host() {
        return this.socket.address().address
    }

    get port() {
        return this.socket.address().port
    }

    close = () =>
        new Promise<void>((r) => {
            this.closed = true
            this.connectOnReceive = undefined
            this.connecting = undefined
            this.connected = undefined
            this.waiting = undefined
            this.socket.once('close', r)
            try {
                this.socket.close()
            } catch (error) {
                r()
            }
        })
}

export class TcpTransport implements Transport {
    readonly type = 'tcp' as const
    private readonly stream: StreamTransport

    private constructor(addr: Address, options: StreamTransportOptions = {}) {
        this.stream = new StreamTransport(
            'tcp',
            () => connect({port: addr[1], host: addr[0]}),
            undefined,
            options.connectTimeoutMs
        )
    }

    static async init(addr: Address, options: StreamTransportOptions = {}) {
        const transport = new TcpTransport(addr, options)
        try {
            await transport.init()
            return transport
        } catch (error) {
            await transport.close()
            throw error
        }
    }

    private async init() {
        await this.stream.waitForConnect()
    }

    get address() {
        return this.stream.address
    }

    get remoteAddress() {
        return this.stream.remoteAddress
    }

    get closed() {
        return this.stream.closed
    }

    get onData() {
        return this.stream.onData
    }

    set onData(handler: (data: Buffer, addr: Address) => void) {
        this.stream.onData = handler
    }

    send = async (data: Buffer, addr?: Address) => {
        await this.stream.send(data, addr)
    }

    close = async () => {
        await this.stream.close()
    }
}

export class TlsTransport implements Transport {
    readonly type = 'tls' as const
    private readonly stream: StreamTransport

    private constructor(
        addr: Address,
        options: TlsConnectionOptions = {},
        streamOptions: StreamTransportOptions = {}
    ) {
        this.stream = new StreamTransport(
            'tls',
            () =>
                tls.connect({
                    ...options,
                    host: addr[0],
                    port: addr[1]
                }),
            undefined,
            streamOptions.connectTimeoutMs
        )
    }

    static async init(
        addr: Address,
        options: TlsConnectionOptions = {},
        streamOptions: StreamTransportOptions = {}
    ) {
        const transport = new TlsTransport(addr, options, streamOptions)
        try {
            await transport.init()
            return transport
        } catch (error) {
            await transport.close()
            throw error
        }
    }

    private async init() {
        await this.stream.waitForConnect()
    }

    get address() {
        return this.stream.address
    }

    get remoteAddress() {
        return this.stream.remoteAddress
    }

    get closed() {
        return this.stream.closed
    }

    get onData() {
        return this.stream.onData
    }

    set onData(handler: (data: Buffer, addr: Address) => void) {
        this.stream.onData = handler
    }

    send = async (data: Buffer, addr?: Address) => {
        await this.stream.send(data, addr)
    }

    close = async () => {
        await this.stream.close()
    }
}

class StreamTransport implements Transport {
    readonly type: StreamTransportType
    private connecting!: Promise<void>
    private client!: StreamSocket
    onData: (data: Buffer, addr: Address) => void = () => {}
    closed = false
    private rejectConnecting?: (error: Error) => void

    constructor(
        type: StreamTransportType,
        private createClient: () => StreamSocket,
        private connectEvent: StreamConnectEvent = type === 'tls'
            ? 'secureConnect'
            : 'connect',
        private connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS
    ) {
        this.type = type
        this.connect()
    }

    private connect() {
        if (this.closed) {
            return
        }

        if (this.client) {
            this.client.destroy()
        }
        const client = this.createClient()
        this.client = client
        this.connecting = new Promise((resolve, reject) => {
            let settled = false
            const settle = (error?: Error) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                client.off(this.connectEvent, onConnect)
                client.off('error', onConnectError)
                this.rejectConnecting = undefined
                error ? reject(error) : resolve()
            }
            const onConnect = () => {
                settle()
            }
            const onConnectError = (error: Error) => {
                this.closed = true
                settle(error)
                client.destroy()
            }
            const timer = setTimeout(() => {
                this.closed = true
                settle(
                    new Error(
                        `${this.type} connect timed out after ${this.connectTimeoutMs}ms`
                    )
                )
                client.destroy()
            }, this.connectTimeoutMs)
            this.rejectConnecting = (error) => settle(error)
            client.once(this.connectEvent, onConnect)
            client.once('error', onConnectError)
        })

        client.on('data', (data) => {
            this.onData(data, this.remoteAddress!)
        })
        client.on('error', (error) => {
            log(`${this.type} transport error`, error)
        })
    }

    async waitForConnect() {
        await this.connecting
    }

    get address() {
        return {} as AddressInfo
    }

    /** The peer the stream is connected to, once connected. */
    get remoteAddress(): Address | undefined {
        const {remoteAddress, remotePort} = this.client
        if (!remoteAddress || !remotePort) {
            return undefined
        }
        return [stripZoneId(remoteAddress), remotePort]
    }

    send = async (data: Buffer, addr?: Address) => {
        void addr
        await this.connecting
        await new Promise<void>((resolve, reject) => {
            this.client.write(data, (err) => {
                if (err) {
                    reject(err)
                    return
                }
                resolve()
            })
        })
    }

    close = async () => {
        this.closed = true
        this.rejectConnecting?.(new Error(`${this.type} transport closed`))
        this.client?.destroy()
    }
}

/** Strip an IPv6 zone identifier, e.g. fe80::1%eth0 -> fe80::1. */
function stripZoneId(address: string) {
    return address.split('%')[0]
}

export type IpAddressFamily = 4 | 6

export interface Transport {
    type: string
    address: AddressInfo
    closed: boolean
    onData: (data: Buffer, addr: Address) => void
    send: (data: Buffer, addr?: Address) => Promise<void>
    close: () => Promise<void>
    /**
   * IP family of a datagram socket. A datagram transport can only reach
   * addresses of this family. Built-in UDP transports always set it; a custom
   * transport that leaves it unset gets no family preference.
   */
    addressFamily?: IpAddressFamily
    /**
   * The peer a connected (stream) transport is talking to. Responses arrive
   * from this address. Built-in TCP/TLS transports set it once connected.
   */
    remoteAddress?: Address
}
