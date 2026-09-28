import {Exception} from '@lakutata/core'

export class NatsNotFoundException extends Exception {
    public errno: string | number = 'E_NATS_NOT_FOUND'
    public message: string = 'Subject Not Found'
    public statusCode: number = 404
}