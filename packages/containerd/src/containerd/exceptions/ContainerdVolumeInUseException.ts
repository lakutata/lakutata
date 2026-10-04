import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Containerd.removeVolume} when a container of the namespace mounts the volume, even a stopped one.
 * Its `errno` is `E_CONTAINERD_VOLUME_IN_USE`.
 */
export class ContainerdVolumeInUseException extends Exception {
    public errno: string | number = 'E_CONTAINERD_VOLUME_IN_USE'
}
