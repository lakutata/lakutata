import {Exception} from '@lakutata/core'

/**
 * Containerd image export exception
 */
export class ContainerdImageExportException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_EXPORT'
}
