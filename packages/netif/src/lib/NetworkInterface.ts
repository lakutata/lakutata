import {EventEmitter} from 'node:events'
import {NetIfException} from '../exceptions/NetIfException.js'
import {NetIfNotFoundException} from '../exceptions/NetIfNotFoundException.js'
import {NetIfTimeoutException} from '../exceptions/NetIfTimeoutException.js'
import {registry} from './Registry.js'
import {readInterfaces} from './Snapshot.js'
import {type InterfaceAddress, type NetworkInterfaceInfo} from './Types.js'

/**
 * How an interface is given: its name (`'eth1'`, `'en0'`, `'以太网 2'`), its hardware address (`{mac: '52:54:00:12:34:56'}`,
 * the same on every system, the one to give a management port by) or its index (`{index: 3}`, which changes when the
 * interface is unplugged and plugged again).
 */
export type InterfaceSelector = string | {
    /**
     * The hardware address: `'52:54:00:12:34:56'`, `'52-54-00-12-34-56'`, in either case.
     */
    mac: string
} | {
    /**
     * The index of the interface.
     */
    index: number
}

/**
 * A change of the addresses of an interface: the `change` event.
 */
export interface AddressChange {
    /**
     * Every usable address of the interface now.
     */
    addresses: InterfaceAddress[]

    /**
     * The addresses that came: added, or usable since (an IPv6 address once its duplicate address detection is over).
     */
    added: InterfaceAddress[]

    /**
     * The addresses that went.
     */
    removed: InterfaceAddress[]
}

/**
 * The options of `waitForAddress()`.
 */
export interface WaitForAddressOptions {
    /**
     * The family of the address to wait for, any by default.
     */
    family?: 'IPv4' | 'IPv6'

    /**
     * The milliseconds to wait at most, without limit by default: then a `NetIfTimeoutException`.
     */
    timeout?: number
}

/**
 * The events of a `NetworkInterface` and their arguments.
 */
export interface NetworkInterfaceEvents {
    /**
     * The addresses changed (some added, some removed).
     */
    change: [change: AddressChange]

    /**
     * The link came up: a cable plugged in, an association made.
     */
    up: []

    /**
     * The link went down.
     */
    down: []

    /**
     * The interface appeared: plugged, created, enabled (on Windows).
     */
    added: []

    /**
     * The interface disappeared.
     */
    removed: []
}

const MAC: RegExp = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i

/**
 * The key of an address in a comparison
 */
function keyOf(address: InterfaceAddress): string {
    return `${address.family}|${address.address}|${address.scopeid ?? ''}`
}

/**
 * What changed between two states of an interface: whether it appeared or disappeared, its link came up or went down,
 * and its addresses added and removed
 */
export function changesOf(previous: NetworkInterfaceInfo | undefined, next: NetworkInterfaceInfo | undefined): {appeared: boolean, disappeared: boolean, up: boolean, down: boolean, added: InterfaceAddress[], removed: InterfaceAddress[]} {
    const before: Map<string, InterfaceAddress> = new Map((previous?.addresses ?? []).map((address: InterfaceAddress): [string, InterfaceAddress] => [keyOf(address), address]))
    const after: Map<string, InterfaceAddress> = new Map((next?.addresses ?? []).map((address: InterfaceAddress): [string, InterfaceAddress] => [keyOf(address), address]))
    const wasRunning: boolean = previous?.running ?? false
    const isRunning: boolean = next?.running ?? false
    return {
        appeared: !previous && !!next,
        disappeared: !!previous && !next,
        up: !wasRunning && isRunning,
        down: wasRunning && !isRunning,
        added: [...after].filter(([key]): boolean => !before.has(key)).map(([, address]): InterfaceAddress => ({...address})),
        removed: [...before].filter(([key]): boolean => !after.has(key)).map(([, address]): InterfaceAddress => ({...address}))
    }
}

/**
 * A network interface of the machine, followed: its state and addresses now, events when they change, and the servers
 * listening on it. The interface may not exist yet (a USB adapter not plugged in, a system starting): the object follows
 * it once it appears, and again when it is unplugged and plugged back.
 * @example
 * ```typescript
 * import {type InterfaceAddress, NetworkInterface} from '@lakutata/netif'
 *
 * const management: NetworkInterface = new NetworkInterface('eth1')
 * console.log(management.present, management.running, management.addresses.map(address => address.address))
 * management.on('change', ({added, removed}) => console.log('added', added, 'removed', removed))
 * management.on('down', () => console.log('the cable of eth1 is unplugged'))
 * const address: InterfaceAddress = await management.waitForAddress({family: 'IPv4', timeout: 30000})
 * console.log(`http://${address.address}:8080`)
 * management.close()
 * ```
 */
