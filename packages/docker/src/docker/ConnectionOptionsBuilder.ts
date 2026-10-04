import {IDockerConnectionOptions} from './interfaces/IDockerConnectionOptions.js'
import {Docker} from './Docker.js'
import {IDockerSocketConnectionOptions} from './interfaces/IDockerSocketConnectionOptions.js'
import {IDockerHttpConnectionOptions} from './interfaces/IDockerHttpConnectionOptions.js'
import {IDockerHttpsConnectionOptions} from './interfaces/IDockerHttpsConnectionOptions.js'
import {IDockerSSHConnectionOptions} from './interfaces/IDockerSSHConnectionOptions.js'
import {ComponentOptions, ComponentOptionsBuilder} from '@lakutata/core'

/**
 * Build the component options of a {@link Docker} connected as the options say, to register it in the `components` of
 * an application under the name of your choice. Without `socketPath` nor `host`, it connects to the Docker of the
 * environment (`DOCKER_HOST`, else the local socket). The options are validated when the component is created, not
 * here.
 * @param options The connection options: a socket (`socketPath`), or a `host` and `port` reached with `protocol`
 * (`'http'`, `'https'` or `'ssh'`), with their TLS, SSH, timeout and API version options.
 * @returns The component options (`{class: Docker, ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildDockerConnectionOptions} from 'lakutata/com/docker'
 *
 * Application.run(() => ({
 *     id: 'docker.app',
 *     name: 'Docker',
 *     components: {
 *         //The Docker of the environment (DOCKER_HOST, else the local socket), with the API version 1.47
 *         docker: BuildDockerConnectionOptions({version: '1.47'})
 *     }
 * }))
 * ```
 */
export const BuildDockerConnectionOptions: ComponentOptionsBuilder<IDockerConnectionOptions> = (options: IDockerConnectionOptions): ComponentOptions<IDockerConnectionOptions> => ({
    ...options,
    class: Docker
})

/**
 * Build the component options of a {@link Docker} connected to the Unix socket of a daemon (or its named pipe on
 * Windows), to register it in the `components` of an application. The options are validated when the component is
 * created, not here.
 * @param options The path of the socket (`socketPath`), with the timeout and the API version. Without `socketPath`, the
 * Docker of the environment is used, with the other options applied over it.
 * @returns The component options (`{class: Docker, ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildDockerSocketConnectionOptions} from 'lakutata/com/docker'
 *
 * Application.run(() => ({
 *     id: 'docker.app',
 *     name: 'Docker',
 *     components: {
 *         docker: BuildDockerSocketConnectionOptions({socketPath: '/var/run/docker.sock', timeout: 60000})
 *     }
 * }))
 * ```
 */
export const BuildDockerSocketConnectionOptions: ComponentOptionsBuilder<IDockerConnectionOptions> = (options: IDockerSocketConnectionOptions): ComponentOptions<IDockerSocketConnectionOptions> => ({
    ...options,
    class: Docker
})

/**
 * Build the component options of a {@link Docker} connected to a daemon over plain HTTP (`dockerd -H tcp://0.0.0.0:2375`),
 * to register it in the `components` of an application. The connection is neither encrypted nor authenticated: keep it
 * to trusted networks. The options are validated when the component is created, not here.
 * @param options The `host` and `port` of the daemon, with the headers, the timeout and the API version; the `protocol`
 * is set to `'http'`.
 * @returns The component options (`{class: Docker, protocol: 'http', ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildDockerHttpConnectionOptions} from 'lakutata/com/docker'
 *
 * Application.run(() => ({
 *     id: 'docker.app',
 *     name: 'Docker',
 *     components: {
 *         docker: BuildDockerHttpConnectionOptions({host: '192.168.1.10', port: 2375})
 *     }
 * }))
 * ```
 */
export const BuildDockerHttpConnectionOptions: ComponentOptionsBuilder<IDockerHttpConnectionOptions> = (options: IDockerHttpConnectionOptions): ComponentOptions<IDockerHttpConnectionOptions> => ({
    ...options,
    protocol: 'http',
    class: Docker
})
/**
 * Build the component options of a {@link Docker} connected to a daemon over HTTPS (`dockerd --tlsverify -H
 * tcp://0.0.0.0:2376`), to register it in the `components` of an application. The options are validated when the
 * component is created, not here.
 * @param options The `host` and `port` of the daemon, with the PEM contents of the authority (`ca`), the client
 * certificate (`cert`) and its key (`key`), the headers, the timeout and the API version; the `protocol` is set to
 * `'https'`.
 * @returns The component options (`{class: Docker, protocol: 'https', ...options}`).
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import {Application} from 'lakutata'
 * import {BuildDockerHttpsConnectionOptions} from 'lakutata/com/docker'
 *
 * Application.run(() => ({
 *     id: 'docker.app',
 *     name: 'Docker',
 *     components: {
 *         //The PEM contents, not the file paths
 *         docker: BuildDockerHttpsConnectionOptions({
 *             host: 'docker.example.com',
 *             port: 2376,
 *             ca: readFileSync('/etc/docker/certs/ca.pem'),
 *             cert: readFileSync('/etc/docker/certs/cert.pem'),
 *             key: readFileSync('/etc/docker/certs/key.pem')
 *         })
 *     }
 * }))
 * ```
 */
export const BuildDockerHttpsConnectionOptions: ComponentOptionsBuilder<IDockerHttpsConnectionOptions> = (options: IDockerHttpsConnectionOptions): ComponentOptions<IDockerHttpsConnectionOptions> => ({
    ...options,
    protocol: 'https',
    class: Docker
})
/**
 * Build the component options of a {@link Docker} connected to a remote daemon over SSH, as `DOCKER_HOST=ssh://user@host`
 * does, to register it in the `components` of an application. The requests go through `docker system dial-stdio` run on
 * the remote host, which needs the Docker CLI; locally, the optional package `ssh2` must be installed. The SSH connection
 * authenticates through the SSH agent (no password). The options are validated when the component is created, not here.
 * @param options The `host` and `port` (the SSH port, usually 22) of the remote host, the `username`, the SSH agent's
 * socket (`sshAuthAgent`; `SSH_AUTH_SOCK` by default), the timeout and the API version; the `protocol` is set to
 * `'ssh'`.
 * @returns The component options (`{class: Docker, protocol: 'ssh', ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildDockerSSHConnectionOptions} from 'lakutata/com/docker'
 *
 * Application.run(() => ({
 *     id: 'docker.app',
 *     name: 'Docker',
 *     components: {
 *         docker: BuildDockerSSHConnectionOptions({host: 'docker.example.com', port: 22, username: 'deploy'})
 *     }
 * }))
 * ```
 */
export const BuildDockerSSHConnectionOptions: ComponentOptionsBuilder<IDockerSSHConnectionOptions> = (options: IDockerSSHConnectionOptions): ComponentOptions<IDockerSSHConnectionOptions> => ({
    ...options,
    protocol: 'ssh',
    class: Docker
})
