import {Exception} from '@lakutata/core'

/**
 * Thrown when the daemon has no image with the ID or the name given: by {@link Docker.getImage}, by
 * {@link Docker.createContainer} and `DockerContainer.update()` (recreating a container whose image was removed), and by
 * the operations of a {@link DockerImage} which was removed (HTTP 404 from the daemon). Its `errno` is
 * `E_DOCKER_IMAGE_NOT_FOUND`.
 */
export class DockerImageNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_NOT_FOUND'
}