export class NetworkInterface extends EventEmitter<NetworkInterfaceEvents> {

    /**
     * How the interface was given.
     */
    public readonly selector: InterfaceSelector

    #state: NetworkInterfaceInfo | undefined

    #unsubscribe: (() => void) | undefined

    readonly #waits: Set<(error: NetIfException) => void> = new Set()

    /**
     * Follows an interface.
     * @param selector Its name, `{mac}` or `{index}`.
     * @throws NetIfNotFoundException An index that no interface has (an index is never given again once its interface is
     * gone), or a hardware address that several interfaces have now (a bridge and its ports: give the name then).
     */
    constructor(selector: InterfaceSelector) {
        super()
        this.selector = NetworkInterface.#normalized(selector)
        this.#unsubscribe = registry.subscribe((interfaces: NetworkInterfaceInfo[]): void => this.#update(interfaces))
        const {entry, ambiguous} = this.#match(registry.current())
        if (ambiguous || (!entry && typeof this.selector === 'object' && 'index' in this.selector)) {
            this.close()
            throw new NetIfNotFoundException(ambiguous
                ? `Several interfaces have the hardware address ${(this.selector as {mac: string}).mac}: give the interface by its name`
                : `No interface has the index ${(this.selector as {index: number}).index}`)
        }
        this.#state = entry
    }

    /**
     * The network interfaces of the machine, as `listInterfaces()` gives them.
     * @returns The interfaces, in the order of the system.
     * @example
     * ```typescript
     * import {NetworkInterface} from '@lakutata/netif'
     *
     * const names: string[] = NetworkInterface.list().map(entry => entry.name)
     * ```
     */
    public static list(): NetworkInterfaceInfo[] {
        return readInterfaces().interfaces
    }

