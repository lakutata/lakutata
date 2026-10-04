import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * The options of {@link BuildDockerSocketConnectionOptions}: the daemon's Unix socket or named pipe (`socketPath`), with
 * the authorities (`ca`), the timeout and the API version of {@link IDockerConnectionOptions}.
 */
export interface IDockerSocketConnectionOptions extends Omit<IDockerConnectionOptions, 'sshAuthAgent' | 'key' | 'protocol' | 'cert' | 'headers' | 'username' | 'port' | 'host'> {
}
