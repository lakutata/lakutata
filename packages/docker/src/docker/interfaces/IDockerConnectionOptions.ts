import {IDockerKeyObject} from './IDockerKeyObject.js'

/**
 * The connection options of the {@link Docker} component, as {@link BuildDockerConnectionOptions} takes them: a socket
 * (`socketPath`), or a `host` and `port` reached over HTTP, HTTPS or SSH. Without `socketPath` nor `host`, the component
 * connects to the Docker of the environment (`DOCKER_HOST`, else the local socket), with the other options given
 * (`timeout`, `headers`, `version`…) applied over the environment's.
 */
export interface IDockerConnectionOptions {
    /**
     * The path of the daemon's Unix socket (`/var/run/docker.sock`), or of its named pipe on Windows
     * (`//./pipe/docker_engine`). When set, `host` and `port` are ignored.
     * @default undefined (the Docker of the environment)
     */
    socketPath?: string | undefined
    /**
     * The host name or IP address of the daemon, reached with `protocol`.
     * @default undefined (the Docker of the environment)
     */
    host?: string | undefined
    /**
     * The port of the daemon on `host`: by convention 2375 over HTTP and 2376 over HTTPS; the SSH port for `'ssh'`.
     * @default undefined (80 over HTTP, 443 over HTTPS, 22 over SSH)
     */
    port?: number | string | undefined
    /**
     * The user of the SSH connections.
     * @default undefined
     */
    username?: string | undefined
    /**
     * The HTTP headers added to every request sent to the daemon.
     * @default undefined
     */
    headers?: { [name: string]: string }
    /**
     * The certificates of the authorities trusted for the daemon's HTTPS certificate: their PEM contents, not their file
     * paths.
     * @default undefined (the authorities of Node.js)
     */
    ca?: string | string[] | Buffer | Buffer[] | undefined
    /**
     * The client certificate of the HTTPS connections (its PEM contents).
     * @default undefined
     */
    cert?: string | string[] | Buffer | Buffer[] | undefined
    /**
     * The private key of `cert` (its PEM contents), or keys with their passphrases.
     * @default undefined
     */
    key?: string | string[] | Buffer | Buffer[] | IDockerKeyObject[] | undefined
    /**
     * How `host` is reached: `'http'`, `'https'`, or `'ssh'` (which needs the optional package `ssh2`, and the Docker
     * CLI on the remote host). Ignored with `socketPath`.
     * @default 'https' when `ca`, `cert` and `key` are all given, 'http' otherwise
     */
    protocol?: 'https' | 'http' | 'ssh' | undefined
    /**
     * How long a request may stay idle (no data received), in milliseconds, before it fails; the streams (followed
     * logs) included.
     * @default undefined (no timeout)
     */
    timeout?: number | undefined
    /**
     * The version of the Docker Engine API used by the requests (`'1.47'` or `'v1.47'`).
     * @default undefined (negotiated with the daemon)
     */
    version?: string | undefined
    /**
     * The path of the SSH agent's socket, which authenticates the SSH connections.
     * @default undefined (the `SSH_AUTH_SOCK` environment variable)
     */
    sshAuthAgent?: string | undefined
}
