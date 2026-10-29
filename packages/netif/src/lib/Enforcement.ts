import {nativeWeakReception} from './Native.js'

/**
 * A family of addresses
 */
export type Family = 'IPv4' | 'IPv6'

/**
 * Whether the system refuses the connections and the datagrams reaching the addresses of an interface through another
 * interface, and why not
 */
export interface Enforcement {
    enforced: boolean
    reason?: string
}

/**
 * Why a socket of Linux could not be bound to the interface
 */
export const LINUX_PERMISSION: string = 'Linux accepts the packets of an address through any interface, and binding a socket to an interface (SO_BINDTODEVICE) needs the capability CAP_NET_RAW before Linux 5.7: give it to the process (setcap cap_net_raw+ep on its executable, AmbientCapabilities=CAP_NET_RAW in its systemd unit) or run a newer kernel'

/**
 * Whether the system refuses, through the other interfaces, the packets for the addresses of the interface of the index
 * when they are listened on by address: the strong host model of Windows (every other interface receiving with it and
 * not forwarding) and of macOS (net.inet.ip.check_interface set to 2, forwarding off); never on Linux
 */
export function addressEnforcement(index: number, families: Family[]): Enforcement {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
        if (process.platform === 'linux') return {enforced: false, reason: LINUX_PERMISSION}
        return {enforced: false, reason: `The interfaces of ${process.platform} are listened on by address, with no guarantee about the other interfaces`}
    }
    for (const family of families) {
        const weak: {interface: string, setting: string} | null = nativeWeakReception(index, family === 'IPv4' ? 4 : 6)
        if (!weak) continue
        const version: string = family === 'IPv4' ? 'ipv4' : 'ipv6'
        if (process.platform === 'win32') {
            const setting: string = weak.setting === 'WeakHostReceive' ? 'weakhostreceive' : 'forwarding'
            return {
                enforced: false,
                reason: `Windows accepts ${family} packets for the addresses of the interface through the interface "${weak.interface}": its ${weak.setting} is enabled. Disable it as an administrator: netsh interface ${version} set interface "${weak.interface}" ${setting}=disabled`
            }
        }
        if (weak.setting.endsWith('forwarding')) {
            return {
                enforced: false,
                reason: `macOS forwards ${family} (${weak.setting} is 1, as while a virtual machine or a container shares the network), and does not check the interface packets come through then`
            }
        }
        return {
            enforced: false,
            reason: `macOS accepts the ${family} packets of an address through any interface (${weak.setting} is not 2). Make it refuse them: sudo sysctl -w ${weak.setting}=2, with forwarding off`
        }
    }
    return {enforced: true}
}
