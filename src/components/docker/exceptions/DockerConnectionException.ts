import {Exception} from '../../../lib/base/abstracts/Exception.js'

/**
 * Docker connection exception
 */
export class DockerConnectionException extends Exception {
    public errno: string | number = 'E_DOCKER_CONNECTION'
}
