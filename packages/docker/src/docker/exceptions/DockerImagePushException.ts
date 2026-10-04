import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link DockerImage.push} when the registry refuses the push (refused credentials, a repository not found or
 * not writable); its message is the registry's. Its `errno` is `E_DOCKER_IMAGE_PUSH`.
 */
export class DockerImagePushException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_PUSH'
}
