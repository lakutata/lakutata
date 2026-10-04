import {Exception} from '@lakutata/core'

/**
 * Thrown when the {@link Docker} component is created and cannot connect to its daemon: the socket or the host cannot be
 * reached, the daemon does not answer its ping or its version, the TLS handshake fails, or an SSH connection is
 * configured without the package `ssh2`. Its message is the cause's. Its `errno` is `E_DOCKER_CONNECTION`.
 */
export class DockerConnectionException extends Exception {
    public errno: string | number = 'E_DOCKER_CONNECTION'
}
