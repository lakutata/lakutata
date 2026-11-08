import {LDAPException} from './LDAPException.js'

/**
 * An operation, or a connection, that took longer than its timeout. An operation that times out is abandoned on the
 * server; the connection goes on.
 */
export class LDAPTimeoutException extends LDAPException {
    /**
     * @param message What took too long.
     */
    constructor(message: string) {
        super('E_LDAP_TIMEOUT', message)
    }
}
