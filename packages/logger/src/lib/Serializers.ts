//Derived from the upstream projects listed in THIRD_PARTY_NOTICES.md (rewritten in TypeScript)
const SEEN: unique symbol = Symbol('seen')

/**
 * Whether a value looks like an error
 * @param value
 */
export function isErrorLike(value: any): boolean {
    return !!value && typeof value.message === 'string'
}

/**
 * The cause of an error
 * @param error
 */
function causeOf(error: any): any {
    if (!error) return undefined
    const cause: any = typeof error.cause === 'function' ? error.cause() : error.cause
    return isErrorLike(cause) ? cause : undefined
}

/**
 * The stack of an error followed by the stacks of its causes
 * @param error
 * @param seen
 */
function stackWithCauses(error: any, seen: Set<unknown> = new Set()): string {
    if (!isErrorLike(error)) return ''
    const stack: string = error.stack || ''
    if (seen.has(error)) return `${stack}\ncauses have become circular...`
    const cause: any = causeOf(error)
    if (!cause) return stack
    seen.add(error)
    return `${stack}\ncaused by: ${stackWithCauses(cause, seen)}`
}

/**
 * The message of an error followed by the messages of its causes
 * @param error
 * @param seen
 * @param skip
 */
function messageWithCauses(error: any, seen: Set<unknown> = new Set(), skip: boolean = false): string {
    if (!isErrorLike(error)) return ''
    const message: string = skip ? '' : (error.message || '')
    if (seen.has(error)) return `${message}: ...`
    const cause: any = causeOf(error)
    if (!cause) return message
    seen.add(error)
    //A cause function (VError) already includes the message of its cause, as an error wrapping a cause of the same
    //message (an exception keeping the original error)
    const included: boolean = typeof error.cause === 'function' || (!skip && !seen.has(cause) && message === cause.message)
    return message + (included ? '' : ': ') + messageWithCauses(cause, seen, included)
}

/**
 * Serialize an error: type, message and stack (with the causes), aggregated errors and the other enumerable properties
 * @param error
 */
export function serializeError(error: any): any {
    if (!isErrorLike(error)) return error
    error[SEEN] = undefined
    const serialized: Record<string, unknown> = {}
    serialized.type = Object.prototype.toString.call(error.constructor) === '[object Function]' ? error.constructor.name : error.name
    serialized.message = messageWithCauses(error)
    serialized.stack = stackWithCauses(error)
    if (Array.isArray(error.errors)) serialized.aggregateErrors = error.errors.map((item: unknown): unknown => serializeError(item))
    for (const key in error) {
        //"raw" is reserved for the original error (not serialized)
        if (serialized[key] !== undefined || key === 'raw') continue
        const value: any = error[key]
        if (isErrorLike(value)) {
            if (key !== 'cause' && !Object.prototype.hasOwnProperty.call(value, SEEN)) serialized[key] = serializeError(value)
        } else {
            serialized[key] = value
        }
    }
    delete error[SEEN]
    return serialized
}

/**
 * The headers written as [Redacted] by default: the credentials of the requests and of the responses
 */
export const REDACTED_HEADERS: readonly string[] = Object.freeze(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

/**
 * A copy of headers, the values of the redacted ones (lower-case names) replaced by [Redacted]
 * @param headers
 * @param redacted
 */
function redactHeaders(headers: unknown, redacted: ReadonlySet<string>): unknown {
    if (!redacted.size || !headers || typeof headers !== 'object') return headers
    //A copy: the headers of the request or the response are not changed
    const copy: Record<string, unknown> = {...headers as Record<string, unknown>}
    for (const name of Object.keys(copy)) if (redacted.has(name.toLowerCase())) copy[name] = '[Redacted]'
    return copy
}

/**
 * Serialize an HTTP request
 * @param request
 * @param redacted the lower-case names of the headers written as [Redacted]
 */
export function serializeRequest(request: any, redacted: ReadonlySet<string> = new Set()): Record<string, unknown> {
    const connection: any = request.info || request.socket
    const serialized: Record<string, unknown> = {}
    serialized.id = typeof request.id === 'function' ? request.id() : (request.id || (request.info ? request.info.id : undefined))
    serialized.method = request.method
    if (request.originalUrl) {
        serialized.url = request.originalUrl
    } else {
        const path: unknown = request.path
        serialized.url = typeof path === 'string' ? path : (request.url ? request.url.path || request.url : undefined)
    }
    if (request.query) serialized.query = request.query
    if (request.params) serialized.params = request.params
    serialized.headers = redactHeaders(request.headers, redacted)
    serialized.remoteAddress = connection && connection.remoteAddress
    serialized.remotePort = connection && connection.remotePort
    return serialized
}

/**
 * Serialize an HTTP response
 * @param response
 * @param redacted the lower-case names of the headers written as [Redacted]
 */
export function serializeResponse(response: any, redacted: ReadonlySet<string> = new Set()): Record<string, unknown> {
    return {
        statusCode: response.headersSent ? response.statusCode : null,
        headers: redactHeaders(response.getHeaders ? response.getHeaders() : response._headers, redacted)
    }
}
