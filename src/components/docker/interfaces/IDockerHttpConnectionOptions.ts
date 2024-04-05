import {IDockerConnectionOptions} from './IDockerConnectionOptions.js'

/**
 * Docker http connection options
 */
export interface IDockerHttpConnectionOptions extends Omit<IDockerConnectionOptions, 'socketPath' | 'sshAuthAgent'> {
    host: string
    port: number | string
}
