import {LDAPDNSyntaxException} from '../../exceptions/LDAPDNSyntaxException.js'
import {BerReader, isUTF8} from '../ber/Ber.js'
import {prepareString} from '../schema/StringPrep.js'

/**
 * An attribute and its value in an RDN (`cn=Alice`)
 */
export interface AttributeTypeAndValue {
    /**
     * The attribute type, as written: a name or an OID
     */
    type: string
    /**
     * The value as text; for a value written as its BER (`#0403616263`), the text it holds
     */
    value: string
    /**
     * The BER of a value written as `#` and its hex bytes
     */
    binary?: Buffer
}

/**
 * What compares DNs: the names of the attribute types made one (`cn` and `commonName`), and the values prepared by the
 * attribute's equality rule. A `Schema` is one; without one, the types compare without case and the values as
 * `caseIgnoreMatch` compares them.
 */
export interface DNNormalizer {
    /**
     * The name an attribute type compares by
     * @param type The type, as written.
     */
    normalizeType(type: string): string

    /**
     * The prepared form of a value, undefined when it is not valid for its attribute
     * @param type The type, as written.
     * @param value The attribute and its value.
     */
    prepareValue(type: string, value: AttributeTypeAndValue): string | undefined
}

/**
 * The options of the parsing of a DN
 */
export interface DNParseOptions {
    /**
     * Refuse what RFC 4514 does not allow: spaces around the separators, unescaped trailing spaces, `"`, `<` and `>` in
     * values, `;` separating the RDNs (RFC 2253), `_` in attribute names. By default they are accepted, as many
     * directories write DNs with spaces after the commas (`cn=a, dc=example, dc=com`); the DN is written back strictly.
     */
    strict?: boolean
}

const DEFAULT_NORMALIZER: DNNormalizer = {
    normalizeType: (type: string): string => type.toLowerCase(),
    prepareValue: (type: string, value: AttributeTypeAndValue): string | undefined => prepareString(value.value, true)
}

const HEX: string = '0123456789abcdef'

/**
 * Escape a value for the text of a DN (RFC 4514 §2.4): `\`, `"`, `+`, `,`, `;`, `<`, `>`, a leading space or `#`, a
 * trailing space, and NUL
 * @param value The value.
 * @example
 * ```typescript
 * import {escapeDNValue} from '@lakutata/ldap-engine'
 *
 * console.log(`cn=${escapeDNValue('Liu, Alice')},dc=example,dc=com`) //cn=Liu\, Alice,dc=example,dc=com
 * ```
 */
export function escapeDNValue(value: string): string {
    let result: string = ''
    for (let index: number = 0; index < value.length; index++) {
        const character: string = value[index]
        const code: number = character.charCodeAt(0)
        if (code === 0) {
            result += '\\00'
        } else if (code < 0x20 || code === 0x7f) {
            result += '\\' + HEX[code >> 4] + HEX[code & 0x0f]
        } else if ('\\"+,;<>'.includes(character) || (index === 0 && (character === ' ' || character === '#')) || (index === value.length - 1 && character === ' ')) {
            result += '\\' + character
        } else {
            result += character
        }
    }
    return result
}

/**
 * The text a BER value holds: the content of a string type, or of an OCTET STRING holding text
 * @param binary The BER.
 */
function textOfBER(binary: Buffer): string {
    try {
        const reader: BerReader = new BerReader(binary)
        const {end} = reader.header()
        const content: Buffer = binary.subarray(reader.offset, end)
        if (end === binary.length && isUTF8(content)) return content.toString('utf8')
    } catch {
        //Not BER: the bytes as they are
    }
    return binary.toString('latin1')
}

/**
 * A relative distinguished name: one attribute and its value, or several joined by `+`
 * @example
 * ```typescript
 * import {RDN} from '@lakutata/ldap-engine'
 *
 * const rdn: RDN = RDN.parse('cn=Alice+uid=alice')
 * console.log(rdn.get('uid'), rdn.toString()) //alice cn=Alice+uid=alice
 * ```
 */
export class RDN {
    /**
     * Its attributes and their values
     */
    public readonly attributes: readonly AttributeTypeAndValue[]

