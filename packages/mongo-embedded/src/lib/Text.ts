import { addon } from './Addon.js'
import { EmbeddedOperationError, MongoEmbeddedError } from './Errors.js'
import { TEXT_SCORE } from './mingo/util/_meta.js'
import { type EmbeddedIndex } from './Planner.js'
import { type EmbeddedDocument } from './Values.js'

export { TEXT_SCORE }

/**
 * The languages of the text indexes, as MongoDB 8.0 names them (their names and their codes): their ids in the addon
 * (none: no stop words, no stemming)
 */
const LANGUAGES: Record<string, number> = {
    none: 0,
    danish: 1, da: 1,
    dutch: 2, nl: 2,
    english: 3, en: 3,
    finnish: 4, fi: 4,
    french: 5, fr: 5,
    german: 6, de: 6,
    hungarian: 7, hu: 7,
    italian: 8, it: 8,
    norwegian: 9, nb: 9,
    portuguese: 10, pt: 10,
    romanian: 11, ro: 11,
    russian: 12, ru: 12,
    spanish: 13, es: 13,
    swedish: 14, sv: 14,
    turkish: 15, tr: 15
}

/**
 * The flags of the terms of a text: its case kept, its diacritics kept
 */
const CASE_SENSITIVE = 1
const DIACRITIC_SENSITIVE = 2

/**
 * The field of the text indexes in the key of their entries (_fts: "text", _ftsx: 1), the fields before it and after
 * it the ones given before and after the text fields
 */
const TEXT_KEY = '_fts'

/**
 * The id of a language of the text indexes (its name or its code), undefined for a language it does not have
 *
 * @param language
 */
export function languageOf(language: unknown): number | undefined {
    return typeof language === 'string' && Object.hasOwn(LANGUAGES, language) ? LANGUAGES[language] : undefined
}

/**
 * Whether an index is a text index
 *
 * @param index
 */
export function isTextIndex(index: EmbeddedIndex): boolean {
    return index.key[TEXT_KEY] === 'text'
}

/**
 * The fields of an index before its text fields: a $text query gives each one by an equality
 *
 * @param index
 */
export function prefixFieldsOf(index: EmbeddedIndex): string[] {
    const fields = Object.keys(index.key)
    return fields.slice(0, fields.indexOf(TEXT_KEY))
}

/**
 * A text index, as MongoDB 8.0 makes it (createIndex): its key the fields before its text fields, _fts: "text" and
 * _ftsx: 1, then the fields after them; the weights of its text fields (1 by default, its option weights: more fields
 * too, between 0 and 100000, their integers), its default language (english), the field of the language of a document
 * (language_override, language), its version (3, the only one supported). Undefined when the key has no text field
 *
 * @param key the key given
 * @param options the options given
 * @param name its name
 * @param failure the error of a specification that fails (CannotCreateIndex, 67)
 */
export function textIndexOf(key: EmbeddedDocument, options: EmbeddedDocument, name: string, failure: (message: string) => Error): EmbeddedIndex | undefined {
    const fields = Object.keys(key)
    const texts = fields.filter((field) => key[field] === 'text')
    if (!texts.length) return undefined
    if (fields.some((field) => typeof key[field] === 'string' && key[field] !== 'text'))
        throw failure("Can't use more than one index plugin for a single index.")
    const first = fields.indexOf(texts[0])
    if (fields.slice(first, first + texts.length).some((field) => key[field] !== 'text'))
        throw failure("'text' fields in index must all be adjacent")
    if (options.collation !== undefined) throw failure("Index type 'text' does not support collation")
    const weights: Record<string, number> = Object.fromEntries(texts.map((field) => [field, 1]))
    if (options.weights !== undefined) {
        if (typeof options.weights !== 'object' || options.weights === null || Array.isArray(options.weights))
            throw failure("text index option 'weights' must be an object")
        for (const [field, given] of Object.entries(options.weights as EmbeddedDocument)) {
            const weight = typeof given === 'number' ? given : ['Int32', 'Double', 'Long', 'Decimal128'].includes(given?._bsontype) ? Number(given.valueOf?.() ?? String(given)) : undefined
            if (weight === undefined) throw failure('weight for text index needs numeric type')
            if (!(weight > 0 && weight < 100000)) throw failure(`text index weight must be in the exclusive interval (0,100000) but found: ${weight}`)
            weights[field] = Math.trunc(weight)
        }
    }
    const language = options.default_language ?? 'english'
    if (languageOf(language) === undefined) throw failure('default_language is not valid')
    const override = options.language_override ?? 'language'
    if (typeof override !== 'string') throw failure('language_override must be a string')
    const version = options.textIndexVersion ?? 3
    if (version !== 3) {
        if (version === 1 || version === 2) throw new MongoEmbeddedError(`text indexes of version ${version} are not supported by mongo-embedded (version 3 only)`)
        throw failure(`bad textIndexVersion: ${String(version)}`)
    }
    const indexed: EmbeddedDocument = {}
    for (const field of fields.slice(0, first)) indexed[field] = key[field]
    indexed[TEXT_KEY] = 'text'
    indexed._ftsx = 1
    for (const field of fields.slice(first + texts.length)) indexed[field] = key[field]
    return {
        name: name,
        key: indexed,
        weights: weights,
        default_language: language,
        language_override: override,
        textIndexVersion: 3
    } as EmbeddedIndex
}

