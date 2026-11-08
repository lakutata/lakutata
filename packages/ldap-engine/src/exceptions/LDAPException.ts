/**
 * The base of the exceptions of the package: an `Error` with an `errno` naming its kind
 * @example
 * ```typescript
 * import {Filter, LDAPException} from '@lakutata/ldap-engine'
 *
 * try {
 *     Filter.parse('(cn=a')
 * } catch (error) {
 *     if (error instanceof LDAPException) console.log(error.errno)
 * }
 * ```
 */
export class LDAPException extends Error {
    /**
     * The kind of the error, as the exceptions of lakutata name theirs
     */
    public readonly errno: string

    /**
     * @param errno The kind of the error.
     * @param message The message.
     */
    constructor(errno: string, message: string) {
        super(message)
        this.name = new.target.name
        this.errno = errno
    }
}
