import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Docker.pullImage} when the pull fails: the image or the registry not found, refused credentials, the
 * daemon unreachable, or the component destroyed during the pull. Its message is the registry's or the daemon's. Its
 * `errno` is `E_DOCKER_IMAGE_PULL`.
 */
export class DockerImagePullException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_PULL'
}
