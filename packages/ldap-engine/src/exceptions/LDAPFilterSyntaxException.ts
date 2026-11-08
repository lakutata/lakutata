import {LDAPException} from './LDAPException.js'

/**
 * A search filter written in text (RFC 4515) that cannot be parsed
 */
export class LDAPFilterSyntaxException extends LDAPException {
    /**
     * Where in the text the error is
     */
    public readonly position: number

    /**
     * @param message What is wrong.
     * @param position Where in the text.
     */
    constructor(message: string, position: number) {
        super('E_LDAP_FILTER', message)
        this.position = position
    }
}
