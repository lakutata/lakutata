import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Containerd.pullImage} when the registry cannot be reached, refuses the credentials, does not
 * have the reference, the transfer fails or is aborted (the component destroyed), or the unpacking fails. Its `errno`
 * is `E_CONTAINERD_IMAGE_PULL`.
 */
export class ContainerdImagePullException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_PULL'
}
