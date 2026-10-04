import {Exception} from '@lakutata/core'

/**
 * Thrown when an image has no manifest for the platform asked: a pull or a push of a platform the image does not
 * have, a container created for a platform not pulled, or an image none of whose platforms' content is present. Its
 * `errno` is `E_CONTAINERD_PLATFORM`.
 */
export class ContainerdPlatformException extends Exception {
    public errno: string | number = 'E_CONTAINERD_PLATFORM'
}
