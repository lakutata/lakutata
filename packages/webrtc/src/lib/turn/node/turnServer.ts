import {randomUUID} from 'node:crypto'
import {
    type RemoteInfo,
    type Socket,
    type SocketType,
    createSocket
} from 'node:dgram'
import {
    type AddressInfo,
    type Server as TcpServer,
    type Socket as TcpSocket,
    createServer
} from 'node:net'
import {networkInterfaces} from 'node:os'
import {
    type TLSSocket,
    type TlsOptions,
    type Server as TlsServer,
    createServer as createTlsServer
} from 'node:tls'

import {type Address, debug, detached, growReceiveBuffer} from '../../common/index.js'

const log = debug('webrtc/turn/server')

import {padTurnFrame} from '../turn/frame.js'
import {
    type TurnServerAction,
    TurnServerProtocol,
    type TurnServerProtocolOptions
} from '../turn/protocol.js'

export interface NodeTurnServerTlsOptions extends TlsOptions {
    external?: boolean
    port?: number
}

export interface NodeTurnServerAttachTlsSocketOptions {
    initialData?: Buffer
    localAddress?: Address
}

export interface NodeTurnServerOptions extends TurnServerProtocolOptions {
    host?: string
    port?: number
    relayAddress?: string
    relayBindAddress?: string
    /**the UDP ports of the relays (the firewall or the container publishes this range); any free port by default */
    relayPortRange?: [number, number]
    credentials?: Record<string, string>
    udp?: boolean
    tcp?: boolean
    tls?: NodeTurnServerTlsOptions
    /**the listeners bound with SO_REUSEPORT, to share their ports with the servers of other threads (Linux): the system
     * keeps each client on one of them */
    reusePort?: boolean
}

export class NodeTurnServer {
    readonly protocol: TurnServerProtocol

    private udpSocket?: Socket
    private tcpServer?: TcpServer
    private tlsServer?: TlsServer
    private readonly tcpConnections = new Map<string, TcpSocket>()
    private readonly tlsConnections = new Map<string, TLSSocket>()
    private readonly relaySockets = new Map<string, Socket>()
    //The address of each relay socket by its port, and the port of each relay: a packet of a peer coming from one of
    //them is known without asking each socket its address (a system call) at each packet
    private readonly relayBoundByPort = new Map<number, AddressInfo>()
    private readonly relayPorts = new Map<string, number>()
    //The addresses of the interfaces of the machine, read again a second after
    private interfaceAddresses?: {at: number, addresses: Set<string>}
    private timer?: NodeJS.Timeout
    //Set while closed: the clients closing afterwards do not arm the timer again
    private closed = false
    private readonly host: string
    private readonly port: number
    private readonly udpEnabled: boolean
    private readonly tcpEnabled: boolean
    private readonly tlsEnabled: boolean
    private readonly tlsExternal: boolean
    private readonly tlsOptions?: NodeTurnServerTlsOptions
    private readonly tlsPort: number
    private readonly relayAddress: string
    private readonly relayBindAddress: string
    private readonly relayPortRange?: [number, number]
    private boundPort?: number
    private boundTlsPort?: number
    private readonly reusePort: boolean

    constructor(options: NodeTurnServerOptions = {}) {
        const {
            host = '0.0.0.0',
            port = 3478,
            relayAddress = host === '0.0.0.0' ? '127.0.0.1' : host,
            relayBindAddress = host,
            relayPortRange,
            udp = true,
            tcp = true,
            credentials,
            tls,
            getPassword,
            software = 'lakutata-webrtc',
            reusePort = false,
            ...protocolOptions
        } = options

        this.reusePort = reusePort
        this.host = host
        this.port = port
        this.udpEnabled = udp
        this.tcpEnabled = tcp
        this.tlsEnabled = tls !== undefined
        this.tlsExternal = Boolean(tls?.external)
        this.tlsOptions = tls
        this.tlsPort = tls?.port ?? (port === 0 ? 0 : 5349)
        this.relayAddress = relayAddress
        this.relayBindAddress = relayBindAddress
        if (relayPortRange && relayPortRange[0] > relayPortRange[1]) {
            throw new Error(`relayPortRange: the first port (${relayPortRange[0]}) is above the last one (${relayPortRange[1]})`)
        }
        this.relayPortRange = relayPortRange
        this.protocol = new TurnServerProtocol({
            software,
            getPassword:
        getPassword ?? ((username, _realm) => credentials?.[username]),
            ...protocolOptions
        })
    }

