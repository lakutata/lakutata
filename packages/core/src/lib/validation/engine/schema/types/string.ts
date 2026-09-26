/**
 * Derived from the upstream lib/types/string.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, escapeRegex} from '../../hoek/index.js'
import {type DomainOptions as AddressDomainOptions, type EmailOptions as AddressEmailOptions, isDomainValid, isEmailValid, ipRegex, uriRegex} from '../../address/index.js'
import * as Tlds from '../../tlds/index.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'
import type {SchemaTerms} from '../base.js'
import * as Common from '../common.js'
import type {Preferences, SchemaRule, ValidationHelpers, ValidationOutcome} from '../model.js'
import type {State} from '../state.js'

/**
 * A replacement applied to the value before validation (see string.replace())
 */
export interface StringReplacement {
    pattern: RegExp
    replacement: string
}

/**
 * The terms of string schemas
 */
export interface StringTerms {
    replacements: StringReplacement[] | null
}

/**
 * The top level domain options of the domain, email and uri rules
 */
export interface TldsOptions {
    allow?: Set<string> | string[] | boolean
    deny?: Set<string> | string[] | null
}

/**
 * The options of the domain rule (and of the domain option of the uri rule)
 */
export interface DomainOptions {
    allowFullyQualified?: boolean
    allowUnicode?: boolean
    allowUnderscore?: boolean
    maxDomainSegments?: number
    minDomainSegments?: number
    tlds?: TldsOptions | boolean
}

/**
 * The options of the email rule
 */
export interface EmailOptions extends DomainOptions {
    ignoreLength?: boolean
    multiple?: boolean
    separator?: string
}

export interface Base64Options {
    paddingRequired?: boolean
    urlSafe?: boolean
}

export interface DataUriOptions {
    paddingRequired?: boolean
}

export interface GuidOptions {
    version?: string | string[]
    separator?: boolean | '-' | ':'
    wrapper?: boolean | string
}

export interface HexOptions {
    byteAligned?: boolean
    prefix?: boolean | 'optional'
}

export interface IpOptions {
    cidr?: 'optional' | 'required' | 'forbidden'
    version?: string | string[]
}

export interface PatternOptions {
    invert?: boolean
    name?: string
}

export interface UriOptions {
    allowRelative?: boolean
    allowQuerySquareBrackets?: boolean
    domain?: DomainOptions
    relativeOnly?: boolean
    scheme?: string | RegExp | (string | RegExp)[]
    encodeUri?: boolean
}

/**
 * The string schema
 */
export interface StringSchema extends AnySchema {
    $_terms: SchemaTerms & AnyTerms & StringTerms
    alphanum(): this
    base64(options?: Base64Options): this
    case(direction: 'lower' | 'upper'): this
    creditCard(): this
    dataUri(options?: DataUriOptions): this
    domain(options?: DomainOptions): this
    email(options?: EmailOptions): this
    guid(options?: GuidOptions): this
    uuid(options?: GuidOptions): this
    hex(options?: HexOptions): this
    hostname(): this
    insensitive(): this
    ip(options?: IpOptions): this
    isoDate(): this
    isoDuration(): this
    length(limit: unknown, encoding?: string): this
    lowercase(): this
    max(limit: unknown, encoding?: string): this
    min(limit: unknown, encoding?: string): this
    normalize(form?: string): this
    pattern(regex: RegExp, options?: PatternOptions | string): this
    regex(regex: RegExp, options?: PatternOptions | string): this
    replace(pattern: RegExp | string, replacement: string): this
    token(): this
    trim(enabled?: boolean): this
    truncate(enabled?: boolean): this
    uppercase(): this
    uri(options?: UriOptions): this
}

/**
 * A reference or a template (a resolvable rule argument)
 */
interface Resolvable {
    resolve(value: unknown, state: State, prefs: Preferences): unknown
}

/**
 * The options passed to the address module, as normalized by addressOptions()
 */
type AddressOptions = DomainOptions | EmailOptions

/**
 * A boolean used as a property key
 */
type BooleanKey = 'true' | 'false'

