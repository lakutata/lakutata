import {NetIfException} from './NetIfException.js'

/**
 * A wait that ended before what it waited for happened: `waitForAddress()` whose interface got no address in time.
 * Its `errno` is `'E_NETIF_TIMEOUT'`.
 */
export class NetIfTimeoutException extends NetIfException {
    /**
     * `'E_NETIF_TIMEOUT'`.
     */
    public errno: string | number = 'E_NETIF_TIMEOUT'
}