    get address(): Address | undefined {
        if (this.boundPort === undefined) {
            return undefined
        }
        return [this.relayAddress, this.boundPort]
    }

    get tlsAddress(): Address | undefined {
        if (this.boundTlsPort === undefined) {
            return undefined
        }
        return [this.relayAddress, this.boundTlsPort]
    }

    async listen() {
        if (this.boundPort !== undefined || this.boundTlsPort !== undefined) {
            return
        }
        this.closed = false

        if (!this.udpEnabled && !this.tcpEnabled && !this.tlsEnabled) {
            throw new Error('NodeTurnServer requires udp, tcp, or tls to be enabled')
        }

        if (
            this.tcpEnabled &&
      this.tlsEnabled &&
      !this.tlsExternal &&
      this.tlsPort !== 0 &&
      this.tlsPort === this.port
        ) {
            throw new Error(
                'NodeTurnServer cannot share the same port for tcp and tls'
            )
        }

        if (
            this.tlsEnabled &&
      !this.tlsExternal &&
      (!this.tlsOptions?.key || !this.tlsOptions?.cert)
        ) {
            throw new Error('NodeTurnServer tls requires both key and cert')
        }

        // With port 0, UDP picks an ephemeral port and TCP reuses that number.
        // The number may already be taken on the TCP side, so pick a new one.
        const sharesEphemeralPort =
            this.port === 0 && this.udpEnabled && this.tcpEnabled
        const maxAttempts = sharesEphemeralPort ? SHARED_PORT_BIND_ATTEMPTS : 1

        for (let attempt = 1; ; attempt++) {
            try {
                await this.listenTransports()
                break
            } catch (error) {
                // Never leave a half-open server behind (e.g. UDP bound, TCP failed).
                await this.closeListeners()
                if (isAddressInUseError(error) && attempt < maxAttempts) {
                    continue
                }
                throw error
            }
        }

        this.updateTimer()
    }

    private async listenTransports() {
        if (this.udpEnabled) {
            await this.listenUdp()
        }

        if (this.tcpEnabled) {
            await this.listenTcp(this.boundPort ?? this.port)
        }

        if (this.tlsEnabled) {
            if (this.tlsExternal) {
                if (this.tlsPort !== 0) {
                    this.boundTlsPort = this.tlsPort
                }
            } else {
                await this.listenTls(this.tlsPort)
            }
        }
    }

    attachTlsSocket(
        socket: TLSSocket,
        options: NodeTurnServerAttachTlsSocketOptions = {}
    ) {
        if (!this.tlsEnabled) {
            throw new Error(
                'NodeTurnServer tls must be enabled before attaching sockets'
            )
        }

        this.handleStreamConnection(socket, 'tls', options)
    }

    async close() {
        this.closed = true
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = undefined
        }

        for (const connection of this.tcpConnections.values()) {
            connection.destroy()
        }
        this.tcpConnections.clear()

        for (const connection of this.tlsConnections.values()) {
            connection.destroy()
        }
        this.tlsConnections.clear()

        const relayClosers = [...this.relaySockets.values()].map(
            (socket) =>
                new Promise<void>((resolve) => {
                    socket.once('close', resolve)
                    socket.close()
                })
        )
        this.relaySockets.clear()
        this.relayBoundByPort.clear()
        this.relayPorts.clear()

