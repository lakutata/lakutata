import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {DN} from '../dn/DN.js'
import type {LDAPConnection, OperationOptions, OperationResult} from './Connection.js'

/**
 * The text of an objectGUID of Active Directory (16 bytes, the first three fields little-endian, MS-DTYP 2.3.4.2), in
 * the form of a UUID: `3b2118fd-c4a6-4ffd-9a8e-7cfa3f2a0f11`
 * @param guid The 16 bytes.
 * @example
 * ```typescript
 * import {guidToString, stringToGuid} from '@lakutata/ldap-engine'
 *
 * const text: string = guidToString(Buffer.from('fd18213ba6c4fd4f9a8e7cfa3f2a0f11', 'hex'))
 * console.log(text, stringToGuid(text).toString('hex')) //3b2118fd-c4a6-4ffd-9a8e-7cfa3f2a0f11 fd18213ba6c4fd4f9a8e7cfa3f2a0f11
 * ```
 */
export function guidToString(guid: Buffer): string {
    if (guid.length !== 16) throw new LDAPUsageException(`An objectGUID has 16 bytes, not ${guid.length}`)
    const hex: (start: number, end: number) => string = (start: number, end: number): string => guid.subarray(start, end).toString('hex')
    const reversed: (start: number, end: number) => string = (start: number, end: number): string => Buffer.from(guid.subarray(start, end)).reverse().toString('hex')
    return `${reversed(0, 4)}-${reversed(4, 6)}-${reversed(6, 8)}-${hex(8, 10)}-${hex(10, 16)}`
}

/**
 * The 16 bytes of an objectGUID from its text, with or without braces; search for it with `Filter.equal('objectGUID',
 * stringToGuid(text))`, which escapes the bytes
 * @param text The text.
 * @example
 * ```typescript
 * import {Filter, stringToGuid} from '@lakutata/ldap-engine'
 *
 * console.log(Filter.stringify(Filter.equal('objectGUID', stringToGuid('{3b2118fd-c4a6-4ffd-9a8e-7cfa3f2a0f11}'))))
 * ```
 */
export function stringToGuid(text: string): Buffer {
    const match: RegExpExecArray | null = /^\{?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}?$/i.exec(text.trim())
    if (!match) throw new LDAPUsageException(`${text} is not a GUID`)
    const reversed: (hex: string) => Buffer = (hex: string): Buffer => Buffer.from(hex, 'hex').reverse()
    return Buffer.concat([reversed(match[1]), reversed(match[2]), reversed(match[3]), Buffer.from(match[4], 'hex'), Buffer.from(match[5], 'hex')])
}

/**
 * The text of a security identifier (objectSid, MS-DTYP 2.4.2): `S-1-5-21-…`
 * @param sid The bytes.
 * @example
 * ```typescript
 * import {sidToString, stringToSid} from '@lakutata/ldap-engine'
 *
 * console.log(sidToString(stringToSid('S-1-5-21-3623811015-3361044348-30300820-1013'))) //S-1-5-21-3623811015-3361044348-30300820-1013
 * ```
 */
export function sidToString(sid: Buffer): string {
    if (sid.length < 8 || sid.length !== 8 + sid[1] * 4) throw new LDAPUsageException('Not a security identifier')
    const authority: number = sid.readUIntBE(2, 6)
    const parts: string[] = ['S', String(sid[0]), authority >= 2 ** 32 ? '0x' + sid.subarray(2, 8).toString('hex') : String(authority)]
    for (let index: number = 0; index < sid[1]; index++) parts.push(String(sid.readUInt32LE(8 + index * 4)))
    return parts.join('-')
}

/**
 * The bytes of a security identifier from its text
 * @param text The text: `S-1-5-21-…`.
 * @example
 * ```typescript
 * import {stringToSid} from '@lakutata/ldap-engine'
 *
 * console.log(stringToSid('S-1-5-32-544').toString('hex')) //01020000000000052000000020020000
 * ```
 */
export function stringToSid(text: string): Buffer {
    const match: RegExpExecArray | null = /^S-(\d+)-(0x[0-9a-f]{12}|\d+)((?:-\d+)*)$/i.exec(text.trim())
    if (!match) throw new LDAPUsageException(`${text} is not a security identifier`)
    const subAuthorities: number[] = match[3] ? match[3].slice(1).split('-').map(Number) : []
    const bytes: Buffer = Buffer.alloc(8 + subAuthorities.length * 4)
    bytes[0] = Number(match[1])
    bytes[1] = subAuthorities.length
    bytes.writeUIntBE(match[2].startsWith('0x') ? parseInt(match[2], 16) : Number(match[2]), 2, 6)
    subAuthorities.forEach((value: number, index: number): number => bytes.writeUInt32LE(value, 8 + index * 4))
    return bytes
}

/**
 * The flags of userAccountControl (KB 305144)
 */
