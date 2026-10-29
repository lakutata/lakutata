import {closeSync} from 'node:fs'
import {type InterfaceAddress, listInterfaces, NetIfNotEnforcedException, NetworkInterface, type NetworkInterfaceInfo} from '../../exports/Netif.js'

/**
 * Linux: whether the process may bind a socket to an interface (no privilege needed since Linux 5.7, CAP_NET_RAW
 * before); false elsewhere
 */
export function mayBind(): boolean {
    if (process.platform !== 'linux') return false
    const loopback: NetworkInterfaceInfo = listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!
    const followed: NetworkInterface = new NetworkInterface(loopback.name)
    try {
        closeSync(followed.bindSocket({type: 'udp'}).fd)
        return true
    } catch (error) {
        if (error instanceof NetIfNotEnforcedException) return false
        throw error
    } finally {
        followed.close()
    }
}