        await Promise.all([...relayClosers, this.closeListeners()])
    }

    private async closeListeners() {
        const closers: Promise<void>[] = []
        if (this.udpSocket) {
            const udpSocket = this.udpSocket
            this.udpSocket = undefined
            closers.push(
                new Promise<void>((resolve) => {
                    udpSocket.once('close', resolve)
                    udpSocket.close()
                })
            )
        }

        if (this.tcpServer) {
            const tcpServer = this.tcpServer
            this.tcpServer = undefined
            closers.push(
                new Promise<void>((resolve) => {
                    tcpServer.close(() => resolve())
                })
            )
        }

        if (this.tlsServer) {
            const tlsServer = this.tlsServer
            this.tlsServer = undefined
            closers.push(
                new Promise<void>((resolve) => {
                    tlsServer.close(() => resolve())
                })
            )
        }

        this.boundPort = undefined
        this.boundTlsPort = undefined
        await Promise.all(closers)
    }

    private async listenUdp() {
        const socket = createSocket({type: this.socketType(this.host), reusePort: this.reusePort})
        this.udpSocket = socket
        socket.on('message', detached(async (data: Buffer, remoteInfo: RemoteInfo) => {
            await this.executeActions(
                this.protocol.handleClientDatagram({
                    clientId: udpClientId(remoteInfo),
                    data,
                    remoteAddress: [
                        normalizeAddress(remoteInfo.address),
                        remoteInfo.port
                    ],
                    localAddress: this.address,
                    transport: 'udp'
                })
            )
        }, (error) => log('client datagram failed', error)))

        await new Promise<void>((resolve, reject) => {
            socket.once('error', reject)
            socket.bind({address: this.host, port: this.port}, () => {
                socket.off('error', reject)
                const address = socket.address()
                if (typeof address === 'string') {
                    reject(new Error('Expected UDP address info'))
                    return
                }
                this.boundPort = address.port
                growReceiveBuffer(socket)
                resolve()
            })
        })
    }

    private async listenTcp(port: number) {
        const server = createServer((socket) => {
            this.handleStreamConnection(socket, 'tcp')
        })
        this.tcpServer = server

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen({port, host: this.host, reusePort: this.reusePort}, () => {
                server.off('error', reject)
                const address = server.address()
                if (!address || typeof address === 'string') {
                    reject(new Error('Expected TCP address info'))
                    return
                }
                this.boundPort = address.port
                resolve()
            })
        })
    }

    private async listenTls(port: number) {
        const server = createTlsServer(this.tlsOptions!, (socket) => {
            this.handleStreamConnection(socket, 'tls')
        })
        this.tlsServer = server

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen({port, host: this.host, reusePort: this.reusePort}, () => {
                server.off('error', reject)
                const address = server.address()
                if (!address || typeof address === 'string') {
                    reject(new Error('Expected TLS address info'))
                    return
                }
                this.boundTlsPort = address.port
                resolve()
            })
        })
    }

    private async executeActions(actions: TurnServerAction[]) {
        let scheduleAt: number | undefined
        for (const action of actions) {
            switch (action.type) {
                case 'send-client':
                    await this.sendClient(action)
                    break
                case 'send-relay':
                    await this.sendRelay(action)
                    break
                case 'bind-relay':
                    await this.bindRelay(action.allocationId, action.relayId)
                    break
                case 'close-relay':
                    await this.closeRelay(action.relayId)
                    break
                case 'close-client':
                    this.closeClient(action.clientId)
                    break
                case 'schedule-timeout':
                    scheduleAt = action.at
                    break
                default:
                    break
            }
        }

        //The packets relayed change no expiry: the timer moves only when the protocol schedules it
        if (scheduleAt !== undefined) this.setTimer(scheduleAt)
    }

    private async sendClient(
        action: Extract<TurnServerAction, {type: 'send-client'}>
    ) {
        if (action.transport === 'tcp' || action.transport === 'tls') {
            const socket = this.getStreamClient(action.transport, action.clientId)
            if (!socket || socket.destroyed) {
                return
            }

            await new Promise<void>((resolve, reject) => {
                socket.write(padTurnFrame(action.data), (error) => {
                    if (error) {
                        reject(error)
                        return
                    }
                    resolve()
                })
            }).catch(async (error) => {
                if (!isClosedTcpWriteError(error)) {
                    throw error
                }

                await this.executeActions(
                    this.protocol.handleClientClosed({clientId: action.clientId})
                )
            })
            return
        }

        if (action.transport !== 'udp') {
            return
        }

        if (!this.udpSocket) {
            return
        }

        //Not waiting for the send: a datagram not sent is lost, as on the network
        this.udpSocket.send(padTurnFrame(action.data), action.remoteAddress[1], action.remoteAddress[0])
    }

    private async sendRelay(
        action: Extract<TurnServerAction, {type: 'send-relay'}>
    ) {
        const relaySocket = this.relaySockets.get(action.relayId)
        if (!relaySocket) {
            return
        }

        //Not waiting for the send: a datagram not sent is lost, as on the network
        relaySocket.send(action.data, action.remoteAddress[1], action.remoteAddress[0])
    }

    //A UDP socket bound to the relay address: on a free port of relayPortRange (from a random one), else on any port
    private async bindRelaySocket(): Promise<Socket> {
        const bind = (port: number) => new Promise<Socket>((resolve, reject) => {
            const socket = createSocket(this.socketType(this.relayBindAddress))
            socket.once('error', (error) => {
                try {
                    socket.close()
                } catch {
                    //Already closed
                }
                reject(error)
            })
            socket.bind({address: this.relayBindAddress, port}, () => {
                socket.removeAllListeners('error')
                growReceiveBuffer(socket)
                resolve(socket)
            })
        })
        if (!this.relayPortRange) return bind(0)
        const [min, max] = this.relayPortRange
        const count = max - min + 1
        const start = Math.floor(Math.random() * count)
        let lastError: unknown
        for (let i = 0; i < count; i++) {
            try {
                return await bind(min + ((start + i) % count))
            } catch (error) {
                lastError = error
                if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') break
            }
        }
        throw lastError ?? new Error('no free port in the relay port range')
    }

    private async bindRelay(allocationId: string, relayId: string) {
        try {
            const socket = await this.bindRelaySocket()
            this.relaySockets.set(relayId, socket)
            socket.on('error', (error) => log('relay socket error', error))
            const address = socket.address()
            if (typeof address === 'string') {
                throw new Error('Expected relay UDP address info')
            }
            this.relayBoundByPort.set(address.port, address)
            this.relayPorts.set(relayId, address.port)
            socket.on('message', detached(async (data: Buffer, remoteInfo: RemoteInfo) => {
                await this.executeActions(
                    this.protocol.handleRelayPacket({
                        relayId,
                        data,
                        remoteAddress: this.normalizeRelayRemoteAddress(remoteInfo),
                        localAddress: [this.relayAddress, address.port]
                    })
                )
            }, (error) => log('relay datagram failed', error)))

            await this.executeActions(
                this.protocol.handleRelayBound({
                    allocationId,
                    relayId,
                    relayedAddress: [this.relayAddress, address.port]
                })
            )
        } catch (error) {
            log('relay bind failed', error)
            const socket = this.relaySockets.get(relayId)
            this.relaySockets.delete(relayId)
            this.forgetRelayPort(relayId)
            try {
                socket?.close()
            } catch {
                //Already closed
            }

            await this.executeActions(
                this.protocol.handleRelayBindFailure({
                    allocationId
                })
            )
        }
    }

    private async closeRelay(relayId: string) {
        const relaySocket = this.relaySockets.get(relayId)
        if (!relaySocket) {
            return
        }

        this.relaySockets.delete(relayId)
        this.forgetRelayPort(relayId)
        await new Promise<void>((resolve) => {
            relaySocket.once('close', resolve)
            relaySocket.close()
        })
    }

    private closeClient(clientId: string) {
        const socket = this.tcpConnections.get(clientId)
        if (socket && !socket.destroyed) {
            socket.destroy()
            return
        }

        const tlsSocket = this.tlsConnections.get(clientId)
        if (tlsSocket && !tlsSocket.destroyed) {
            tlsSocket.destroy()
        }
    }

    private updateTimer() {
        const nextTimeoutAt = this.protocol.nextTimeoutAt
        if (nextTimeoutAt === undefined) {
            if (this.timer) clearTimeout(this.timer)
            this.timer = undefined
            return
        }
        this.setTimer(nextTimeoutAt)
    }

    /**
     * Run the timer of the protocol at a time
     * @param nextTimeoutAt
     */
    private setTimer(nextTimeoutAt: number) {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = undefined
        }
        if (this.closed) return

        this.timer = setTimeout(
            detached(async () => {
                this.timer = undefined
                await this.executeActions(this.protocol.handleTimer())
            }, (error) => log('timer failed', error)),
            Math.max(0, nextTimeoutAt - Date.now())
        )
    }

    private normalizeRelayRemoteAddress(
        remoteInfo: Pick<RemoteInfo, 'address' | 'port'>
    ): Address {
        const remoteAddress = normalizeAddress(remoteInfo.address)
        //Only a relay socket of the port of the packet can be its sender
        const bound = this.relayBoundByPort.get(remoteInfo.port)
        if (bound && this.isRelaySocketAddress(bound, remoteAddress, remoteInfo.port)) {
            return [this.relayAddress, remoteInfo.port]
        }

        return [remoteAddress, remoteInfo.port]
    }

    private isRelaySocketAddress(
        address: AddressInfo,
        remoteAddress: string,
        remotePort: number
    ) {
        if (address.port !== remotePort) {
            return false
        }

        const boundAddress = normalizeAddress(address.address)
        return (
            boundAddress === remoteAddress ||
      ((isWildcardAddress(boundAddress) ||
        this.isLocalInterfaceAddress(boundAddress)) &&
        this.isLocalInterfaceAddress(remoteAddress))
        )
    }

    private isLocalInterfaceAddress(address: string) {
        if (address === this.relayAddress) {
            return true
        }

        const now = Date.now()
        if (!this.interfaceAddresses || now - this.interfaceAddresses.at > 1000) {
            const addresses = new Set<string>()
            for (const candidate of Object.values(networkInterfaces()).flat()) {
                if (candidate) addresses.add(normalizeAddress(candidate.address))
            }
            this.interfaceAddresses = {at: now, addresses}
        }
        return this.interfaceAddresses.addresses.has(address)
    }

    /**
     * A relay closed: its port is not one of a relay any more
     * @param relayId
     */
    private forgetRelayPort(relayId: string) {
        const port = this.relayPorts.get(relayId)
        this.relayPorts.delete(relayId)
        if (port !== undefined) this.relayBoundByPort.delete(port)
    }

    private socketType(address: string): SocketType {
        return address.includes(':') ? 'udp6' : 'udp4'
    }

    private handleStreamConnection(
        socket: TcpSocket,
        transport: 'tcp',
        options?: NodeTurnServerAttachTlsSocketOptions,
    ): void
    private handleStreamConnection(
        socket: TLSSocket,
        transport: 'tls',
        options?: NodeTurnServerAttachTlsSocketOptions,
    ): void
    private handleStreamConnection(
        socket: TcpSocket | TLSSocket,
        transport: 'tcp' | 'tls',
        options: NodeTurnServerAttachTlsSocketOptions = {}
    ) {
        const clientId = randomUUID()
        const localAddress =
            options.localAddress ?? this.resolveStreamLocalAddress(socket, transport)
        if (transport === 'tcp') {
            this.tcpConnections.set(clientId, socket as TcpSocket)
        } else {
            this.tlsConnections.set(clientId, socket as TLSSocket)
        }
        const handleData = async (data: Buffer) => {
            await this.executeActions(
                this.protocol.handleTcpChunk({
                    clientId,
                    data,
                    remoteAddress: [
                        normalizeAddress(socket.remoteAddress ?? ''),
                        socket.remotePort ?? 0
                    ],
                    localAddress,
                    transport
                })
            )
        }
        socket.on('data', (data) => {
            void handleData(data)
        })
        socket.on('close', detached(async () => {
            if (transport === 'tcp') {
                this.tcpConnections.delete(clientId)
            } else {
                this.tlsConnections.delete(clientId)
            }
            await this.executeActions(this.protocol.handleClientClosed({clientId}))
        }, (error) => log('client close failed', error)))
        socket.on('error', () => {})

        if (options.initialData?.length) {
            void handleData(options.initialData)
        }
    }

    private getStreamClient(transport: 'tcp' | 'tls', clientId: string) {
        return transport === 'tcp'
            ? this.tcpConnections.get(clientId)
            : this.tlsConnections.get(clientId)
    }

    private resolveStreamLocalAddress(
        socket: TcpSocket | TLSSocket,
        transport: 'tcp' | 'tls'
    ) {
        if (socket.localAddress && socket.localPort) {
            return [
                normalizeAddress(socket.localAddress),
                socket.localPort
            ] as Address
        }

        return transport === 'tcp' ? this.address : this.tlsAddress
    }
}

export async function createNodeTurnServer(
    options: NodeTurnServerOptions = {}
) {
    const server = new NodeTurnServer(options)
    await server.listen()
    return server
}

function normalizeAddress(address: string) {
    return address.split('%')[0]
}

function isWildcardAddress(address: string) {
    return address === '0.0.0.0' || address === '::'
}

const SHARED_PORT_BIND_ATTEMPTS = 10

function isAddressInUseError(error: unknown) {
    return (
        !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    )
}

function isClosedTcpWriteError(error: unknown) {
    const code =
        error && typeof error === 'object' && 'code' in error
            ? (error as NodeJS.ErrnoException).code
            : undefined
    return (
        code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED'
    )
}

function udpClientId(remoteInfo: Pick<RemoteInfo, 'address' | 'port'>) {
    return `udp:${normalizeAddress(remoteInfo.address)}:${remoteInfo.port}`
}