export const UserAccountControl = {
    script: 0x1,
    accountDisable: 0x2,
    homeDirRequired: 0x8,
    lockout: 0x10,
    passwordNotRequired: 0x20,
    passwordCannotChange: 0x40,
    encryptedTextPasswordAllowed: 0x80,
    tempDuplicateAccount: 0x100,
    normalAccount: 0x200,
    interdomainTrustAccount: 0x800,
    workstationTrustAccount: 0x1000,
    serverTrustAccount: 0x2000,
    dontExpirePassword: 0x10000,
    mnsLogonAccount: 0x20000,
    smartcardRequired: 0x40000,
    trustedForDelegation: 0x80000,
    notDelegated: 0x100000,
    useDESKeyOnly: 0x200000,
    dontRequirePreauth: 0x400000,
    passwordExpired: 0x800000,
    trustedToAuthForDelegation: 0x1000000,
    partialSecretsAccount: 0x4000000
} as const

/**
 * The flags set in a userAccountControl value (or msDS-User-Account-Control-Computed, where Active Directory reports
 * the lockout and the expired password since Windows Server 2003), by the names of `UserAccountControl`
 * @param value The value, as a number or as its text.
 * @example
 * ```typescript
 * import {parseUserAccountControl} from '@lakutata/ldap-engine'
 *
 * const flags = parseUserAccountControl('514')
 * console.log(flags.accountDisable, flags.normalAccount) //true true
 * ```
 */
export function parseUserAccountControl(value: number | string): Record<keyof typeof UserAccountControl, boolean> {
    const number: number = typeof value === 'string' ? Number(value) : value
    return Object.fromEntries(Object.entries(UserAccountControl).map(([name, flag]: [string, number]): [string, boolean] => [name, (number & flag) !== 0])) as Record<keyof typeof UserAccountControl, boolean>
}

/**
 * The date of a FILETIME of Active Directory (pwdLastSet, accountExpires, lastLogonTimestamp: hundreds of nanoseconds
 * since 1601); undefined for 0 and for the largest value, which mean never
 * @param value The value, as its text or as a bigint.
 * @example
 * ```typescript
 * import {fileTimeToDate} from '@lakutata/ldap-engine'
 *
 * console.log(fileTimeToDate('133800000000000000')?.toISOString())
 * ```
 */
export function fileTimeToDate(value: string | bigint): Date | undefined {
    const number: bigint = typeof value === 'bigint' ? value : BigInt(value.trim())
    if (number <= 0n || number >= 9223372036854775807n) return undefined
    return new Date(Number(number / 10000n - 11644473600000n))
}

/**
 * The value of unicodePwd for a password: the password in double quotes, in UTF-16LE (MS-ADTS 3.1.1.3.1.5.1)
 * @param password The password.
 * @example
 * ```typescript
 * import {adPasswordValue} from '@lakutata/ldap-engine'
 *
 * console.log(adPasswordValue('a').toString('hex')) //220061002200
 * ```
 */
export function adPasswordValue(password: string): Buffer {
    return Buffer.from(`"${password}"`, 'utf16le')
}

/**
 * Change one's own password in Active Directory: unicodePwd deleted with the old one and added with the new one, in
 * one modify. Active Directory accepts it over TLS only (LDAPS or StartTLS), and checks the password policy.
 * @param connection The connection, bound as the user.
 * @param dn The DN of the user.
 * @param oldPassword The current password.
 * @param newPassword The new password.
 * @param options The options of the operation.
 * @example
 * ```typescript
 * import {changeADPassword, connectLDAP} from '@lakutata/ldap-engine'
 *
 * async function change(): Promise<void> {
 *     const connection = await connectLDAP({url: 'ldaps://dc1.example.com'})
 *     await connection.bind('alice@example.com', 'old password')
 *     await changeADPassword(connection, 'CN=Alice,OU=Staff,DC=example,DC=com', 'old password', 'new password')
 *     await connection.close()
 * }
 * ```
 */
export function changeADPassword(connection: LDAPConnection, dn: string | DN, oldPassword: string, newPassword: string, options?: OperationOptions): Promise<OperationResult> {
    return connection.modify(dn, [
        {operation: 'delete', attribute: 'unicodePwd', values: [adPasswordValue(oldPassword)]},
        {operation: 'add', attribute: 'unicodePwd', values: [adPasswordValue(newPassword)]}
    ], options)
}

/**
 * Reset a user's password in Active Directory, as an administrator: unicodePwd replaced. Over TLS only.
 * @param connection The connection, bound as an administrator.
 * @param dn The DN of the user.
 * @param newPassword The new password.
 * @param options The options of the operation.
 * @example
 * ```typescript
 * import {connectLDAP, resetADPassword} from '@lakutata/ldap-engine'
 *
 * async function reset(): Promise<void> {
 *     const connection = await connectLDAP({url: 'ldaps://dc1.example.com'})
 *     await connection.bind('admin@example.com', 'secret')
 *     await resetADPassword(connection, 'CN=Alice,OU=Staff,DC=example,DC=com', 'temporary password')
 *     await connection.close()
 * }
 * ```
 */
export function resetADPassword(connection: LDAPConnection, dn: string | DN, newPassword: string, options?: OperationOptions): Promise<OperationResult> {
    return connection.modify(dn, {operation: 'replace', attribute: 'unicodePwd', values: [adPasswordValue(newPassword)]}, options)
}
