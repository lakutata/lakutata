import {Exception} from '@lakutata/core'

/**
 * Containerd image pull exception
 */
export class ContainerdImagePullException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_PULL'
}
