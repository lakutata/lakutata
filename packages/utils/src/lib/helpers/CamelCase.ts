import {type NoCaseOptions} from './NoCase.js'
import {split, toLower, toUpper} from './internal/CaseWords.js'

/**
 * Convert a string of any case into camel case (`userId`). The words are found as {@link noCase} finds them: split at
 * the characters other than letters and digits (spaces, `_`, `-`, `.`…, which are dropped) and at the case changes
 * (`fooBar`, `XMLHttp`). The first word is in lower case, the others are capitalized and in lower case; a word starting
 * with a digit is prefixed with `_` (`version_2Beta`), so the words stay apart.
 * @param input The string to convert; an empty string, or one without letters nor digits, gives `''`.
 * @param options How the words are split and cased: `separateNumbers` also splits at the boundaries between letters and
 * digits (`version2beta` is one word by default, `version_2Beta` with it); `locale` is the locale of the case
 * conversions, the host's locale when `undefined` (a Turkish host lowers `I` to `ı`), and a locale-independent
 * conversion when `false`.
 * @returns The camel case string.
 * @example
 * ```typescript
 * import {camelCase} from 'lakutata/utils'
 *
 * console.log(camelCase('user_id'), camelCase('XMLHttpRequest'), camelCase('version 2 beta', {locale: false}))
 * //userId xmlHttpRequest version_2Beta
 * ```
 */
export function camelCase(input: string, options?: NoCaseOptions): string {
    const lower = toLower(options?.locale)
    const upper = toUpper(options?.locale)
    return split(input, options)
        .map((word, index) => {
            if (index === 0) {
                return lower(word)
            }
            const char0 = word[0]
            const initial = char0 >= '0' && char0 <= '9' ? '_' + char0 : upper(char0)
            return initial + lower(word.slice(1))
        })
        .join('')
}
