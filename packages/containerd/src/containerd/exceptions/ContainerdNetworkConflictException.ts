import {Exception} from '@lakutata/core'

/**
 * Thrown when a network cannot be created or removed: its name is taken (`host`, `none` and `bridge` included),
 * its subnet overlaps another network's, a container uses it, it is the default `bridge`, or it was not created by
 * nerdctl. Its `errno` is `E_CONTAINERD_NETWORK_CONFLICT`.
 */
export class ContainerdNetworkConflictException extends Exception {
    public errno: string | number = 'E_CONTAINERD_NETWORK_CONFLICT'
}
