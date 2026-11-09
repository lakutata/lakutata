import {LDAPException} from './LDAPException.js'

/**
 * A message that cannot be decoded. When `fatal` is true the stream cannot go on (the message could not be framed, or
 * its message ID could not be read): the session ends, after a Notice of Disconnection from a server. Otherwise the
 * message ID and the operation are known. When `malformed` is true the encoding of the operation is wrong (its
 * structure or a length) and a server ends the session too (RFC 4511 §4.1.1); else only a value is not allowed, and a
 * server answers that operation with `protocolError`. A client fails the operation either way.
 */
export class LDAPDecodeException extends LDAPException {
    /**
     * Whether the session cannot go on
     */
    public readonly fatal: boolean

    /**
     * Whether the encoding is wrong (its structure or a length), not only a value; true when `fatal` is
     */
    public readonly malformed: boolean

    /**
     * The message ID of the message, when it could be read
     */
    public readonly messageId: number | undefined

    /**
     * The type of the operation of the message (`'searchRequest'`…), when its tag is known
     */
    public readonly operation: string | undefined

    /**
     * @param message What could not be decoded.
     * @param options Whether it is fatal, whether its encoding is wrong (when it is fatal by default), the message ID and
     * the operation when they are known.
     */
    constructor(message: string, options: {fatal: boolean, malformed?: boolean, messageId?: number, operation?: string}) {
        super('E_LDAP_DECODE', message)
        this.fatal = options.fatal
        this.malformed = options.fatal || (options.malformed ?? false)
        this.messageId = options.messageId
        this.operation = options.operation
    }
}
