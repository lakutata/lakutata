import {LDAPFilterSyntaxException} from '../../exceptions/LDAPFilterSyntaxException.js'
import {isUTF8} from '../ber/Ber.js'
import type {AssertionFilter, ExtensibleFilter, Filter, SubstringsFilter} from './Filter.js'

/**
 * The options of the parsing of a filter
 */
export interface FilterParseOptions {
    /**
     * Refuse what RFC 4515 does not allow: spaces between the filters, `\` before a character that is not two hex
     * digits, characters outside the attribute descriptions' grammar (`_`). By default they are accepted, as the
     * configurations of many applications write them (`(& (cn={0})(objectClass=person))`).
     */
    strict?: boolean
}

const HEX: string = '0123456789abcdef'

/**
 * Escape a value for the text of a filter (RFC 4515 §3): `*`, `(`, `)`, `\` and NUL become `\2a`, `\28`, `\29`, `\5c`
 * and `\00`, and so do the other control characters, for the text to be readable; the bytes of a value that is not
 * UTF-8 are all escaped.
 * @param value The value: a string, or bytes.
 * @example
 * ```typescript
 * import {escapeFilterValue} from '@lakutata/ldap-engine'
 *
 * console.log(`(cn=${escapeFilterValue('a*(b)')})`) //(cn=a\2a\28b\29)
 * ```
 */
export function escapeFilterValue(value: string | Buffer): string {
    const bytes: Buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
    const text: boolean = isUTF8(bytes)
    let result: string = ''
    let start: number = 0
    for (let index: number = 0; index < bytes.length; index++) {
        const byte: number = bytes[index]
        if (byte === 0x2a || byte === 0x28 || byte === 0x29 || byte === 0x5c || byte < 0x20 || byte === 0x7f || (!text && byte >= 0x80)) {
            result += bytes.subarray(start, index).toString(text ? 'utf8' : 'latin1') + '\\' + HEX[byte >> 4] + HEX[byte & 0x0f]
            start = index + 1
        }
    }
    return result + bytes.subarray(start).toString(text ? 'utf8' : 'latin1')
}

/**
 * The text of a filter (RFC 4515)
 * @param filter The filter.
 */
export function stringifyFilter(filter: Filter): string {
    switch (filter.type) {
        case 'and':
            return `(&${filter.filters.map(stringifyFilter).join('')})`
        case 'or':
            return `(|${filter.filters.map(stringifyFilter).join('')})`
        case 'not':
            return `(!${stringifyFilter(filter.filter)})`
        case 'equality':
            return `(${filter.attribute}=${escapeFilterValue(filter.value)})`
        case 'greaterOrEqual':
            return `(${filter.attribute}>=${escapeFilterValue(filter.value)})`
        case 'lessOrEqual':
            return `(${filter.attribute}<=${escapeFilterValue(filter.value)})`
        case 'approx':
            return `(${filter.attribute}~=${escapeFilterValue(filter.value)})`
        case 'present':
            return `(${filter.attribute}=*)`
        case 'substrings':
            return `(${filter.attribute}=${filter.initial ? escapeFilterValue(filter.initial) : ''}*${filter.any.map((part: Buffer): string => escapeFilterValue(part) + '*').join('')}${filter.final ? escapeFilterValue(filter.final) : ''})`
        case 'extensible':
            return `(${filter.attribute ?? ''}${filter.dnAttributes ? ':dn' : ''}${filter.rule ? ':' + filter.rule : ''}:=${escapeFilterValue(filter.value)})`
    }
}

/**
 * The parser of the text of a filter
 */
class Parser {
    protected position: number = 0

    constructor(protected readonly text: string, protected readonly strict: boolean) {
    }

    public parse(): Filter {
        this.spaces()
        const filter: Filter = this.filter(0)
        this.spaces()
        if (this.position < this.text.length) this.fail('Text after the filter')
        return filter
    }

    protected fail(message: string): never {
        throw new LDAPFilterSyntaxException(`${message} at ${this.position} in ${JSON.stringify(this.text)}`, this.position)
    }

    protected spaces(): void {
        if (this.strict) return
        while (this.position < this.text.length && /\s/.test(this.text[this.position])) this.position++
    }

    protected expect(character: string): void {
        if (this.text[this.position] !== character) this.fail(`"${character}" expected`)
        this.position++
    }

    protected filter(depth: number): Filter {
        if (depth > 100) this.fail('A filter nested too deep')
        this.expect('(')
        this.spaces()
        let filter: Filter
        const character: string | undefined = this.text[this.position]
        if (character === '&' || character === '|') {
            this.position++
            this.spaces()
            const filters: Filter[] = []
            while (this.text[this.position] === '(') {
                filters.push(this.filter(depth + 1))
                this.spaces()
            }
            filter = {type: character === '&' ? 'and' : 'or', filters: filters}
        } else if (character === '!') {
            this.position++
            this.spaces()
            filter = {type: 'not', filter: this.filter(depth + 1)}
            this.spaces()
        } else {
            filter = this.item()
        }
        this.expect(')')
        return filter
    }

    protected attribute(): string {
        const start: number = this.position
        const pattern: RegExp = this.strict ? /[A-Za-z0-9.;-]/ : /[A-Za-z0-9.;_-]/
        while (this.position < this.text.length && pattern.test(this.text[this.position])) this.position++
        const attribute: string = this.text.slice(start, this.position)
        if (this.strict && attribute && !/^([A-Za-z][A-Za-z0-9-]*|[0-9]+(\.[0-9]+)*)(;[A-Za-z0-9-]+)*$/.test(attribute)) this.fail(`An invalid attribute description "${attribute}"`)
        return attribute
    }