const tlds: { tlds: { allow: Set<string>, deny: null } } | false = Tlds.tlds instanceof Set ? {tlds: {allow: Tlds.tlds, deny: null}} : false

const base64Regex: Record<BooleanKey, Record<BooleanKey, RegExp>> = {
    //paddingRequired
    true: {
        //urlSafe
        true: /^(?:[\w\-]{2}[\w\-]{2})*(?:[\w\-]{2}==|[\w\-]{3}=)?$/,
        false: /^(?:[A-Za-z0-9+\/]{2}[A-Za-z0-9+\/]{2})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/
    },
    false: {
        true: /^(?:[\w\-]{2}[\w\-]{2})*(?:[\w\-]{2}(==)?|[\w\-]{3}=?)?$/,
        false: /^(?:[A-Za-z0-9+\/]{2}[A-Za-z0-9+\/]{2})*(?:[A-Za-z0-9+\/]{2}(==)?|[A-Za-z0-9+\/]{3}=?)?$/
    }
}

const dataUriRegex: RegExp = /^data:[\w+.-]+\/[\w+.-]+;((charset=[\w-]+|base64),)?(.*)$/

const hexRegex: { withPrefix: RegExp, withOptionalPrefix: RegExp, withoutPrefix: RegExp } = {
    withPrefix: /^0x[0-9a-f]+$/i,
    withOptionalPrefix: /^(?:0x)?[0-9a-f]+$/i,
    withoutPrefix: /^[0-9a-f]+$/i
}

//IP addresses without CIDR (hostnames)
const ipAddressRegex: RegExp = ipRegex({cidr: 'forbidden'}).regex

const isoDurationRegex: RegExp = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/

const guidBrackets: Record<string, string> = {
    '{': '}', '[': ']', '(': ')', '': ''
}

const guidVersions: Record<string, string> = {
    uuidv1: '1',
    uuidv2: '2',
    uuidv3: '3',
    uuidv4: '4',
    uuidv5: '5',
    uuidv6: '6',
    uuidv7: '7',
    uuidv8: '8'
}

const guidSeparators: Set<unknown> = new Set<unknown>([undefined, true, false, '-', ':'])

const normalizationForms: string[] = ['NFC', 'NFD', 'NFKC', 'NFKD']

