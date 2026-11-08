import {LDAPException} from './LDAPException.js'

/**
 * A use of the client the protocol or its safety does not allow: an empty password to `bind()` (an unauthenticated
 * bind, which many servers take as a success), StartTLS while operations are outstanding, an operation on a closed
 * connection. Nothing is sent to the server.
 */
export class LDAPUsageException extends LDAPException {
    /**
     * @param message What is not allowed.
     */
    constructor(message: string) {
        super('E_LDAP_USAGE', message)
    }
}
