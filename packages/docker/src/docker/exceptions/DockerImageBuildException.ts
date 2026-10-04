import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Docker.buildImage} when the build fails: a step of the Dockerfile failing (its message is BuildKit's
 * error), the Dockerfile or a file of the context missing, a base image which cannot be pulled with the credentials
 * given, the daemon unreachable, or the component destroyed during the build. Its `errno` is `E_DOCKER_IMAGE_BUILD`.
 */
export class DockerImageBuildException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_BUILD'
}