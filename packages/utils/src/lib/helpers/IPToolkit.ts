/**
 * The numeric forms of an IPv4 address, given by {@link IPv4.toBinHex}.
 */
export interface IPBinHex {
    /**
     * The address as 8 lower-case hexadecimal digits prefixed with `0x` (`'0xc0a80001'`).
     */
    hex: string
    /**
     * The address as an unsigned 32-bit integer (`3232235521`).
     */
    decimal: number
    /**
     * The address as 32 binary digits, padded with leading zeros.
     */
    binary: string
}

/**
 * An IPv4 subnet, given by {@link IPv4.parseCIDR} and {@link IPv4.parseSubnet}. The addresses are in dotted decimal
 * notation (`'192.168.0.1'`).
 */
export interface IPv4Subnet {
    /**
     * The prefix length, from `0` to `32` (`24` for `/24`).
     */
    cidrMask: number
    /**
     * The number of addresses in the subnet, the network and broadcast addresses included: 2 to the power of
     * `32 - cidrMask` (`256` for a `/24`).
     */
    ipCount: number
    /**
     * The number of host addresses: `ipCount - 2`, or `ipCount` for a `/31` (a point-to-point link) and a `/32` (a
     * single host), which have no network nor broadcast address.
     */
    usableCount: number
    /**
     * The subnet mask of the prefix length (`'255.255.255.0'` for a `/24`).
     */
    subnetMask: string
    /**
     * The first host address: the one after the network address, or the first address of a `/31` or a `/32`.
     */
    firstHost: string
    /**
     * The last host address: the one before the broadcast address, or the last address of a `/31` or a `/32`.
     */
    lastHost: string
    /**
     * The network address, the first address of the subnet (its host bits zero); `''` for a `/31` and a `/32`.
     */
    networkAddress: string
    /**
     * The broadcast address, the last address of the subnet (its host bits one); `''` for a `/31` and a `/32`.
     */
    broadcastAddress: string
}

/**
 * An IPv6 prefix (a CIDR block), given by {@link IPv6.parseCIDR}. The addresses are in compressed form
 * (`'2001:db8::'`).
 */
export interface IPv6Subnet {
    /**
     * The number of addresses in the block: 2 to the power of `128 - prefixLength`, as a bigint
     * (`18446744073709551616n` for a `/64`).
     */
    ipCount: bigint
    /**
     * The last address of the block, its host bits one (`'2001:db8::ffff:ffff:ffff:ffff'` for `2001:db8::/64`).
     */
    lastHost: string
    /**
     * The first address of the block, its host bits zero (`'2001:db8::'` for `2001:db8::1/64`). IPv6 has no broadcast
     * address, so no address is reserved.
     */
    firstHost: string
    /**
     * The prefix length, from `0` to `128`.
     */
    prefixLength: number
}

/**
 * The IPv6 forms of an IPv4 address mapped into IPv6 (`::ffff:0:0/96`), given by {@link IPv4.toIPv6Format}.
 */
export interface IPv6Result {
    /**
     * The mixed notation, the IPv4 address in dotted decimal after `::ffff:` (`'::ffff:192.168.1.1'`).
     */
    mapped: string
    /**
     * The expanded form, 8 groups of 4 hexadecimal digits (`'0000:0000:0000:0000:0000:ffff:c0a8:0101'`).
     */
    expanded: string
    /**
     * The compressed form, the zero groups shortened (`'::ffff:c0a8:101'`).
     */
    compressed: string
}

/**
 * The address and the prefix length of a CIDR block: exactly one `/`, the length in decimal digits only, at most the
 * given one; false when it is not so
 * @param cidr
 * @param maxLength
 */
function SplitCIDR(cidr: string, maxLength: number): { ip: string, length: number } | false {
    const parts: string[] = cidr.split('/')
    if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) return false
    const length: number = Number(parts[1])
    return length <= maxLength ? {ip: parts[0], length: length} : false
}

/**
 * A range of consecutive IPv4 addresses, both ends included, held as unsigned 32-bit integers. It is obtained from
 * {@link IPv4.ipRange}: `IPv4.ipRange.fromString('192.168.1.1', '192.168.1.100')` or
 * `IPv4.ipRange.fromLong(3232235777, 3232235876)`.
 */
class IPv4Range {

    readonly #start: number
    readonly #end: number

    /**
     * Create a range of the integer forms of two addresses, given in either order: the smaller one is the start
     * (`new IPv4.ipRange(5, 1)` is the range from `1` to `5`). {@link IPv4Range.fromLong} and
     * {@link IPv4Range.fromString} refuse the ends in the wrong order instead.
     * @param start An end of the range, an integer from `0` to `4294967295`.
     * @param end The other end of the range, an integer from `0` to `4294967295`.
     * @throws {Error} When `start` or `end` is out of `0`…`4294967295`.
     */
    constructor(start: number, end: number) {
        if (+start < 0 || +start > 4294967295 || +end < 0 || +end > 4294967295) {
            throw new Error('Invalid start or end IPv4 address')
        }
        this.#start = Math.min(start, end)
        this.#end = Math.max(start, end)
    }

    /**
     * Create a range of the integer forms of its first and last addresses.
     * @param start The first address, an integer from `0` to `4294967295` (`3232235777` for `192.168.1.1`).
     * @param end The last address, an integer from `start` to `4294967295`.
     * @returns The range.
     * @throws {Error} When `start` or `end` is not a number or is out of `0`…`4294967295`, or when `end` is less than
     * `start`.
     */
    static fromLong(start: number, end: number): IPv4Range {
        if (typeof start !== 'number' || typeof end !== 'number') throw new Error('Invalid start or end IPv4 address')
        if (+end < +start) throw new Error('Invalid range value, end must be greater than or equal to start')
        return new IPv4Range(start, end)
    }

