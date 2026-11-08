import type {Entry} from '../lib/client/Entry.js'
import type {Control} from '../lib/controls/Control.js'
import type {LDAPResult} from '../lib/protocol/Messages.js'
import {ResultCode, resultCodeName} from '../lib/protocol/ResultCode.js'
import {LDAPException} from './LDAPException.js'

/**
 * The details of a result an exception carries
 */
export interface LDAPResultDetails {
    /**
     * The DN of the last entry found on the way to the one named
     */
    matchedDN?: string
    /**
     * The message of the server
     */
    diagnosticMessage?: string
    /**
     * The LDAP URLs of other servers, with `referral`
     */
    referral?: string[]
    /**
     * The controls of the response (the password policy control of a failed bind…)
     */
    controls?: Control[]
}

/**
 * An operation that ended with a result code other than success: thrown by the client for the result of the server,
 * and thrown by the handlers of a server to answer with that code. The common codes have a subclass of their own;
 * `code` tells them all apart.
 * @example
 * ```typescript
 * import {LDAPNoSuchObjectException, LDAPResultException, ResultCode} from '@lakutata/ldap-engine'
 *
 * try {
 *     throw new LDAPNoSuchObjectException('No such entry', {matchedDN: 'dc=example,dc=com'})
 * } catch (error) {
 *     if (error instanceof LDAPResultException && error.code === ResultCode.noSuchObject) console.log(error.matchedDN)
 * }
 * ```
 */
export class LDAPResultException extends LDAPException {
    /**
     * The result code (see `ResultCode`)
     */
    public readonly code: number

    /**
     * The DN of the last entry found on the way to the one named; empty when there is none
     */
    public readonly matchedDN: string

    /**
     * The message of the server; empty when there is none
     */
    public readonly diagnosticMessage: string

    /**
     * The LDAP URLs of other servers, with `referral`
     */
    public readonly referral: string[] | undefined

    /**
     * The controls of the response
     */
    public readonly controls: Control[]

    /**
     * The sub-code Active Directory puts in its message (`data 52e`: invalid credentials, `data 775`: locked…), as
     * lower-case hex, when there is one
     */
    public readonly adDataCode: string | undefined

    /**
     * @param code The result code.
     * @param message The message; the name of the code by default.
     * @param details The matched DN, the message of the server, the referral and the controls.
     */
    constructor(code: number, message?: string, details: LDAPResultDetails = {}) {
        super(`E_LDAP_${resultCodeName(code).replace(/[A-Z]/g, (letter: string): string => '_' + letter).toUpperCase()}`, message ?? (details.diagnosticMessage || resultCodeName(code)))
        this.code = code
        this.matchedDN = details.matchedDN ?? ''
        this.diagnosticMessage = details.diagnosticMessage ?? ''
        this.referral = details.referral
        this.controls = details.controls ?? []
        this.adDataCode = /\bdata ([0-9a-f]+)\b/i.exec(this.diagnosticMessage)?.[1].toLowerCase()
    }

    /**
     * The name of the result code (`'noSuchObject'`)
     */
    public get codeName(): string {
        return resultCodeName(this.code)
    }
}

/**
 * The entry named does not exist (32); `matchedDN` is the last one found on the way
 */
export class LDAPNoSuchObjectException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The matched DN and the other details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.noSuchObject, message, details)
    }
}

/**
 * A bind with a name or a password that is not right (49), or to an entry that does not exist
 */
export class LDAPInvalidCredentialsException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.invalidCredentials, message, details)
    }
}

/**
 * The identity of the session may not do the operation (50)
 */
export class LDAPInsufficientAccessException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.insufficientAccessRights, message, details)
    }
}

/**
 * The entry to add, or the new name of an entry, exists already (68)
 */
export class LDAPEntryAlreadyExistsException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.entryAlreadyExists, message, details)
    }
}

/**
 * An entry with children cannot be deleted (66) without the tree delete control
 */
export class LDAPNotAllowedOnNonLeafException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.notAllowedOnNonLeaf, message, details)
    }
}

/**
 * A value breaks a constraint (19): too many values of a single-valued attribute, a value refused by a policy…
 */
export class LDAPConstraintViolationException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.constraintViolation, message, details)
    }
}

/**
 * The entry would not follow its object classes (65): a required attribute missing, an attribute not allowed
 */
export class LDAPObjectClassViolationException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.objectClassViolation, message, details)
    }
}

/**
 * The attribute, or the value to delete, is not there (16)
 */
export class LDAPNoSuchAttributeException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.noSuchAttribute, message, details)
    }
}

/**
 * The value to add is there already (20)
 */
export class LDAPAttributeOrValueExistsException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.attributeOrValueExists, message, details)
    }
}

/**
 * A DN that is not one (34)
 */
export class LDAPInvalidDNSyntaxException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.invalidDNSyntax, message, details)
    }
}

/**
 * A value that does not follow the syntax of its attribute (21)
 */
export class LDAPInvalidAttributeSyntaxException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.invalidAttributeSyntax, message, details)
    }
}

/**
 * The server will not do the operation (53): an unauthenticated bind, an operation it does not support…
 */
