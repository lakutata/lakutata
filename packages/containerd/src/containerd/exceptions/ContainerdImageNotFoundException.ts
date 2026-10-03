import {Exception} from '@lakutata/core'

/**
 * Containerd image not found exception
 */
export class ContainerdImageNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_NOT_FOUND'
}
