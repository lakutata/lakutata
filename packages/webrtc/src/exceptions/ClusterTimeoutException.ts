import {Exception} from '@lakutata/core'

/**
 * Thrown by `Cluster.request()` when the node does not answer in time. Its `errno` is `'E_CLUSTER_TIMEOUT'`.
 */
export class ClusterTimeoutException extends Exception {
    /**
     * `'E_CLUSTER_TIMEOUT'`.
     */
    public errno: string | number = 'E_CLUSTER_TIMEOUT'
}
