import {LDAPException} from './LDAPException.js'

/**
 * A DN (RFC 4514) that cannot be parsed; a server answers it with `invalidDNSyntax`
 */
export class LDAPDNSyntaxException extends LDAPException {
    /**
     * Where in the text the error is
     */
    public readonly position: number

    /**
     * @param message What is wrong.
     * @param position Where in the text.
     */
    constructor(message: string, position: number) {
        super('E_LDAP_DN', message)
        this.position = position
    }
}
