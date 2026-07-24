import {Exception} from '@lakutata/core'

/**
 * Docker connection exception
 */
export class DockerConnectionException extends Exception {
    public errno: string | number = 'E_DOCKER_CONNECTION'
}