    /**
     * @param attributes Its attributes and their values; at least one.
     */
    constructor(attributes: AttributeTypeAndValue[]) {
        if (!attributes.length) throw new LDAPDNSyntaxException('An RDN without an attribute', 0)
        this.attributes = Object.freeze(attributes.slice())
    }

    /**
     * Parse an RDN
     * @param text The text: `cn=Alice`.
     * @param options Whether to refuse what RFC 4514 does not allow.
     */
    public static parse(text: string, options: DNParseOptions = {}): RDN {
        const dn: DN = DN.parse(text, options)
        if (dn.length !== 1) throw new LDAPDNSyntaxException(`"${text}" is not one RDN`, 0)
        return dn.rdns[0]
    }

    /**
     * The value of an attribute of the RDN, the type compared without case
     * @param type The attribute type.
     */
    public get(type: string): string | undefined {
        const lower: string = type.toLowerCase()
        return this.attributes.find((attribute: AttributeTypeAndValue): boolean => attribute.type.toLowerCase() === lower)?.value
    }

    /**
     * The text of the RDN (RFC 4514)
     */
    public toString(): string {
        return this.attributes.map((attribute: AttributeTypeAndValue): string => `${attribute.type}=${attribute.binary ? '#' + attribute.binary.toString('hex') : escapeDNValue(attribute.value)}`).join('+')
    }

    /**
     * The form the RDN compares by: its attributes normalized and sorted
     * @param normalizer What normalizes the types and the values.
     */
    public key(normalizer: DNNormalizer = DEFAULT_NORMALIZER): string {
        //The RDN does not change: its key is kept for the last normalizer (a schema does not change once used)
        if (this.keyCache?.normalizer === normalizer) return this.keyCache.key
        const key: string = this.attributes
            .map((attribute: AttributeTypeAndValue): string => `${normalizer.normalizeType(attribute.type)}=${escapeDNValue(normalizer.prepareValue(attribute.type, attribute) ?? attribute.value)}`)
            .sort()
            .join('+')
        this.keyCache = {normalizer: normalizer, key: key}
        return key
    }

    /**
     * The key of the RDN for the last normalizer it was computed with
     */
    protected keyCache: {normalizer: DNNormalizer, key: string} | undefined

    /**
     * Whether two RDNs are the same: the same attributes with values equal by their equality rules, in any order
     * @param other The other RDN.
     * @param normalizer What normalizes the types and the values.
     */
    public equals(other: RDN | string, normalizer?: DNNormalizer): boolean {
        return this.key(normalizer) === (typeof other === 'string' ? RDN.parse(other) : other).key(normalizer)
    }
}

/**
 * The parser of the text of a DN
 */
class Parser {
    protected position: number = 0

    constructor(protected readonly text: string, protected readonly strict: boolean) {
    }

    public parse(): RDN[] {
        const rdns: RDN[] = []
        this.spaces()
        if (this.position >= this.text.length) return rdns
        for (; ;) {
            const attributes: AttributeTypeAndValue[] = [this.attribute()]
            while (this.text[this.position] === '+') {
                this.position++
                attributes.push(this.attribute())
            }
            rdns.push(new RDN(attributes))
            if (this.position >= this.text.length) break
            //RFC 2253 separated the RDNs by ";" too, as ldapjs still does
            if (this.text[this.position] !== ',' && (this.strict || this.text[this.position] !== ';')) this.fail('"," expected')
            this.position++
        }
        return rdns
    }

    protected fail(message: string): never {
        throw new LDAPDNSyntaxException(`${message} at ${this.position} in ${JSON.stringify(this.text)}`, this.position)
    }

    protected spaces(): void {
        if (this.strict) return
        while (this.text[this.position] === ' ') this.position++
    }

