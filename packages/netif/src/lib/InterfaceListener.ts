import {EventEmitter} from 'node:events'
import {closeSync} from 'node:fs'
import {type AddressInfo, createServer, type ListenOptions as NetListenOptions, type Server, type Socket} from 'node:net'
import {NetIfException} from '../exceptions/NetIfException.js'
import {NetIfNotEnforcedException} from '../exceptions/NetIfNotEnforcedException.js'
import {addressEnforcement, type Enforcement, type Family, LINUX_PERMISSION} from './Enforcement.js'
import {OBSERVE} from './Internal.js'
import {nativeBindSocket} from './Native.js'
import {type NetworkInterface} from './NetworkInterface.js'
import {type InterfaceAddress, type NetworkInterfaceInfo} from './Types.js'

/**
 * The options of `listen()`.
 */
export interface ListenOptions {
    /**
     * The port. 0: one the system chooses, kept when the interface is listened on again.
     */
    port: number

    /**
     * The families listened on: `'IPv4'`, `'IPv6'` or `'both'` (by default). With `'both'`, a system without IPv6 is
     * listened on in IPv4.
     */
    family?: 'IPv4' | 'IPv6' | 'both'

    /**
     * `true`: the listening is refused (a `NetIfNotEnforcedException`) where the system cannot refuse the connections
     * reaching the addresses of the interface through another interface, and it stops while that guarantee is lost.
     * `false` by default: the best the system allows, told by `enforced`.
     */
    strict?: boolean

    /**
     * The length of the queue of the connections not accepted yet, 511 by default.
     */
    backlog?: number
}

/**
 * An address a listener can be reached at.
 */
export interface ListeningAddress {
    /**
     * The address (an IPv6 address without its scope).
     */
    address: string

    /**
     * `'IPv4'` or `'IPv6'`.
     */
    family: 'IPv4' | 'IPv6'

    /**
     * The port.
     */
    port: number

    /**
     * IPv6 only: the index of the interface for a link-local address, 0 otherwise.
     */
    scopeid?: number
}

/**
 * The events of an `InterfaceListener` and their arguments.
 */
export interface InterfaceListenerEvents {
    /**
     * The interface is listened on, after `listen()` and each time it is listened on again (an address added, the
     * interface plugged back).
     */
    listening: []

    /**
     * An error of a listening again (the port taken meanwhile…), retried a little later; with `strict`, the guarantee
     * lost (a `NetIfNotEnforcedException`). Without a listener of `error`, the error is thrown, as for a `net.Server`.
     */
    error: [error: Error]

    /**
     * Whether the connections coming through another interface are refused changed: its new value.
     */
    enforced: [enforced: boolean]

    /**
     * The listener was closed.
     */
    close: []
}

/**
 * A socket of the listener: bound to the interface (Linux), or to one of its addresses
 */
interface Endpoint {
    key: string
    family: Family
    server: Server
    address?: InterfaceAddress
}

/**
 * What is to be listened on
 */
interface Wanted {
    key: string
    family: Family
    address?: InterfaceAddress
}

/**
 * What a server listens on: an address and a port, or a socket made already (its descriptor: the handle form of listen())
 */
type ListenTarget = NetListenOptions | {fd: number, backlog: number}

/**
 * What the making of a socket gave
 */
type Opened = 'opened' | 'skipped' | 'by address'

const RETRY_FIRST: number = 1000
const RETRY_LAST: number = 30000
//A port 0 shared by the sockets of the families: chosen by the first one, taken by another program for the next one
const PORT_ATTEMPTS: number = 3

/**
 * Whether an error is the one of an address gone or not usable yet: the next reading of the interfaces settles it
 */
function vanished(error: unknown): boolean {
    const code: unknown = (error as NodeJS.ErrnoException)?.code ?? (error as NetIfException)?.errno
    return code === 'EADDRNOTAVAIL' || code === 'ENODEV' || code === 'ENXIO'
}

/**
 * The listening of a server on a network interface: `NetworkInterface.listen()`. The listener accepts the connections
 * and gives them to the server (`server.emit('connection', socket)`), which handles them as its own: the server itself
 * does not listen (its `address()` is `null`, its `close()` does not stop the listener; use the ones of the listener).
 * The interface is listened on again when its addresses change and when it is unplugged and plugged back; the
 * connections established are left to the server.
 * @example
 * ```typescript
 * import {createServer} from 'node:http'
 * import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'
 *
 * const server = createServer((request, response) => response.end('ok'))
 * const listener: InterfaceListener = await new NetworkInterface('eth1').listen(server, {port: 8080})
 * console.log(listener.enforced, listener.addresses)
 * listener.on('error', error => console.error(error))
 * await listener.close()
 * ```
 */
export class InterfaceListener extends EventEmitter<InterfaceListenerEvents> {

