import {Exception} from '@lakutata/core'

export class DockerImageBuildException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_BUILD'
}