const StringType: StringSchema = Any.extend<StringSchema>({

    type: 'string',

    flags: {

        insensitive: {default: false},
        truncate: {default: false}
    },

    terms: {

        replacements: {init: null}
    },

    coerce: {
        from: 'string',
        method(value: unknown, {schema, state, prefs}: ValidationHelpers<StringSchema>): ValidationOutcome | undefined {
            const normalize: SchemaRule | undefined = schema.$_getRule('normalize')
            if (normalize) {
                value = (value as string).normalize((normalize.args as Record<string, unknown>).form as string)
            }
            const casing: SchemaRule | undefined = schema.$_getRule('case')
            if (casing) {
                value = (casing.args as Record<string, unknown>).direction === 'upper' ? (value as string).toLocaleUpperCase() : (value as string).toLocaleLowerCase()
            }
            const trim: SchemaRule | undefined = schema.$_getRule('trim')
            if (trim &&
                (trim.args as Record<string, unknown>).enabled) {
                value = (value as string).trim()
            }
            if (schema.$_terms.replacements) {
                for (const replacement of schema.$_terms.replacements) {
                    value = (value as string).replace(replacement.pattern, replacement.replacement)
                }
            }
            const hex: SchemaRule | undefined = schema.$_getRule('hex')
            if (hex &&
                ((hex.args as Record<string, unknown>).options as HexOptions).byteAligned &&
                (value as string).length % 2 !== 0) {
                value = `0${value}`
            }
            if (schema.$_getRule('isoDate')) {
                const iso: string | null = isoDate(value as string)
                if (iso) {
                    value = iso
                }
            }
            if (schema._flags.truncate) {
                const rule: SchemaRule | undefined = schema.$_getRule('max')
                if (rule) {
                    let limit: unknown = (rule.args as Record<string, unknown>).limit
                    if (Common.isResolvable(limit)) {
                        limit = (limit as Resolvable).resolve(value, state, prefs)
                        if (!Common.limit(limit)) {
                            return {value, errors: schema.$_createError('any.ref', limit, {ref: (rule.args as Record<string, unknown>).limit, arg: 'limit', reason: 'must be a positive integer'}, state, prefs)}
                        }
                    }
                    value = (value as string).slice(0, limit as number)
                }
            }
            return {value}
        }
    },

    validate(value: unknown, {schema, error}: ValidationHelpers<StringSchema>): ValidationOutcome | undefined {
        if (typeof value !== 'string') {
            return {value, errors: error('string.base')}
        }
        if (value === '') {
            const min: SchemaRule | undefined = schema.$_getRule('min')
            if (min &&
                (min.args as Record<string, unknown>).limit === 0) {
                return
            }
            return {value, errors: error('string.empty')}
        }
    },

    rules: {

        alphanum: {
            method(this: StringSchema): StringSchema {
                return this.$_addRule('alphanum')
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>): unknown {
                if (/^[a-zA-Z0-9]+$/.test(value as string)) {
                    return value
                }
                return helpers.error('string.alphanum')
            }
        },

        base64: {
            method(this: StringSchema, options: Base64Options = {}): StringSchema {
                Common.assertOptions(options, ['paddingRequired', 'urlSafe'])
                options = {urlSafe: false, paddingRequired: true, ...options}
                assert(typeof options.paddingRequired === 'boolean', 'paddingRequired must be boolean')
                assert(typeof options.urlSafe === 'boolean', 'urlSafe must be boolean')
                return this.$_addRule({name: 'base64', args: {options}})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {options}: Record<string, unknown>): unknown {
                const regex: RegExp = base64Regex[(options as Base64Options).paddingRequired as unknown as BooleanKey][(options as Base64Options).urlSafe as unknown as BooleanKey]
                if (regex.test(value as string)) {
                    return value
                }
                return helpers.error('string.base64')
            }
        },

        case: {
            method(this: StringSchema, direction: 'lower' | 'upper'): StringSchema {
                assert(['lower', 'upper'].includes(direction), 'Invalid case:', direction)
                return this.$_addRule({name: 'case', args: {direction}})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {direction}: Record<string, unknown>): unknown {
                if (direction === 'lower' && value === (value as string).toLocaleLowerCase() ||
                    direction === 'upper' && value === (value as string).toLocaleUpperCase()) {
                    return value
                }
                return helpers.error(`string.${direction}case`)
            },
            convert: true
        },

        creditCard: {
            method(this: StringSchema): StringSchema {
                return this.$_addRule('creditCard')
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>): unknown {
                let i: number = (value as string).length
                let sum: number = 0
                let mul: number = 1
                while (i--) {
                    //The digit (a string) coerced to a number by the multiplication
                    const char: number = ((value as string).charAt(i) as unknown as number) * mul
                    sum = sum + (char - ((char > 9) as unknown as number) * 9)
                    mul = mul ^ 3
                }
                if (sum > 0 &&
                    sum % 10 === 0) {
                    return value
                }
                return helpers.error('string.creditCard')
            }
        },

        dataUri: {
            method(this: StringSchema, options: DataUriOptions = {}): StringSchema {
                Common.assertOptions(options, ['paddingRequired'])
                options = {paddingRequired: true, ...options}
                assert(typeof options.paddingRequired === 'boolean', 'paddingRequired must be boolean')
                return this.$_addRule({name: 'dataUri', args: {options}})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {options}: Record<string, unknown>): unknown {
                const matches: RegExpMatchArray | null = (value as string).match(dataUriRegex)
                if (matches) {
                    if (!matches[2]) {
                        return value
                    }
                    if (matches[2] !== 'base64') {
                        return value
                    }
                    const base64regex: RegExp = base64Regex[(options as DataUriOptions).paddingRequired as unknown as BooleanKey].false
                    if (base64regex.test(matches[3])) {
                        return value
                    }
                }
                return helpers.error('string.dataUri')
            }
        },

        domain: {
            method(this: StringSchema, options?: DomainOptions): StringSchema {
                if (options) {
                    Common.assertOptions(options, ['allowFullyQualified', 'allowUnicode', 'allowUnderscore', 'maxDomainSegments', 'minDomainSegments', 'tlds'])
                }
                const address: AddressOptions | false | undefined = addressOptions(options)
                return this.$_addRule({name: 'domain', args: {options}, address})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, args: Record<string, unknown>, {address}: SchemaRule): unknown {
                if (isDomainValid(value as string, address as AddressDomainOptions | undefined)) {
                    return value
                }
                return helpers.error('string.domain')
            }
        },

        email: {
            method(this: StringSchema, options: EmailOptions = {}): StringSchema {
                Common.assertOptions(options, ['allowFullyQualified', 'allowUnicode', 'ignoreLength', 'maxDomainSegments', 'minDomainSegments', 'multiple', 'separator', 'tlds'])
                assert(options.multiple === undefined || typeof options.multiple === 'boolean', 'multiple option must be an boolean')
                const address: AddressOptions | false | undefined = addressOptions(options)
                const regex: RegExp = new RegExp(`\\s*[${options.separator ? escapeRegex(options.separator) : ','}]\\s*`)
                return this.$_addRule({name: 'email', args: {options}, regex, address})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {options}: Record<string, unknown>, {regex, address}: SchemaRule): unknown {
                const emails: string[] = (options as EmailOptions).multiple ? (value as string).split(regex as RegExp) : [value as string]
                const invalids: string[] = []
                for (const email of emails) {
                    if (!isEmailValid(email, address as AddressEmailOptions | undefined)) {
                        invalids.push(email)
                    }
                }
                if (!invalids.length) {
                    return value
                }
                return helpers.error('string.email', {value, invalids})
            }
        },

        guid: {
            alias: 'uuid',
            method(this: StringSchema, options: GuidOptions = {}): StringSchema {
                Common.assertOptions(options, ['version', 'separator', 'wrapper'])
                assert(
                    options.wrapper === undefined ||
                    typeof options.wrapper === 'boolean' ||
                    (typeof options.wrapper === 'string' && typeof guidBrackets[options.wrapper] === 'string'),
                    `"wrapper" must be true, false, or one of "${Object.keys(guidBrackets).filter(Boolean).join('", "')}"`
                )
                let versionNumbers: string = ''
                if (options.version) {
                    const versions: unknown[] = ([] as unknown[]).concat(options.version)
                    assert(versions.length >= 1, 'version must have at least 1 valid version specified')
                    const set: Set<string> = new Set()
                    for (let i: number = 0; i < versions.length; ++i) {
                        const version: unknown = versions[i]
                        assert(typeof version === 'string', 'version at position ' + i + ' must be a string')
                        const versionNumber: string = guidVersions[version.toLowerCase()]
                        assert(versionNumber, 'version at position ' + i + ' must be one of ' + Object.keys(guidVersions).join(', '))
                        assert(!set.has(versionNumber), 'version at position ' + i + ' must not be a duplicate')
                        versionNumbers += versionNumber
                        set.add(versionNumber)
                    }
                }
                assert(guidSeparators.has(options.separator), 'separator must be one of true, false, "-", or ":"')
                const separator: string = options.separator === undefined ? '[:-]?' :
                    options.separator === true ? '[:-]' :
                        options.separator === false ? '[]?' : `\\${options.separator}`
                let wrapperStart: string
                let wrapperEnd: string
                if (options.wrapper === undefined) {
                    wrapperStart = '[\\[{\\(]?'
                    wrapperEnd = '[\\]}\\)]?'
                } else if (options.wrapper === true) {
                    wrapperStart = '[\\[{\\(]'
                    wrapperEnd = '[\\]}\\)]'
                } else if (options.wrapper === false) {
                    wrapperStart = ''
                    wrapperEnd = ''
                } else {
                    wrapperStart = escapeRegex(options.wrapper)
                    wrapperEnd = escapeRegex(guidBrackets[options.wrapper])
                }
                const regex: RegExp = new RegExp(
                    `^(${wrapperStart})[0-9A-F]{8}(${separator})[0-9A-F]{4}\\2?[${
                        versionNumbers || '0-9A-F'
                    }][0-9A-F]{3}\\2?[${
                        versionNumbers ? '89AB' : '0-9A-F'
                    }][0-9A-F]{3}\\2?[0-9A-F]{12}(${wrapperEnd})$`,
                    'i'
                )
                return this.$_addRule({name: 'guid', args: {options}, regex})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, args: Record<string, unknown>, {regex}: SchemaRule): unknown {
                const results: RegExpExecArray | null = (regex as RegExp).exec(value as string)
                if (!results) {
                    return helpers.error('string.guid')
                }
                const open: string = results[1]
                const close: string = results[results.length - 1]
                if ((open || close) && guidBrackets[open] !== close) {
                    return helpers.error('string.guid')
                }
                return value
            }
        },

        hex: {
            method(this: StringSchema, options: HexOptions = {}): StringSchema {
                Common.assertOptions(options, ['byteAligned', 'prefix'])
                options = {byteAligned: false, prefix: false, ...options}
                assert(typeof options.byteAligned === 'boolean', 'byteAligned must be boolean')
                assert(typeof options.prefix === 'boolean' || options.prefix === 'optional', 'prefix must be boolean or "optional"')
                return this.$_addRule({name: 'hex', args: {options}})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {options}: Record<string, unknown>): unknown {
                const re: RegExp = (options as HexOptions).prefix === 'optional' ?
                    hexRegex.withOptionalPrefix :
                    (options as HexOptions).prefix === true ?
                        hexRegex.withPrefix :
                        hexRegex.withoutPrefix
                if (!re.test(value as string)) {
                    return helpers.error('string.hex')
                }
                if ((options as HexOptions).byteAligned &&
                    (value as string).length % 2 !== 0) {
                    return helpers.error('string.hexAlign')
                }
                return value
            }
        },

        hostname: {
            method(this: StringSchema): StringSchema {
                return this.$_addRule('hostname')
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>): unknown {
                if (isDomainValid(value as string, {minDomainSegments: 1}) ||
                    ipAddressRegex.test(value as string)) {
                    return value
                }
                return helpers.error('string.hostname')
            }
        },

        insensitive: {
            method(this: StringSchema): StringSchema {
                return this.$_setFlag('insensitive', true)
            }
        },

        ip: {
            method(this: StringSchema, options: IpOptions = {}): StringSchema {
                Common.assertOptions(options, ['cidr', 'version'])
                const {cidr, versions, regex} = ipRegex(options as Parameters<typeof ipRegex>[0])
                const version: string[] | undefined = options.version ? versions : undefined
                return this.$_addRule({name: 'ip', args: {options: {cidr, version}}, regex})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {options}: Record<string, unknown>, {regex}: SchemaRule): unknown {
                if ((regex as RegExp).test(value as string)) {
                    return value
                }
                if ((options as IpOptions).version) {
                    return helpers.error('string.ipVersion', {value, cidr: (options as IpOptions).cidr, version: (options as IpOptions).version})
                }
                return helpers.error('string.ip', {value, cidr: (options as IpOptions).cidr})
            }
        },

        isoDate: {
            method(this: StringSchema): StringSchema {
                return this.$_addRule('isoDate')
            },
            validate(value: unknown, {error}: ValidationHelpers<StringSchema>): unknown {
                if (isoDate(value as string)) {
                    return value
                }
                return error('string.isoDate')
            }
        },

        isoDuration: {
            method(this: StringSchema): StringSchema {
                return this.$_addRule('isoDuration')
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>): unknown {
                if (isoDurationRegex.test(value as string)) {
                    return value
                }
                return helpers.error('string.isoDuration')
            }
        },

        length: {
            method(this: StringSchema, limit: unknown, encoding?: string): StringSchema {
                return length(this, 'length', limit, '=', encoding)
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {limit, encoding}: Record<string, unknown>, {name, operator, args}: SchemaRule): unknown {
                const length: number = encoding ? Buffer && Buffer.byteLength(value as string, encoding as BufferEncoding) : (value as string).length
                if (Common.compare(length, limit, operator as Common.CompareOperator)) {
                    return value
                }
                return helpers.error('string.' + name, {limit: (args as Record<string, unknown>).limit, value, encoding})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: Common.limit,
                    message: 'must be a positive integer'
                },
                'encoding'
            ]
        },

        lowercase: {
            method(this: StringSchema): StringSchema {
                return this.case('lower')
            }
        },

        max: {
            method(this: StringSchema, limit: unknown, encoding?: string): StringSchema {
                return length(this, 'max', limit, '<=', encoding)
            },
            args: ['limit', 'encoding']
        },

        min: {
            method(this: StringSchema, limit: unknown, encoding?: string): StringSchema {
                return length(this, 'min', limit, '>=', encoding)
            },
            args: ['limit', 'encoding']
        },

        normalize: {
            method(this: StringSchema, form: string = 'NFC'): StringSchema {
                assert(normalizationForms.includes(form), 'normalization form must be one of ' + normalizationForms.join(', '))
                return this.$_addRule({name: 'normalize', args: {form}})
            },
            validate(value: unknown, {error}: ValidationHelpers<StringSchema>, {form}: Record<string, unknown>): unknown {
                if (value === (value as string).normalize(form as string)) {
                    return value
                }
                return error('string.normalize', {value, form})
            },
            convert: true
        },

        pattern: {
            alias: 'regex',
            method(this: StringSchema, regex: RegExp, options: PatternOptions | string = {}): StringSchema {
                assert(regex instanceof RegExp, 'regex must be a RegExp')
                assert(!regex.flags.includes('g') && !regex.flags.includes('y'), 'regex should not use global or sticky mode')
                if (typeof options === 'string') {
                    options = {name: options}
                }
                Common.assertOptions(options, ['invert', 'name'])
                const errorCode: string = ['string.pattern', options.invert ? '.invert' : '', options.name ? '.name' : '.base'].join('')
                return this.$_addRule({name: 'pattern', args: {regex, options}, errorCode})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {regex, options}: Record<string, unknown>, {errorCode}: SchemaRule): unknown {
                const patternMatch: boolean = (regex as RegExp).test(value as string)
                //Booleans (or undefined) coerced to numbers by the xor
                if ((patternMatch as unknown as number) ^ ((options as PatternOptions).invert as unknown as number)) {
                    return value
                }
                return helpers.error(errorCode as string, {name: (options as PatternOptions).name, regex, value})
            },
            args: ['regex', 'options'],
            multi: true
        },

        replace: {
            method(this: StringSchema, pattern: RegExp | string, replacement: string): StringSchema {
                if (typeof pattern === 'string') {
                    pattern = new RegExp(escapeRegex(pattern), 'g')
                }
                assert(pattern instanceof RegExp, 'pattern must be a RegExp')
                assert(typeof replacement === 'string', 'replacement must be a String')
                const obj: StringSchema = this.clone()
                if (!obj.$_terms.replacements) {
                    obj.$_terms.replacements = []
                }
                obj.$_terms.replacements.push({pattern, replacement})
                return obj
            }
        },

        token: {
            method(this: StringSchema): StringSchema {
                return this.$_addRule('token')
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>): unknown {
                if (/^\w+$/.test(value as string)) {
                    return value
                }
                return helpers.error('string.token')
            }
        },

        trim: {
            method(this: StringSchema, enabled: boolean = true): StringSchema {
                assert(typeof enabled === 'boolean', 'enabled must be a boolean')
                return this.$_addRule({name: 'trim', args: {enabled}})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {enabled}: Record<string, unknown>): unknown {
                if (!enabled ||
                    value === (value as string).trim()) {
                    return value
                }
                return helpers.error('string.trim')
            },
            convert: true
        },

        truncate: {
            method(this: StringSchema, enabled: boolean = true): StringSchema {
                assert(typeof enabled === 'boolean', 'enabled must be a boolean')
                return this.$_setFlag('truncate', enabled)
            }
        },

        uppercase: {
            method(this: StringSchema): StringSchema {
                return this.case('upper')
            }
        },

        uri: {
            method(this: StringSchema, options: UriOptions = {}): StringSchema {
                Common.assertOptions(options, ['allowRelative', 'allowQuerySquareBrackets', 'domain', 'relativeOnly', 'scheme', 'encodeUri'])
                if (options.domain) {
                    Common.assertOptions(options.domain, ['allowFullyQualified', 'allowUnicode', 'maxDomainSegments', 'minDomainSegments', 'tlds'])
                }
                const {regex, scheme} = uriRegex(options as Parameters<typeof uriRegex>[0])
                const domain: AddressOptions | false | undefined | null = options.domain ? addressOptions(options.domain) : null
                return this.$_addRule({name: 'uri', args: {options}, regex, domain, scheme})
            },
            validate(value: unknown, helpers: ValidationHelpers<StringSchema>, {options}: Record<string, unknown>, {regex, domain, scheme}: SchemaRule): unknown {
                //scheme:/ is technically valid but makes no sense
                if (['http:/', 'https:/'].includes(value as string)) {
                    return helpers.error('string.uri')
                }
                let match: RegExpExecArray | null = (regex as RegExp).exec(value as string)
                if (!match && helpers.prefs.convert && (options as UriOptions).encodeUri) {
                    const encoded: string = encodeURI(value as string)
                    match = (regex as RegExp).exec(encoded)
                    if (match) {
                        value = encoded
                    }
                }
                if (match) {
                    const matched: string = match[1] || match[2]
                    if (domain &&
                        (!(options as UriOptions).allowRelative || matched) &&
                        !isDomainValid(matched, domain as AddressDomainOptions)) {
                        return helpers.error('string.domain', {value: matched})
                    }
                    return value
                }
                if ((options as UriOptions).relativeOnly) {
                    return helpers.error('string.uriRelativeOnly')
                }
                if ((options as UriOptions).scheme) {
                    return helpers.error('string.uriCustomScheme', {scheme, value})
                }
                return helpers.error('string.uri')
            }
        }
    },

    manifest: {

        build(obj: StringSchema, desc: Record<string, unknown>): StringSchema {
            if (desc.replacements) {
                for (const {pattern, replacement} of desc.replacements as StringReplacement[]) {
                    obj = obj.replace(pattern, replacement)
                }
            }
            return obj
        }
    },

    messages: {
        'string.alphanum': '{{#label}} must only contain alpha-numeric characters',
        'string.base': '{{#label}} must be a string',
        'string.base64': '{{#label}} must be a valid base64 string',
        'string.creditCard': '{{#label}} must be a credit card',
        'string.dataUri': '{{#label}} must be a valid dataUri string',
        'string.domain': '{{#label}} must contain a valid domain name',
        'string.email': '{{#label}} must be a valid email',
        'string.empty': '{{#label}} is not allowed to be empty',
        'string.guid': '{{#label}} must be a valid GUID',
        'string.hex': '{{#label}} must only contain hexadecimal characters',
        'string.hexAlign': '{{#label}} hex decoded representation must be byte aligned',
        'string.hostname': '{{#label}} must be a valid hostname',
        'string.ip': '{{#label}} must be a valid ip address with a {{#cidr}} CIDR',
        'string.ipVersion': '{{#label}} must be a valid ip address of one of the following versions {{#version}} with a {{#cidr}} CIDR',
        'string.isoDate': '{{#label}} must be in iso format',
        'string.isoDuration': '{{#label}} must be a valid ISO 8601 duration',
        'string.length': '{{#label}} length must be {{#limit}} characters long',
        'string.lowercase': '{{#label}} must only contain lowercase characters',
        'string.max': '{{#label}} length must be less than or equal to {{#limit}} characters long',
        'string.min': '{{#label}} length must be at least {{#limit}} characters long',
        'string.normalize': '{{#label}} must be unicode normalized in the {{#form}} form',
        'string.token': '{{#label}} must only contain alpha-numeric and underscore characters',
        'string.pattern.base': '{{#label}} with value {:[.]} fails to match the required pattern: {{#regex}}',
        'string.pattern.name': '{{#label}} with value {:[.]} fails to match the {{#name}} pattern',
        'string.pattern.invert.base': '{{#label}} with value {:[.]} matches the inverted pattern: {{#regex}}',
        'string.pattern.invert.name': '{{#label}} with value {:[.]} matches the inverted {{#name}} pattern',
        'string.trim': '{{#label}} must not have leading or trailing whitespace',
        'string.uri': '{{#label}} must be a valid uri',
        'string.uriCustomScheme': '{{#label}} must be a valid uri with a scheme matching the {{#scheme}} pattern',
        'string.uriRelativeOnly': '{{#label}} must be a valid relative uri',
        'string.uppercase': '{{#label}} must only contain uppercase characters'
    }
})

