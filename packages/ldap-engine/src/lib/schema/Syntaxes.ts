import {isUTF8} from '../ber/Ber.js'
import {parseGeneralizedTime} from './MatchingRules.js'

/**
 * A syntax as code: its OID, its description, whether its values are binary, and how a value is checked
 */
export interface Syntax {
    /**
     * The OID of the syntax
     */
    oid: string
    /**
     * Its description (`Directory String`)
     */
    description: string
    /**
     * Whether its values are bytes rather than text (a client reads them as Buffers, and `;binary` applies to the
     * certificates)
     */
    binary: boolean
    /**
     * Whether a value is valid for the syntax; without it, every value is
     * @param value The value.
     */
    validate?(value: Buffer): boolean
}

const PREFIX: string = '1.3.6.1.4.1.1466.115.121.1.'

/**
 * Whether a value is non-empty UTF-8
 * @param value The value.
 */
function utf8(value: Buffer): boolean {
    return value.length > 0 && isUTF8(value)
}

/**
 * Whether a value is non-empty ASCII matching a pattern
 * @param pattern The pattern.
 */
function ascii(pattern: RegExp): (value: Buffer) => boolean {
    return (value: Buffer): boolean => value.length > 0 && !value.some((byte: number): boolean => byte >= 0x80) && pattern.test(value.toString('latin1'))
}

//An OID, or a name (descr), as RFC 4512 §1.4 writes them
const OID: RegExp = /^([0-9]+(\.[0-9]+)+|[A-Za-z][A-Za-z0-9-]*)$/

/**
 * The syntaxes of RFC 4517 and RFC 4530 the package knows. The DNs and the names and optional UIDs are checked by
 * parsing them, which the schema does.
 */
export const STANDARD_SYNTAXES: Syntax[] = [
    {oid: PREFIX + '3', description: 'Attribute Type Description', binary: false, validate: utf8},
    {oid: PREFIX + '4', description: 'Audio', binary: true},
    {oid: PREFIX + '5', description: 'Binary', binary: true},
    {oid: PREFIX + '6', description: 'Bit String', binary: false, validate: ascii(/^'[01]*'B$/)},
    {oid: PREFIX + '7', description: 'Boolean', binary: false, validate: ascii(/^(TRUE|FALSE)$/)},
    {oid: PREFIX + '8', description: 'Certificate', binary: true},
    {oid: PREFIX + '9', description: 'Certificate List', binary: true},
    {oid: PREFIX + '10', description: 'Certificate Pair', binary: true},
    {oid: PREFIX + '11', description: 'Country String', binary: false, validate: ascii(/^[A-Za-z0-9 '()+,./:=?-]{2}$/)},
    {oid: PREFIX + '12', description: 'DN', binary: false, validate: (value: Buffer): boolean => isUTF8(value)},
    {oid: PREFIX + '13', description: 'Data Quality', binary: false, validate: utf8},
    {oid: PREFIX + '14', description: 'Delivery Method', binary: false, validate: utf8},
    {oid: PREFIX + '15', description: 'Directory String', binary: false, validate: utf8},
    {oid: PREFIX + '16', description: 'DIT Content Rule Description', binary: false, validate: utf8},
    {oid: PREFIX + '17', description: 'DIT Structure Rule Description', binary: false, validate: utf8},
    {oid: PREFIX + '19', description: 'DSA Quality', binary: false, validate: utf8},
    {oid: PREFIX + '21', description: 'Enhanced Guide', binary: false, validate: utf8},
    {oid: PREFIX + '22', description: 'Facsimile Telephone Number', binary: false, validate: utf8},
    {oid: PREFIX + '23', description: 'Fax', binary: true},
    {oid: PREFIX + '24', description: 'Generalized Time', binary: false, validate: (value: Buffer): boolean => isUTF8(value) && parseGeneralizedTime(value.toString('utf8')) !== undefined},
    {oid: PREFIX + '25', description: 'Guide', binary: false, validate: utf8},
    {oid: PREFIX + '26', description: 'IA5 String', binary: false, validate: (value: Buffer): boolean => !value.some((byte: number): boolean => byte >= 0x80)},
    {oid: PREFIX + '27', description: 'INTEGER', binary: false, validate: ascii(/^-?(0|[1-9][0-9]*)$/)},
    {oid: PREFIX + '28', description: 'JPEG', binary: true},
    {oid: PREFIX + '30', description: 'Matching Rule Description', binary: false, validate: utf8},
    {oid: PREFIX + '31', description: 'Matching Rule Use Description', binary: false, validate: utf8},
    {oid: PREFIX + '34', description: 'Name And Optional UID', binary: false, validate: (value: Buffer): boolean => isUTF8(value)},
    {oid: PREFIX + '35', description: 'Name Form Description', binary: false, validate: utf8},
    {oid: PREFIX + '36', description: 'Numeric String', binary: false, validate: ascii(/^[0-9 ]+$/)},
    {oid: PREFIX + '37', description: 'Object Class Description', binary: false, validate: utf8},
    {oid: PREFIX + '38', description: 'OID', binary: false, validate: ascii(OID)},
    {oid: PREFIX + '39', description: 'Other Mailbox', binary: false, validate: utf8},
    {oid: PREFIX + '40', description: 'Octet String', binary: true},
    {oid: PREFIX + '41', description: 'Postal Address', binary: false, validate: utf8},
    {oid: PREFIX + '42', description: 'Protocol Information', binary: false, validate: utf8},
    {oid: PREFIX + '43', description: 'Presentation Address', binary: false, validate: utf8},
    {oid: PREFIX + '44', description: 'Printable String', binary: false, validate: ascii(/^[A-Za-z0-9 '()+,./:=?-]+$/)},
    {oid: PREFIX + '49', description: 'Supported Algorithm', binary: true},
    {oid: PREFIX + '50', description: 'Telephone Number', binary: false, validate: ascii(/^[A-Za-z0-9 '()+,./:=?-]+$/)},
    {oid: PREFIX + '51', description: 'Teletex Terminal Identifier', binary: false, validate: utf8},
    {oid: PREFIX + '52', description: 'Telex Number', binary: false, validate: utf8},
    {oid: PREFIX + '53', description: 'UTC Time', binary: false, validate: utf8},
    {oid: PREFIX + '54', description: 'LDAP Syntax Description', binary: false, validate: utf8},
    {oid: PREFIX + '58', description: 'Substring Assertion', binary: false, validate: utf8},
    //The authorization rules of OpenLDAP (olcAuthzRegexp and the authzTo/authzFrom attributes of its core schema)
    {oid: '1.3.6.1.4.1.4203.666.2.7', description: 'OpenLDAP authz', binary: false, validate: utf8},
    {oid: '1.3.6.1.1.16.1', description: 'UUID', binary: false, validate: ascii(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/)}
]