    protected item(): Filter {
        const attribute: string = this.attribute()
        const operator: string = this.text.slice(this.position, this.position + 2)
        if (operator === '~=' || operator === '>=' || operator === '<=') {
            if (!attribute) this.fail('An attribute is missing')
            this.position += 2
            const type: AssertionFilter['type'] = operator === '~=' ? 'approx' : operator === '>=' ? 'greaterOrEqual' : 'lessOrEqual'
            const parts: Buffer[] = this.value(false)
            return {type: type, attribute: attribute, value: parts[0]}
        }
        if (this.text[this.position] === ':') return this.extensible(attribute)
        if (!attribute) this.fail('An attribute is missing')
        this.expect('=')
        const parts: Buffer[] = this.value(true)
        if (parts.length === 1) return {type: 'equality', attribute: attribute, value: parts[0]}
        if (parts.length === 2 && !parts[0].length && !parts[1].length) return {type: 'present', attribute: attribute}
        const filter: SubstringsFilter = {type: 'substrings', attribute: attribute, any: []}
        if (parts[0].length) filter.initial = parts[0]
        if (parts[parts.length - 1].length) filter.final = parts[parts.length - 1]
        for (const part of parts.slice(1, -1)) {
            if (part.length) {
                filter.any.push(part)
            } else if (this.strict) {
                this.fail('Two asterisks in a row')
            }
        }
        //Asterisks alone ((cn=**)): nothing to match but the presence of the attribute
        if (filter.initial === undefined && filter.final === undefined && !filter.any.length) return {type: 'present', attribute: attribute}
        return filter
    }

    protected extensible(attribute: string): ExtensibleFilter {
        const filter: ExtensibleFilter = {type: 'extensible', value: Buffer.alloc(0), dnAttributes: false}
        if (attribute) filter.attribute = attribute
        //"dn" is case-insensitive, as the strings of ABNF are
        if (this.text.slice(this.position, this.position + 3).toLowerCase() === ':dn' && this.text[this.position + 3] === ':') {
            filter.dnAttributes = true
            this.position += 3
        }
        if (this.text[this.position] === ':' && this.text[this.position + 1] !== '=') {
            this.position++
            const start: number = this.position
            while (this.position < this.text.length && /[A-Za-z0-9.;_-]/.test(this.text[this.position])) this.position++
            filter.rule = this.text.slice(start, this.position)
            if (!filter.rule) this.fail('A matching rule is missing')
        }
        this.expect(':')
        this.expect('=')
        if (filter.attribute === undefined && filter.rule === undefined) this.fail('An extensible filter needs an attribute or a matching rule')
        filter.value = this.value(false)[0]
        return filter
    }

    /**
     * The value up to the closing parenthesis: its parts between the asterisks when they are allowed
     */
    protected value(asterisks: boolean): Buffer[] {
        const parts: Buffer[] = []
        let bytes: number[] = []
        while (this.position < this.text.length) {
            const character: string = this.text[this.position]
            if (character === ')') break
            if (character === '(' || character === '\0') this.fail(`An unescaped "${character === '\0' ? 'NUL' : character}" in a value`)
            if (character === '*') {
                if (!asterisks) this.fail('An unescaped "*" in a value')
                parts.push(Buffer.from(bytes))
                bytes = []
                this.position++
                continue
            }
            if (character === '\\') {
                const hex: string = this.text.slice(this.position + 1, this.position + 3)
                if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                    bytes.push(parseInt(hex, 16))
                    this.position += 3
                    continue
                }
                //RFC 1960 escaped the special characters with a backslash alone
                const next: string | undefined = this.text[this.position + 1]
                if (this.strict || next === undefined || !'*()\\'.includes(next)) this.fail('An invalid escape')
                bytes.push(next.charCodeAt(0))
                this.position += 2
                continue
            }
            const code: number = this.text.codePointAt(this.position)!
            const encoded: Buffer = Buffer.from(String.fromCodePoint(code), 'utf8')
            for (const byte of encoded) bytes.push(byte)
            this.position += code > 0xffff ? 2 : 1
        }
        parts.push(Buffer.from(bytes))
        return parts
    }
}

/**
 * Parse the text of a filter (RFC 4515)
 * @param text The text.
 * @param options Whether to refuse what RFC 4515 does not allow.
 */
export function parseFilter(text: string, options: FilterParseOptions = {}): Filter {
    return new Parser(text, options.strict === true).parse()
}

/**
 * Write a filter with values from variables: each value is escaped, so a value cannot change the filter (`*`, `(`, `)`
 * in a user name stay characters of the name). A `Buffer` is escaped byte by byte.
 * @param strings The text of the template.
 * @param values The values.
 * @example
 * ```typescript
 * import {filter, type Filter} from '@lakutata/ldap-engine'
 *
 * const name: string = 'alice*'
 * const search: Filter = filter`(&(objectClass=person)(uid=${name}))`
 * console.log(search) //an equality filter on uid with the value "alice*", not a substrings filter
 * ```
 */
export function filter(strings: TemplateStringsArray, ...values: (string | number | boolean | bigint | Buffer)[]): Filter {
    let text: string = strings[0]
    values.forEach((value: string | number | boolean | bigint | Buffer, index: number): void => {
        text += escapeFilterValue(Buffer.isBuffer(value) ? value : String(value)) + strings[index + 1]
    })
    return parseFilter(text)
}
