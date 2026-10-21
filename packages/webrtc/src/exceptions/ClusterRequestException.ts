import {Exception} from '@lakutata/core'

/**
 * Thrown by `Cluster.request()` when the request cannot be answered: the node is not in the cluster, it has no handler
 * of the topic, or its handler failed. Its `errno` is `'E_CLUSTER_REQUEST'`.
 */
export class ClusterRequestException extends Exception {
    /**
     * `'E_CLUSTER_REQUEST'`.
     */
    public errno: string | number = 'E_CLUSTER_REQUEST'
}
