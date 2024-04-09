export interface IPBinHex {
    hex: string
    decimal: number
    binary: string
}

export interface IPv4SubNet {
    cidrMask: number;
    ipCount: number;
    usableCount: number;
    subnetMask: string;
    firstHost: string,
    lastHost: string,
    networkAddress: string;
    broadcastAddress: string;
}

export interface IPv6SubNet {
    ipCount: bigint
    lastHost: string
    firstHost: string
    prefixLength: number
}

export interface IPv6Result {
    mapped: string;
    expanded: string;
    comperssed: string;
}

class IPv4Range {

    readonly #start: number
    readonly #end: number

    constructor(start: number, end: number) {
        if (+start < 0 || +start > 4294967295 || +end < 0 || +end > 4294967295) {
            throw new Error('Invalid start or end IPv4 address')
        }
        this.#start = start
        this.#end = end
    }

    /**
     * Create ipRange instance from start and end IPv4 integers
     *
     * @param start - Start IPv4 integer
     * @param end - End IPv4 integer
     * @returns The created ipRange instance
     * @throws Error if start or end IPv4 is invalid
     *
     * @example
     * ```
     * const range = ipRange.fromLong(3232235777, 3232235876);
     * ```
     */
    static fromLong(start: number, end: number): IPv4Range {
        if (typeof start !== 'number' || typeof end !== 'number') throw new Error('Invalid start or end IPv4 address')
        if (+end < +start) throw new Error('Invalid range value, end must be greater than or equal to start')
        return new IPv4Range(start, end)
    }

    /**
     * Create ipRange instance from start and end IPv4 strings
     *
     * @param startIp - Start IPv4 string
     * @param endIp - End IPv4 string
     * @returns The created ipRange instance
     * @throws Error if start or end IPv4 is invalid
     *
     * @example
     * ```
     * const range = ipRange.fromString('192.168.1.1', '192.168.1.100');
     * ```
     */
    static fromString(start: string, end: string): IPv4Range {
        const sLong: number | false = IPv4.ip2long(start)
        const eLong: number | false = IPv4.ip2long(end)
        if (typeof sLong !== 'number' || typeof eLong !== 'number') throw new Error('Invalid start or end IPv4 address')
        if (eLong < sLong) throw new Error('Invalid range value, end must be greater than or equal to start')
        return new IPv4Range(sLong, eLong)
    }

