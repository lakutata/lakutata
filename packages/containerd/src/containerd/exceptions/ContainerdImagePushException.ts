import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link ContainerdImage.push} (and {@link Containerd.buildImage} with `push`) when the registry cannot be
 * reached or refuses the push (credentials, rights). Its `errno` is `E_CONTAINERD_IMAGE_PUSH`.
 */
export class ContainerdImagePushException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_PUSH'
}
