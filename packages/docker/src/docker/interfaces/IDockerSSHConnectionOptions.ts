import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * The options of {@link BuildDockerSSHConnectionOptions}: a remote host reached over SSH at `host` and `port`, as
 * `username`, authenticated by the SSH agent (`sshAuthAgent`), with the timeout and the API version of
 * {@link IDockerConnectionOptions} (its `protocol` is replaced by `'ssh'`).
 */
export interface IDockerSSHConnectionOptions extends Omit<IDockerConnectionOptions, 'socketPath'> {
    /**
     * The host name or IP address of the remote host running the daemon.
     */
    host: string
    /**
     * The SSH port of the remote host (usually 22).
     */
    port: number | string
}
