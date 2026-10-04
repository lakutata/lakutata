import {type Locale, Split, ToLower} from './internal/CaseWords.js'

/**
 * How a string is split into words by the case conversions (`NoCase`, `CamelCase`).
 */
export interface SplitOptions {
    /**
     * Whether the digits make words of their own: `'version2Beta'` gives `version 2 beta` instead of `version2 beta`.
     * @default false (a digit stays with the letters before it)
     */
    separateNumbers?: boolean
}

/**
 * The options of `NoCase`: how the words are split, and the locale of their lower case.
 */
export interface NoCaseOptions extends SplitOptions {
    /**
     * The locale of the lower case, as accepted by `String.prototype.toLocaleLowerCase` (`'tr'` turns `I` into `ı`), or
     * `false` for the locale-independent `toLowerCase()`.
     * @default undefined (the runtime's default locale)
     */
    locale?: Locale
}

/**
 * Convert a string in any case (camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, sentences) into lower
 * case words separated by single spaces. A word starts at each lower-to-upper change (`fooBar`), at the last capital of
 * an acronym (`XMLHttp` gives `xml http`), and after any run of characters which are neither letters nor digits
 * (spaces, `_`, `-`, punctuation, which are removed). The letters of any script are kept.
 * @param input The string to convert; an empty string, or one without letters and digits, gives `''`.
 * @param options How the words are split, and the locale of the lower case.
 * @returns The lower case words, separated by spaces.
 * @example
 * ```typescript
 * import {NoCase} from 'lakutata/utils'
 *
 * console.log(NoCase('helloWorld_fooBar-BAZ'))
 * //hello world foo bar baz
 * console.log(NoCase('XMLHttpRequest'), '|', NoCase('version2Beta', {separateNumbers: true}))
 * //xml http request | version 2 beta
 * ```
 */
export function NoCase(input: string, options?: NoCaseOptions): string {
    return Split(input, options)
        .map(ToLower(options?.locale))
        .join(' ')
}