    /**
     * Create a range of its first and last addresses, in dotted decimal notation (the leading zeros are accepted, as by
     * {@link IPv4.isValidIP}).
     * @param start The first address (`'192.168.1.1'`).
     * @param end The last address, equal to or after `start` (`'192.168.1.100'`).
     * @returns The range.
     * @throws {Error} When `start` or `end` is not a valid IPv4 address, or when `end` is before `start`.
     */
    static fromString(start: string, end: string): IPv4Range {
        const sLong: number | false = IPv4.ip2long(start)
        const eLong: number | false = IPv4.ip2long(end)
        if (typeof sLong !== 'number' || typeof eLong !== 'number') throw new Error('Invalid start or end IPv4 address')
        if (eLong < sLong) throw new Error('Invalid range value, end must be greater than or equal to start')
        return new IPv4Range(sLong, eLong)
    }

    /**
     * Get the first and last addresses of the range as integers.
     * @returns The pair `[start, end]` (`[3232235777, 3232235876]`).
     */
    ip2long(): number[] {
        return [this.#start, this.#end]
    }

    /**
     * Get the first and last addresses of the range in dotted decimal notation.
     * @returns The pair `[start, end]` (`['192.168.1.1', '192.168.1.100']`).
     */
    long2ip(): string[] {
        return [
            IPv4.long2ip(this.#start) as string,
            IPv4.long2ip(this.#end) as string
        ]
    }

    /**
     * Count the addresses of the range, both ends included (`100` from `192.168.1.1` to `192.168.1.100`).
     * @returns The number of addresses.
     */
    ipCount(): number {
        return this.#end - this.#start + 1
    }

    /**
     * Tell whether an address is in the range, both ends included.
     * @param ip The address, in dotted decimal notation.
     * @returns `true` when the address is in the range, `false` otherwise or when `ip` is not a valid IPv4 address.
     */
    contains(ip: string): boolean {
        const long: number | false = IPv4.ip2long(ip)
        if (typeof long !== 'number') return false
        return long >= this.#start && long <= this.#end
    }
}

/**
 * The IP address toolkit for both versions: validate, convert and compare IPv4 and IPv6 addresses and CIDR blocks.
 * Its static methods try an input as IPv4 first, then as IPv6; {@link IPv4} and {@link IPv6} handle one version, with
 * the methods specific to it (the subnet masks, the private ranges, the expanded and compressed forms). The class is
 * not instantiated. The invalid inputs give `false` rather than throwing.
 * @example
 * ```typescript
 * import {IP} from 'lakutata/utils'
 *
 * //An allowlist of networks, of both versions
 * const allowed: string[] = ['10.0.0.0/8', '2001:db8::/32']
 * const remote: string = '2001:db8::17'
 * console.log(IP.isValidIP(remote), allowed.some((cidr: string): boolean => IP.contains(cidr, remote)))
 * //true true
 * console.log(IP.ip2long('192.168.0.1'), IP.long2ip(1n), IP.isConflict(['10.0.0.0/8', '10.1.0.0/16']))
 * //3232235521 ::1 true
 * ```
 */
export class IP {
    /**
     * Tell whether an address is in a CIDR block, the network and broadcast addresses included. An IPv4-mapped IPv6
     * address is in the IPv4 blocks of its IPv4 address (`'::ffff:192.168.1.5'` is in `'192.168.1.0/24'`, as a dual-stack
     * server sees an IPv4 client); an IPv4 address is not in an IPv6 block.
     * @param cidr The CIDR block, IPv4 (`'192.168.1.0/24'`) or IPv6 (`'2001:db8::/64'`); see {@link IPv4.isCIDR} and
     * {@link IPv6.isCIDR}.
     * @param ip The address, IPv4 or IPv6.
     * @returns `true` when the address is in the block, `false` otherwise or when either is invalid or not a string.
     */
    public static contains(cidr: string, ip: string): boolean {
        if (typeof cidr !== 'string' || typeof ip !== 'string') return false
        if (IPv4.contains(cidr, ip) || IPv6.contains(cidr, ip)) return true
        //An IPv4-mapped IPv6 address (::ffff:0:0/96) against an IPv4 block
        if (!IPv4.isCIDR(cidr)) return false
        const long: bigint | false = IPv6.ip2long(ip)
        if (long === false || long >> 32n !== 0xffffn) return false
        return IPv4.contains(cidr, IPv4.long2ip(Number(long & 0xffffffffn)) as string)
    }

    /**
     * Convert an address into its integer form: a number for IPv4 (`'192.168.0.1'` gives `3232235521`), a bigint for
     * IPv6 (`'::ffff:9999'` gives `4294941081n`).
     * @param ip The address, IPv4 or IPv6.
     * @returns The integer form (`'0.0.0.0'` gives `0`), or `false` when the address is invalid.
     */
    public static ip2long(ip: string): number | bigint | false {
        if (!this.isValidIP(ip)) return false
        const long: number | false = IPv4.ip2long(ip)
        return long === false ? IPv6.ip2long(ip) : long
    }

    /**
     * Tell whether a string is a valid CIDR block, IPv4 (a prefix length from `0` to `32`) or IPv6 (from `0` to `128`);
     * see {@link IPv4.isCIDR} and {@link IPv6.isCIDR}.
     * @param cidr The string to test (`'192.168.1.0/24'`, `'2001:db8::/32'`).
     * @returns `true` when it is a valid CIDR block, `false` otherwise or when it is not a string.
     */
    public static isCIDR(cidr: string): boolean {
        if (typeof cidr !== 'string') return false
        return IPv4.isCIDR(cidr) || IPv6.isCIDR(cidr)
    }

    /**
     * Tell whether two CIDR blocks of the same version in a list overlap. The blocks of different versions never
     * conflict, and the invalid entries are ignored.
     * @param cidrs The CIDR blocks, of either version (`['192.168.1.0/24', '192.168.1.0/28', '2001:db8::/122']`).
     * @returns `true` when two blocks overlap, `false` otherwise or when the list is empty or not an array.
     */
    public static isConflict(cidrs: string[]): boolean {
        if (!Array.isArray(cidrs) || cidrs.length === 0) return false
        return IPv4.isConflict(cidrs) || IPv6.isConflict(cidrs)
    }

    /**
     * Tell whether a string is a valid IPv4 or IPv6 address; see {@link IPv4.isValidIP} and {@link IPv6.isValidIP}.
     * @param ip The string to test (`'192.168.1.99'`, `'f16c:f7ec:cfa2:e1c5:9a3c:cb08:801f:36b8'`).
     * @returns `true` when it is a valid address of either version, `false` otherwise or when it is not a string.
     */
    public static isValidIP(ip: string): boolean {
        if (typeof ip !== 'string') return false
        return IPv4.isValidIP(ip) || IPv6.isValidIP(ip)
    }

    /**
     * Convert the integer form of an address into its text: a number gives an IPv4 address in dotted decimal notation
     * (`3232235521` gives `'192.168.0.1'`), a bigint an IPv6 address in compressed form (`1n` gives `'::1'`).
     * @param ip The integer form: a number from `0` to `4294967295` (its fraction dropped), or a bigint from `0n` to
     * `2n ** 128n - 1n`.
     * @returns The address, or `false` when the integer is out of range or neither a number nor a bigint.
     */
    public static long2ip(ip: number | bigint): string | false {
        if (typeof ip !== 'number' && typeof ip !== 'bigint') return false
        return IPv4.long2ip(ip as number) || IPv6.long2ip(ip as bigint)
    }
}

/**
 * The IPv4 toolkit: validate and convert the addresses (dotted decimal notation, integer, binary, hexadecimal,
 * IPv4-mapped IPv6), parse the CIDR blocks and the subnet masks, compare the addresses and subnets, and build address
 * ranges ({@link IPv4.ipRange}). The class is not instantiated. The invalid inputs give `false` rather than throwing.
 * @example
 * ```typescript
 * import {IPv4, type IPv4Subnet} from 'lakutata/utils'
 *
 * const subnet: IPv4Subnet | false = IPv4.parseCIDR('192.168.0.1/24')
 * if (subnet) console.log(subnet.networkAddress, subnet.broadcastAddress, subnet.usableCount)
 * //192.168.0.0 192.168.0.255 254
 * console.log(IPv4.isPrivate('10.1.2.3'), IPv4.isSameSubnet('192.168.1.10', '192.168.2.10', '255.255.0.0'))
 * //true true
 * console.log(IPv4.toSubnetMask(20), IPv4.toInverseMask(20))
 * //255.255.240.0 0.0.15.255
 * console.log(IPv4.ipRange.fromString('192.168.1.1', '192.168.1.100').ipCount())
 * //100
 * ```
 */
export class IPv4 {
    /**
     * Convert an IPv4 address into its integer form, an unsigned 32-bit integer (`'192.168.0.1'` gives `3232235521`).
     * The leading zeros of its numbers are read as decimal (`'192.168.01.1'` is `192.168.1.1`), not as octal.
     * @param ip The address, in dotted decimal notation.
     * @returns The integer, from `0` to `4294967295`, or `false` when the address is invalid (see {@link
     * IPv4.isValidIP}).
     */
    public static ip2long(ip: string): number | false {
        if (!this.isValidIP(ip)) return false

        let long: number = 0
        const parts: string[] = ip.split('.')
        for (const part of parts) long = (long << 8) + +part
        return long >>> 0
    }

    /**
     * Convert the integer form of an IPv4 address into dotted decimal notation (`3232235521` gives `'192.168.0.1'`).
     * @param ip The integer, from `0` to `4294967295`; its fraction is dropped.
     * @returns The address, or `false` when the integer is out of range, `NaN` or not a number.
     */
    public static long2ip(ip: number): string | false {
        if (typeof ip !== 'number' || isNaN(ip)) return false
        if (ip >= 0 && ip <= 4294967295) {
            const parts: number[] = []
            for (let i: number = 3; i >= 0; i--) parts.push((ip >>> (i * 8)) & 255)
            return parts.join('.')
        } else {
            return false
        }
    }

    /**
     * The class of the IPv4 address ranges: create a range with `IPv4.ipRange.fromString(start, end)` or
     * `IPv4.ipRange.fromLong(start, end)`, then count its addresses or test whether it contains one.
     */
    public static ipRange: typeof IPv4Range = IPv4Range

    /**
     * Tell whether a string is a valid IPv4 CIDR block: a valid address (see {@link IPv4.isValidIP}), `/` and a prefix
     * length from `0` to `32` (`'192.168.1.0/24'`). The address need not be the network address (`'192.168.1.7/24'` is
     * valid). The prefix length is decimal digits only: `'/8.5'`, `'/ 8'`, `'/0x8'` and a second `/` (`'/24/3'`) are
     * invalid.
     * @param cidr The string to test.
     * @returns `true` when it is a valid CIDR block, `false` otherwise or when it is not a string.
     */
    public static isCIDR(cidr: string): boolean {
        if (typeof cidr !== 'string') return false

        const subnet: IPv4Subnet | false = this.parseCIDR(cidr)
        return typeof subnet === 'object' ? true : false
    }

    /**
     * Tell whether two IPv4 addresses are the same, each given in dotted decimal notation or as its integer form
     * (`'192.168.0.1'` equals `3232235521`, and `'192.168.01.10'` equals `'192.168.1.010'`).
     * @param ip1 The first address: a string, or an integer from `0` to `4294967295`.
     * @param ip2 The second address: a string, or an integer from `0` to `4294967295`.
     * @returns `true` when both are valid and equal, `false` otherwise.
     */
    public static isEqual(ip1: string | number, ip2: string | number): boolean {
        if (typeof ip1 === 'number' && (ip1 < 0 || ip1 > 4294967295)) return false
        if (typeof ip2 === 'number' && (ip2 < 0 || ip2 > 4294967295)) return false
        if (typeof ip1 === 'string') ip1 = this.ip2long(ip1) as number
        if (typeof ip2 === 'string') ip2 = this.ip2long(ip2) as number
        if (typeof ip1 !== 'number' || typeof ip2 !== 'number') return false
        return ip1 === ip2
    }

    /**
     * Tell whether an IPv4 address is in a CIDR block, its network and broadcast addresses included
     * (`'192.168.1.5'` is in `'192.168.1.0/24'`).
     * @param cidr The CIDR block (see {@link IPv4.isCIDR}).
     * @param ip The address, in dotted decimal notation.
     * @returns `true` when the address is in the block, `false` otherwise or when either is invalid.
     */
    public static contains(cidr: string, ip: string): boolean {
        const subnet: IPv4Subnet | false = this.parseCIDR(cidr)
        if (typeof subnet !== 'object' || !this.isValidIP(ip)) return false

        const {cidrMask, firstHost, lastHost, networkAddress, broadcastAddress} = subnet
        if (cidrMask >= 31) {
            return this.ipRange.fromString(firstHost, lastHost).contains(ip)
        } else {
            return this.ipRange.fromString(networkAddress, broadcastAddress).contains(ip)
        }
    }

    /**
     * Tell whether an IPv4 address is in a range not routed on the internet: the private networks of RFC 1918
     * (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), the loopback (`127.0.0.0/8`) and the link-local addresses
     * (`169.254.0.0/16`). The shared address space of the carrier-grade NAT (`100.64.0.0/10`) and `0.0.0.0/8` are not
     * included.
     * @param ip The address, in dotted decimal notation.
     * @returns `true` when the address is in one of these ranges, `false` otherwise or when it is invalid.
     */
    public static isPrivate(ip: string): boolean {
        if (!this.isValidIP(ip)) return false

        const privateRanges: { start: string, end: string }[] = [
            {start: '10.0.0.0', end: '10.255.255.255'},
            {start: '127.0.0.0', end: '127.255.255.255'},
            {start: '172.16.0.0', end: '172.31.255.255'},
            {start: '169.254.0.0', end: '169.254.255.255'},
            {start: '192.168.0.0', end: '192.168.255.255'}
        ]

        for (const range of privateRanges) {
            if (this.ipRange.fromString(range.start, range.end).contains(ip)) {
                return true
            }
        }
        return false
    }

    /**
     * Tell whether a string is a valid IPv4 address in dotted decimal notation: four numbers from `0` to `255` of 1 to
     * 3 digits, separated by dots, without spaces. By default the leading zeros are allowed (`'192.168.01.99'`).
     * @param ip The string to test; a value which is not a string gives `false`.
     * @param options `strict: true` rejects the leading zeros (`'192.168.01.99'`), and also a first number `0`
     * (`'0.0.0.0'`); `false` by default.
     * @returns `true` when the address is valid, `false` otherwise.
     */
    public static isValidIP(ip: string, options: { strict?: boolean } = {strict: false}): boolean {
        if (options.strict) {
            const IPV4_REGEX: RegExp = /^(1\d{2}|2[0-4]\d|25[0-5]|[1-9]\d|[1-9])(\.(1\d{2}|2[0-4]\d|25[0-5]|[1-9]\d|\d)){3}$/
            return IPV4_REGEX.test(ip)
        } else {
            const IPV4_REGEX: RegExp = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
            return IPV4_REGEX.test(ip)
        }
    }

    /**
     * Describe the subnet of an IPv4 CIDR block: its addresses and counts (see {@link IPv4Subnet}). The address of the
     * block may be any address of the subnet (`'192.168.0.1/24'` describes `192.168.0.0/24`). A `/31` or a `/32` has no
     * network nor broadcast address: they are `''`, and all of its addresses are hosts.
     * @param cidr The CIDR block (see {@link IPv4.isCIDR}), such as `'192.168.0.1/24'`.
     * @returns The subnet (for `'192.168.0.1/24'`: `ipCount` `256`, `usableCount` `254`, `subnetMask`
     * `'255.255.255.0'`, `firstHost` `'192.168.0.1'`, `lastHost` `'192.168.0.254'`, `networkAddress` `'192.168.0.0'`,
     * `broadcastAddress` `'192.168.0.255'`), or `false` when the block is invalid (see {@link IPv4.isCIDR}) or not a
     * string.
     */
    public static parseCIDR(cidr: string): IPv4Subnet | false {
        if (typeof cidr !== 'string') return false

        const split: { ip: string, length: number } | false = SplitCIDR(cidr, 32)
        if (split === false || !this.isValidIP(split.ip)) return false
        const ip: string = split.ip
        const mask: number = split.length

        const length: number = 32 - mask
        const longIP: number = this.ip2long(ip) as number
        const ipCount: number = Number(0b1n << BigInt(length))
        const networkIP: number = mask ? ((longIP >> length) << length) >>> 0 : 0
        const broadcastIP: number = (networkIP | ipCount - 1) >>> 0

        const cidrInfo: IPv4Subnet = {
            ipCount,
            cidrMask: mask,
            usableCount: mask < 31 ? ipCount - 2 : ipCount,
            subnetMask: this.toSubnetMask(mask) as string,
            networkAddress: mask < 31 ? this.long2ip(networkIP) as string : '',
            broadcastAddress: mask < 31 ? this.long2ip(broadcastIP) as string : '',
            firstHost: this.long2ip(networkIP + (mask < 31 ? 1 : 0)) as string,
            lastHost: this.long2ip(broadcastIP - (mask < 31 ? 1 : 0)) as string
        }

        return cidrInfo
    }

    /**
     * Tell whether two IPv4 CIDR blocks in a list overlap (`['192.168.1.0/24', '192.168.0.0/16']` do). The invalid
     * entries, IPv6 blocks included, are ignored.
     * @param cidrs The CIDR blocks.
     * @returns `true` when two blocks overlap, `false` otherwise or when the list is empty or not an array.
     */
    public static isConflict(cidrs: string[]): boolean {
        if (!Array.isArray(cidrs) || cidrs.length === 0) return false

        const _cidrs: any[] = []
        for (const cidr of cidrs) {
            const subnet: IPv4Subnet | false = this.parseCIDR(cidr)
            if (typeof subnet === 'object') _cidrs.push({
                cidr,
                networkAddress: subnet.networkAddress || subnet.firstHost
            })
        }

        for (let i: number = 0; i < _cidrs.length; i++) {
            for (let j: number = i + 1; j < _cidrs.length; j++) {
                const R1: boolean = this.contains(_cidrs[j].cidr, _cidrs[i].networkAddress)
                const R2: boolean = this.contains(_cidrs[i].cidr, _cidrs[j].networkAddress)
                if (R1 || R2) return true
            }
        }
        return false
    }

    /**
     * Describe the subnet of an IPv4 address and a subnet mask, as {@link IPv4.parseCIDR} does for a CIDR block
     * (`parseSubnet('192.168.0.1', '255.255.255.0')` equals `parseCIDR('192.168.0.1/24')`).
     * @param ip The address, in dotted decimal notation.
     * @param mask The subnet mask: in dotted decimal notation with contiguous ones (`'255.255.255.0'`), or a prefix
     * length, an integer from `0` to `32` (`24`), as {@link IPv4.isValidMask} accepts.
     * @returns The subnet, or `false` when the address or the mask is invalid.
     */
    public static parseSubnet(ip: string, mask: string | number): IPv4Subnet | false {
        if (!this.isValidIP(ip) || !this.isValidMask(mask)) return false

        const length: number | false = typeof mask === 'number' ? mask : this.toMaskLength(mask)
        const cidrInfo: IPv4Subnet | false = this.parseCIDR(`${ip}/${length}`)
        return cidrInfo
    }

    /**
     * Tell whether a value is a valid IPv4 subnet mask: a prefix length from `0` to `32`, or a mask in dotted decimal
     * notation whose bits are ones then zeros (`'255.255.255.0'`, but not `'255.0.255.0'`).
     * @param mask The mask: a number of bits, an integer, or a string.
     * @returns `true` when the mask is valid, `false` otherwise (`NaN` and a fraction, `24.5`, included).
     */
    public static isValidMask(mask: string | number): boolean {
        if (typeof mask === 'number') {
            return Number.isInteger(mask) && mask >= 0 && mask <= 32
        } else if (typeof mask === 'string') {
            const longMask: number | false = this.ip2long(mask)
            if (typeof longMask !== 'number') return false
            return /^1*0*$/.test(longMask.toString(2).padStart(32, '0'))
        } else {
            return false
        }
    }

    /**
     * Tell whether two IPv4 addresses are in the same subnet: whether their bits under a mask are equal
     * (`'192.168.1.10'` and `'192.168.1.100'` are under `24` and `'255.255.255.0'`, not under `32`).
     * @param ip1 The first address, in dotted decimal notation.
     * @param ip2 The second address, in dotted decimal notation.
     * @param mask The subnet mask: a prefix length, an integer from `0` to `32`, or a mask in dotted decimal notation.
     * @returns `true` when the addresses are in the same subnet, `false` otherwise or when an address or the mask is
     * invalid.
     */
    public static isSameSubnet(ip1: string, ip2: string, mask: string | number) {
        if (!this.isValidIP(ip1) || !this.isValidIP(ip2) || !this.isValidMask(mask)) return false

        const ip1Long: number = this.ip2long(ip1) as number
        const ip2Long: number = this.ip2long(ip2) as number
        if (typeof mask === 'number') mask = this.toSubnetMask(mask) as string
        const maskLong: number = this.ip2long(mask) as number
        return (ip1Long & maskLong) === (ip2Long & maskLong)
    }

    /**
     * Convert an IPv4 address into its numeric forms (`'192.168.0.1'` gives the hexadecimal `'0xc0a80001'`, the decimal
     * `3232235521` and the binary `'11000000101010000000000000000001'`).
     * @param ip The address, in dotted decimal notation.
     * @returns The numeric forms, or `false` when the address is invalid.
     */
    public static toBinHex(ip: string): IPBinHex | false {
        if (!this.isValidIP(ip)) return false
        const longIP: number = this.ip2long(ip) as number
        return {
            decimal: longIP,
            hex: `0x${longIP.toString(16).padStart(8, '0')}`,
            binary: longIP.toString(2).padStart(32, '0')
        }

    }

    /**
     * Convert an IPv4 address into the forms of its IPv4-mapped IPv6 address (`'192.168.1.1'` gives `mapped`
     * `'::ffff:192.168.1.1'`, `compressed` `'::ffff:c0a8:101'` and `expanded`
     * `'0000:0000:0000:0000:0000:ffff:c0a8:0101'`). The leading zeros of the address are dropped.
     * @param ip The address, in dotted decimal notation (the leading zeros are accepted).
     * @returns The IPv6 forms, or `false` when the address is invalid.
     */
    public static toIPv6Format(ip: string): IPv6Result | false {
        if (!this.isValidIP(ip)) return false
        const longIP: number = this.ip2long(ip) as number
        const ipv4: string = this.long2ip(longIP) as string
        return {
            mapped: `::ffff:${ipv4}`,
            compressed: IPv6.compressedForm(`::ffff:${ipv4}`) as string,
            expanded: IPv6.expandedForm(`::ffff:${ipv4}`) as string
        }
    }

    /**
     * Convert a prefix length into its subnet mask in dotted decimal notation (`0` gives `'0.0.0.0'`, `24` gives
     * `'255.255.255.0'`, `32` gives `'255.255.255.255'`).
     * @param length The prefix length, an integer from `0` to `32`.
     * @returns The subnet mask, or `false` when the length is out of range, a fraction, `NaN` or not a number.
     */
    public static toSubnetMask(length: number): string | false {
        if (typeof length !== 'number' || isNaN(length) || !this.isValidMask(length)) return false
        const mask: number = 0xffffffff << 32 - length
        return length ? this.long2ip(mask >>> 0) : '0.0.0.0'
    }

    /**
     * Convert a subnet mask in dotted decimal notation into its prefix length (`'255.255.255.0'` gives `24`,
     * `'0.0.0.0'` gives `0`).
     * @param mask The subnet mask, its bits ones then zeros.
     * @returns The prefix length, from `0` to `32`, or `false` when the mask is invalid (`'255.0.255.0'`) or not a
     * string.
     */
    public static toMaskLength(mask: string): number | false {
        if (typeof mask !== 'string') return false
        if (!this.isValidMask(mask)) return false
        const longMask: number | false = this.ip2long(mask)
        const length: number = longMask === 0 ? 0 : longMask.toString(2).replaceAll('0', '').length
        return length
    }

    /**
     * Compute the inverse mask (the wildcard mask of the access lists) of a subnet mask: its bits flipped (`24` and
     * `'255.255.255.0'` give `'0.0.0.255'`, `0` gives `'255.255.255.255'`).
     * @param mask The subnet mask: a prefix length, an integer from `0` to `32`, or a mask in dotted decimal notation.
     * @returns The inverse mask in dotted decimal notation, or `false` when the mask is invalid.
     */
    public static toInverseMask(mask: string | number): string | false {
        if (!this.isValidMask(mask)) return false

        if (typeof mask === 'number') mask = this.toSubnetMask(mask) as string
        const longMask: number = this.ip2long(mask) as number
        const notMask: number = ~longMask >>> 0
        return this.long2ip(notMask)
    }
}

/**
 * The IPv6 toolkit: validate the addresses, convert them between their expanded, compressed and integer (bigint) forms,
 * parse the CIDR blocks, and compare the addresses and blocks. The class is not instantiated. The invalid inputs give
 * `false` rather than throwing.
 * @example
 * ```typescript
 * import {IPv6, type IPv6Subnet} from 'lakutata/utils'
 *
 * console.log(IPv6.compressedForm('2001:0db8:0000:0000:0000:0000:0000:0001'), IPv6.expandedForm('::1'))
 * //2001:db8::1 0000:0000:0000:0000:0000:0000:0000:0001
 * const block: IPv6Subnet | false = IPv6.parseCIDR('2001:db8::1/64')
 * if (block) console.log(block.firstHost, block.lastHost, block.ipCount)
 * //2001:db8:: 2001:db8::ffff:ffff:ffff:ffff 18446744073709551616n
 * console.log(IPv6.contains('2001:db8::/64', '2001:db8::11'), IPv6.isEqual('::ffff', 65535n))
 * //true true
 * ```
 */
export class IPv6 {
    /**
     * Compress an IPv6 address: the leading zeros of each group dropped, the longest run of two or more zero groups
     * (the first one on a tie) replaced with `::`, the hexadecimal digits in lower case, as RFC 5952 recommends
     * (`'2001:0DB8:0000:0000:0000:0000:0000:0001'` gives `'2001:db8::1'`). An embedded IPv4 address is converted into
     * two groups (`'::ffff:192.168.1.1'` gives `'::ffff:c0a8:101'`). The spaces around the address are trimmed, and a
     * zone index is kept after it, as given (`'FE80::0001%eth0'` gives `'fe80::1%eth0'`).
     * @param ip The address, in any valid form (see {@link IPv6.isValidIP}).
     * @returns The compressed form, or `false` when the address is invalid.
     */
    public static compressedForm(ip: string): string | false {
        if (!this.isValidIP(ip)) return false
        const {address, zone} = IPv6.#splitZone(ip)
        if (this.ip2long(address) === 0n) return `::${zone}`

        const sections: string[] = (this.expandedForm(address) as string).split(':')
        const compress = sections.map((section: string) => {
            const _section: number = parseInt(section, 16)
            return _section ? _section.toString(16) : 'X'
        }).join(':')

        const regExp: RegExp[] = [/(X:X:X:X:X:X:X)/, /(X:X:X:X:X:X)/, /(X:X:X:X:X)/, /(X:X:X:X)/, /(X:X:X)/, /(X:X)/]
        for (let i: number = 0; i < regExp.length; i++) {
            if (compress.match(regExp[i])) return compress.replace(regExp[i], ':').replace(':::', '::').replaceAll('X', '0') + zone
        }

        return compress.replaceAll('X', '0') + zone
    }

    /**
     * The address trimmed, apart from its zone index (with its %, '' without one)
     * @param ip
     * @private
     */
    static #splitZone(ip: string): { address: string, zone: string } {
        const trimmed: string = ip.trim()
        const index: number = trimmed.indexOf('%')
        return index === -1 ? {address: trimmed, zone: ''} : {address: trimmed.slice(0, index), zone: trimmed.slice(index)}
    }

    /**
     * Tell whether an IPv6 address is in a CIDR block (`'2001:db8::11'` is in `'2001:db8::1/64'`, not in
     * `'2001:db8::1/128'`).
     * @param cidr The CIDR block (see {@link IPv6.isCIDR}).
     * @param ip The address; an IPv4 address gives `false`.
     * @returns `true` when the address is in the block, `false` otherwise or when either is invalid.
     */
    public static contains(cidr: string, ip: string): boolean {
        const subnet: IPv6Subnet | false = this.parseCIDR(cidr)
        if (typeof subnet !== 'object' || !this.isValidIP(ip)) return false

        const {lastHost, firstHost} = subnet
        const ipLong: bigint | false = this.ip2long(ip)
        const lastHostLong: bigint | false = this.ip2long(lastHost)
        const firstHostLong: bigint | false = this.ip2long(firstHost)
        return ipLong >= firstHostLong && ipLong <= lastHostLong
    }

    /**
     * Expand an IPv6 address into its full form, 8 groups of 4 hexadecimal digits (`'2001:db8::1'` gives
     * `'2001:0db8:0000:0000:0000:0000:0000:0001'`). The case of the digits is kept, and an embedded IPv4 address is
     * converted into two groups (`'::ffff:192.168.1.1'` gives `'0000:0000:0000:0000:0000:ffff:c0a8:0101'`). The spaces
     * around the address are trimmed, and a zone index is kept after it (`'fe80::1%eth0'` gives
     * `'fe80:0000:0000:0000:0000:0000:0000:0001%eth0'`).
     * @param ip The address, in any valid form (see {@link IPv6.isValidIP}).
     * @returns The expanded form, or `false` when the address is invalid.
     */
    public static expandedForm(ip: string): string | false {
        if (!this.isValidIP(ip)) return false
        const {address, zone} = IPv6.#splitZone(ip)
        if (address === '::') return '0000:'.repeat(8).slice(0, -1) + zone
        const sections: string[] = address.split(':')
        for (let i: number = 0; i < sections.length; i++) {
            if (sections[i] === '' && sections[i + 1] === '') sections.splice(i, 1)
        }
        const last: string = sections[sections.length - 1]
        if (IPv4.isValidIP(last)) {
            const hex: string = (IPv4.toBinHex(last) as IPBinHex).hex.slice(2)
            sections.pop() && sections.push(hex.slice(0, 4), hex.slice(4))
        }
        return sections.map((section: string): string => {
            return section ? section.padStart(4, '0') : '0000:'.repeat(9 - sections.length).slice(0, -1)
        }).join(':') + zone
    }

    /**
     * Convert an IPv6 address into its integer form, a 128-bit unsigned bigint (`'::1'` gives `1n`, `'::ffff:9999'`
     * gives `4294941081n`). A zone index is ignored.
     * @param ip The address, in any valid form (see {@link IPv6.isValidIP}).
     * @returns The integer, from `0n` to `2n ** 128n - 1n`, or `false` when the address is invalid (an IPv4 address
     * included).
     */
    public static ip2long(ip: string): bigint | false {
        if (!this.isValidIP(ip)) return false

        const binary: string[] = []
        ip = this.expandedForm(IPv6.#splitZone(ip).address) as string
        const parts: string[] = ip.split(':')
        for (let i: number = 0; i < parts.length; i++) {
            const dec: number = parseInt(parts[i], 16)
            binary.push(dec.toString(2).padStart(16, '0'))
        }
        return BigInt(`0b${binary.join('')}`)
    }

    /**
     * Tell whether a string is a valid IPv6 CIDR block: a valid address (see {@link IPv6.isValidIP}), `/` and a prefix
     * length from `0` to `128` (`'2001:db8::/32'`, `'::9999:ffff/128'`). The address need not be the first of the
     * block. The prefix length is decimal digits only: `'/64.5'`, `'/ 64'`, `'/0x40'` and a second `/` are invalid.
     * @param cidr The string to test.
     * @returns `true` when it is a valid CIDR block, `false` otherwise or when it is not a string.
     */
    public static isCIDR(cidr: string): boolean {
        if (typeof cidr !== 'string') return false

        const subnet: IPv6Subnet | false = this.parseCIDR(cidr)
        return typeof subnet === 'object' ? true : false
    }

    /**
     * Tell whether two IPv6 CIDR blocks in a list overlap (`['2001:db8::1/120', '2001:db8::1/122']` do). The invalid
     * entries, IPv4 blocks included, are ignored.
     * @param cidrs The CIDR blocks.
     * @returns `true` when two blocks overlap, `false` otherwise or when the list is empty or not an array.
     */
    public static isConflict(cidrs: string[]): boolean {
        if (!Array.isArray(cidrs) || cidrs.length === 0) return false

        const _cidrs: any[] = []
        for (const cidr of cidrs) {
            const subnet: IPv6Subnet | false = this.parseCIDR(cidr)
            if (typeof subnet === 'object') _cidrs.push({cidr, firstHost: subnet.firstHost})
        }

        for (let i: number = 0; i < _cidrs.length; i++) {
            for (let j: number = i + 1; j < _cidrs.length; j++) {
                const R1: boolean = this.contains(_cidrs[j].cidr, _cidrs[i].firstHost)
                const R2: boolean = this.contains(_cidrs[i].cidr, _cidrs[j].firstHost)
                if (R1 || R2) return true
            }
        }
        return false
    }

    /**
     * Tell whether two IPv6 addresses are the same, each given in any valid form or as its integer form (`'::ffff'`,
     * `'0:0:0:0:0:0:0:ffff'` and `65535n` are equal).
     * @param ip1 The first address: a string, or a bigint from `0n` to `2n ** 128n - 1n`.
     * @param ip2 The second address: a string, or a bigint from `0n` to `2n ** 128n - 1n`.
     * @returns `true` when both are valid and equal, `false` otherwise (a `number` is never equal: `isEqual(65535n,
     * 65535)` gives `false`).
     */

    public static isEqual(ip1: string | bigint, ip2: string | bigint): boolean {
        if (typeof ip1 === 'bigint' && (ip1 < 0n || ip1 > 340282366920938463463374607431768211455n)) return false
        if (typeof ip2 === 'bigint' && (ip2 < 0 || ip2 > 340282366920938463463374607431768211455n)) return false
        if (typeof ip1 === 'string') ip1 = this.ip2long(ip1) as bigint
        if (typeof ip2 === 'string') ip2 = this.ip2long(ip2) as bigint
        if (typeof ip1 !== 'bigint' || typeof ip2 !== 'bigint') return false
        return ip1 === ip2
    }

    /**
     * Tell whether a string is a valid IPv6 address: 8 groups of 1 to 4 hexadecimal digits separated by `:`, a run of
     * zero groups possibly shortened to `::`, the last 32 bits possibly written as an IPv4 address
     * (`'::ffff:1.2.3.4'`). A zone index (`'fe80::1%eth0'`) and spaces around the address are accepted. An IPv4 address
     * alone is not valid.
     * @param ip The string to test; a value which is not a string gives `false`.
     * @returns `true` when the address is valid, `false` otherwise.
     */
    public static isValidIP(ip: string): boolean {
        const IPV4_REGEX: RegExp = /^[\s]*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:)))(%.+)?[\s]*$/
        return IPV4_REGEX.test(ip)
    }

