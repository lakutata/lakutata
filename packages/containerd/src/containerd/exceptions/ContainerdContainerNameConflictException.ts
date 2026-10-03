import {Exception} from '@lakutata/core'

/**
 * Containerd container name conflict exception: the name is used by another container
 */
export class ContainerdContainerNameConflictException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONTAINER_NAME_CONFLICT'
}
