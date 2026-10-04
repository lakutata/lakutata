import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Containerd.getVolume} and {@link Containerd.removeVolume} when the volume does not exist. Its
 * `errno` is `E_CONTAINERD_VOLUME_NOT_FOUND`.
 */
export class ContainerdVolumeNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_VOLUME_NOT_FOUND'
}
