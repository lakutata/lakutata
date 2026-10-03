import {type ActionPattern} from '@lakutata/core'

/**
 * The parameters of the context of the service requests (ServiceContext)
 */
export type ServiceContextParams = {
    readonly data: ActionPattern
    /**
     * The client of the request, which the events are pushed to (Entrypoint.notify)
     */
    readonly clientId?: string
}
