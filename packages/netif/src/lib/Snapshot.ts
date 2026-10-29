import {type NativeAddress, type NativeInterface, nativeList} from './Native.js'
import {type InterfaceAddress, type NetworkInterfaceInfo} from './Types.js'

/**
 * The mask of a prefix length: `'255.255.255.0'` for 24 in IPv4, `'ffff:ffff:ffff:ffff::'` for 64 in IPv6
 */
export function netmaskOf(family: 'IPv4' | 'IPv6', prefixLength: number): string {
    const bits: number = family === 'IPv4' ? 32 : 128
    const length: number = Math.max(0, Math.min(bits, prefixLength))
    const bytes: number[] = []
    for (let index: number = 0; index < bits / 8; index++) {
        const taken: number = Math.max(0, Math.min(8, length - index * 8))
        bytes.push(taken === 0 ? 0 : (0xff << (8 - taken)) & 0xff)
    }
    if (family === 'IPv4') return bytes.join('.')
    const groups: number[] = []
    for (let index: number = 0; index < 16; index += 2) groups.push(bytes[index] * 256 + bytes[index + 1])
    //The longest run of zero groups (two at least) written ::
    let start: number = -1
    let size: number = 0
    for (let index: number = 0; index < 8;) {
        if (groups[index] !== 0) {
            index++
            continue
        }
        let end: number = index
        while (end < 8 && groups[end] === 0) end++
        if (end - index > size) {
            start = index
            size = end - index
        }
        index = end
    }
    const hex: string[] = groups.map((group: number): string => group.toString(16))
    if (size < 2) return hex.join(':')
    return `${hex.slice(0, start).join(':')}::${hex.slice(start + size).join(':')}`
}

/**
 * An address read by the addon as an address of the package
 */
function addressOf(address: NativeAddress): InterfaceAddress {
    const converted: InterfaceAddress = {
        address: address.address,
        family: address.family,
        netmask: netmaskOf(address.family, address.prefixLength),
        cidr: `${address.address}/${address.prefixLength}`
    }
    if (address.family === 'IPv6') converted.scopeid = address.scopeid ?? 0
    return converted
}

/**
 * An interface read by the addon as an interface of the package: its usable addresses only
 */
export function interfaceOf(entry: NativeInterface): NetworkInterfaceInfo {
    const converted: NetworkInterfaceInfo = {
        name: entry.name,
        index: entry.index,
        up: entry.up,
        running: entry.running,
        loopback: entry.loopback,
        addresses: entry.addresses.filter((address: NativeAddress): boolean => !address.tentative).map(addressOf)
    }
    if (entry.mac) converted.mac = entry.mac
    return converted
}

/**
 * The interfaces of the machine now, and whether some address is still tentative (to be read again soon)
 */
export function readInterfaces(): {interfaces: NetworkInterfaceInfo[], tentative: boolean} {
    const entries: NativeInterface[] = nativeList()
    return {
        interfaces: entries.map(interfaceOf),
        tentative: entries.some((entry: NativeInterface): boolean => entry.addresses.some((address: NativeAddress): boolean => address.tentative))
    }
}
