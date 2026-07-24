import {Exception} from '@lakutata/core'

export class DockerImagePullException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_PULL'
}
