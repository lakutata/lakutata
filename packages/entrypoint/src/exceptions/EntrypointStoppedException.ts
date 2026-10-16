import {Exception} from '@lakutata/core'

/**
 * The request arrived while the entrypoint is stopping (the application exiting): it is refused, the requests in
 * progress being waited for. A request still running when the entrypoint's `shutdownTimeout` runs out is aborted with
 * it too. Its errno is `E_ENTRYPOINT_STOPPED`, its HTTP status 503.
 */
export class EntrypointStoppedException extends Exception {
    public errno: string | number = 'E_ENTRYPOINT_STOPPED'

    public readonly statusCode: number = 503
}