export class LDAPUnwillingToPerformException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.unwillingToPerform, message, details)
    }
}

/**
 * The operation needs a stronger authentication, or TLS (8)
 */
export class LDAPStrongerAuthRequiredException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.strongerAuthRequired, message, details)
    }
}

/**
 * The search found more entries than a size limit (4). The client throws it when the limit is the server's own (the
 * search asked for none), with the entries before it in `partial`; a limit the search asked for is a result instead.
 */
export class LDAPSizeLimitExceededException extends LDAPResultException {
    /**
     * The entries returned before the limit, when the client threw it
     */
    public partial: Entry[] | undefined

    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.sizeLimitExceeded, message, details)
    }
}

/**
 * The operation took longer than its time limit on the server (3)
 */
export class LDAPTimeLimitExceededException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.timeLimitExceeded, message, details)
    }
}

/**
 * The server is busy (51) or unavailable (52): another server, or a later try, may do it
 */
export class LDAPUnavailableException extends LDAPResultException {
    /**
     * @param code `busy` or `unavailable`.
     * @param message The message.
     * @param details The details.
     */
    constructor(code: number = ResultCode.unavailable, message?: string, details?: LDAPResultDetails) {
        super(code, message, details)
    }
}

/**
 * The server sends the client to other servers (10); `referral` holds their LDAP URLs
 */
export class LDAPReferralException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The referral and the other details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.referral, message, details)
    }
}

/**
 * The request broke the protocol (2): a malformed message, an operation or a version the server does not support
 */
export class LDAPProtocolErrorException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.protocolError, message, details)
    }
}

/**
 * A critical control the server does not support, or cannot apply to the operation (12)
 */
export class LDAPUnavailableCriticalExtensionException extends LDAPResultException {
    /**
     * @param message The message.
     * @param details The details.
     */
    constructor(message?: string, details?: LDAPResultDetails) {
        super(ResultCode.unavailableCriticalExtension, message, details)
    }
}

const CLASSES: Map<number, new (message?: string, details?: LDAPResultDetails) => LDAPResultException> = new Map<number, new (message?: string, details?: LDAPResultDetails) => LDAPResultException>([
    [ResultCode.noSuchObject, LDAPNoSuchObjectException],
    [ResultCode.invalidCredentials, LDAPInvalidCredentialsException],
    [ResultCode.insufficientAccessRights, LDAPInsufficientAccessException],
    [ResultCode.entryAlreadyExists, LDAPEntryAlreadyExistsException],
    [ResultCode.notAllowedOnNonLeaf, LDAPNotAllowedOnNonLeafException],
    [ResultCode.constraintViolation, LDAPConstraintViolationException],
    [ResultCode.objectClassViolation, LDAPObjectClassViolationException],
    [ResultCode.noSuchAttribute, LDAPNoSuchAttributeException],
    [ResultCode.attributeOrValueExists, LDAPAttributeOrValueExistsException],
    [ResultCode.invalidDNSyntax, LDAPInvalidDNSyntaxException],
    [ResultCode.invalidAttributeSyntax, LDAPInvalidAttributeSyntaxException],
    [ResultCode.unwillingToPerform, LDAPUnwillingToPerformException],
    [ResultCode.strongerAuthRequired, LDAPStrongerAuthRequiredException],
    [ResultCode.sizeLimitExceeded, LDAPSizeLimitExceededException],
    [ResultCode.timeLimitExceeded, LDAPTimeLimitExceededException],
    [ResultCode.referral, LDAPReferralException],
    [ResultCode.protocolError, LDAPProtocolErrorException],
    [ResultCode.unavailableCriticalExtension, LDAPUnavailableCriticalExtensionException]
])

/**
 * The exception of a result: the subclass of its code, or `LDAPResultException`
 * @param result The result.
 * @param controls The controls of the response.
 * @example
 * ```typescript
 * import {LDAPInvalidCredentialsException, resultException} from '@lakutata/ldap-engine'
 *
 * const error = resultException({resultCode: 49, matchedDN: '', diagnosticMessage: '80090308: LdapErr: DSID-0C09042A, comment: AcceptSecurityContext error, data 52e, v3839'})
 * console.log(error instanceof LDAPInvalidCredentialsException, error.adDataCode) //true 52e
 * ```
 */
export function resultException(result: LDAPResult, controls?: Control[]): LDAPResultException {
    const details: LDAPResultDetails = {matchedDN: result.matchedDN, diagnosticMessage: result.diagnosticMessage, referral: result.referral, controls: controls}
    if (result.resultCode === ResultCode.busy || result.resultCode === ResultCode.unavailable) return new LDAPUnavailableException(result.resultCode, undefined, details)
    if (result.resultCode === ResultCode.confidentialityRequired) return new LDAPResultException(result.resultCode, undefined, details)
    const Exception: (new (message?: string, details?: LDAPResultDetails) => LDAPResultException) | undefined = CLASSES.get(result.resultCode)
    return Exception ? new Exception(undefined, details) : new LDAPResultException(result.resultCode, undefined, details)
}
