import {Exception} from '@lakutata/core'

/**
 * Containerd network not found exception
 */
export class ContainerdNetworkNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_NETWORK_NOT_FOUND'
}
