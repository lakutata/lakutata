import {Exception} from '@lakutata/core'

/**
 * Thrown when the daemon has no network with the ID, short ID or name given: by {@link Docker.getNetwork} and
 * {@link Docker.removeNetwork}, and by the creation of a container connected to a missing network (HTTP 404 from the
 * daemon). Its `errno` is `E_DOCKER_NETWORK_NOT_FOUND`.
 */
export class DockerNetworkNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_NETWORK_NOT_FOUND'
}