export default StringType

//Helpers

/**
 * Normalize the domain options into the options of the address module
 * @param options
 */
function addressOptions(options: AddressOptions | undefined): AddressOptions | false | undefined {
    if (!options) {
        return tlds || options
    }
    //minDomainSegments
    assert(options.minDomainSegments === undefined ||
        Number.isSafeInteger(options.minDomainSegments) && (options.minDomainSegments as number) > 0, 'minDomainSegments must be a positive integer')
    //maxDomainSegments
    assert(options.maxDomainSegments === undefined ||
        Number.isSafeInteger(options.maxDomainSegments) && (options.maxDomainSegments as number) > 0, 'maxDomainSegments must be a positive integer')
    //tlds
    if (options.tlds === false) {
        return options
    }
    if (options.tlds === true ||
        options.tlds === undefined) {
        assert(tlds, 'Built-in TLD list disabled')
        return Object.assign({}, options, tlds)
    }
    assert(typeof options.tlds === 'object', 'tlds must be true, false, or an object')
    const deny: TldsOptions['deny'] = options.tlds.deny
    if (deny) {
        if (Array.isArray(deny)) {
            options = Object.assign({}, options, {tlds: {deny: new Set(deny)}})
        }
        assert((options.tlds as TldsOptions).deny instanceof Set, 'tlds.deny must be an array, Set, or boolean')
        assert(!(options.tlds as TldsOptions).allow, 'Cannot specify both tlds.allow and tlds.deny lists')
        validateTlds((options.tlds as TldsOptions).deny as Set<string>, 'tlds.deny')
        return options
    }
    const allow: TldsOptions['allow'] = options.tlds.allow
    if (!allow) {
        return {...options, tlds: false}
    }
    if (allow === true) {
        assert(tlds, 'Built-in TLD list disabled')
        return Object.assign({}, options, tlds)
    }
    if (Array.isArray(allow)) {
        options = Object.assign({}, options, {tlds: {allow: new Set(allow)}})
    }
    assert((options.tlds as TldsOptions).allow instanceof Set, 'tlds.allow must be an array, Set, or boolean')
    validateTlds((options.tlds as TldsOptions).allow as Set<string>, 'tlds.allow')
    return options
}

function validateTlds(set: Set<string>, source: string): void {
    for (const tld of set) {
        assert(isDomainValid(tld, {minDomainSegments: 1, maxDomainSegments: 1}), `${source} must contain valid top level domain names`)
    }
}

/**
 * The value as an ISO date string, or null when not a valid ISO date
 * @param value
 */
function isoDate(value: string): string | null {
    if (!Common.isIsoDate(value)) {
        return null
    }
    //Add missing trailing zeros to timeshift
    if (/.*T.*[+-]\d\d$/.test(value)) {
        value += '00'
    }
    const date: Date = new Date(value)
    if (isNaN(date.getTime())) {
        return null
    }
    return date.toISOString()
}

function length(schema: StringSchema, name: string, limit: unknown, operator: Common.CompareOperator, encoding: string | undefined): StringSchema {
    assert(!encoding || Buffer && Buffer.isEncoding(encoding), 'Invalid encoding:', encoding)
    return schema.$_addRule({name, method: 'length', args: {limit, encoding}, operator})
}
