import {readFileSync} from 'node:fs'
import {addon, collationData} from './Addon.js'
import {EmbeddedOperationError} from './Errors.js'
import {type StringCollation} from './mingo/util/_bson.js'
import {type NativeCollation, type NativeCollator} from './Native.js'

/**
 * A collation of MongoDB: the rules comparing the strings of a query, a sort or an index, by the collators of the ICU
 * of the package (the same on every platform). {locale: "simple"} compares them by their code points, as no collation
 * does.
 *
 * @example
 * import {EmbeddedClient, type EmbeddedCollation} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * await items.insertMany([{name: 'apple'}, {name: 'Apple'}, {name: 'äpple'}])
 * const caseless: EmbeddedCollation = {locale: 'en', strength: 2}
 * console.log(await items.countDocuments({name: 'APPLE'}, {collation: caseless})) // 2
 */
export interface EmbeddedCollation {
    /**
     * The locale of the rules (en, fr_CA, zh@collation=pinyin...), or "simple"
     */
    locale: string

    /**
     * Whether the case is compared at the strengths 1 and 2
     */
    caseLevel?: boolean

    /**
     * Whether the uppercase or the lowercase letters sort first ("upper", "lower"), or as the locale sorts them ("off")
     */
    caseFirst?: 'upper' | 'lower' | 'off'

    /**
     * The level of the comparison: 1 the base letters, 2 the accents too, 3 the case too (the default), 4 the
     * punctuation ignored at the other levels, 5 every code point
     */
    strength?: number

    /**
     * Whether the digits are compared as numbers ("10" after "9")
     */
    numericOrdering?: boolean

    /**
     * Whether the spaces and the punctuation are compared ("non-ignorable") or ignored at the strengths 1 to 3
     * ("shifted")
     */
    alternate?: 'non-ignorable' | 'shifted'

    /**
     * The characters "shifted" ignores: the spaces and the punctuation ("punct"), or the spaces ("space")
     */
    maxVariable?: 'punct' | 'space'

    /**
     * Whether the text is normalized before it is compared
     */
    normalization?: boolean

    /**
     * Whether the accents are compared from the end of the string (French of Canada)
     */
    backwards?: boolean

    /**
     * The version of ICU of the rules, as the index of a collation tells it
     */
    version?: string
}

/**
 * The fields of a collation, in the order MongoDB tells them
 */
const FIELDS: string[] = ['locale', 'caseLevel', 'caseFirst', 'strength', 'numericOrdering', 'alternate', 'maxVariable', 'normalization', 'backwards', 'version']

/**
 * The fields of a collation of the booleans
 */
const BOOLEANS: Set<string> = new Set<string>(['caseLevel', 'numericOrdering', 'normalization', 'backwards'])

/**
 * The values of the fields of the strings of a collation, and the message of another value
 */
const CHOICES: Record<string, [string[], string]> = {
    caseFirst: [['upper', 'lower', 'off'], '\'upper\', \'lower\', or \'off\''],
    alternate: [['non-ignorable', 'shifted'], '\'non-ignorable\' or \'shifted\''],
    maxVariable: [['punct', 'space'], '\'punct\' or \'space\'']
}

/**
 * The names of the codes of MongoDB of the errors of a collation
 */
const CODE_NAMES: Record<number, string> = {2: 'BadValue', 9: 'FailedToParse', 14: 'TypeMismatch', 40414: 'Location40414', 40415: 'Location40415'}

/**
 * The most sort keys a collator keeps (the ones of the strings it compared last)
 */
const KEPT_KEYS: number = 100000

/**
 * The error of a collation, with the code of MongoDB
 * @param code
 * @param message
 */
function collationError(code: number, message: string): EmbeddedOperationError {
    return new EmbeddedOperationError(code, CODE_NAMES[code] ?? `Location${code}`, message)
}

/**
 * The type of a value as MongoDB names it in its errors
 * @param value
 * @internal
 */
export function typeName(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double'
    if (typeof value === 'boolean') return 'bool'
    return typeof value === 'object' ? 'object' : typeof value
}

/**
 * The number of a value of a numeric type (a number, or a number of bson), undefined for the other values
 * @param value
 */
function numberOf(value: unknown): number | undefined {
    if (typeof value === 'number') return value
    const bsontype: string | undefined = (value as { _bsontype?: string } | null)?._bsontype
    return bsontype === 'Int32' || bsontype === 'Double' || bsontype === 'Long' || bsontype === 'Decimal128' ? Number(String(value)) : undefined
}

/**
 * A collator of a collation: its collation as an index tells it (every field, the ones not given those of its locale),
 * its comparison of strings, and the sort keys of strings (their bytes compared give its order; it keeps the last
 * ones it computed)
 * @internal
 */
export class EmbeddedCollator implements StringCollation {
    /**
     * Its collation as MongoDB tells it, every field given
     */
    readonly collation: Required<EmbeddedCollation>

    /**
     * The text of its collation, the same for the collations of the same rules
     */
    readonly id: string

    protected readonly keys: Map<string, Buffer> = new Map<string, Buffer>()

