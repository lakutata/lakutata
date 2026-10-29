import {NetIfException} from './NetIfException.js'

/**
 * A listening with `strict: true` that the system cannot guarantee: the connections and the datagrams reaching the
 * addresses of the interface through another interface would not be refused. Its message tells why (the system, the
 * interface and its setting, the permission missing) and what to do. Its `errno` is `'E_NETIF_NOT_ENFORCED'`.
 */
export class NetIfNotEnforcedException extends NetIfException {
    /**
     * `'E_NETIF_NOT_ENFORCED'`.
     */
    public errno: string | number = 'E_NETIF_NOT_ENFORCED'
}