/**
 * The language of the strings of a document (or of an embedded document): its field of the language when it has one
 * (a string of a language, else it fails as MongoDB fails it), else the one given
 *
 * @param index
 * @param document
 * @param language the language around it
 */
function languageIn(index: EmbeddedIndex, document: EmbeddedDocument, language: number): number {
    const override = (index as EmbeddedDocument).language_override as string
    if (!Object.hasOwn(document, override)) return language
    const given = document[override]
    if (typeof given !== 'string')
        throw new EmbeddedOperationError(17261, 'Location17261', 'found language override field in document with non-string type')
    const id = languageOf(given)
    if (id === undefined) throw new EmbeddedOperationError(17262, 'Location17262', `language override unsupported: ${given}`)
    return id
}

/**
 * Whether a value is a document (not an array, nor a value of BSON)
 *
 * @param value
 */
function isDocument(value: unknown): value is EmbeddedDocument {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as EmbeddedDocument)._bsontype === undefined && !(value instanceof Date)
}

/**
 * The strings a text index takes at a path of a document, with their languages: the string there, or the strings of an
 * array there; through the documents of an array on the way (not an array of arrays)
 *
 * @param index
 * @param value
 * @param names the names of the path left
 * @param language the language around the value
 * @param strings
 */
function stringsAt(index: EmbeddedIndex, value: unknown, names: string[], language: number, strings: [string, number][]): void {
    if (!names.length) {
        if (typeof value === 'string') strings.push([value, language])
        else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') strings.push([item, language])
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) if (isDocument(item)) stringsAt(index, item, names, language, strings)
        return
    }
    if (!isDocument(value)) return
    const inside = languageIn(index, value, language)
    stringsAt(index, value[names[0]], names.slice(1), inside, strings)
}

/**
 * Every string of a document (a wildcard text index, $**), with their languages, but the ones of the fields given a
 * weight of their own
 *
 * @param index
 * @param value
 * @param path its path
 * @param language
 * @param own the fields given a weight of their own
 * @param strings
 */
function everyString(index: EmbeddedIndex, value: unknown, path: string, language: number, own: Set<string>, strings: [string, number][]): void {
    if (own.has(path)) return
    if (typeof value === 'string') strings.push([value, language])
    else if (Array.isArray(value)) for (const item of value) everyString(index, item, path, language, own, strings)
    else if (isDocument(value)) {
        const inside = languageIn(index, value, language)
        for (const field of Object.keys(value)) everyString(index, value[field], path ? `${path}.${field}` : field, inside, own, strings)
    }
}

/**
 * The scores of the terms of a document in a text index, as MongoDB 8.0 scores them: in each string of a field, a term
 * found n times scores (1 + 1/2 + ... + 1/2^(n-1)) * (0.5 * n / words + 0.5) (its words the ones that are not stop
 * words), times the weight of the field; the scores of a term in the strings and the fields of the document added up
 *
 * @param index
 * @param document
 */
