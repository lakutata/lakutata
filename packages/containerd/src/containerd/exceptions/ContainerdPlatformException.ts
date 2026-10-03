import {Exception} from '@lakutata/core'

/**
 * Containerd platform exception: the image has no manifest of the platform
 */
export class ContainerdPlatformException extends Exception {
    public errno: string | number = 'E_CONTAINERD_PLATFORM'
}
