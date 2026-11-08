import {LDAPException} from './LDAPException.js'

/**
 * A connection that cannot be made, or that is lost: the operations waiting on it fail with this exception. `code` is
 * the code of the system when there is one (`'ECONNREFUSED'`, `'ECONNRESET'`…).
 */
export class LDAPConnectionException extends LDAPException {
    /**
     * The code of the system, when there is one
     */
    public readonly code: string | undefined

    /**
     * @param message What happened.
     * @param code The code of the system.
     */
    constructor(message: string, code?: string) {
        super('E_LDAP_CONNECTION', message)
        this.code = code
    }
}
