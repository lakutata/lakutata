import {Exception} from '@lakutata/core'

/**
 * Thrown when the daemon has no container with the ID, short ID or name given: by {@link Docker.getContainer}, and by
 * the operations of a {@link DockerContainer} whose container was removed (HTTP 404 from the daemon). Its message is
 * the daemon's ("No such container: web"). Its `errno` is `E_DOCKER_CONTAINER_NOT_FOUND`.
 */
export class DockerContainerNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_CONTAINER_NOT_FOUND'
}
