/**
 * The result codes of LDAP: RFC 4511 §4.1.9 and Appendix A, Cancel (RFC 3909), Assertion (RFC 4528), Proxied
 * Authorization (RFC 4370), Content Synchronization (RFC 4533) and the virtual list view draft. The codes are
 * extensible (RFC 4520): a code not listed here is kept as its number.
 */
export const ResultCode = {
    success: 0,
    operationsError: 1,
    protocolError: 2,
    timeLimitExceeded: 3,
    sizeLimitExceeded: 4,
    compareFalse: 5,
    compareTrue: 6,
    authMethodNotSupported: 7,
    strongerAuthRequired: 8,
    referral: 10,
    adminLimitExceeded: 11,
    unavailableCriticalExtension: 12,
    confidentialityRequired: 13,
    saslBindInProgress: 14,
    noSuchAttribute: 16,
    undefinedAttributeType: 17,
    inappropriateMatching: 18,
    constraintViolation: 19,
    attributeOrValueExists: 20,
    invalidAttributeSyntax: 21,
    noSuchObject: 32,
    aliasProblem: 33,
    invalidDNSyntax: 34,
    aliasDereferencingProblem: 36,
    inappropriateAuthentication: 48,
    invalidCredentials: 49,
    insufficientAccessRights: 50,
    busy: 51,
    unavailable: 52,
    unwillingToPerform: 53,
    loopDetect: 54,
    sortControlMissing: 60,
    offsetRangeError: 61,
    namingViolation: 64,
    objectClassViolation: 65,
    notAllowedOnNonLeaf: 66,
    notAllowedOnRDN: 67,
    entryAlreadyExists: 68,
    objectClassModsProhibited: 69,
    affectsMultipleDSAs: 71,
    virtualListViewError: 76,
    other: 80,
    canceled: 118,
    noSuchOperation: 119,
    tooLate: 120,
    cannotCancel: 121,
    assertionFailed: 122,
    authorizationDenied: 123,
    eSyncRefreshRequired: 4096
} as const

const NAMES: Map<number, string> = new Map(Object.entries(ResultCode).map(([name, code]: [string, number]): [number, string] => [code, name]))

/**
 * The name of a result code (`'noSuchObject'` for 32), or its number as text when it is not a known one
 * @param code The result code.
 * @example
 * ```typescript
 * import {resultCodeName} from '@lakutata/ldap-engine'
 *
 * console.log(resultCodeName(49)) //invalidCredentials
 * ```
 */
export function resultCodeName(code: number): string {
    return NAMES.get(code) ?? String(code)
}
