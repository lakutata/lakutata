import {Exception} from '@lakutata/core'

/**
 * Containerd container state exception: the container is not in the state the operation needs
 */
export class ContainerdContainerStateException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONTAINER_STATE'
}
