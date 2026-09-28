import {Exception} from '@lakutata/core'

export class NatsNoRespondersAvailableException extends Exception {
    public errno: string | number = 'E_NATS_NO_RESPONDERS_AVAILABLE'
    public message: string = 'No Responders Available'
    public statusCode: number = 503
}