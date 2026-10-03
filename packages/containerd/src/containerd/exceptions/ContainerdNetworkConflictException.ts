import {Exception} from '@lakutata/core'

/**
 * Containerd network conflict exception: the network exists, its subnet overlaps another one, or it is used
 */
export class ContainerdNetworkConflictException extends Exception {
    public errno: string | number = 'E_CONTAINERD_NETWORK_CONFLICT'
}