    /**
     * Get start and end IPv4 integers of current range
     *
     * @returns Array of start and end IPv4 integers
     *
     * @example
     * ```
     * const range = ipRange.fromString('192.168.1.1', '192.168.1.100');
     * range.ip2long(); // [3232235777, 3232235876]
     * ```
     */
    ip2long(): number[] {
        return [this.#start, this.#end]
    }

    /**
     * Get start and end IPv4 strings of current range
     *
     * @returns Array of start and end IPv4 strings
     *
     * @example
     * ```
     * const range = ipRange.fromLong(3232235777, 3232235876);
     * range.long2ip(); // ['192.168.1.1', '192.168.1.100']
     * ```
     */
    long2ip(): string[] {
        return [
            IPv4.long2ip(this.#start) as string,
            IPv4.long2ip(this.#end) as string
        ]
    }

    /**
     * Get the number of IPs in current range
     *
     * @returns Number of IPv4 addresses
     *
     * @example
     * ```
     * const range = ipRange.fromString('192.168.1.1', '192.168.1.100');
     * range.ipCount(); // 100
     * ```
     */
    ipCount(): number {
        return this.#end - this.#start + 1
    }

    /**
     * Verify if the IPv4 address is within the current range
     *
     * @param ip - A standard IPv4 address string
     * @returns True if within range, otherwise false
     *
     * @example
     * ```
     * const range = ipRange.fromString('192.168.1.1', '192.168.1.100');
     * range.contains('192.168.1.99'); // true
     * range.contains('192.168.0.11'); // false
     * ```
     */
    contains(ip: string): boolean {
        const long: number | false = IPv4.ip2long(ip)
        if (typeof long !== 'number') return false
        return long >= this.#start && long <= this.#end
    }
}

export class IP {
    /**
     * Verify if the IPv4 or IPv6 address is within the CIDR range
     *
     * @param cidr - A standard format IPv4 or IPv6 CIDR address
     * @param ip - The IPv4 or IPv6 address to check
     * @returns True if within range, otherwise false
     *
     * @example
     * ```
     * contains('192.168.1.0/24', '192.168.1.5')    // true
     * contains('192.168.1.0/24', '192.168.2.5')    // false
     * contains('2001:db8::1/64', '2001:db8::11')    // true
     * contains('2001:db8::1/128', '2001:db8::11')    // false
     * ```
     */
    public static contains(cidr: string, ip: string): boolean {
        if (typeof cidr !== 'string' || typeof ip !== 'string') return false
        return IPv4.contains(cidr, ip) || IPv6.contains(cidr, ip)
    }

    /**
     * Convert IPv4 or IPv6 address string to number
     *
     * @param ip - The IPv4 or IPv6 address string
     * @returns The converted IPv4 or IPv6 number or false if invalid
     *
     * @example
     * ```
     * ip2long('192.168.0.1')   // 3232235521
     * ip2long('::ffff:9999')   // 4294941081
     * ```
     */
    public static ip2long(ip: string): number | bigint | false {
        if (!this.isValidIP(ip)) return false
        return IPv4.ip2long(ip) || IPv6.ip2long(ip)
    }

    /**
     * Verify if the CIDR address is valid
     *
     * @param cidr - The CIDR address string
     * @returns True if valid, false otherwise
     *
     * @example
     * ```
     * isCIDR('192.168.1.0/24')  // true
     * isCIDR('192.168.1.0/34')  // false
     * isCIDR('287.168.1.0/34')  // false
     * ```
     */
    public static isCIDR(cidr: string): boolean {
        if (typeof cidr !== 'string') return false
        return IPv4.isCIDR(cidr) || IPv6.isCIDR(cidr)
    }

    /**
     * Check for conflicts in a set of CIDR
     *
     * @param cidrs - Array of CIDR format address string
     * @returns True if conflict found, false otherwise
     *
     * @example
     * ```
     * isConflict(['192.168.1.0/24', '192.168.0.0/24'])  // false
     * isConflict(['192.168.1.0/24', '2001:db8::1/122'])  // false
     * isConflict(['2001:db8::1/120', '2001:db8::1/122'])  // true
     * isConflict(['192.168.1.0/24', '192.168.1.0/28', '2001:db8::1/122'])  // true
     * ```
     */
    public static isConflict(cidrs: string[]): boolean {
        if (!Array.isArray(cidrs) || cidrs.length === 0) return false
        return IPv4.isConflict(cidrs) || IPv6.isConflict(cidrs)
    }

    /**
     * Verify if the IPv4 or IPv6 address is valid
     *
     * @param ip - The IPv4 or IPv6 address string
     * @returns True if valid, false otherwise
     *
     * @example
     * ```
     * isValidIP('192.168.1.99') // true
     * isValidIP('f16c:f7ec:cfa2:e1c5:9a3c:cb08:801f:36b8') // true
     * ```
     */
    public static isValidIP(ip: string): boolean {
        if (typeof ip !== 'string') return false
        return IPv4.isValidIP(ip) || IPv6.isValidIP(ip)
    }

    /**
     * Convert IPv4 or IPv6 number to address string
     *
     * @param ip - The IPv4 or IPv6 number
     * @returns The converted IPv4 or IPv6 address string or false if invalid
     *
     * @example
     * ```
     * ip2long('192.168.0.1')   // 3232235521
     * ip2long('::ffff:9999')   // 4294941081
     * ```
     */
    public static long2ip(ip: number | bigint): string | false {
        if (typeof ip !== 'number' && typeof ip !== 'bigint') return false
        return IPv4.long2ip(ip as number) || IPv6.long2ip(ip as bigint)
    }
}

export class IPv4 {
    /**
     * Convert IPv4 address string to number
     *
     * @param ip - The IPv4 address string
     * @returns The converted IPv4 number or false if invalid
     *
     * @example
     * ```
     * ip2long('192.168.0.1')   // 3232235521
     * ip2long('192.168.0.257') // false
     * ```
     */
    public static ip2long(ip: string): number | false {
        if (!this.isValidIP(ip)) return false

        let long: number = 0
        const parts: string[] = ip.split('.')
        for (const part of parts) long = (long << 8) + +part
        return long >>> 0
    }

    /**
     * Convert IPv4 number to address string
     *
     * @param ip - The IPv4 number
     * @returns The converted IPv4 address string or false if invalid
     *
     * @example
     * ```
     * long2ip(3232235521) // '192.168.0.1'
     * long2ip(-1) // false
     * ```
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
     * IPv4 address range class for representing a range defined by a start and end IPv4 address. Valid values are from 0 to 4294967295.
     */
    public static ipRange: typeof IPv4Range = IPv4Range

    /**
     * Verify if the CIDR address is valid
     *
     * @param cidr - The CIDR address string
     * @returns True if valid, false otherwise
     *
     * @example
     * ```
     * isCIDR('192.168.1.0/24')  // true
     * isCIDR('192.168.1.0/34')  // false
     * isCIDR('287.168.1.0/34')  // false
     * ```
     */
    public static isCIDR(cidr: string): boolean {
        if (typeof cidr !== 'string') return false

        const subnet: IPv4SubNet | false = this.parseCIDR(cidr)
        return typeof subnet === 'object' ? true : false
    }

    /**
     * Verify if two IPv4 address are equal
     * @param ip1 The first IPv4 address to compare
     * @param ip2 The second IPv4 address to compare
     * @returns True if equal, false otherwise
     *
     * @example
     * ```
     * isEqual(32322355, 3232235521)  // false
     * isEqual(3232235521, 3232235521)  // true
     * isEqual('192.168.0.1', 3232235521)  // true
     * isEqual('192.168.1.10', '192.168.1.10') // true
     * isEqual('192.168.01.10', '192.168.1.010') // true
     * isEqual('192.168.02.10', '192.168.1.010') // false
     * ```
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
     * Verify if the IP address is within the CIDR range
     *
     * @param cidr - A standard format CIDR address
     * @param ip - The IPv4 address to check
     * @returns True if within range, otherwise false
     *
     * @example
     * ```
     * contains('192.168.1.0/24', '192.168.1.5')    // true
     * contains('192.168.1.0/24', '192.168.2.5')    // false
     * ```
     */
    public static contains(cidr: string, ip: string): boolean {
        const subnet: IPv4SubNet | false = this.parseCIDR(cidr)
        if (typeof subnet !== 'object' || !this.isValidIP(ip)) return false

        const {cidrMask, firstHost, lastHost, networkAddress, broadcastAddress} = subnet
        if (cidrMask >= 31) {
            return this.ipRange.fromString(firstHost, lastHost).contains(ip)
        } else {
            return this.ipRange.fromString(networkAddress, broadcastAddress).contains(ip)
        }
    }

    /**
     * Verify if an IPv4 address is private
     * @param ip - The IPv4 address string
     * @returns True if private IPv4, false otherwise
     *
     * @example
     * ```
     * isPrivate('192.168.0.1') // returns true
     * isPrivate('114.114.114.114') // returns false
     * ```
     */
    public static isPrivate(ip: string): boolean {
        if (!this.isValidIP(ip)) return false

        const privateRanges: { start: string; end: string }[] = [
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
     * Verify if the IPv4 address is valid
     *
     * @param ip - The IPv4 address string
     * @param options - Enable strict mode to disallow leading 0s, false by default
     * @returns True if valid, false otherwise
     *
     * @example
     * ```
     * isValidIP('192.168.1.99') // true
     * isValidIP('192.168.01.99', {strict: true}) // false
     * ```
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
     * Parse CIDR format address into address range info
     *
     * NetworkAddress and broadcastAddress are valid when mask < 31
     *
     * @param cidr - The CIDR format address string
     * @returns The parsed address range object or false if invalid
     *
     * @example
     * ```
     * parseCIDR('192.168.0.1/33')    // false
     * parseCIDR('192.168.0.1/24')
     * // {
     * //   ipCount: 256,
     * //   usableCount: 254,
     * //   cidrMask: 24,
     * //   subnetMask: '255.255.255.0',
     * //   firstHost: '192.168.0.1',
     * //   lastHost: '192.168.0.254',
     * //   networkAddress: '192.168.0.0',
     * //   broadcastAddress: '192.168.0.255'
     * // }
     * ```
     */
    public static parseCIDR(cidr: string): IPv4SubNet | false {
        if (typeof cidr !== 'string') return false

        const [ip, mask] = cidr.split('/')
        if (ip === undefined || mask === undefined || mask === '') return false
        if (!this.isValidIP(ip) || !this.isValidMask(+mask)) return false

        const length: number = 32 - +mask
        const longIP: number = this.ip2long(ip) as number
        const ipCount: number = Number(0b1n << BigInt(length))
        const networkIP: number = +mask ? ((longIP >> length) << length) >>> 0 : 0
        const broadcastIP: number = (networkIP | ipCount - 1) >>> 0

        const cidrInfo: IPv4SubNet = {
            ipCount,
            cidrMask: +mask,
            usableCount: +mask < 31 ? ipCount - 2 : ipCount,
            subnetMask: this.toSubnetMask(+mask) as string,
            networkAddress: +mask < 31 ? this.long2ip(networkIP) as string : '',
            broadcastAddress: +mask < 31 ? this.long2ip(broadcastIP) as string : '',
            firstHost: this.long2ip(networkIP + (+mask < 31 ? 1 : 0)) as string,
            lastHost: this.long2ip(broadcastIP - (+mask < 31 ? 1 : 0)) as string
        }

        return cidrInfo
    }

    /**
     * Check for conflicts in a set of CIDR
     *
     * @param cidrs - Array of CIDR format address string
     * @returns True if conflict found, false otherwise
     *
     * @example
     * ```
     * isConflict(['192.168.1.0/24', '192.168.0.0/16'])  // true
     * isConflict(['192.168.1.0/24', '192.168.2.0/24'])  // false
     * isConflict(['192.168.1.0/24', '192.168.2.0/24', '192.168.3.0/16'])  // true
     * isConflict(['192.168.1.0/24', '192.168.2.0/24', '192.168.3.0/24'])  // false
     * ```
     */
    public static isConflict(cidrs: string[]): boolean {
        if (!Array.isArray(cidrs) || cidrs.length === 0) return false

        const _cidrs: any[] = []
        for (const cidr of cidrs) {
            const subnet: IPv4SubNet | false = this.parseCIDR(cidr)
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
     * Parse IPv4 address and subnet mask into CIDR info
     *
     * @param ip - The IPv4 address string
     * @param mask - The subnet mask string
     * @returns The parsed CIDR info object or false if invalid
     *
     * @example
     * ```
     * parseSubnet('192.168.0.1', '1.255.255.0')    // false
     * parseSubnet('192.168.0.1', '255.255.255.0')
     * // {
     * //   ipCount: 256,
     * //   usableCount: 254,
     * //   cidrMask: 24,
     * //   subnetMask: '255.255.255.0',
     * //   firstHost: '192.168.0.1',
     * //   lastHost: '192.168.0.254',
     * //   networkAddress: '192.168.0.0',
     * //   broadcastAddress: '192.168.0.255'
     * // }
     * ```
     */
    public static parseSubnet(ip: string, mask: string): IPv4SubNet | false {
        if (!this.isValidIP(ip) || !this.isValidMask(mask)) return false

        const length: number | false = this.toMaskLength(mask)
        const cidrInfo: IPv4SubNet | false = this.parseCIDR(`${ip}/${length}`)
        return cidrInfo
    }

    /**
     * Verify if the subnet mask is valid
     *
     * @param  mask - The subnet mask to valid
     * @returns True if valid, otherwise false
     *
     * @example
     * ```
     * isValidMask(24) // true
     * isValidMask('255.255.255.0') // true
     * isValidMask('255.255.256.0') // false
     * ```
     */
    public static isValidMask(mask: string | number): boolean {
        if (typeof mask === 'number' && !isNaN(mask)) {
            if (mask < 0 || mask > 32) return false
            return true
        } else if (typeof mask === 'string') {
            const longMask: number | false = this.ip2long(mask)
            if (typeof longMask !== 'number') return false
            return /^1*0*$/.test(longMask.toString(2).padStart(32, '0'))
        } else {
            return false
        }
    }

    /**
     * Verify if two IPv4 address are on the same subnet
     *
     * @param ip1 - The first IPv4 address to compare
     * @param ip2 - The second IPv4 address to compare
     * @param mask - The subnet mask
     * @returns True if in the same subnet, otherwise false
     *
     * @example
     * ```
     * isSameSubnet('192.168.1.10', '192.168.1.100', 24) // true
     * isSameSubnet('192.168.1.10', '192.168.1.100', 32) // false
     * isSameSubnet('192.168.1.10', '192.168.1.100', '255.255.255.0') // true
     * isSameSubnet('192.168.1.10', '192.168.2.100', '255.255.255.0') // false
     * ```
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
     * Convert IPv4 address to binary and hex
     *
     * @param ip - The IPv4 address string
     * @returns Contains binary and hexadecimal objects, false if invalid
     *
     * @example
     * ```
     * const results = toBinHex('192.168.0.1');
     * // results = {
     * //   hex: '0xc0a80001',
     * //   decimal: 3232235521
     * //   binary: '11000000101010000000000000001'
     * // }
     * ```
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
     * Converts IPv4 address to IPv6 format
     *
     * @param ip - The IPv4 address string (validation requires strict mode)
     * @returns The IPv6 address object or false if invalid
     *
     * @example
     * ```
     * toIPv6Format('192.168.1.1')
     * // {
     * //   mapped: '::ffff:192.168.1.1',
     * //   comperssed: "::ffff:c0a8:101"
     * //   expanded: '0000:0000:0000:0000:0000:ffff:c0a8:0101',
     * // }
     * ```
     */
    public static toIPv6Format(ip: string): IPv6Result | false {
        if (!this.isValidIP(ip)) return false
        const longIP: number = this.ip2long(ip) as number
        const ipv4: string = this.long2ip(longIP) as string
        return {
            mapped: `::ffff:${ipv4}`,
            comperssed: IPv6.compressedForm(`::ffff:${ipv4}`) as string,
            expanded: IPv6.expandedForm(`::ffff:${ipv4}`) as string
        }
    }

    /**
     * Convert mask length to subnet mask string
     *
     * @param length - The mask length number
     * @returns The subnet mask string or false if invalid
     *
     * @example
     * ```
     * toSubnetMask(0)  // '0.0.0.0'
     * toSubnetMask(8)  // '255.0.0.0'
     * toSubnetMask(16) // '255.255.0.0'
     * toSubnetMask(24) // '255.255.255.0'
     * ```
     */
    public static toSubnetMask(length: number): string | false {
        if (typeof length !== 'number' || isNaN(length) || !this.isValidMask(length)) return false
        const mask: number = 0xffffffff << 32 - length
        return length ? this.long2ip(mask >>> 0) : '0.0.0.0'
    }

    /**
     * Convert subnet mask string to mask length number
     *
     * @param mask - The subnet mask string
     * @returns The mask length or false if invalid
     *
     * @example
     * ```
     * toMaskLength('255.255.255.0') // 24
     * toMaskLength('255.255.256.0') // false
     * ```
     */
    public static toMaskLength(mask: string): number | false {
        if (typeof mask !== 'string') return false
        if (!this.isValidMask(mask)) return false
        const longMask: number | false = this.ip2long(mask)
        const length: number = longMask === 0 ? 0 : longMask.toString(2).replaceAll('0', '').length
        return length
    }

    /**
     * Calculate the inverse mask of a subnet mask
     * @param mask - The subnet mask
     * @returns The inverse mask, or false if invalid
     *
     * @example
     * ```
     * toInverseMask(24);  // '0.0.0.255'
     * toInverseMask(16);  // '0.0.255.255'
     * toInverseMask('255.255.255.0');  // '0.0.0.255'
     * toInverseMask('255.255.0.0');  // '0.0.255.255'
     * ```
     */
    public static toInverseMask(mask: string | number): string | false {
        if (!this.isValidMask(mask)) return false

        if (typeof mask === 'number') mask = this.toSubnetMask(mask) as string
        const longMask: number = this.ip2long(mask) as number
        const notMask: number = ~longMask >>> 0
        return this.long2ip(notMask)
    }
}

export class IPv6 {
    /**
     * Compresses an expanded IPv6 address into shortened form.
     *
     * @param ip - The IPv6 address string
     * @returns The compressed IPv6 address string or false if invalid
     *
     * @example
     * ```
     * compressedForm('2001:0db8:0000:0000:0000:0000:0000:0001')  // '2001:db8::1'
     * ```
     */
    public static compressedForm(ip: string): string | false {
        if (!this.isValidIP(ip)) return false
        if (this.ip2long(ip) === 0n) return '::'

        ip = this.expandedForm(ip) as string
        const sections: string[] = ip.split(':')
        const compress = sections.map((section: string) => {
            const _section: number = parseInt(section, 16)
            return _section ? _section.toString(16) : 'X'
        }).join(':')

        const regExp: RegExp[] = [/(X:X:X:X:X:X:X)/, /(X:X:X:X:X:X)/, /(X:X:X:X:X)/, /(X:X:X:X)/, /(X:X:X)/, /(X:X)/]
        for (let i: number = 0; i < regExp.length; i++) {
            if (compress.match(regExp[i])) return compress.replace(regExp[i], ':').replace(':::', '::').replaceAll('X', '0')
        }

        return compress.replaceAll('X', '0')
    }

    /**
     * Verify if the IPv6 address is within the CIDR range
     *
     * @param cidr - A standard format IPv6 CIDR address
     * @param ip - The IPv6 address to check
     * @returns True if within range, otherwise false
     *
     * @example
     * contains('2001:db8::1/64', '2001:db8::11')    // true
     * contains('2001:db8::1/128', '2001:db8::11')    // false
     */
    public static contains(cidr: string, ip: string): boolean {
        const subnet: IPv6SubNet | false = this.parseCIDR(cidr)
        if (typeof subnet !== 'object' || !this.isValidIP(ip)) return false

        const {lastHost, firstHost} = subnet
        const ipLong: bigint | false = this.ip2long(ip)
        const lastHostLong: bigint | false = this.ip2long(lastHost)
        const firstHostLong: bigint | false = this.ip2long(firstHost)
        return ipLong >= firstHostLong && ipLong <= lastHostLong
    }

    /**
     * Expands an abbreviated IPv6 address string into its full representation.
     *
     * @param ip - The IPv6 address string
     * @returns The expanded IPv6 address string or false if invalid
     *
     * @example
     * ```
     * expandedForm('2001:db8::1') // '2001:0db8:0000:0000:0000:0000:0000:0001'
     * ```
     */
    public static expandedForm(ip: string): string | false {
        if (!this.isValidIP(ip)) return false
        if (ip === '::') return '0000:'.repeat(8).slice(0, -1)
        const sections: string[] = ip.split(':')
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
        }).join(':')
    }

    /**
     * Convert IPv6 address string to number
     *
     * @param ip - The IPv6 address string
     * @returns The converted IPv6 number or false if invalid
     *
     * @example
     * ```
     * ip2long('f16c:f7ec:cfa2:e1c5:9a3c:cb08:801f:36b8')   // 320909743562165251276054390739658815160n
     * ```
     */
    public static ip2long(ip: string): bigint | false {
        if (!this.isValidIP(ip)) return false

        const binary: string[] = []
        ip = this.expandedForm(ip) as string
        const parts: string[] = ip.split(':')
        for (let i: number = 0; i < parts.length; i++) {
            const dec: number = parseInt(parts[i], 16)
            binary.push(dec.toString(2).padStart(16, '0'))
        }
        return BigInt(`0b${binary.join('')}`)
    }

    /**
     * Verify if the IPv6 CIDR address is valid
     *
     * @param cidr - The CIDR address string
     * @returns True if valid, false otherwise
     *
     * @example
     * ```
     * isCIDR('::9999:ffff/0')  // true
     * isCIDR('::9999:ffff/64')  // true
     * isCIDR('::9999:ffff/128')  // true
     * isCIDR('::9999:ffff/129')  // false
     * isCIDR('::99991:ffff/129')  // false
     * ```
     */
    public static isCIDR(cidr: string): boolean {
        if (typeof cidr !== 'string') return false

        const subnet: IPv6SubNet | false = this.parseCIDR(cidr)
        return typeof subnet === 'object' ? true : false
    }

    /**
     * Check for conflicts in a set of IPv6 CIDR
     *
     * @param cidrs - Array of IPv6 CIDR format address string
     * @returns True if conflict found, false otherwise
     *
     * @example
     * ```
     * isConflict(['2001:db8::1/120', '2001:db8::1/122'])  // true
     * isConflict(['2001:db8::1/120', '3001:db8::1/120'])  // false
     * ```
     */
    public static isConflict(cidrs: string[]): boolean {
        if (!Array.isArray(cidrs) || cidrs.length === 0) return false

        const _cidrs: any[] = []
        for (const cidr of cidrs) {
            const subnet: IPv6SubNet | false = this.parseCIDR(cidr)
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
     * Verify if two IPv6 address are equal
     * @param ip1 The first IPv6 address to compare
     * @param ip2 The second IPv6 address to compare
     * @returns True if equal, false otherwise
     *
     * @example
     * ```
     * isEqual(65535n, 65535)  // false
     * isEqual(65535n, 65535n)  // true
     * isEqual('::ffff', 65535n) // true
     * isEqual('::ffff', ::ffff)  // true
     * isEqual('::ffff', 0:0:0:0:0:0:0:ffff)  // true
     * isEqual('::ffff', 0000:0000:0000:0000:0000:0000:0000:ffff)  // true
     * ```
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
     * Verify if the IPv6 address is valid
     *
     * @param ip - The IPv6 address string
     * @returns True if valid, false otherwise
     *
     * @example
     * ```
     * isValidIP('f16c:f7ec:cfa2:e1c5:9a3c:cb08:801f:36b8') // true
     * ```
     */
    public static isValidIP(ip: string): boolean {
        const IPV4_REGEX: RegExp = /^[\s]*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}))|:)))(%.+)?[\s]*$/
        return IPV4_REGEX.test(ip)
    }

    /**
     * Convert IPv4 number to address string
     *
     * @param ip - The IPv4 number
     * @returns The converted IPv4 address string or false if invalid
     *
     * @example
     * ```
     * long2ip(3232235521) // '192.168.0.1'
     * long2ip(-1) // false
     * ```
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
     * Parse CIDR format address into address range info
     *
     * NetworkAddress and broadcastAddress are valid when mask < 31
     *
     * @param cidr - The CIDR format address string
     * @returns The parsed address range object or false if invalid
     *
     * @example
     * ```
     * parseCIDR('::9999:ffff/118')
     * // {
     * //   ipCount: 1024n,
     * //   cidrMask: 118,
     * //   firstHost: '::9999:fc00',
     * //   lastHost: '::9999:ffff',
     * // }
     * ```
     */
    public static parseCIDR(cidr: string): IPv6SubNet | false {
        if (typeof cidr !== 'string') return false
        const [ip, mask] = cidr.split('/')
        if (ip === undefined || mask === undefined || mask === '') return false
        const prefixLength: number = +mask
        if (!this.isValidIP(ip) || isNaN(prefixLength) || prefixLength < 0 || prefixLength > 128) return false
        const length: bigint = BigInt(128 - prefixLength)
        const longIP: bigint = this.ip2long(ip) as bigint
        const ipCount: bigint = BigInt(0b1n << length)
        const networkIP: bigint = (longIP >> length) << length
        const firstHost: string = this.long2ip(networkIP) as string
        const lastHost: string = this.long2ip(networkIP | ipCount - 1n) as string
        const cidrInfo: IPv6SubNet = {
            ipCount,
            firstHost,
            lastHost,
            prefixLength
        }
        return cidrInfo
    }
}
