import {Exception} from '@lakutata/core'

/**
 * Thrown when the daemon refuses a request and no other exception of the component fits: a container name already used
 * (HTTP 409), a container not running (HTTP 409), credentials refused by a registry ({@link Docker.loginRepository}),
 * a network with containers connected, an image used by a container, an invalid parameter (HTTP 400), a failure of the
 * daemon (HTTP 500). Its message is the daemon's, its `statusCode` the HTTP status of the daemon's answer. Its `errno`
 * is `E_DOCKER_REQUEST`.
 */
export class DockerRequestException extends Exception {
    public errno: string | number = 'E_DOCKER_REQUEST'

    /**
     * The HTTP status of the daemon's answer (`409`, `500`…); the HTTP entrypoints reply with it when the exception
     * fails a request.
     */
    public readonly statusCode: number

    /**
     * Create the exception of a refused request: the component creates it, an application does not.
     * @param statusCode The HTTP status of the daemon's answer.
     * @param message The daemon's message.
     */
    constructor(statusCode: number, message: string) {
        super(message)
        this.statusCode = statusCode
    }
}
