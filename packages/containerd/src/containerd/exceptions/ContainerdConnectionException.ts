import {Exception} from '@lakutata/core'

/**
 * Thrown when the {@link Containerd} component is created and containerd does not answer on its `socketPath`
 * (containerd not running, no access to the socket: run as root or as a member of the socket's group), or its
 * `buildkitTLS` is given with a unix socket `buildkitAddress`. Its `errno` is `E_CONTAINERD_CONNECTION`.
 */
export class ContainerdConnectionException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONNECTION'
}
