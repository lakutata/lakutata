import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * Docker ssh connection options
 */
export interface IDockerSSHConnectionOptions extends Omit<IDockerConnectionOptions, 'socketPath'> {
    host: string
    port: number | string
}
