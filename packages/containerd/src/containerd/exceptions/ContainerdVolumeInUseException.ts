import {Exception} from '@lakutata/core'

/**
 * Containerd volume in use exception: a container uses the volume
 */
export class ContainerdVolumeInUseException extends Exception {
    public errno: string | number = 'E_CONTAINERD_VOLUME_IN_USE'
}
