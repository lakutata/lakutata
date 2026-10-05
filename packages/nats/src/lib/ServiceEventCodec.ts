import {md5} from '@lakutata/utils'
import * as querystring from 'node:querystring'

export interface ServiceEventData {
    readonly args: any[]
}

export class ServiceEventCodec {
    protected static hashEventName(serviceId: string, eventName: string): string {
        return md5(querystring.encode({
            serviceId: serviceId,
            eventName: eventName
        })).toString('hex')
    }

    public static encode(args: any[]): ServiceEventData {
        return {
            args: args
        }
    }

    public static decode(eventData: ServiceEventData): any[] {
        return eventData.args
    }

    public static formatSubject(serviceId: string, eventName: string): string {
        return `framework.internal.service.event.${this.hashEventName(serviceId, eventName)}`
    }
}