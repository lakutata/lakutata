import {NetIfException} from './NetIfException.js'

/**
 * An operation the system, or the way the interface is listened on, cannot do: `bindSocket()` outside Linux, the
 * broadcasts and the multicast of a UDP socket bound to the addresses of an interface on Linux and macOS. Its `errno` is
 * `'E_NETIF_NOT_SUPPORTED'`.
 */
export class NetIfNotSupportedException extends NetIfException {
    /**
     * `'E_NETIF_NOT_SUPPORTED'`.
     */
    public errno: string | number = 'E_NETIF_NOT_SUPPORTED'
}