    /**
     * Convert the integer form of an IPv6 address into its compressed form (`1n` gives `'::1'`, `65535n` gives
     * `'::ffff'`).
     * @param ip The integer, a bigint from `0n` to `2n ** 128n - 1n`.
     * @returns The address, or `false` when the integer is out of range or not a bigint (a `number` gives `false`).
     */
    public static long2ip(ip: bigint): string | false {
        if (typeof ip !== 'bigint') return false
        if (ip >= 0n && ip <= 340282366920938463463374607431768211455n) {
            const sections: string[] = []
            const hex: string = ip.toString(16).padStart(32, '0')
            for (let i: number = 0; i < 8; i++) sections.push(hex.slice(i * 4, (i + 1) * 4))
            return this.compressedForm(sections.join(':')) as string
        } else {
            return false
        }
    }

    /**
     * Describe an IPv6 CIDR block: its first and last addresses, its size and its prefix length (see
     * {@link IPv6Subnet}). The address of the block may be any address in it (`'2001:db8::1/64'` describes
     * `2001:db8::/64`).
     * @param cidr The CIDR block (see {@link IPv6.isCIDR}), such as `'::9999:ffff/118'`.
     * @returns The block (for `'::9999:ffff/118'`: `ipCount` `1024n`, `firstHost` `'::9999:fc00'`, `lastHost`
     * `'::9999:ffff'`, `prefixLength` `118`), or `false` when the block is invalid (see {@link IPv6.isCIDR}) or not a
     * string.
     */
    public static parseCIDR(cidr: string): IPv6Subnet | false {
        if (typeof cidr !== 'string') return false
        const split: { ip: string, length: number } | false = SplitCIDR(cidr, 128)
        if (split === false || !this.isValidIP(split.ip)) return false
        const ip: string = split.ip
        const prefixLength: number = split.length
        const length: bigint = BigInt(128 - prefixLength)
        const longIP: bigint = this.ip2long(ip) as bigint
        const ipCount: bigint = BigInt(0b1n << length)
        const networkIP: bigint = (longIP >> length) << length
        const firstHost: string = this.long2ip(networkIP) as string
        const lastHost: string = this.long2ip(networkIP | ipCount - 1n) as string
        const cidrInfo: IPv6Subnet = {
            ipCount,
            firstHost,
            lastHost,
            prefixLength
        }
        return cidrInfo
    }
}
