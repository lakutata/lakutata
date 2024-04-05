import {IDockerConnectionOptions} from './interfaces/IDockerConnectionOptions.js'
import {Docker} from './Docker.js'
import {IDockerSocketConnectionOptions} from './interfaces/IDockerSocketConnectionOptions.js'
import {IDockerHttpConnectionOptions} from './interfaces/IDockerHttpConnectionOptions.js'
import {IDockerHttpsConnectionOptions} from './interfaces/IDockerHttpsConnectionOptions.js'
import {IDockerSSHConnectionOptions} from './interfaces/IDockerSSHConnectionOptions.js'

/**
 * Build docker config
 * @param options
 * @constructor
 */
export const BuildDockerConnectionConfig: (options: IDockerConnectionOptions) => IDockerConnectionOptions = (options: IDockerConnectionOptions) => ({
    ...options,
    class: Docker
})
/**
 * Build docker socket config
 * @param options
 * @constructor
 */
export const BuildDockerSocketConnectionConfig: (options: IDockerSocketConnectionOptions) => IDockerConnectionOptions = (options: IDockerSocketConnectionOptions) => ({
    ...options,
    class: Docker
})

/**
 * Build docker http config
 * @param options
 * @constructor
 */
export const BuildDockerHttpConnectionConfig: (options: IDockerHttpConnectionOptions) => IDockerConnectionOptions = (options: IDockerHttpConnectionOptions) => ({
    ...options,
    protocol: 'http',
    class: Docker
})
/**
 * Build docker https config
 * @param options
 * @constructor
 */
export const BuildDockerHttpsConnectionConfig: (options: IDockerHttpsConnectionOptions) => IDockerConnectionOptions = (options: IDockerHttpsConnectionOptions) => ({
    ...options,
    protocol: 'https',
    class: Docker
})
/**
 * Build docker ssh config
 * @param options
 * @constructor
 */
export const BuildDockerSSHConnectionConfig: (options: IDockerSSHConnectionOptions) => IDockerConnectionOptions = (options: IDockerSSHConnectionOptions) => ({
    ...options,
    protocol: 'ssh',
    class: Docker
})
