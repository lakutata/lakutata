import {type NoCaseOptions, Split, ToLower, ToUpper} from './NoCase.js'

export type {NoCaseOptions}

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
