import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * The options of {@link buildDockerHttpConnectionOptions}: a daemon reached over plain HTTP at `host` and `port`, with the
 * headers, the timeout and the API version of {@link IDockerConnectionOptions} (its `protocol` is replaced by
 * `'http'`).
 */
export interface IDockerHttpConnectionOptions extends Omit<IDockerConnectionOptions, 'socketPath' | 'sshAuthAgent'> {
    /**
     * The host name or IP address of the daemon.
     */
    host: string
    /**
     * The TCP port of the daemon (2375 by convention).
     */
    port: number | string
}
