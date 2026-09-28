import {Exception} from '@lakutata/core'

export class NatsBadRequestException extends Exception {
    public errno: string | number = 'E_NATS_BAD_REQUEST'
    public message: string = 'Bad Request'
    public statusCode: number = 400
}