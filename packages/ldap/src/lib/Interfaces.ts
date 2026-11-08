//Adapted from lib/Interfaces.ts of @lakutata/entrypoint (its functions are not exported), as @lakutata/mcp and
//@lakutata/grpc copy it: for a component rather than an entrypoint adapter, its errors given to a function
import type {Server} from 'node:net'
import type {IInterfaceListener, IInterfaceListening, NetworkInterfaceSelector} from '@lakutata/core'

/**
 * The options of a server listening on network interfaces instead of an address: it listens on the interfaces
 * whatever their addresses, again when they change and when an interface is unplugged and plugged back, through an
 * implementation of `IInterfaceListening` of `@lakutata/core` (the package `@lakutata/netif`, installed apart, by
 * default).
 */
export interface InterfaceListeningOptions {
    /**
     * The network interface to listen on instead of an address: its name (`'eth1'`; on Windows the name of the network
     * connection), `{mac: '52:54:00:12:34:56'}` or `{index: 3}`; several of them in an array (then the port cannot be
     * 0). It excludes `host`. The interface may not exist yet: the server starts, and listens on it once it can.
     */
    interface?: NetworkInterfaceSelector | NetworkInterfaceSelector[]
    /**
     * With `interface`: the server fails to start where the system cannot refuse the connections reaching the addresses
     * of the interface through another interface, and stops listening while that guarantee is lost. `false` by
     * default: the best the system allows.
     */
    strict?: boolean
    /**
     * With `interface`: the families listened on, `'IPv4'`, `'IPv6'` or `'both'` (by default).
     */
    family?: 'IPv4' | 'IPv6' | 'both'
    /**
     * With `interface`: the errors of the listening on the interfaces once the server started, retried by the
     * listeners. Without it they are written to the log of the application.
     */
    onError?: (error: unknown) => void | Promise<void>
    /**
     * With `interface`: the implementation of the listening on interfaces (the one of `@lakutata/netif`, loaded when
     * `interface` is given, by default)
     */
    interfaceListening?: IInterfaceListening
}

/**
 * Checks the options for the interfaces: whether interfaces are given
 * @param name The name of the component, for the messages.
 * @param options Its options.
 * @returns Whether the component listens on interfaces.
 * @throws {TypeError} `host` and `interface` together, `strict`, `family`, `onError` or `interfaceListening` without
 * `interface`.
 */
export function listensOnInterfaces(name: string, options: InterfaceListeningOptions & {host?: string}): boolean {
    if (options.interface === undefined) {
        const given: string[] = (['strict', 'family', 'onError', 'interfaceListening'] as const).filter((option: string): boolean => (options as Record<string, unknown>)[option] !== undefined)
        if (given.length) throw new TypeError(`${name}: ${given.join(', ')} ${given.length > 1 ? 'are options' : 'is an option'} of interface, which is not given`)
        return false
    }
    if (options.host !== undefined) throw new TypeError(`${name}: host and interface cannot be given together (an address, or an interface whatever its addresses)`)
    return true
}

/**
 * The implementation of the options, else the one of `@lakutata/netif`, an optional dependency, loaded now
 * @param name The name of the component.
 * @param options The options.
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
 * Listens on the interfaces of the options for the server, which does not listen itself: its connections are given to
 * it by the listeners. Their errors once started go to `onError`, else to `report`.
 * @param name The name of the component, for the messages.
 * @param server The server.
 * @param options The options of the component.
 * @param port The port.
 * @param report What reports an error without `onError`.
 * @returns The listeners, one by interface.
 */
export async function listenOnInterfaces(name: string, server: Server, options: InterfaceListeningOptions, port: number, report: (error: unknown, message: string) => void): Promise<IInterfaceListener[]> {
    const implementation: IInterfaceListening = await implementationOf(name, options)
    const listeners: IInterfaceListener[] = await implementation.listenOnAll(options.interface!, server, {port: port, family: options.family, strict: options.strict})
    for (const listener of listeners) {
        listener.on('error', (error: Error): void => {
            const message: string = `The listening of ${name} on an interface failed`
            if (!options.onError) {
                report(error, message)
                return
            }
            Promise.resolve(options.onError(error)).catch((handlerError: unknown): void => report(handlerError, `The onError handler of ${name} failed (${message})`))
        })
    }
    return listeners
}

/**
 * Closes the listeners: no connection accepted any more (the ones established are left to the server)
 * @param listeners The listeners, none when the component listens on an address.
 */
export async function closeListeners(listeners: IInterfaceListener[] | undefined): Promise<void> {
    if (listeners) await Promise.all(listeners.map((listener: IInterfaceListener): Promise<void> => listener.close()))
}
