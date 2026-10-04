import {Exception} from '@lakutata/core'

/**
 * Thrown when no network has the name, identifier or prefix asked ({@link Containerd.getNetwork},
 * {@link Containerd.removeNetwork}), or when a container is created on a CNI network that does not exist. Its `errno` is
 * `E_CONTAINERD_NETWORK_NOT_FOUND`.
 */
export class ContainerdNetworkNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_NETWORK_NOT_FOUND'
}
