import {Exception} from '@lakutata/core'

/**
 * Containerd connection exception
 */
export class ContainerdConnectionException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONNECTION'
}
