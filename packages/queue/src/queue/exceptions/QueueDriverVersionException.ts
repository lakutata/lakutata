import {Exception} from '@lakutata/core'

/**
 * Thrown when a {@link Queue} connects to a server older than its driver supports (Redis before 5.0, NATS before 2.9.4
 * or without JetStream, RabbitMQ before 3.6). Its message names the version found and the version needed. Its `errno` is
 * `'E_QUEUE_DRIVER_VERSION'`.
 */
export class QueueDriverVersionException extends Exception {
    /**
     * `'E_QUEUE_DRIVER_VERSION'`.
     */
    public errno: string | number = 'E_QUEUE_DRIVER_VERSION'
}
