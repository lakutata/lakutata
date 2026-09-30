/**
 * A request to the Docker Engine API which failed: its message is the one of docker-modem, "(HTTP code 404) no such
 * container - No such container: x", the status and the body of the response are given
 */
export class DockerRequestError extends Error {

    /**
     * @param statusCode the status of the response
     * @param reason the meaning of the status for the request
     * @param detail the message of the daemon
     * @param json the body of the response
     */
    constructor(public readonly statusCode: number, public readonly reason: string, detail: string, public readonly json?: unknown) {
        super(`(HTTP code ${statusCode}) ${reason} - ${detail} `)
        this.name = 'DockerRequestError'
    }
}
