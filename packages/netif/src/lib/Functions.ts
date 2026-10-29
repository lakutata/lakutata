import {type Server} from 'node:net'
import {InterfaceListener, type ListenOptions} from './InterfaceListener.js'
import {type InterfaceSelector, NetworkInterface} from './NetworkInterface.js'
import {readInterfaces} from './Snapshot.js'
import {type NetworkInterfaceInfo} from './Types.js'

/**
 * The network interfaces of the machine, the ones without an address too, with their state: their name, index,
 * hardware address, whether they are enabled and connected, their usable addresses. More than `os.networkInterfaces()`,
 * which lists only the interfaces with an address and no state.
 * @returns The interfaces, in the order of the system.
 * @example
 * ```typescript
 * import {listInterfaces, type NetworkInterfaceInfo} from '@lakutata/netif'
 *
 * for (const entry of listInterfaces()) {
 *     console.log(entry.name, entry.running ? 'connected' : 'not connected', entry.addresses.map(address => address.cidr))
 * }
 * const connected: NetworkInterfaceInfo[] = listInterfaces().filter(entry => entry.running && !entry.loopback)
 * ```
 */
export function listInterfaces(): NetworkInterfaceInfo[] {
    return readInterfaces().interfaces
}

/**
 * Listens on an interface for a server: `new NetworkInterface(selector).listen(server, options)` in one call, the
 * interface followed until the listener is closed.
 * @param selector The interface: its name, `{mac}` or `{index}`.
 * @param server A `net.Server` or a server built on one (`http`, `https`, `http2`, `tls`), which must not listen itself.
 * @param options The port, the families, `strict` and the backlog.
 * @returns The listener.
 * @throws NetIfNotEnforcedException With `strict`, where the system cannot refuse the connections coming through another
 * interface.
 * @throws NetIfNotFoundException An index or a hardware address that cannot be found.
 * @throws NetIfException The system refused the first listening, its code as `errno`.
 * @example
 * ```typescript
 * import {createServer} from 'node:http'
 * import {type InterfaceListener, listenOn} from '@lakutata/netif'
 *
 * const listener: InterfaceListener = await listenOn('eth1', createServer((request, response) => response.end('ok')), {port: 8080})
 * console.log(listener.addresses)
 * ```
 */
export async function listenOn(selector: InterfaceSelector, server: Server, options: ListenOptions): Promise<InterfaceListener> {
    const networkInterface: NetworkInterface = new NetworkInterface(selector)
    try {
        return await new InterfaceListener(networkInterface, server, options, true).start()
    } catch (error) {
        networkInterface.close()
        throw error
    }
}

/**
 * Listens on several interfaces for a server: `listenOn()` for each of them, one listener by interface, the interfaces
 * followed until their listeners are closed. When one of them cannot be listened on, the ones listened on already are
 * closed and the error is thrown. Several interfaces need a port: 0 lets the system choose one for the first
 * interface, which may not exist yet.
 * @param selectors An interface (its name, `{mac}` or `{index}`), or several.
 * @param server A `net.Server` or a server built on one (`http`, `https`, `http2`, `tls`), which must not listen itself.
 * @param options The port, the families, `strict` and the backlog, the same for every interface.
 * @returns The listeners, in the order of the interfaces.
 * @throws TypeError No interface, or a port 0 with several of them.
 * @throws NetIfNotEnforcedException With `strict`, where the system cannot refuse the connections coming through another
 * interface.
 * @throws NetIfException The system refused a first listening, its code as `errno`.
 * @example
 * ```typescript
 * import {createServer} from 'node:http'
 * import {type InterfaceListener, listenOnAll} from '@lakutata/netif'
 *
 * const server = createServer((request, response) => response.end('ok'))
 * const listeners: InterfaceListener[] = await listenOnAll(['eth1', {mac: '52:54:00:12:34:56'}], server, {port: 8080})
 * for (const listener of listeners) listener.on('error', error => console.error(error))
 * ```
 */
export async function listenOnAll(selectors: InterfaceSelector | InterfaceSelector[], server: Server, options: ListenOptions): Promise<InterfaceListener[]> {
    const list: InterfaceSelector[] = Array.isArray(selectors) ? selectors : [selectors]
    if (!list.length) throw new TypeError('listenOnAll() takes an interface at least')
    if (list.length > 1 && options?.port === 0) throw new TypeError('Several interfaces need a port: 0 lets the system choose one for the first interface, which may not exist yet')
    const listeners: InterfaceListener[] = []
    try {
        for (const selector of list) listeners.push(await listenOn(selector, server, options))
    } catch (error) {
        await Promise.all(listeners.map((listener: InterfaceListener): Promise<void> => listener.close()))
        throw error
    }
    return listeners
}