    /**
     * The server the connections are given to.
     */
    public readonly server: Server

    /**
     * The interface listened on.
     */
    public readonly networkInterface: NetworkInterface

    readonly #families: Family[]

    readonly #strict: boolean

    readonly #backlog: number

    readonly #requestedPort: number

    readonly #endpoints: Map<string, Endpoint> = new Map()

    readonly #ownsInterface: boolean

    #port: number | undefined

    //Linux: the sockets bound to the interface until the process may not (then by address)
    #bound: boolean = process.platform === 'linux'

    #enforcement: Enforcement

    #paused: boolean = false

    #closed: boolean = false

    #stopObserving: (() => void) | undefined

    #syncing: Promise<void> = Promise.resolve()

    #again: boolean = false

    #retry: NodeJS.Timeout | undefined

    #retryDelay: number = RETRY_FIRST

    #alive: NodeJS.Timeout | undefined

    /**
     * Internal: made by `NetworkInterface.listen()`; `start()` listens.
     * @param networkInterface The interface.
     * @param server The server.
     * @param options The options of `listen()`.
     * @param ownsInterface Whether the interface is closed with the listener (`listenOn()`).
     */
    constructor(networkInterface: NetworkInterface, server: Server, options: ListenOptions, ownsInterface: boolean = false) {
        super()
        if (!server || typeof server.emit !== 'function') throw new TypeError('listen() takes a net.Server (http, https, http2, tls…)')
        if (!Number.isInteger(options?.port) || options.port < 0 || options.port > 65535) throw new TypeError(`${String(options?.port)} is not a port`)
        const family: 'IPv4' | 'IPv6' | 'both' = options.family ?? 'both'
        if (!['IPv4', 'IPv6', 'both'].includes(family)) throw new TypeError(`${String(family)} is not a family ('IPv4', 'IPv6' or 'both')`)
        this.networkInterface = networkInterface
        this.server = server
        this.#families = family === 'both' ? ['IPv4', 'IPv6'] : [family]
        this.#strict = options.strict ?? false
        this.#backlog = options.backlog ?? 511
        this.#requestedPort = options.port
        this.#port = options.port || undefined
        this.#ownsInterface = ownsInterface
        this.#enforcement = this.#enforcementNow()
    }

    /**
     * Whether the system refuses the connections reaching the addresses of the interface through another interface:
     * always on Linux (the sockets are bound to the interface), on Windows while every other interface receives with the
     * strong host model, on macOS when it is set to (`net.inet.ip.check_interface` 2, forwarding off).
     */
    public get enforced(): boolean {
        return this.#enforcement.enforced
    }

    /**
     * Why the connections coming through another interface are not refused, `undefined` while they are.
     */
    public get reason(): string | undefined {
        return this.#enforcement.reason
    }

    /**
     * The port, `undefined` until a port 0 was given one by the system.
     */
    public get port(): number | undefined {
        return this.#port
    }

    /**
     * Whether the interface is listened on now (it exists, and has an address where it is listened on by address).
     */
    public get listening(): boolean {
        return this.#endpoints.size > 0
    }

