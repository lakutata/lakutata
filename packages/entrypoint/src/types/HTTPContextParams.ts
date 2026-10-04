import {type IncomingMessage, type ServerResponse} from 'node:http'

/**
 * The parameters creating an `HTTPContext`, given by the HTTP adapters.
 */
export type HTTPContextParams = {
    /**
     * The route of the action as declared, its controller prefix included (`'/users/:id'`).
     */
    readonly route: string
    /**
     * The HTTP method of the action, as declared (`'get'`).
     */
    readonly method: string
    /**
     * The Node.js request.
     */
    readonly request: IncomingMessage
    /**
     * The Node.js response.
     */
    readonly response: ServerResponse
    /**
     * The input of the action before its validation: by default, the query string merged with the parsed body (the
     * route parameters are given apart, to the dispatch).
     */
    readonly data: Record<string, any>
}