    protected attribute(): AttributeTypeAndValue {
        this.spaces()
        const start: number = this.position
        while (this.position < this.text.length && /[A-Za-z0-9.\-_]/.test(this.text[this.position])) this.position++
        let type: string = this.text.slice(start, this.position)
        //RFC 1779 wrote the OIDs with a prefix
        if (!this.strict && /^oid\./i.test(type)) type = type.slice(4)
        const pattern: RegExp = this.strict ? /^([A-Za-z][A-Za-z0-9-]*|[0-9]+(\.[0-9]+)*)$/ : /^([A-Za-z][A-Za-z0-9_-]*|[0-9]+(\.[0-9]+)*)$/
        if (!pattern.test(type)) this.fail(type ? `"${type}" is not an attribute type` : 'An attribute type is missing')
        this.spaces()
        if (this.text[this.position] !== '=') this.fail('"=" expected')
        this.position++
        this.spaces()
        if (this.text[this.position] === '#') return this.hexValue(type)
        return {type: type, value: this.stringValue()}
    }

    protected hexValue(type: string): AttributeTypeAndValue {
        this.position++
        const start: number = this.position
        while (this.position < this.text.length && /[0-9A-Fa-f]/.test(this.text[this.position])) this.position++
        const hex: string = this.text.slice(start, this.position)
        if (!hex.length || hex.length % 2) this.fail('A value of "#" and an odd or empty count of hex digits')
        this.spaces()
        if (this.position < this.text.length && !',+'.includes(this.text[this.position]) && (this.strict || this.text[this.position] !== ';')) this.fail('A character after a hex value')
        const binary: Buffer = Buffer.from(hex, 'hex')
        return {type: type, value: textOfBER(binary), binary: binary}
    }

    protected stringValue(): string {
        const bytes: number[] = []
        //The bytes up to the last escaped one or the last character that is not a space: the unescaped spaces after
        //it are trailing spaces
        let significant: number = 0
        while (this.position < this.text.length) {
            const character: string = this.text[this.position]
            if (character === ',' || character === '+' || (!this.strict && character === ';')) break
            if (character === '\\') {
                const hex: string = this.text.slice(this.position + 1, this.position + 3)
                if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                    bytes.push(parseInt(hex, 16))
                    this.position += 3
                } else {
                    const next: string | undefined = this.text[this.position + 1]
                    if (next === undefined || !' "#+,;<=>\\'.includes(next)) this.fail('An invalid escape')
                    bytes.push(next.charCodeAt(0))
                    this.position += 2
                }
                significant = bytes.length
                continue
            }
            if (character === '\0') this.fail('An unescaped NUL')
            if (this.strict && '";<>'.includes(character)) this.fail(`An unescaped "${character}"`)
            const code: number = this.text.codePointAt(this.position)!
            for (const byte of Buffer.from(String.fromCodePoint(code), 'utf8')) bytes.push(byte)
            this.position += code > 0xffff ? 2 : 1
            if (character !== ' ') significant = bytes.length
        }
        if (bytes.length > significant) {
            if (this.strict) this.fail('An unescaped trailing space')
            bytes.length = significant
        }
        const buffer: Buffer = Buffer.from(bytes)
        if (!isUTF8(buffer)) this.fail('A value that is not UTF-8')
        return buffer.toString('utf8')
    }
}

/**
 * A distinguished name (RFC 4514), its RDNs from the entry itself (the first one) to the top of the tree (the last one).
 * DNs compare by their normalized form: the attribute types made one and the values prepared by their equality rules,
 * with a `Schema`, or without case otherwise.
 * @example
 * ```typescript
 * import {DN} from '@lakutata/ldap-engine'
 *
 * const dn: DN = DN.parse('UID=Alice, OU=People, DC=Example, DC=com')
 * console.log(dn.toString()) //UID=Alice,OU=People,DC=Example,DC=com
 * console.log(dn.equals('uid=alice,ou=people,dc=example,dc=com')) //true
 * console.log(dn.parent()?.toString(), dn.isDescendantOf('dc=example,dc=com')) //OU=People,DC=Example,DC=com true
 * ```
 */
export class DN {
    /**
     * Its RDNs, the entry's own first
     */
    public readonly rdns: readonly RDN[]

    /**
     * The normalized form without a schema, computed once
     */
    protected defaultKey: string | undefined

