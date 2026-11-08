import {LDAPException} from './LDAPException.js'

/**
 * A schema that cannot be used: a definition that cannot be parsed, a name or an OID defined twice (the two places
 * named), a reference to a type, a class or a rule that is not defined
 */
export class LDAPSchemaException extends LDAPException {
    /**
     * @param message What is wrong.
     */
    constructor(message: string) {
        super('E_LDAP_SCHEMA', message)
    }
}
