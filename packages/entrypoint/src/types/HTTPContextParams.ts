import {type IncomingMessage, type ServerResponse} from 'node:http'

/**
 * The parameters of the context of the HTTP requests (HTTPContext)
 */
export type HTTPContextParams = {
    readonly route: string
    readonly method: string
    readonly request: IncomingMessage
    readonly response: ServerResponse
    readonly data: Record<string, any>
}
