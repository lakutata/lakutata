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
