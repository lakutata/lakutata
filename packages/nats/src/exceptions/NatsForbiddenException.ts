import {Exception} from '@lakutata/core'

export class NatsForbiddenException extends Exception {
    public errno: string | number = 'E_NATS_FORBIDDEN'
    public message: string = 'Forbidden'
    public statusCode: number = 403
}