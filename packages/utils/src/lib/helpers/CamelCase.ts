import {type NoCaseOptions} from './NoCase.js'
import {Split, ToLower, ToUpper} from './internal/CaseWords.js'

/**
 * Convert any string into a camel case string (the words of NoCase, the first one in lower case, the others
 * capitalized, a digit starting a word prefixed by _)
 * @param input
 * @param options
 * @constructor
 */
export function CamelCase(input: string, options?: NoCaseOptions): string {
    const lower = ToLower(options?.locale)
    const upper = ToUpper(options?.locale)
    return Split(input, options)
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
