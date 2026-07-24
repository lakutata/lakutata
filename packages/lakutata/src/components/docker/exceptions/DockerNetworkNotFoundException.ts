import {Exception} from '@lakutata/core'

export class DockerNetworkNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_NETWORK_NOT_FOUND'
}