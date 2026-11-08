import {LDAPException} from './LDAPException.js'

/**
 * A message that cannot be decoded. When `fatal` is true the stream cannot go on (the message could not be framed, or
 * its message ID could not be read): the session ends, after a Notice of Disconnection from a server. Otherwise the
 * message ID and the operation are known, and a server answers that operation with `protocolError`.
 */
export class LDAPDecodeException extends LDAPException {
    /**
     * Whether the session cannot go on
     */
    public readonly fatal: boolean

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
     * @param options Whether it is fatal, the message ID and the operation when they are known.
     */
    constructor(message: string, options: {fatal: boolean, messageId?: number, operation?: string}) {
        super('E_LDAP_DECODE', message)
        this.fatal = options.fatal
        this.messageId = options.messageId
        this.operation = options.operation
    }
}
