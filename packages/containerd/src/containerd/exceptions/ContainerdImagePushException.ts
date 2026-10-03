import {Exception} from '@lakutata/core'

/**
 * Containerd image push exception
 */
export class ContainerdImagePushException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_PUSH'
}