export function textScoresOf(index: EmbeddedIndex, document: EmbeddedDocument): Map<string, number> {
    const { weights, default_language } = index as EmbeddedDocument
    const language = languageIn(index, document, languageOf(default_language)!)
    const scores = new Map<string, number>()
    const own = new Set(Object.keys(weights).filter((field) => field !== '$**'))
    for (const [field, weight] of Object.entries(weights as Record<string, number>)) {
        const strings: [string, number][] = []
        if (field === '$**') everyString(index, document, '', language, own, strings)
        else stringsAt(index, document, field.split('.'), language, strings)
        for (const [text, textLanguage] of strings) {
            const { terms, words } = addon.textTerms(text, textLanguage, 0)
            const counts = new Map<string, number>()
            for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1)
            for (const [term, count] of counts) {
                const frequency = 2 - 2 ** (1 - count)
                const coefficient = (0.5 * count) / words + 0.5
                scores.set(term, (scores.get(term) ?? 0) + weight * frequency * coefficient)
            }
        }
    }
    return scores
}

/**
 * The strings of a document a text index takes, with their languages (the phrases of a $text are looked for in them)
 *
 * @param index
 * @param document
 */
function stringsOf(index: EmbeddedIndex, document: EmbeddedDocument): [string, number][] {
    const { weights, default_language } = index as EmbeddedDocument
    const language = languageIn(index, document, languageOf(default_language)!)
    const strings: [string, number][] = []
    const own = new Set(Object.keys(weights).filter((field) => field !== '$**'))
    for (const field of Object.keys(weights)) {
        if (field === '$**') everyString(index, document, '', language, own, strings)
        else stringsAt(index, document, field.split('.'), language, strings)
    }
    return strings
}

/**
 * The keys of a document in a text index: for each of its terms, the keys of the fields before the text fields, the
 * key of the term, then its score (8 bytes, a double); a field before them holding an array fails it (201)
 *
 * @param index
 * @param document
 * @param encode the key of a value in a field of a direction
 */
export function textKeysOf(index: EmbeddedIndex, document: EmbeddedDocument, encode: (value: unknown, direction: unknown) => Buffer): Buffer[] {
    const scores = textScoresOf(index, document)
    if (!scores.size) return []
    const prefix = Buffer.concat(prefixFieldsOf(index).map((field) => {
        const value = valueAt(document, field)
        if (Array.isArray(value))
            throw new EmbeddedOperationError(201, 'Location201', `Field '${field}' of text index contains an array in document`)
        return encode(value ?? null, index.key[field])
    }))
    return [...scores].map(([term, score]) => {
        const scored = Buffer.allocUnsafe(8)
        scored.writeDoubleBE(score)
        return Buffer.concat([prefix, encode(term, 1), scored])
    })
}

/**
 * The value at a path of a document (undefined when a step is not a document)
 *
 * @param document
 * @param path
 */
function valueAt(document: EmbeddedDocument, path: string): unknown {
    let value: unknown = document
    for (const name of path.split('.')) {
        if (!isDocument(value)) return undefined
        value = value[name]
    }
    return value
}

/**
 * A $text query: the terms its documents are found by (the ones of its words and of its phrases, folded as the index
 * holds them), the same terms in its case and with its diacritics when it keeps them ($caseSensitive,
 * $diacriticSensitive), the terms they must not have (in its case and with its diacritics too), the phrases they must
 * have and must not have, its language and its flags
 */
export interface EmbeddedTextQuery {
    terms: string[]
    exact: string[]
    negated: string[]
    phrases: string[]
    negatedPhrases: string[]
    language: number
    flags: number
}

/**
 * A $text checked as MongoDB 8.0 checks it ($search a string, $language one of the text indexes, $caseSensitive and
 * $diacriticSensitive booleans, no other field), then parsed: its words and its phrases ("..."), the ones negated by a
 * minus before them (-word, -"phrase"), as terms of its language (the default one of the index)
 *
 * @param text the value of $text
 * @param index the text index of the collection
 */
