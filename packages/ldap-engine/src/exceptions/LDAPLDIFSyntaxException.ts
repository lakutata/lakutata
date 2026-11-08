import {LDAPException} from './LDAPException.js'

/**
 * An LDIF text (RFC 2849) that cannot be parsed
 */
export class LDAPLDIFSyntaxException extends LDAPException {
    /**
     * The line of the error (1 for the first)
     */
    public readonly line: number

    /**
     * @param message What is wrong.
     * @param line The line.
     */
    constructor(message: string, line: number) {
        super('E_LDAP_LDIF', `${message} (line ${line})`)
        this.line = line
    }
}