    /**
     * @param opened the collator opened by the addon and the attributes it takes
     * @param locale the locale of its collation
     */
    constructor(protected readonly opened: NativeCollation, locale: string) {
        this.collation = {
            locale: locale,
            caseLevel: opened.caseLevel,
            caseFirst: opened.caseFirst as Required<EmbeddedCollation>['caseFirst'],
            strength: opened.strength,
            numericOrdering: opened.numericOrdering,
            alternate: opened.alternate as Required<EmbeddedCollation>['alternate'],
            maxVariable: opened.maxVariable as Required<EmbeddedCollation>['maxVariable'],
            normalization: opened.normalization,
            backwards: opened.backwards,
            version: opened.version
        }
        this.id = JSON.stringify(this.collation)
    }

    /**
     * The sort key of a string: it ends with a 0 and holds no other
     * @param text
     */
    sortKey(text: string): Buffer {
        let key: Buffer | undefined = this.keys.get(text)
        if (!key) {
            if (this.keys.size >= KEPT_KEYS) this.keys.clear()
            key = addon.sortKey(this.opened.collator, text)
            this.keys.set(text, key)
        }
        return key
    }

    /**
     * Compares two strings by its rules
     * @param a
     * @param b
     */
    compare(a: string, b: string): number {
        return a === b ? 0 : Buffer.compare(this.sortKey(a), this.sortKey(b))
    }

    /**
     * The key of a string that the strings it tells equal share (its sort key)
     * @param text
     */
    key(text: string): string {
        return this.sortKey(text).toString('latin1')
    }

    /**
     * The collator itself (for the order of the addon)
     */
    get native(): NativeCollator {
        return this.opened.collator
    }
}

/**
 * The collators opened, by the text of the collation given
 */
const collators: Map<string, EmbeddedCollator> = new Map<string, EmbeddedCollator>()

/**
 * The collator of a collation, checked as MongoDB checks it: none for no collation and for {locale: "simple"} (the code
 * points). A collation of a field it does not know, of a value of another type or out of its values, of a locale ICU
 * does not know fails with EmbeddedOperationError and the code of MongoDB
 * @param collation
 * @internal
 */
export function collatorOf(collation: unknown): EmbeddedCollator | undefined {
    if (collation === undefined || collation === null) return undefined
    if (typeof collation !== 'object' || Array.isArray(collation))
        throw collationError(14, `BSON field 'collation' is the wrong type '${typeName(collation)}', expected type 'object'`)
    const given: Record<string, unknown> = collation as Record<string, unknown>
    for (const field of Object.keys(given))
        if (!FIELDS.includes(field)) throw collationError(40415, `BSON field 'collation.${field}' is an unknown field.`)
    if (given.locale === undefined) throw collationError(40414, 'BSON field \'collation.locale\' is missing but a required field')
    if (typeof given.locale !== 'string')
        throw collationError(14, `BSON field 'collation.locale' is the wrong type '${typeName(given.locale)}', expected type 'string'`)
    if (!given.locale) throw collationError(2, 'Field \'locale\' is invalid in: { locale: "" }')
    const fields: string[] = Object.keys(given).filter((field: string): boolean => given[field] !== undefined)
    if (given.locale === 'simple') {
        if (fields.length > 1) throw collationError(9, `If locale=simple, no other fields should be present in: ${JSON.stringify(given)}`)
        return undefined
    }
    const attributes: Record<string, unknown> = {}
    for (const field of fields) {
        const value: unknown = given[field]
        if (field === 'locale' || field === 'version') {
            if (typeof value !== 'string')
                throw collationError(14, `BSON field 'collation.${field}' is the wrong type '${typeName(value)}', expected type 'string'`)
            continue
        }
        if (BOOLEANS.has(field)) {
            if (typeof value !== 'boolean')
                throw collationError(14, `BSON field 'collation.${field}' is the wrong type '${typeName(value)}', expected type 'bool'`)
            attributes[field] = value
        } else if (field === 'strength') {
            const strength: number | undefined = numberOf(value)
            if (strength === undefined)
                throw collationError(14, `BSON field 'collation.strength' is the wrong type '${typeName(value)}', expected types '[long, int, decimal, double]'`)
            if (!Number.isInteger(strength) || strength < 1 || strength > 5)
                throw collationError(9, `Field 'strength' must be an integer 1 through 5. Got: ${strength}`)
            attributes.strength = strength
        } else {
            if (typeof value !== 'string')
                throw collationError(14, `BSON field 'collation.${field}' is the wrong type '${typeName(value)}', expected type 'string'`)
            const [choices, told] = CHOICES[field]
            if (!choices.includes(value)) throw collationError(9, `Field '${field}' must be ${told}. Got: ${value}`)
            attributes[field] = value
        }
    }
    // The same attributes given in another order: the same collator
    const id: string = JSON.stringify([given.locale, Object.keys(attributes).sort().map((field: string): unknown => [field, attributes[field]])])
    let collator: EmbeddedCollator | undefined = collators.get(id)
    if (!collator) {
        if (!addon.collationData()) addon.collationData(readFileSync(collationData))
        let opened: NativeCollation
        try {
            opened = addon.collator(given.locale, attributes)
        } catch (error) {
            const code: number | undefined = (error as { code?: number }).code
            throw code === undefined ? error : collationError(code, (error as Error).message)
        }
        collator = new EmbeddedCollator(opened, given.locale)
        collators.set(id, collator)
    }
    if (given.version !== undefined && given.version !== collator.collation.version)
        throw collationError(2, `Collation version mismatch: ${given.version}, the collations of mongo-embedded are of ICU ${collator.collation.version}`)
    return collator
}
