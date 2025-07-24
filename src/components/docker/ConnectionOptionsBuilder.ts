import {IDockerConnectionOptions} from './interfaces/IDockerConnectionOptions.js'
import {Docker} from './Docker.js'
import {IDockerSocketConnectionOptions} from './interfaces/IDockerSocketConnectionOptions.js'
import {IDockerHttpConnectionOptions} from './interfaces/IDockerHttpConnectionOptions.js'
import {IDockerHttpsConnectionOptions} from './interfaces/IDockerHttpsConnectionOptions.js'
import {IDockerSSHConnectionOptions} from './interfaces/IDockerSSHConnectionOptions.js'
import {ComponentOptions, ComponentOptionsBuilder} from '../../types/ComponentOptions.js'

/**
 * Build docker config
 * @param options
 * @constructor
 */
export const BuildDockerConnectionOptions: ComponentOptionsBuilder<IDockerConnectionOptions> = (options: IDockerConnectionOptions): ComponentOptions<IDockerConnectionOptions> => ({
    ...options,
    class: Docker
})

/**
 * Build docker socket config
 * @param options
 * @constructor
 */
export const BuildDockerSocketConnectionOptions: ComponentOptionsBuilder<IDockerConnectionOptions> = (options: IDockerSocketConnectionOptions): ComponentOptions<IDockerSocketConnectionOptions> => ({
    ...options,
    class: Docker
})

/**
 * Build docker http config
 * @param options
 * @constructor
 */
export const BuildDockerHttpConnectionOptions: ComponentOptionsBuilder<IDockerHttpConnectionOptions> = (options: IDockerHttpConnectionOptions): ComponentOptions<IDockerHttpConnectionOptions> => ({
    ...options,
    protocol: 'http',
    class: Docker
})
/**
 * Build docker https config
 * @param options
 * @constructor
 */
export const BuildDockerHttpsConnectionOptions: ComponentOptionsBuilder<IDockerHttpsConnectionOptions> = (options: IDockerHttpsConnectionOptions): ComponentOptions<IDockerHttpsConnectionOptions> => ({
    ...options,
    protocol: 'https',
    class: Docker
})
/**
 * Build docker ssh config
 * @param options
 * @constructor
 */
export const BuildDockerSSHConnectionOptions: ComponentOptionsBuilder<IDockerSSHConnectionOptions> = (options: IDockerSSHConnectionOptions): ComponentOptions<IDockerSSHConnectionOptions> => ({
    ...options,
    protocol: 'ssh',
    class: Docker
})
