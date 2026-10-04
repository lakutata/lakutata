import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link ContainerdContainer.exportDirectory} when the path does not exist in the container (its symbolic
 * links resolved inside it). Its `errno` is `E_CONTAINERD_PATH_NOT_FOUND`.
 */
export class ContainerdPathNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_PATH_NOT_FOUND'
}
