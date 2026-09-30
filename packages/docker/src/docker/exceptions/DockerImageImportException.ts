import {Exception} from '@lakutata/core'

export class DockerImageImportException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_IMPORT'
}