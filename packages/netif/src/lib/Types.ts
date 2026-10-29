/**
 * An address of a network interface, written as `os.networkInterfaces()` writes it
 */
export interface InterfaceAddress {
    /**
     * The address: `'192.168.10.2'`, `'fd00::2'`, `'fe80::1c82:430f:35a3:800a'` (an IPv6 address without its scope).
     */
    address: string

    /**
     * `'IPv4'` or `'IPv6'`.
     */
    family: 'IPv4' | 'IPv6'

    /**
     * The mask of the network of the address: `'255.255.255.0'`, `'ffff:ffff:ffff:ffff::'`.
     */
    netmask: string

    /**
     * The address and the length of its prefix: `'192.168.10.2/24'`.
     */
    cidr: string

    /**
     * IPv6 only: the index of the interface for a link-local address (`fe80::…`, which is written `fe80::…%<scopeid>` to
     * be connected to), `0` for the other ones.
     */
    scopeid?: number
}

/**
 * A network interface of the machine and its state when it was read
 */
export interface NetworkInterfaceInfo {
    /**
     * The name of the interface: `'eth1'`, `'en0'`, on Windows the name of its network connection (`'以太网 2'`,
     * `'Ethernet 2'`, in the language of the system).
     */
    name: string

    /**
     * The index the system gives the interface. It changes when the interface is unplugged and plugged again.
     */
    index: number

    /**
     * The hardware address (`'52:54:00:12:34:56'`), `undefined` for an interface without one (loopback, tunnels) and on
     * the macOS versions that hide it from the processes (macOS 27 gives `02:00:00:00:00:00` for every interface).
     */
    mac?: string

    /**
     * Whether the interface is enabled (its administrative state). On Windows a disabled adapter is not listed at all.
     */
    up: boolean

    /**
     * Whether its link is up: a cable plugged in, an association made.
     */
    running: boolean

    /**
     * Whether it is the loopback interface.
     */
    loopback: boolean

    /**
     * Its usable addresses, an empty array when it has none. An IPv6 address still in its duplicate address detection
     * (about one second after it is added) is not usable yet and not listed.
     */
    addresses: InterfaceAddress[]
}
