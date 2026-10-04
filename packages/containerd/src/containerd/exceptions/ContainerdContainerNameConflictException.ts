import {Exception} from '@lakutata/core'

/**
 * Thrown when a container is created (or created again by an update) with a name another container of the namespace
 * has. Its `errno` is `E_CONTAINERD_CONTAINER_NAME_CONFLICT`.
 */
export class ContainerdContainerNameConflictException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONTAINER_NAME_CONFLICT'
}
