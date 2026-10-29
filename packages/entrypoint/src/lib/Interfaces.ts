import type {Server} from 'node:net'
import type {IInterfaceListener, IInterfaceListening, NetworkInterfaceSelector} from '@lakutata/core'
import type {ChannelRuntime} from '../channel/EntrypointAdapter.js'

/**
 * The options of an adapter listening on network interfaces instead of an address: the adapter listens on the
 * interfaces whatever their addresses, again when they change and when an interface is unplugged and plugged back,
 * through an implementation of `IInterfaceListening` of `@lakutata/core` (the package `@lakutata/netif`, installed
 * apart, by default).
 */
export interface InterfaceListeningOptions {
    /**
     * The network interface to listen on instead of an address: its name (`'eth1'`; on Windows the name of the network
     * connection), `{mac: '52:54:00:12:34:56'}` or `{index: 3}`; several of them in an array (then the port cannot be
     * 0). It excludes `host`. The interface may not exist yet: the adapter starts, and listens on it once it can.
     */
    interface?: NetworkInterfaceSelector | NetworkInterfaceSelector[]

    /**
     * With `interface`: the adapter fails to start where the system cannot refuse the connections reaching the addresses
     * of the interface through another interface, and stops listening while that guarantee is lost (see `enforced` of
     * the listeners). `false` by default: the best the system allows.
     */
    strict?: boolean

    /**
     * With `interface`: the families listened on, `'IPv4'`, `'IPv6'` or `'both'`.
     * @default 'both'
     */
    family?: 'IPv4' | 'IPv6' | 'both'

    /**
     * With `interface`: the errors of the listening on the interfaces once the adapter started (the port taken when an
     * interface is listened on again, the guarantee of `strict` lost), retried by the listeners. Without it they are
     * written to the log of the application.
     */
    onError?: (error: unknown) => void | Promise<void>

    /**
     * With `interface`: the implementation of the listening on interfaces.
     * @default the one of `@lakutata/netif`, loaded when `interface` is given (an error tells how to install it when it
     * is missing)
     */
    interfaceListening?: IInterfaceListening
}

/**
 * Checks the options of an adapter for the interfaces: whether interfaces are given
 * @param name The name of the adapter function, for the messages.
 * @param options Its options.
 * @param unsupported Why `interface` cannot be given in the configuration of these options, when it cannot.
 * @returns Whether the adapter listens on interfaces.
 * @throws {TypeError} `host` and `interface` together, `strict`, `family`, `onError` or `interfaceListening` without
 * `interface`, `interface` where it cannot be given.
 */
export function listensOnInterfaces(name: string, options: InterfaceListeningOptions & {host?: string}, unsupported?: string): boolean {
    if (options.interface === undefined) {
        const given: string[] = (['strict', 'family', 'onError', 'interfaceListening'] as const).filter((option: string): boolean => (options as Record<string, unknown>)[option] !== undefined)
        if (given.length) throw new TypeError(`${name}: ${given.join(', ')} ${given.length > 1 ? 'are options' : 'is an option'} of interface, which is not given`)
        return false
    }
    if (unsupported) throw new TypeError(`${name}: interface cannot be given ${unsupported}`)
    if (options.host !== undefined) throw new TypeError(`${name}: host and interface cannot be given together (an address, or an interface whatever its addresses)`)
    return true
}

/**
 * The implementation of the options, else the one of `@lakutata/netif`, an optional dependency, loaded now
 */
async function implementationOf(name: string, options: InterfaceListeningOptions): Promise<IInterfaceListening> {
    if (options.interfaceListening) return options.interfaceListening
    try {
        return await import('@lakutata/netif')
    } catch (error: unknown) {
        const code: unknown = (error as NodeJS.ErrnoException)?.code
        if ((code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') && String((error as Error).message).includes('@lakutata/netif')) {
            throw new Error(`The interface option of ${name} needs the package @lakutata/netif (npm install @lakutata/netif)`, {cause: error})
        }
        throw error
    }
}

/**
 * Gives an error of the listening to the handler of the options, or writes it to the log of the application
 */
async function report(runtime: ChannelRuntime<any>, onError: InterfaceListeningOptions['onError'], error: unknown, message: string): Promise<void> {
    if (onError) {
        try {
            return await onError(error)
        } catch (handlerError: unknown) {
            error = handlerError
            message = `The onError handler of an adapter failed (${message})`
        }
    }
    try {
        const logger: any = await runtime.getObject('log')
        logger.error(error, message)
    } catch {
        console.error(`${message}:`, error)
    }
}

/**
 * Listens on the interfaces of the options for the server, which does not listen itself: its connections are given to
 * it by the listeners. Their errors once started go to `onError`, else to the log of the application.
 * @param name The name of the adapter function, for the messages.
 * @param runtime The runtime of the channel.
 * @param server The server.
 * @param options The options of the adapter.
 * @param port The port.
 * @param webSockets How the adapter serves WebSockets, when it does: refused in Bun (1.4), whose WebSocket server cannot
 * take the upgrade of a connection given to the server (it throws, uncaught, and the client gets no answer).
 * @returns The listeners, one by interface.
 * @throws {Error} WebSockets in Bun.
 */
export async function listenOnInterfaces(name: string, runtime: ChannelRuntime<any>, server: Server, options: InterfaceListeningOptions, port: number, webSockets?: string): Promise<IInterfaceListener[]> {
    if (webSockets && process.versions.bun) {
        throw new Error(`${name}: Bun cannot upgrade to a WebSocket a connection given to a server listening on an interface (${webSockets})`)
    }
    const implementation: IInterfaceListening = await implementationOf(name, options)
    const listeners: IInterfaceListener[] = await implementation.listenOnAll(options.interface!, server, {port: port, family: options.family, strict: options.strict})
    for (const listener of listeners) {
        listener.on('error', (error: Error): void => {
            void report(runtime, options.onError, error, `The listening of ${name} on an interface failed`)
        })
    }
    return listeners
}

/**
 * Closes the listeners: no connection accepted any more (the ones established are left to the server)
 * @param listeners The listeners, none when the adapter listens on an address.
 */
export async function closeListeners(listeners: IInterfaceListener[] | undefined): Promise<void> {
    if (listeners) await Promise.all(listeners.map((listener: IInterfaceListener): Promise<void> => listener.close()))
}
