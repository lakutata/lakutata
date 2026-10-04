import {type ActionPattern} from '@lakutata/core'

/**
 * The parameters creating a `ServiceContext`, given by the service adapters (which may add their own, such as the
 * Socket.IO socket).
 */
export type ServiceContextParams = {
    /**
     * The message received: an object, matched against the actions' patterns.
     */
    readonly data: ActionPattern
    /**
     * The id of the client of the request, which `Entrypoint.notify()` pushes the events to; omitted for the transports
     * without clients.
     */
    readonly clientId?: string
}
