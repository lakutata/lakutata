import {Exception} from '@lakutata/core'

/**
 * Thrown when a {@link Queue} connects with a driver whose client packages are not installed: `bullmq` and `ioredis` for
 * the Redis driver, `nats` for NATS JetStream. Its message names the package to install. Its `errno` is
 * `'E_QUEUE_DRIVER_NOT_FOUND'`.
 */
export class QueueDriverNotFoundException extends Exception {
    /**
     * `'E_QUEUE_DRIVER_NOT_FOUND'`.
     */
    public errno: string | number = 'E_QUEUE_DRIVER_NOT_FOUND'
}
