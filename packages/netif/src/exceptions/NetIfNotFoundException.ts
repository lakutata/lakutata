import {NetIfException} from './NetIfException.js'

/**
 * A network interface that cannot be found: an interface given by an index that does not exist (an index is never
 * given again once its interface is gone), or a hardware address that several interfaces have (a bridge and its ports).
 * Its `errno` is `'E_NETIF_NOT_FOUND'`.
 */
export class NetIfNotFoundException extends NetIfException {
    /**
     * `'E_NETIF_NOT_FOUND'`.
     */
    public errno: string | number = 'E_NETIF_NOT_FOUND'
}
