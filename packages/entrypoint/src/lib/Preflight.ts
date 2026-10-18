import type {IncomingMessage, OutgoingHttpHeaders} from 'node:http'

/**
 * The headers of the answer to a preflight of a browser: the headers the request asks for are allowed (Authorization,
 * the headers of the application…), the headers of the adapter when it asks for none
 * @param request
 * @param headers the CORS headers of the adapter
 */
export function preflightHeaders(request: IncomingMessage, headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
    const requested: string | undefined = request.headers['access-control-request-headers']
    return {...headers, 'Access-Control-Allow-Headers': requested || headers['Access-Control-Allow-Headers'], 'Vary': 'Access-Control-Request-Headers'}
}
