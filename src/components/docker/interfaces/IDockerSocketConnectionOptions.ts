import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * Docker socket connection options
 */
export interface IDockerSocketConnectionOptions extends Omit<IDockerConnectionOptions, 'sshAuthAgent' | 'key' | 'protocol' | 'cert' | 'headers' | 'username' | 'port' | 'host'> {
}
