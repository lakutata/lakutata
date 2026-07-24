import {Exception} from '@lakutata/core'

/**
 * Docker image not found exception
 */
export class DockerImageNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_NOT_FOUND'
}
