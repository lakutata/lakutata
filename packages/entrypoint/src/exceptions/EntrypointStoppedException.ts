import {Exception} from '@lakutata/core'

export class EntrypointStoppedException extends Exception {
    public errno: string | number = 'E_ENTRYPOINT_STOPPED'

    public readonly statusCode: number = 503
}