    /**
     * The addresses the server can be reached at now. On Linux, the socket bound to the interface also gets the
     * connections sent to another address of the machine through the interface.
     */
    public get addresses(): ListeningAddress[] {
        if (this.#port === undefined || !this.#endpoints.size) return []
        const families: Set<Family> = new Set([...this.#endpoints.values()].map((endpoint: Endpoint): Family => endpoint.family))
        const addresses: InterfaceAddress[] = this.#bound
            ? this.networkInterface.addresses.filter((address: InterfaceAddress): boolean => families.has(address.family))
            : [...this.#endpoints.values()].map((endpoint: Endpoint): InterfaceAddress => endpoint.address!)
        return addresses.map((address: InterfaceAddress): ListeningAddress => {
            const listening: ListeningAddress = {address: address.address, family: address.family, port: this.#port!}
            if (address.family === 'IPv6') listening.scopeid = address.scopeid ?? 0
            return listening
        })
    }

    /**
     * Whether the listener was closed.
     */
    public get closed(): boolean {
        return this.#closed
    }

    /**
     * Internal: the first listening, which `listen()` waits for.
     * @returns The listener.
     */
    public async start(): Promise<this> {
        if (this.#strict && !this.#enforcement.enforced) {
            this.#finish()
            throw new NetIfNotEnforcedException(`The interface cannot be listened on strictly: ${this.#enforcement.reason}`)
        }
        this.#stopObserving = this.networkInterface[OBSERVE]((event: 'update' | 'close'): void => {
            if (event === 'close') {
                void this.close()
                return
            }
            this.#sync()
        })
        try {
            await this.#enqueue((): Promise<void> => this.#reconcile(true))
        } catch (error) {
            this.#finish()
            throw error
        }
        if (this.#strict && !this.#enforcement.enforced) {
            this.#finish()
            throw new NetIfNotEnforcedException(`The interface cannot be listened on strictly: ${this.#enforcement.reason}`)
        }
        this.#keepAlive()
        return this
    }

    /**
     * Stops listening: no connection accepted any more. The connections established are left to the server; the
     * listener does not wait for them (a server of Bun keeps its idle connections open).
     */
    public async close(): Promise<void> {
        if (this.#closed) return
        this.#finish()
        if (this.#ownsInterface) this.networkInterface.close()
        this.emit('close')
    }

    #finish(): void {
        this.#closed = true
        this.#stopObserving?.()
        this.#stopObserving = undefined
        clearTimeout(this.#retry)
        clearInterval(this.#alive)
        this.#retry = undefined
        this.#alive = undefined
        for (const endpoint of this.#endpoints.values()) endpoint.server.close()
        this.#endpoints.clear()
    }

    /**
     * The interfaces were read again: the sockets made or closed to match them, one reconciliation at a time
     */
    #sync(): void {
        if (this.#closed || this.#again) return
        this.#again = true
        void this.#enqueue(async (): Promise<void> => {
            this.#again = false
            if (this.#closed) return
            try {
                await this.#reconcile(false)
            } catch (error) {
                this.#failed(error)
            }
            this.#keepAlive()
        })
    }

    /**
     * A reconciliation run after the ones queued: its promise (the queue goes on whatever its result)
     */
    #enqueue(task: () => Promise<void>): Promise<void> {
        const run: Promise<void> = this.#syncing.then(task)
        this.#syncing = run.catch((): void => undefined)
        return run
    }

    /**
     * While nothing is listened on (the interface missing, no address, a retry pending), the listener keeps the process
     * alive as a listening server does
     */
    #keepAlive(): void {
        if (this.#closed || this.#endpoints.size) {
            clearInterval(this.#alive)
            this.#alive = undefined
        } else if (!this.#alive) {
            this.#alive = setInterval((): void => undefined, 0x7fffffff)
        }
    }

    #failed(error: unknown): void {
        if (this.#closed) return
        this.emit('error', error as Error)
        if (this.#retry) return
        this.#retry = setTimeout((): void => {
            this.#retry = undefined
            this.#sync()
        }, this.#retryDelay)
        this.#retryDelay = Math.min(this.#retryDelay * 2, RETRY_LAST)
    }

    #enforcementNow(): Enforcement {
        if (this.#bound) return {enforced: true}
        return addressEnforcement(this.networkInterface.index ?? 0, this.#families)
    }

    /**
     * The guarantee read again: its event when it changed; with strict, the listening paused while it is lost
     */
    #checkEnforcement(): void {
        const now: Enforcement = this.#enforcementNow()
        const changed: boolean = now.enforced !== this.#enforcement.enforced
        this.#enforcement = now
        if (!changed) return
        this.emit('enforced', now.enforced)
        if (!this.#strict) return
        if (!now.enforced) {
            this.#paused = true
            for (const endpoint of this.#endpoints.values()) endpoint.server.close()
            this.#endpoints.clear()
            this.emit('error', new NetIfNotEnforcedException(`The listening stopped: ${now.reason}`))
        } else {
            this.#paused = false
        }
    }

    /**
     * What is to be listened on now
     */
    #wanted(state: NetworkInterfaceInfo | undefined): Wanted[] {
        if (!state || this.#paused) return []
        if (this.#bound) return this.#families.map((family: Family): Wanted => ({key: `bound|${family}|${state.index}`, family: family}))
        return state.addresses
            .filter((address: InterfaceAddress): boolean => this.#families.includes(address.family))
            .map((address: InterfaceAddress): Wanted => ({key: `address|${address.family}|${address.address}|${address.scopeid ?? ''}`, family: address.family, address: address}))
    }

    /**
     * The sockets made and closed to match the interface; on the first one, an error is thrown, later it is retried
     */
    async #reconcile(first: boolean): Promise<void> {
        this.#checkEnforcement()
        for (let attempt: number = 1; ; attempt++) {
            const state: NetworkInterfaceInfo | undefined = this.networkInterface.info
            const wanted: Wanted[] = this.#wanted(state)
            const keys: Set<string> = new Set(wanted.map((entry: Wanted): string => entry.key))
            for (const [key, endpoint] of [...this.#endpoints]) {
                if (keys.has(key)) continue
                endpoint.server.close()
                this.#endpoints.delete(key)
            }
            let opened: boolean = false
            let modeChanged: boolean = false
            try {
                for (const entry of wanted) {
                    if (this.#closed) return
                    if (this.#endpoints.has(entry.key)) continue
                    const result: Opened = await this.#open(entry, state!)
                    if (result === 'opened') opened = true
                    if (result === 'by address') {
                        modeChanged = true
                        break
                    }
                }
            } catch (error) {
                //A port 0 the system gave the first socket, taken for the next one: all of them again on another port
                const code: unknown = (error as NodeJS.ErrnoException)?.code ?? (error as NetIfException)?.errno
                if (code === 'EADDRINUSE' && !this.#requestedPort && this.#endpoints.size && attempt < PORT_ATTEMPTS && first) {
                    for (const endpoint of this.#endpoints.values()) endpoint.server.close()
                    this.#endpoints.clear()
                    this.#port = undefined
                    continue
                }
                throw error
            }
            //Linux without the permission to bind to the interface: the addresses listened on instead, at once
            if (modeChanged) continue
            this.#retryDelay = RETRY_FIRST
            if (opened) this.emit('listening')
            return
        }
    }

    /**
     * A socket made: whether it listens now ('skipped' for an address gone meanwhile or a family the system lacks, 'by
     * address' when the interface is to be listened on by address from now on)
     */
    async #open(entry: Wanted, state: NetworkInterfaceInfo): Promise<Opened> {
        const server: Server = this.#innerServer()
        let options: ListenTarget
        if (this.#bound) {
            let bound: {fd: number, port: number}
            try {
                bound = nativeBindSocket(state.name, entry.family === 'IPv4' ? 4 : 6, true, this.#port ?? 0, this.#backlog)
            } catch (error) {
                const code: unknown = (error as NetIfException).errno
                if (code === 'EPERM' || code === 'EACCES') {
                    //Linux before 5.7 without CAP_NET_RAW: by address, without the guarantee
                    if (this.#strict) throw new NetIfNotEnforcedException(`The process may not bind a socket to ${state.name}. ${LINUX_PERMISSION}`, {cause: error})
                    this.#bound = false
                    for (const endpoint of this.#endpoints.values()) endpoint.server.close()
                    this.#endpoints.clear()
                    this.#enforcement = {enforced: false, reason: LINUX_PERMISSION}
                    this.emit('enforced', false)
                    return 'by address'
                }
                //IPv6 off in the system: IPv4 only for 'both'
                if (code === 'EAFNOSUPPORT' && this.#families.length > 1) return 'skipped'
                if (vanished(error)) return 'skipped'
                throw error
            }
            options = {fd: bound.fd, backlog: this.#backlog}
            try {
                await this.#listen(server, options)
            } catch (error) {
                try {
                    closeSync(bound.fd)
                } catch {
                    //Owned by the server already
                }
                throw error
            }
        } else {
            const address: InterfaceAddress = entry.address!
            //A link-local IPv6 address with its scope: the index on Windows, the name of the interface elsewhere (libuv)
            const scope: string = address.family === 'IPv6' && address.scopeid ? `%${process.platform === 'win32' ? address.scopeid : state.name}` : ''
            options = {host: `${address.address}${scope}`, port: this.#port ?? 0, backlog: this.#backlog, exclusive: true}
            try {
                await this.#listen(server, options)
            } catch (error) {
                if (vanished(error)) return 'skipped'
                throw error
            }
        }
        if (this.#closed) {
            server.close()
            return 'skipped'
        }
        const listened: AddressInfo | string | null = server.address()
        if (this.#port === undefined && listened && typeof listened === 'object') this.#port = listened.port
        this.#endpoints.set(entry.key, {key: entry.key, family: entry.family, server: server, address: entry.address})
        return 'opened'
    }

    #listen(server: Server, options: ListenTarget): Promise<void> {
        return new Promise((resolve: () => void, reject: (error: Error) => void): void => {
            const failed = (error: Error): void => {
                server.off('listening', listened)
                server.close()
                reject(error)
            }
            const listened = (): void => {
                server.off('error', failed)
                //Later errors of the socket: the ones of the listener
                server.on('error', (error: Error): void => this.#failed(error))
                resolve()
            }
            server.once('error', failed)
            server.once('listening', listened)
            server.listen(options)
        })
    }

    /**
     * A server of the listener: the connections it accepts given to the server of the user, with its settings
     */
    #innerServer(): Server {
        const settings: {allowHalfOpen?: boolean, pauseOnConnect?: boolean} = this.server as unknown as {allowHalfOpen?: boolean, pauseOnConnect?: boolean}
        const server: Server = createServer({allowHalfOpen: !!settings.allowHalfOpen, pauseOnConnect: !!settings.pauseOnConnect, noDelay: true}, (socket: Socket): void => {
            this.server.emit('connection', socket)
        })
        if (typeof this.server.maxConnections === 'number') server.maxConnections = this.server.maxConnections
        return server
    }
}
