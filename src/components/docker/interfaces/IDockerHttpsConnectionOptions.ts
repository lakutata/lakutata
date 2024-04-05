import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * Docker https connection options
 */
export interface IDockerHttpsConnectionOptions extends Omit<IDockerConnectionOptions, 'socketPath' | 'sshAuthAgent'> {
    host: string
    port: number | string
}