    static #normalized(selector: InterfaceSelector): InterfaceSelector {
        if (typeof selector === 'string') {
            if (!selector) throw new TypeError('The name of an interface is empty')
            return selector
        }
        if (selector && typeof selector === 'object' && 'mac' in selector) {
            if (typeof selector.mac !== 'string' || !MAC.test(selector.mac)) throw new TypeError(`${String(selector.mac)} is not a hardware address (aa:bb:cc:dd:ee:ff)`)
            return {mac: selector.mac.toLowerCase().replaceAll('-', ':')}
        }
        if (selector && typeof selector === 'object' && 'index' in selector) {
            if (!Number.isInteger(selector.index) || selector.index <= 0) throw new TypeError(`${String(selector.index)} is not the index of an interface`)
            return {index: selector.index}
        }
        throw new TypeError('An interface is given by its name, {mac} or {index}')
    }

    /**
     * Whether the interface exists now.
     */
    public get present(): boolean {
        return !!this.#state
    }

    /**
     * Its name, `undefined` while it does not exist.
     */
    public get name(): string | undefined {
        return this.#state?.name
    }

    /**
     * Its index, `undefined` while it does not exist. It changes when the interface is unplugged and plugged again.
     */
    public get index(): number | undefined {
        return this.#state?.index
    }

    /**
     * Its hardware address, `undefined` while it does not exist or when it has none (and on the macOS versions that hide
     * it).
     */
    public get mac(): string | undefined {
        return this.#state?.mac
    }

    /**
     * Whether it is enabled (its administrative state); `false` while it does not exist.
     */
    public get up(): boolean {
        return this.#state?.up ?? false
    }

    /**
     * Whether its link is up (a cable plugged in, an association made); `false` while it does not exist.
     */
    public get running(): boolean {
        return this.#state?.running ?? false
    }

    /**
     * Whether it is the loopback interface.
     */
    public get loopback(): boolean {
        return this.#state?.loopback ?? false
    }

    /**
     * Its usable addresses now, an empty array when it has none or does not exist.
     */
    public get addresses(): InterfaceAddress[] {
        return this.#state ? this.#state.addresses.map((address: InterfaceAddress): InterfaceAddress => ({...address})) : []
    }

    /**
     * Its state now as `listInterfaces()` gives it, `undefined` while it does not exist.
     */
    public get info(): NetworkInterfaceInfo | undefined {
        return this.#state ? {...this.#state, addresses: this.addresses} : undefined
    }

    /**
     * Whether the object was closed.
     */
    public get closed(): boolean {
        return !this.#unsubscribe
    }

    /**
     * An address of the interface: one it has now, or the first one it gets.
     * @param options The family of the address and the milliseconds to wait at most.
     * @returns The address.
     * @throws NetIfTimeoutException No address came in time.
     * @throws NetIfException The object was closed while waiting.
     * @example
     * ```typescript
     * import {type InterfaceAddress, NetworkInterface} from '@lakutata/netif'
     *
     * const wan: NetworkInterface = new NetworkInterface('eth0')
     * const address: InterfaceAddress = await wan.waitForAddress({family: 'IPv4', timeout: 60000})
     * wan.close()
     * ```
     */
    public waitForAddress(options: WaitForAddressOptions = {}): Promise<InterfaceAddress> {
        const pick = (): InterfaceAddress | undefined => this.addresses.find((address: InterfaceAddress): boolean => !options.family || address.family === options.family)
        const found: InterfaceAddress | undefined = pick()
        if (found) return Promise.resolve(found)
        if (this.closed) return Promise.reject(new NetIfException('The NetworkInterface is closed'))
        return new Promise((resolve: (address: InterfaceAddress) => void, reject: (error: NetIfException) => void): void => {
            //The wait keeps the process alive, as a server waiting for connections does
            const alive: NodeJS.Timeout = setInterval((): void => undefined, 0x7fffffff)
            let timer: NodeJS.Timeout | undefined
            const finish = (): void => {
                clearInterval(alive)
                clearTimeout(timer)
                this.off('change', changed)
                this.#waits.delete(closed)
            }
            const changed = (): void => {
                const address: InterfaceAddress | undefined = pick()
                if (!address) return
                finish()
                resolve(address)
            }
            const closed = (error: NetIfException): void => {
                finish()
                reject(error)
            }
            this.on('change', changed)
            this.#waits.add(closed)
            if (options.timeout !== undefined) {
                timer = setTimeout((): void => closed(new NetIfTimeoutException(`${this.#described()} got no ${options.family ?? ''} address in ${options.timeout} ms`.replace('  ', ' '))), options.timeout)
            }
        })
    }

    /**
     * Stops following the interface: no event any more; the waits of `waitForAddress()` are rejected.
     */
    public close(): void {
        if (!this.#unsubscribe) return
        this.#unsubscribe()
        this.#unsubscribe = undefined
        for (const closed of [...this.#waits]) closed(new NetIfException('The NetworkInterface was closed while waiting for an address'))
    }

    #described(): string {
        if (typeof this.selector === 'string') return `The interface ${this.selector}`
        return 'mac' in this.selector ? `The interface of ${this.selector.mac}` : `The interface of index ${this.selector.index}`
    }

    /**
     * The interface given among the interfaces, and whether several match (a hardware address shared)
     */
    #match(interfaces: NetworkInterfaceInfo[]): {entry: NetworkInterfaceInfo | undefined, ambiguous: boolean} {
        const selector: InterfaceSelector = this.selector
        const matches: NetworkInterfaceInfo[] = interfaces.filter((entry: NetworkInterfaceInfo): boolean => {
            if (typeof selector === 'string') return entry.name === selector
            if ('mac' in selector) return entry.mac === selector.mac
            return entry.index === selector.index
        })
        return {entry: matches.length === 1 ? matches[0] : undefined, ambiguous: matches.length > 1}
    }

    /**
     * The interfaces read again: the state updated, the events of what changed emitted
     */
    #update(interfaces: NetworkInterfaceInfo[]): void {
        if (this.closed) return
        const previous: NetworkInterfaceInfo | undefined = this.#state
        const next: NetworkInterfaceInfo | undefined = this.#match(interfaces).entry
        this.#state = next
        const changes: ReturnType<typeof changesOf> = changesOf(previous, next)
        if (changes.appeared) this.emit('added')
        if (changes.up) this.emit('up')
        if (changes.down) this.emit('down')
        if (changes.added.length || changes.removed.length) this.emit('change', {addresses: this.addresses, added: changes.added, removed: changes.removed})
        if (changes.disappeared) this.emit('removed')
    }
}
