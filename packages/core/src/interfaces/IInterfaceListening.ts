import type {Server} from 'node:net'

/**
 * A network interface, as an implementation of {@link IInterfaceListening} takes it: its name (`'eth1'`; on Windows the
 * name of the network connection), its hardware address (`{mac: '52:54:00:12:34:56'}`) or its index (`{index: 3}`).
 */
export type NetworkInterfaceSelector = string | {
    /**
     * The hardware address of the interface.
     */
    mac: string
} | {
    /**
     * The index of the interface.
     */
    index: number
}

/**
 * An address a listener of a network interface can be reached at.
 */
export interface IListeningAddress {
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
 * The options of {@link IInterfaceListening.listenOnAll}.
 */
export interface IInterfaceListenOptions {
    /**
     * The port; 0 lets the system choose one (for one interface only).
     */
    port: number
    /**
     * The families listened on.
     * @default 'both'
     */
    family?: 'IPv4' | 'IPv6' | 'both'
    /**
     * Refuse to listen where the connections reaching the addresses of the interface through another interface cannot
     * be refused, and stop listening while they cannot. An implementation that never refuses them throws.
     * @default false
     */
    strict?: boolean
}

/**
 * The listener of a network interface for a server: it accepts the connections of the interface and gives them to the
 * server, whatever the addresses of the interface, again when they change and when the interface is unplugged and
 * plugged back. The server itself does not listen. The `InterfaceListener` of `@lakutata/netif` implements it.
 */
export interface IInterfaceListener {
    /**
     * The interface listened on: its name (`undefined` while it does not exist), and whether it is the loopback one.
     */
    readonly networkInterface: {
        readonly name: string | undefined
        readonly loopback: boolean
    }
    /**
     * The port, `undefined` until a port 0 is given one by the system.
     */
    readonly port: number | undefined
    /**
     * The addresses it can be reached at now: none while the interface does not exist or has no address.
     */
    readonly addresses: IListeningAddress[]
    /**
     * Whether the interface is listened on now.
     */
    readonly listening: boolean
    /**
     * Whether the system refuses the connections that reach the addresses of the interface through another interface.
     */
    readonly enforced: boolean
    /**
     * Why `enforced` is `false`, when it is.
     */
    readonly reason: string | undefined
    /**
     * Whether it was closed.
     */
    readonly closed: boolean

    /**
     * Stop listening; the connections established are left to the server.
     */
    close(): Promise<void>

    /**
     * The interface is listened on, again after a change.
     * @param event `'listening'`.
     * @param listener Called without argument.
     */
    on(event: 'listening', listener: () => void): this

    /**
     * A failure of listening again, retried by the listener; with `strict`, the guarantee lost.
     * @param event `'error'`.
     * @param listener Called with the error.
     */
    on(event: 'error', listener: (error: Error) => void): this

    /**
     * `enforced` changed.
     * @param event `'enforced'`.
     * @param listener Called with its new value.
     */
    on(event: 'enforced', listener: (enforced: boolean) => void): this

    /**
     * The listener was closed.
     * @param event `'close'`.
     * @param listener Called without argument.
     */
    on(event: 'close', listener: () => void): this

    /**
     * Remove a listener of an event.
     * @param event The event.
     * @param listener The listener given to `on()`.
     */
    off(event: 'listening' | 'error' | 'enforced' | 'close', listener: (...args: any[]) => void): this
}

/**
 * Listening on network interfaces instead of addresses: what the entrypoints use for their `interface` option. The
 * package `@lakutata/netif` implements it, and is the one used by default; another implementation is given in the
 * `interfaceListening` option of the entrypoints.
 * @example
 * ```typescript
 * import type {IInterfaceListener, IInterfaceListening} from 'lakutata'
 * import {listenOnAll} from '@lakutata/netif'
 *
 * //An implementation that writes each listener made before giving it to the entrypoint
 * const logged: IInterfaceListening = {
 *     listenOnAll: async (selectors, server, options): Promise<IInterfaceListener[]> => {
 *         const listeners: IInterfaceListener[] = await listenOnAll(selectors, server, options)
 *         for (const listener of listeners) console.log(listener.networkInterface.name, listener.addresses)
 *         return listeners
 *     }
 * }
 * ```
 */
export interface IInterfaceListening {
    /**
     * Listen on interfaces for a server, one listener by interface; when one cannot be listened on, the others are
     * closed and the error is thrown. An interface that does not exist yet is listened on once it appears.
     * @param selectors The interfaces; several need a port other than 0.
     * @param server The server the connections are given to.
     * @param options The port, the families, and whether the other interfaces must be refused.
     * @returns The listeners, in the order of the interfaces.
     */
    listenOnAll(selectors: NetworkInterfaceSelector | NetworkInterfaceSelector[], server: Server, options: IInterfaceListenOptions): Promise<IInterfaceListener[]>
}
