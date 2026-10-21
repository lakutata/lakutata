import {Exception} from '@lakutata/core'

/**
 * Thrown when the `Cluster` component starts with a transport whose client package is not installed (`nats` for NATS,
 * `ioredis` for Redis). Its `errno` is `'E_CLUSTER_TRANSPORT_NOT_FOUND'`.
 */
export class ClusterTransportNotFoundException extends Exception {
    /**
     * `'E_CLUSTER_TRANSPORT_NOT_FOUND'`.
     */
    public errno: string | number = 'E_CLUSTER_TRANSPORT_NOT_FOUND'
}
