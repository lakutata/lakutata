import {type Locale, Split, ToLower} from './internal/CaseWords.js'

export interface SplitOptions {
    separateNumbers?: boolean
}

export interface NoCaseOptions extends SplitOptions {
    locale?: Locale
}

/**
 * Convert any string into a lower case string with spaces between words.
 */
export function NoCase(input: string, options?: NoCaseOptions): string {
    return Split(input, options)
        .map(ToLower(options?.locale))
        .join(' ')
}
