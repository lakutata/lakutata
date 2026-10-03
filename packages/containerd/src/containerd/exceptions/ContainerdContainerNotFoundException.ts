import {Exception} from '@lakutata/core'

/**
 * Containerd container not found exception
 */
export class ContainerdContainerNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONTAINER_NOT_FOUND'
}
