import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class DockerNetworkNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_NETWORK_NOT_FOUND'
}