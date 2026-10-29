import {EventEmitter} from 'node:events'
import {closeSync} from 'node:fs'
import {NetIfException} from '../exceptions/NetIfException.js'
import {NetIfNotEnforcedException} from '../exceptions/NetIfNotEnforcedException.js'
import {addressEnforcement, type Enforcement, type Family, LINUX_PERMISSION} from './Enforcement.js'
import {OBSERVE} from './Internal.js'
import {nativeBindSocket} from './Native.js'
import {type NetworkInterface} from './NetworkInterface.js'
import {type InterfaceAddress, type NetworkInterfaceInfo} from './Types.js'

/**
 * An address a listener or a UDP socket of an interface can be reached at.
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
     * IPv6 only: the scope of the address (the index of the interface for a link-local one), 0 for a global one.
     */
    scopeid?: number
}

/**
 * The options common to the listeners and the UDP sockets of an interface
 */
export interface AttachmentOptions {
    port: number
    family?: 'IPv4' | 'IPv6' | 'both'
    strict?: boolean
}

/**
 * What a socket of an attachment is made on: a socket bound to the interface (Linux, its descriptor), or an address of
 * the interface (the host with its scope, and the port)
 */
export type Target = {fd: number} | {host: string, port: number}

/**
 * A socket of an attachment: bound to the interface, or to one of its addresses
 */
export interface Endpoint<Handle> {
    key: string
    family: Family
    handle: Handle
    address?: InterfaceAddress
}

/**
 * What is to be bound
 */
interface Wanted {
    key: string
    family: Family
    address?: InterfaceAddress
}

/**
 * What the making of a socket gave
 */
type Opened = 'opened' | 'skipped' | 'by address'

const RETRY_FIRST: number = 1000
const RETRY_LAST: number = 30000
//A port 0 shared by the sockets of the families: chosen by the first one, taken by another program for the next one
const PORT_ATTEMPTS: number = 3

/**
 * The code of the error of the system an error carries
 */
export function codeOf(error: unknown): unknown {
    return (error as NodeJS.ErrnoException)?.code ?? (error as NetIfException)?.errno
}

/**
 * Whether an error is the one of an address gone or not usable yet: the next reading of the interfaces settles it
 */
function vanished(error: unknown): boolean {
    const code: unknown = codeOf(error)
    return code === 'EADDRNOTAVAIL' || code === 'ENODEV' || code === 'ENXIO'
}

/**
 * The sockets of an interface kept matching it (the base of the listeners and the UDP sockets): on Linux sockets bound
 * to the interface, one by family, made again when the interface is plugged back (a new index); elsewhere (and on Linux
 * without the permission to bind) a socket by address of the interface, made and closed as its addresses change. The
 * guarantee that the system refuses what comes through another interface (`enforced`), followed; with `strict` the
 * sockets are closed while it is lost. The changes of the interface are followed one at a time.
 */
export abstract class Attachment<Events extends Record<keyof Events, unknown[]>, Handle> extends EventEmitter<Events> {

    /**
     * The interface.
     */
    public readonly networkInterface: NetworkInterface

    protected readonly families: Family[]

    protected readonly strict: boolean

    readonly #requestedPort: number

    readonly #endpoints: Map<string, Endpoint<Handle>> = new Map()

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
     * Internal: the options checked.
     * @param networkInterface The interface.
     * @param options The port, the families and `strict`.
     * @param ownsInterface Whether the interface is closed with it.
     */
    protected constructor(networkInterface: NetworkInterface, options: AttachmentOptions, ownsInterface: boolean) {
        super()
        if (!Number.isInteger(options?.port) || options.port < 0 || options.port > 65535) throw new TypeError(`${String(options?.port)} is not a port`)
        const family: 'IPv4' | 'IPv6' | 'both' = options.family ?? 'both'
        if (!['IPv4', 'IPv6', 'both'].includes(family)) throw new TypeError(`${String(family)} is not a family ('IPv4', 'IPv6' or 'both')`)
        this.networkInterface = networkInterface
        this.families = family === 'both' ? ['IPv4', 'IPv6'] : [family]
        this.strict = options.strict ?? false
        this.#requestedPort = options.port
        this.#port = options.port || undefined
        this.#ownsInterface = ownsInterface
        this.#enforcement = this.#enforcementNow()
    }

    /**
     * Whether a TCP (true) or a UDP socket is bound to the interface
     */
    protected abstract readonly stream: boolean

    /**
     * Makes a socket of a family on the target: its handle once it listens (or is bound)
     */
    protected abstract openHandle(target: Target, family: Family): Promise<Handle>

    /**
     * The port of a socket made
     */
    protected abstract portOf(handle: Handle): number | undefined

    /**
     * Closes a socket
     */
    protected abstract closeHandle(handle: Handle): void

