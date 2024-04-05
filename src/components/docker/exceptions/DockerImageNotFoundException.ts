import {Exception} from '../../../lib/base/abstracts/Exception.js'

/**
 * Docker image not found exception
 */
export class DockerImageNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_NOT_FOUND'
}
