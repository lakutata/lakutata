import {randomBytes} from 'node:crypto'
import {networkInterfaces, type NetworkInterfaceInfo} from 'node:os'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {NodeTurnServer, type NodeTurnServerOptions} from '../lib/turn/node/turnServer.js'
import type {SignalingIceServer} from '../protocol/SignalingProtocol.js'
import {createTURNCredentials, type TURNCredentials, turnPasswordIfValid} from './TURNCredentials.js'

/**
 * The TLS listener of a {@link TURNServer} (`turns:`), for the networks letting only TLS through (port 443).
 */
export interface TURNServerTLSOptions {
    /**
     * The certificate, in PEM.
     */
    cert: string | Buffer
    /**
     * Its private key, in PEM.
     */
    key: string | Buffer
    /**
     * The TCP port.
     * @default 5349
     */
    port?: number
}

/**
 * The options of a {@link TURNServer} (see {@link buildTURNServerOptions}).
 */
export interface TURNServerOptions {
    /**
     * The address the server listens on.
     * @default '0.0.0.0'
     */
    host?: string
    /**
     * The port of STUN and TURN over UDP and TCP.
     * @default 3478
     */
    port?: number
    /**
     * Whether to listen over UDP.
     * @default true
     */
    udp?: boolean
    /**
     * Whether to listen over TCP.
     * @default true
     */
    tcp?: boolean
    /**
     * The TLS listener (`turns:`); none by default.
     */
    tls?: TURNServerTLSOptions
    /**
     * The address the clients reach the server at, given in the ICE servers and the relayed addresses: the public
     * address of the host (or of its NAT, its port mapping forwarding the ports).
     * @default the first IPv4 address of the host that is not internal, else 127.0.0.1
     */
    publicAddress?: string
    /**
     * The UDP ports of the relays, as `[first, last]`: the range published by the container or opened in the firewall.
     * @default any free port
     */
    relayPortRange?: [number, number]
    /**
     * The secret of the short-lived credentials ({@link TURNServer.credentials}), shared with the TURN servers of the
     * other instances (or with a coturn configured with `use-auth-secret`).
     * @default a random secret, chosen when the server starts
     */
    secret?: string
    /**
     * Users with a fixed password, `{username: password}`, besides the short-lived credentials.
     * @default none
     */
    users?: Record<string, string>
    /**
     * The realm of the long-term credentials.
     * @default 'lakutata'
     */
    realm?: string
    /**
     * How long the short-lived credentials are valid, in seconds.
     * @default 86400 (a day)
     */
    credentialTtl?: number
    /**
     * The allocations (relays) at once at most.
     * @default no limit
     */
    maxAllocations?: number
}

//The first IPv4 address of the host that is not internal
function defaultPublicAddress(): string {
    for (const addresses of Object.values(networkInterfaces())) {
        const address: NetworkInterfaceInfo | undefined = addresses?.find((info: NetworkInterfaceInfo): boolean => info.family === 'IPv4' && !info.internal)
        if (address) return address.address
    }
    return '127.0.0.1'
}

/**
 * A STUN and TURN server inside the application (RFC 8489, RFC 8656): over UDP and TCP on port 3478, and over TLS when
 * given a certificate. The browsers and the other clients use it to find their public address (STUN) and to relay their
 * traffic when they cannot connect directly (TURN). It authenticates the clients with short-lived credentials made
 * with its secret ({@link TURNServer.credentials}), as coturn's REST API does, and with the fixed users of its options;
 * both use the SHA-1 integrity of RFC 5389, which the browsers require.
 *
 * Register it with {@link buildTURNServerOptions} and list it in `bootstrap` so that it listens when the application
 * starts; the `Signaling` component gives its ICE servers and credentials to the members of the rooms.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildTURNServerOptions, type TURNServer} from '@lakutata/webrtc'
 *
 * Application
 *     .run(() => ({
 *         id: 'turn.app',
 *         name: 'TURN',
 *         components: {
 *             //UDP and TCP on 3478, the relays on 49160-49200, reached at the public address of the host
 *             turn: buildTURNServerOptions({publicAddress: '203.0.113.10', relayPortRange: [49160, 49200], secret: process.env.TURN_SECRET})
 *         },
 *         bootstrap: ['turn']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const turn: TURNServer = await app.getObject<TURNServer>('turn')
 *         //The ICE servers of a browser, with credentials for the user alice
 *         console.log(turn.iceServers('alice'))
 *     })
 * ```
 */
@Singleton()
export class TURNServer extends Component {

    /**
     * The address the server listens on.
     */
    @Configurable(DTO.String().optional().default('0.0.0.0'))
    protected readonly host: string

    /**
     * The port of STUN and TURN over UDP and TCP.
     */
    @Configurable(DTO.Number().port().optional().default(3478))
    protected readonly port: number

    /**
     * Whether to listen over UDP.
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly udp: boolean

    /**
     * Whether to listen over TCP.
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly tcp: boolean

    /**
     * The TLS listener.
     */
    @Configurable(DTO.Object({
        cert: DTO.Alternatives(DTO.String(), DTO.Binary()).required(),
        key: DTO.Alternatives(DTO.String(), DTO.Binary()).required(),
        port: DTO.Number().port().optional()
    }).optional())
    protected readonly tls?: TURNServerTLSOptions