    /**
     * Whether the system refuses, through another interface, what is sent to the addresses of the interface: always on
     * Linux (the sockets are bound to the interface), on Windows while every other interface receives with the strong
     * host model and does not forward, on macOS when it is set to (`net.inet.ip.check_interface` 2, forwarding off).
     */
    public get enforced(): boolean {
        return this.#enforcement.enforced
    }

    /**
     * Why what comes through another interface is not refused, `undefined` while it is.
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
     * Whether the interface is listened on now (it exists, and has an address where its addresses are listened on).
     */
    public get listening(): boolean {
        return this.#endpoints.size > 0
    }

    /**
     * The addresses it can be reached at now. On Linux the sockets bound to the interface also get what is sent to
     * another address of the machine through the interface.
     */
    public get addresses(): ListeningAddress[] {
        if (this.#port === undefined || !this.#endpoints.size) return []
        const families: Set<Family> = new Set([...this.#endpoints.values()].map((endpoint: Endpoint<Handle>): Family => endpoint.family))
        const addresses: InterfaceAddress[] = this.#bound
            ? this.networkInterface.addresses.filter((address: InterfaceAddress): boolean => families.has(address.family))
            : [...this.#endpoints.values()].map((endpoint: Endpoint<Handle>): InterfaceAddress => endpoint.address!)
        return addresses.map((address: InterfaceAddress): ListeningAddress => {
            const listening: ListeningAddress = {address: address.address, family: address.family, port: this.#port!}
            if (address.family === 'IPv6') listening.scopeid = address.scopeid ?? 0
            return listening
        })
    }

    /**
     * Whether it was closed.
     */
    public get closed(): boolean {
        return this.#closed
    }

    /**
     * Whether the sockets are bound to the interface (Linux), not to its addresses
     */
    protected get boundToInterface(): boolean {
        return this.#bound
    }

    /**
     * The sockets now
     */
    protected endpoints(): Endpoint<Handle>[] {
        return [...this.#endpoints.values()]
    }

    /**
     * A socket made, before it is counted (its settings applied: the broadcasts, the multicast groups)
     */
    protected prepare(_endpoint: Endpoint<Handle>): void {
        //Nothing by default
    }

    /**
     * Internal: the first binding, which the method that made it waits for.
     * @returns It.
     */
    public async start(): Promise<this> {
        if (this.strict && !this.#enforcement.enforced) {
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
        if (this.strict && !this.#enforcement.enforced) {
            this.#finish()
            throw new NetIfNotEnforcedException(`The interface cannot be listened on strictly: ${this.#enforcement.reason}`)
        }
        this.#keepAlive()
        return this
    }

    /**
     * Stops: the sockets closed (the listener does not wait for the connections established, which are left to the
     * server).
     */
    public async close(): Promise<void> {
        if (this.#closed) return
        this.#finish()
        if (this.#ownsInterface) this.networkInterface.close()
        this.#emit('close')
    }

    #emit(event: string, ...args: unknown[]): void {
        (this as unknown as EventEmitter).emit(event, ...args)
    }

    #finish(): void {
        this.#closed = true
        this.#stopObserving?.()
        this.#stopObserving = undefined
        clearTimeout(this.#retry)
        clearInterval(this.#alive)
        this.#retry = undefined
        this.#alive = undefined
        this.#closeAll()
    }

    #closeAll(): void {
        for (const endpoint of this.#endpoints.values()) this.closeHandle(endpoint.handle)
        this.#endpoints.clear()
    }

    /**
     * The interfaces were read again: the sockets made or closed to match them
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
                this.failed(error)
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
     * While nothing is bound (the interface missing, no address, a retry pending), it keeps the process alive as a
     * listening server does
     */
    #keepAlive(): void {
        if (this.#closed || this.#endpoints.size) {
            clearInterval(this.#alive)
            this.#alive = undefined
        } else if (!this.#alive) {
            this.#alive = setInterval((): void => undefined, 0x7fffffff)
        }
    }

    /**
     * An error of a binding again, or of a socket: the error event, the binding retried a little later
     */
    protected failed(error: unknown): void {
        if (this.#closed) return
        this.#emit('error', error)
        if (this.#retry) return
        this.#retry = setTimeout((): void => {
            this.#retry = undefined
            this.#sync()
        }, this.#retryDelay)
        this.#retryDelay = Math.min(this.#retryDelay * 2, RETRY_LAST)
    }

    #enforcementNow(): Enforcement {
        if (this.#bound) return {enforced: true}
        return addressEnforcement(this.networkInterface.index ?? 0, this.families)
    }

    /**
     * The guarantee read again: its event when it changed; with strict, the sockets closed while it is lost
     */
    #checkEnforcement(): void {
        const now: Enforcement = this.#enforcementNow()
        const changed: boolean = now.enforced !== this.#enforcement.enforced
        this.#enforcement = now
        if (!changed) return
        this.#emit('enforced', now.enforced)
        if (!this.strict) return
        if (!now.enforced) {
            this.#paused = true
            this.#closeAll()
            this.#emit('error', new NetIfNotEnforcedException(`The listening stopped: ${now.reason}`))
        } else {
            this.#paused = false
        }
    }

    #wanted(state: NetworkInterfaceInfo | undefined): Wanted[] {
        if (!state || this.#paused) return []
        if (this.#bound) return this.families.map((family: Family): Wanted => ({key: `bound|${family}|${state.index}`, family: family}))
        return state.addresses
            .filter((address: InterfaceAddress): boolean => this.families.includes(address.family))
            .map((address: InterfaceAddress): Wanted => ({key: `address|${address.family}|${address.address}|${address.scopeid ?? ''}`, family: address.family, address: address}))
    }

    /**
     * The sockets made and closed to match the interface; on the first time an error is thrown, later it is retried
     */
    async #reconcile(first: boolean): Promise<void> {
        this.#checkEnforcement()
        for (let attempt: number = 1; ; attempt++) {
            const state: NetworkInterfaceInfo | undefined = this.networkInterface.info
            const wanted: Wanted[] = this.#wanted(state)
            const keys: Set<string> = new Set(wanted.map((entry: Wanted): string => entry.key))
            for (const [key, endpoint] of [...this.#endpoints]) {
                if (keys.has(key)) continue
                this.closeHandle(endpoint.handle)
                this.#endpoints.delete(key)
            }
            let opened: boolean = false
            let byAddress: boolean = false
            try {
                for (const entry of wanted) {
                    if (this.#closed) return
                    if (this.#endpoints.has(entry.key)) continue
                    const result: Opened = await this.#open(entry, state!)
                    if (result === 'opened') opened = true
                    if (result === 'by address') {
                        byAddress = true
                        break
                    }
                }
            } catch (error) {
                //A port 0 the system gave the first socket, taken for the next one: all of them again on another port
                if (codeOf(error) === 'EADDRINUSE' && !this.#requestedPort && this.#endpoints.size && attempt < PORT_ATTEMPTS && first) {
                    this.#closeAll()
                    this.#port = undefined
                    continue
                }
                throw error
            }
            //Linux without the permission to bind to the interface: the addresses bound instead, at once
            if (byAddress) continue
            this.#retryDelay = RETRY_FIRST
            if (opened) this.#emit('listening')
            return
        }
    }

    async #open(entry: Wanted, state: NetworkInterfaceInfo): Promise<Opened> {
        let handle: Handle
        if (this.#bound) {
            let bound: {fd: number, port: number}
            try {
                bound = nativeBindSocket(state.name, entry.family === 'IPv4' ? 4 : 6, this.stream, this.#port ?? 0, 511)
            } catch (error) {
                const code: unknown = codeOf(error)
                if (code === 'EPERM' || code === 'EACCES') {
                    //Linux before 5.7 without CAP_NET_RAW: by address, without the guarantee
                    if (this.strict) throw new NetIfNotEnforcedException(`The process may not bind a socket to ${state.name}. ${LINUX_PERMISSION}`, {cause: error})
                    this.#bound = false
                    this.#closeAll()
                    this.#enforcement = {enforced: false, reason: LINUX_PERMISSION}
                    this.#emit('enforced', false)
                    return 'by address'
                }
                //IPv6 off in the system: IPv4 only for 'both'
                if (code === 'EAFNOSUPPORT' && this.families.length > 1) return 'skipped'
                if (vanished(error)) return 'skipped'
                throw error
            }
            try {
                handle = await this.openHandle({fd: bound.fd}, entry.family)
            } catch (error) {
                try {
                    closeSync(bound.fd)
                } catch {
                    //Owned by the socket already
                }
                throw error
            }
        } else {
            const address: InterfaceAddress = entry.address!
            //An IPv6 address with its scope: the index on Windows, the name of the interface elsewhere (libuv)
            const scope: string = address.family === 'IPv6' && address.scopeid ? `%${process.platform === 'win32' ? address.scopeid : state.name}` : ''
            try {
                handle = await this.openHandle({host: `${address.address}${scope}`, port: this.#port ?? 0}, entry.family)
            } catch (error) {
                if (vanished(error)) return 'skipped'
                throw error
            }
        }
        if (this.#closed) {
            this.closeHandle(handle)
            return 'skipped'
        }
        if (this.#port === undefined) this.#port = this.portOf(handle)
        const endpoint: Endpoint<Handle> = {key: entry.key, family: entry.family, handle: handle, address: entry.address}
        this.prepare(endpoint)
        this.#endpoints.set(entry.key, endpoint)
        return 'opened'
    }
}