    /**
     * @param rdns Its RDNs, the entry's own first; none for the empty DN (the root).
     */
    constructor(rdns: RDN[] = []) {
        this.rdns = Object.freeze(rdns.slice())
    }

    /**
     * Parse a DN
     * @param text The text: `uid=alice,ou=people,dc=example,dc=com`.
     * @param options Whether to refuse what RFC 4514 does not allow.
     */
    public static parse(text: string, options: DNParseOptions = {}): DN {
        return new DN(new Parser(text, options.strict === true).parse())
    }

    /**
     * Whether a text is a DN
     * @param text The text.
     * @param options Whether to refuse what RFC 4514 does not allow.
     */
    public static isValid(text: string, options: DNParseOptions = {}): boolean {
        try {
            DN.parse(text, options)
            return true
        } catch {
            return false
        }
    }

    /**
     * The DN of a value: the DN itself, or the DN parsed from its text
     * @param value The DN or its text.
     */
    public static from(value: DN | string): DN {
        return typeof value === 'string' ? DN.parse(value) : value
    }

    /**
     * The count of its RDNs
     */
    public get length(): number {
        return this.rdns.length
    }

    /**
     * Whether it is the empty DN, the root of the tree
     */
    public isRoot(): boolean {
        return this.rdns.length === 0
    }

    /**
     * Its own RDN, the first one
     */
    public rdn(): RDN | undefined {
        return this.rdns[0]
    }

    /**
     * The DN of its parent; undefined for the root
     */
    public parent(): DN | undefined {
        return this.rdns.length ? new DN(this.rdns.slice(1) as RDN[]) : undefined
    }

    /**
     * The DN of a child of it
     * @param rdn The RDN of the child.
     */
    public child(rdn: RDN | string): DN {
        return new DN([typeof rdn === 'string' ? RDN.parse(rdn) : rdn, ...this.rdns])
    }

    /**
     * The normalized form the DN compares by
     * @param normalizer What normalizes the types and the values; a `Schema`, for one.
     */
    public key(normalizer?: DNNormalizer): string {
        if (normalizer) {
            //The DN does not change: its key is kept for the last normalizer (a schema does not change once used)
            if (this.keyCache?.normalizer === normalizer) return this.keyCache.key
            const key: string = this.rdns.map((rdn: RDN): string => rdn.key(normalizer)).join(',')
            this.keyCache = {normalizer: normalizer, key: key}
            return key
        }
        this.defaultKey ??= this.rdns.map((rdn: RDN): string => rdn.key()).join(',')
        return this.defaultKey
    }

    /**
     * The key of the DN for the last normalizer it was computed with
     */
    protected keyCache: {normalizer: DNNormalizer, key: string} | undefined

    /**
     * Whether two DNs are the same (distinguishedNameMatch)
     * @param other The other DN, or its text.
     * @param normalizer What normalizes the types and the values.
     */
    public equals(other: DN | string, normalizer?: DNNormalizer): boolean {
        const dn: DN = DN.from(other)
        return dn.length === this.length && dn.key(normalizer) === this.key(normalizer)
    }

    /**
     * Whether the DN is under another one (and not that one)
     * @param ancestor The other DN, or its text.
     * @param normalizer What normalizes the types and the values.
     */
    public isDescendantOf(ancestor: DN | string, normalizer?: DNNormalizer): boolean {
        const dn: DN = DN.from(ancestor)
        if (dn.length >= this.length) return false
        const offset: number = this.length - dn.length
        return dn.rdns.every((rdn: RDN, index: number): boolean => rdn.key(normalizer) === this.rdns[offset + index].key(normalizer))
    }

    /**
     * Whether the DN is a child of another one
     * @param parent The other DN, or its text.
     * @param normalizer What normalizes the types and the values.
     */
    public isChildOf(parent: DN | string, normalizer?: DNNormalizer): boolean {
        const dn: DN = DN.from(parent)
        return this.length === dn.length + 1 && this.isDescendantOf(dn, normalizer)
    }

    /**
     * The text of the DN (RFC 4514), its values escaped
     */
    public toString(): string {
        return this.rdns.map((rdn: RDN): string => rdn.toString()).join(',')
    }
}
