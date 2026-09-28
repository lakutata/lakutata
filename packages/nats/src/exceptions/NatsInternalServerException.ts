import {Exception} from '@lakutata/core'

export class NatsInternalServerException extends Exception {
    public errno: string | number = 'E_NATS_INTERNAL_SERVER'
    public message: string = 'Internal Server Error'
    public statusCode: number = 500
}