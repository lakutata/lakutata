import {Exception} from '@lakutata/core'

/**
 * Containerd image import exception
 */
export class ContainerdImageImportException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_IMPORT'
}
