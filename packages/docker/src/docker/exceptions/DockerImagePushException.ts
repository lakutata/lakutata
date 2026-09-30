import {Exception} from '@lakutata/core'

export class DockerImagePushException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_PUSH'
}
