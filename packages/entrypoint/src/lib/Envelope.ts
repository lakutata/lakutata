/**
 * The envelope of a response: its fields, then the extra fields not named as one of them (an extra field never
 * replaces errno, errMsg or data)
 * @param fields The fields of the envelope.
 * @param extra The extra fields, ignored when they are not an object.
 */
export function envelopeOf(fields: Record<string, unknown>, extra: unknown): Record<string, unknown> {
    const envelope: Record<string, unknown> = {...fields}
    if (extra === null || typeof extra !== 'object') return envelope
    for (const [key, value] of Object.entries(extra)) if (!Object.prototype.hasOwnProperty.call(envelope, key)) envelope[key] = value
    return envelope
}

/**
 * The extra fields of an error response: none when the function giving them fails, an error being answered anyway
 * @param extra The function giving the extra fields.
 * @param request The request answered.
 */
export function errorExtraOf<Request>(extra: ((request: Request) => Record<string, unknown>) | undefined, request: Request): unknown {
    try {
        return extra?.(request)
    } catch {
        return undefined
    }
}
