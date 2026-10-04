import {Exception} from '@lakutata/core'

/**
 * Containerd volume not found exception
 */
export class ContainerdVolumeNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_VOLUME_NOT_FOUND'
}
