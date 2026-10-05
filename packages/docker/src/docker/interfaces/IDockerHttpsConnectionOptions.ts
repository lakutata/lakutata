import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * The options of {@link buildDockerHttpsConnectionOptions}: a daemon reached over HTTPS at `host` and `port`, with the
 * `ca`, `cert` and `key` (PEM contents), the headers, the timeout and the API version of
 * {@link IDockerConnectionOptions} (its `protocol` is replaced by `'https'`).
 */
export interface IDockerHttpsConnectionOptions extends Omit<IDockerConnectionOptions, 'socketPath' | 'sshAuthAgent'> {
    /**
     * The host name or IP address of the daemon, as its certificate names it.
     */
    host: string
    /**
     * The TCP port of the daemon (2376 by convention).
     */
    port: number | string
}
