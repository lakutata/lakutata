import {Exception} from '@lakutata/core'

/**
 * Thrown when no container of the namespace has the identifier, name or identifier prefix asked
 * ({@link Containerd.getContainer}), or when a container object is synced after its container was removed. Its `errno`
 * is `E_CONTAINERD_CONTAINER_NOT_FOUND`.
 */
export class ContainerdContainerNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONTAINER_NOT_FOUND'
}