    /**
     * The address the clients reach the server at.
     */
    @Configurable(DTO.String().optional())
    protected readonly publicAddress?: string

    /**
     * The UDP ports of the relays.
     */
    @Configurable(DTO.Array().items(DTO.Number().port()).length(2).optional())
    protected readonly relayPortRange?: [number, number]

    /**
     * The secret of the short-lived credentials.
     */
    @Configurable(DTO.String().min(1).optional())
    protected readonly secret?: string

    /**
     * The users with a fixed password.
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly users: Record<string, string>

    /**
     * The realm of the long-term credentials.
     */
    @Configurable(DTO.String().optional().default('lakutata'))
    protected readonly realm: string

    /**
     * How long the short-lived credentials are valid, in seconds.
     */
    @Configurable(DTO.Number().integer().positive().optional().default(86400))
    protected readonly credentialTtl: number

    /**
     * The allocations at once at most.
     */
    @Configurable(DTO.Number().integer().positive().optional())
    protected readonly maxAllocations?: number

    #server: NodeTurnServer

    #secret: string

    #publicAddress: string

    /**
     * Start listening.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#secret = this.secret ?? randomBytes(32).toString('base64url')
        this.#publicAddress = this.publicAddress ?? defaultPublicAddress()
        const options: NodeTurnServerOptions = {
            host: this.host,
            port: this.port,
            udp: this.udp,
            tcp: this.tcp,
            relayAddress: this.#publicAddress,
            relayBindAddress: this.host,
            relayPortRange: this.relayPortRange,
            realm: this.realm,
            maxAllocations: this.maxAllocations,
            getPassword: (username: string): string | undefined => this.users[username] ?? turnPasswordIfValid(this.#secret, username)
        }
        if (this.tls) options.tls = {cert: this.tls.cert, key: this.tls.key, port: this.tls.port}
        this.#server = new NodeTurnServer(options)
        await this.#server.listen()
    }

    /**
     * Stop listening and close the relays.
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.#server?.close()
    }

    /**
     * The address and the port of STUN and TURN over UDP and TCP, as the clients reach them (the public address).
     */
    public get address(): {address: string, port: number} {
        return {address: this.#publicAddress, port: this.#server?.address?.[1] ?? this.port}
    }

    /**
     * The address and the port of TURN over TLS, as the clients reach them; undefined without TLS.
     */
    public get tlsAddress(): {address: string, port: number} | undefined {
        const bound: readonly [string, number] | undefined = this.#server?.tlsAddress
        return bound ? {address: this.#publicAddress, port: bound[1]} : undefined
    }

    /**
     * The allocations in use: the clients relaying their traffic through the server.
     */
    public get allocations(): number {
        return this.#server?.protocol.allocationCount ?? 0
    }

    /**
     * Create short-lived credentials for a user, valid for `credentialTtl` seconds.
     * @param user The user (the part of the username after the expiry).
     * @returns The username, the password and their lifetime in seconds.
     * @example
     * ```typescript
     * import type {TURNServer, TURNCredentials} from '@lakutata/webrtc'
     *
     * declare const turn: TURNServer
     * const credentials: TURNCredentials = turn.credentials('alice')
     * ```
     */
    public credentials(user: string = 'anonymous'): TURNCredentials {
        return createTURNCredentials(this.#secret, user, this.credentialTtl)
    }

    /**
     * The ICE servers of a client, as `RTCIceServer` objects: STUN, then TURN over UDP and TCP, then over TLS when it
     * listens over TLS, with short-lived credentials for the user.
     * @param user The user the credentials are for.
     * @returns The ICE servers.
     * @example
     * ```typescript
     * import type {SignalingIceServer, TURNServer} from '@lakutata/webrtc'
     *
     * declare const turn: TURNServer
     * //[{urls: 'stun:203.0.113.10:3478'}, {urls: ['turn:203.0.113.10:3478?transport=udp', …], username, credential}]
     * const iceServers: SignalingIceServer[] = turn.iceServers('alice')
     * ```
     */
    public iceServers(user: string = 'anonymous'): SignalingIceServer[] {
        const {address, port} = this.address
        const host: string = address.includes(':') ? `[${address}]` : address
        const urls: string[] = []
        if (this.udp) urls.push(`turn:${host}:${port}?transport=udp`)
        if (this.tcp) urls.push(`turn:${host}:${port}?transport=tcp`)
        const tls: {address: string, port: number} | undefined = this.tlsAddress
        if (tls) urls.push(`turns:${host}:${tls.port}?transport=tcp`)
        const {username, credential} = this.credentials(user)
        const servers: SignalingIceServer[] = []
        if (this.udp) servers.push({urls: `stun:${host}:${port}`})
        if (urls.length) servers.push({urls: urls, username: username, credential: credential})
        return servers
    }
}

/**
 * Build the options of a {@link TURNServer} component, for the `components` of an application.
 * @param options Where it listens, the address the clients reach it at, the relay ports, the credentials (all optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildTURNServerOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'turn.app',
 *     name: 'TURN',
 *     components: {
 *         turn: buildTURNServerOptions({publicAddress: '203.0.113.10', secret: process.env.TURN_SECRET})
 *     },
 *     bootstrap: ['turn']
 * }))
 * ```
 */
export function buildTURNServerOptions(options: TURNServerOptions = {}): ComponentOptions<TURNServerOptions> {
    return {class: TURNServer, ...options}
}