export function textQueryOf(text: unknown, index: EmbeddedIndex): EmbeddedTextQuery {
    if (!isDocument(text)) throw new EmbeddedOperationError(2, 'BadValue', '$text expects an object')
    for (const field of Object.keys(text))
        if (!['$search', '$language', '$caseSensitive', '$diacriticSensitive'].includes(field))
            throw new EmbeddedOperationError(2, 'BadValue', 'extra fields in $text')
    if (text.$search === undefined) throw new EmbeddedOperationError(4, 'NoSuchKey', 'Missing expected field "$search"')
    if (typeof text.$search !== 'string')
        throw new EmbeddedOperationError(14, 'TypeMismatch', `"$search" had the wrong type. Expected string, found ${typeNameOf(text.$search)}`)
    for (const field of ['$language', '$caseSensitive', '$diacriticSensitive'] as const) {
        const expected = field === '$language' ? 'string' : 'boolean'
        if (text[field] !== undefined && typeof text[field] !== expected)
            throw new EmbeddedOperationError(14, 'TypeMismatch', `"${field}" had the wrong type. Expected ${expected === 'string' ? 'string' : 'bool'}, found ${typeNameOf(text[field])}`)
    }
    const language = languageOf(text.$language ?? (index as EmbeddedDocument).default_language)
    if (language === undefined) throw new EmbeddedOperationError(2, 'BadValue', `unsupported language: "${text.$language}" for text index version 3`)
    const flags = (text.$caseSensitive ? CASE_SENSITIVE : 0) | (text.$diacriticSensitive ? DIACRITIC_SENSITIVE : 0)
    const query: EmbeddedTextQuery = { terms: [], exact: [], negated: [], phrases: [], negatedPhrases: [], language: language, flags: flags }
    const positive = (text: string) => {
        query.terms.push(...addon.textTerms(text, language, 0).terms)
        if (flags) query.exact.push(...addon.textTerms(text, language, flags).terms)
    }
    const search: string = text.$search
    const space = (character: string) => /\s/u.test(character)
    for (let at = 0; at < search.length;) {
        if (space(search[at])) {
            at++
            continue
        }
        let negate = false
        if (search[at] === '-') {
            negate = true
            at++
            if (at >= search.length || space(search[at])) continue
        }
        if (search[at] === '"') {
            const end = search.indexOf('"', at + 1)
            const phrase = search.slice(at + 1, end < 0 ? search.length : end)
            at = end < 0 ? search.length : end + 1
            if (negate) query.negatedPhrases.push(phrase)
            else {
                query.phrases.push(phrase)
                positive(phrase)
            }
            continue
        }
        let end = at
        while (end < search.length && !space(search[end]) && search[end] !== '"') end++
        const word = search.slice(at, end)
        at = end
        if (negate) query.negated.push(...addon.textTerms(word, language, flags).terms)
        else positive(word)
    }
    query.terms = [...new Set(query.terms)]
    query.exact = [...new Set(query.exact)]
    query.negated = [...new Set(query.negated)]
    return query
}

/**
 * The name of the type of a value, as MongoDB names it in the errors of $text
 *
 * @param value
 */
function typeNameOf(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double'
    if (typeof value === 'boolean') return 'bool'
    if (Array.isArray(value)) return 'array'
    return typeof value === 'object' ? 'object' : typeof value
}

/**
 * Whether a document found by the terms of a $text matches the rest of it: its phrases there, its negated terms and
 * phrases not there; with $caseSensitive or $diacriticSensitive, one of its terms there in that case or with those
 * diacritics (the index holds them folded), as MongoDB 8.0 checks them in the strings the index takes
 *
 * @param query
 * @param index
 * @param document
 */
export function textMatches(query: EmbeddedTextQuery, index: EmbeddedIndex, document: EmbeddedDocument): boolean {
    const exact = query.flags !== 0
    if (!exact && !query.negated.length && !query.phrases.length && !query.negatedPhrases.length) return true
    const strings = stringsOf(index, document)
    if (query.phrases.length || query.negatedPhrases.length) {
        const texts = strings.map(([text]) => addon.textNormalized(text, query.language, query.flags))
        const holds = (phrase: string) => {
            const normalized = addon.textNormalized(phrase, query.language, query.flags)
            return texts.some((text) => text.includes(normalized))
        }
        if (!query.phrases.every(holds) || query.negatedPhrases.some(holds)) return false
    }
    // The terms of the document, as the $text takes them (in its case, with its diacritics)
    const terms = new Set<string>()
    for (const [text, language] of strings) for (const term of addon.textTerms(text, language, query.flags).terms) terms.add(term)
    if (query.negated.some((term) => terms.has(term))) return false
    return !exact || query.exact.some((term) => terms.has(term))
}
