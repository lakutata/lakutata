/**
 * Give the canonical BCP 47 form of a language tag (`zh-cn` gives `zh-CN`, `iw` gives `he`). The POSIX locales of the
 * environment are converted: their encoding and modifier dropped, `_` replaced by `-` (`zh_CN.UTF-8` gives `zh-CN`,
 * `en_US@euro` gives `en-US`).
 * @param tag The tag; surrounding spaces are ignored.
 * @returns The canonical tag; `undefined` for an invalid tag, a tag whose language is not 2 or 3 letters, `C`,
 * `POSIX`, `*` and the empty string.
 * @example
 * ```typescript
 * import {NormalizeLocale} from 'lakutata/com/i18n'
 *
 * console.log(NormalizeLocale('zh_CN.UTF-8')) //zh-CN
 * console.log(NormalizeLocale('zh-hant-tw')) //zh-Hant-TW
 * console.log(NormalizeLocale('C')) //undefined
 * ```
 */
export function NormalizeLocale(tag: string): string | undefined {
    //The encoding and the modifier of the locales of the environment: zh_CN.UTF-8, de_DE@euro
    const trimmed: string = tag.trim().replace(/[.@].*$/, '').replace(/_/g, '-')
    if (!trimmed || trimmed === 'C' || trimmed === 'POSIX' || trimmed === '*') return undefined
    //The languages are their codes of ISO 639 (2 or 3 letters): the longer subtags of BCP 47 are reserved
    if (!/^[a-z]{2,3}(-|$)/i.test(trimmed)) return undefined
    try {
        return Intl.getCanonicalLocales(trimmed)[0]
    } catch {
        return undefined
    }
}

/**
 * The language of a tag, without its script and region: zh-Hant-TW → zh
 * @param locale
 */
export function LanguageOf(locale: string): string {
    return locale.split('-')[0].toLowerCase()
}

/**
 * Read the languages of an `Accept-Language` header, preferred first: by decreasing quality (`q`, 1 when absent),
 * then in their order in the header. The tags are normalized ({@link NormalizeLocale}); the invalid ones, `*`, and the
 * ones of quality 0 or an invalid quality are dropped.
 * @param header The value of the header (`zh-CN,zh;q=0.9,en;q=0.8`).
 * @returns The language tags, preferred first; empty without a header.
 * @example
 * ```typescript
 * import {ParseAcceptLanguage} from 'lakutata/com/i18n'
 *
 * console.log(ParseAcceptLanguage('en;q=0.5,fr,*;q=0.1')) //['fr', 'en']
 * ```
 */
export function ParseAcceptLanguage(header: string | undefined): string[] {
    if (!header) return []
    return header.split(',')
        .map((part: string, index: number): { locale: string | undefined, quality: number, index: number } => {
            const [tag, ...parameters] = part.split(';')
            const quality: string | undefined = parameters.map((parameter: string): string => parameter.trim()).find((parameter: string): boolean => parameter.startsWith('q='))
            return {locale: NormalizeLocale(tag), quality: quality === undefined ? 1 : Number(quality.slice(2)), index: index}
        })
        .filter((item): item is { locale: string, quality: number, index: number } => item.locale !== undefined && item.quality > 0 && !Number.isNaN(item.quality))
        //By quality, then in their order
        .sort((a, b): number => b.quality - a.quality || a.index - b.index)
        .map((item): string => item.locale)
}

/**
 * Read the languages of a process environment, preferred first, as gettext does: the locale is the first of `LC_ALL`,
 * `LC_MESSAGES` and `LANG` which is set; the colon-separated list of `LANGUAGE` comes before it, but only when that
 * locale is set and valid (not `C` or `POSIX`). The tags are normalized ({@link NormalizeLocale}), the invalid ones
 * and the duplicates dropped.
 * @param environment The environment variables: `process.env` by default.
 * @returns The language tags, preferred first; empty when the environment gives none.
 * @example
 * ```typescript
 * import {EnvironmentLocales} from 'lakutata/com/i18n'
 *
 * console.log(EnvironmentLocales({LANG: 'zh_CN.UTF-8', LANGUAGE: 'zh_TW:en'})) //['zh-TW', 'en', 'zh-CN']
 * ```
 */
export function EnvironmentLocales(environment: NodeJS.ProcessEnv = process.env): string[] {
    //LANGUAGE is used by gettext only when the locale is not C
    const locale: string | undefined = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG
    const list: string[] = locale && NormalizeLocale(locale) !== undefined && environment.LANGUAGE ? environment.LANGUAGE.split(':') : []
    return Unique([...list, ...(locale ? [locale] : [])].map(NormalizeLocale).filter((tag: string | undefined): tag is string => tag !== undefined))
}

/**
 * The languages of the process, preferred first: the one of an environment variable of the application
 * (LAKUTATA_LANG), the ones of the environment (EnvironmentLocales), the language of the process (of its ICU)
 * @param variable the environment variable of the application
 * @param environment
 */
export function ProcessLocales(variable?: string, environment: NodeJS.ProcessEnv = process.env): string[] {
    const own: string | undefined = variable ? NormalizeLocale(environment[variable] ?? '') : undefined
    return Unique([...(own ? [own] : []), ...EnvironmentLocales(environment), new Intl.DateTimeFormat().resolvedOptions().locale])
}

/**
 * Choose the supported language for the requested ones. Each requested language is tried in turn, preferred first,
 * and the first match wins: the same tag (case-insensitive), then its language alone (`en-GB` matches `en`), then
 * another tag of its language (`pt-PT` matches `pt-BR`, the first one in the order of `supported`). The invalid
 * requested tags are skipped.
 * @param requested The requested language tags, preferred first (from {@link ParseAcceptLanguage} or
 * {@link EnvironmentLocales}).
 * @param supported The supported language tags.
 * @param defaultLocale The language returned when none of the requested ones matches.
 * @returns The matching tag as written in `supported`, or `defaultLocale`.
 * @example
 * ```typescript
 * import {NegotiateLocale} from 'lakutata/com/i18n'
 *
 * console.log(NegotiateLocale(['pt-PT', 'en'], ['en', 'pt-BR'], 'en')) //pt-BR
 * console.log(NegotiateLocale(['de'], ['en', 'zh-CN'], 'en')) //en
 * ```
 */
export function NegotiateLocale(requested: string[], supported: string[], defaultLocale: string): string {
    const canonical: string[] = supported.map((tag: string): string => NormalizeLocale(tag) ?? tag)
    const find = (predicate: (tag: string) => boolean): string | undefined => {
        const index: number = canonical.findIndex(predicate)
        return index < 0 ? undefined : supported[index]
    }
    for (const tag of requested) {
        const locale: string | undefined = NormalizeLocale(tag)
        if (!locale) continue
        const lower: string = locale.toLowerCase()
        const language: string = LanguageOf(locale)
        const matched: string | undefined = find((candidate: string): boolean => candidate.toLowerCase() === lower) ??
            find((candidate: string): boolean => candidate.toLowerCase() === language) ??
            find((candidate: string): boolean => LanguageOf(candidate) === language)
        if (matched) return matched
    }
    return defaultLocale
}

/**
 * List the languages a message of a language is looked up in, in their order, each once: the language, then each of
 * its configured fallbacks (followed by their own fallbacks and less specific tags), then its less specific tags
 * (`zh-Hant-TW`, `zh-Hant`, `zh`), then the default language (and its own fallbacks and less specific tags). The tags
 * are not normalized: give canonical ones.
 * @param locale The language tag of the message asked.
 * @param fallbacks The configured fallbacks, by language tag.
 * @param defaultLocale The default language tag.
 * @returns The language tags, in lookup order.
 * @example
 * ```typescript
 * import {FallbackChain} from 'lakutata/com/i18n'
 *
 * console.log(FallbackChain('zh-TW', {'zh-TW': ['zh-CN']}, 'en')) //['zh-TW', 'zh-CN', 'zh', 'en']
 * console.log(FallbackChain('zh-Hant-TW', {}, 'en')) //['zh-Hant-TW', 'zh-Hant', 'zh', 'en']
 * ```
 */
export function FallbackChain(locale: string, fallbacks: Record<string, string[]>, defaultLocale: string): string[] {
    const chain: string[] = []
    const visit = (tag: string): void => {
        if (chain.includes(tag)) return
        chain.push(tag)
        for (const fallback of fallbacks[tag] ?? []) visit(fallback)
        const parts: string[] = tag.split('-')
        if (parts.length > 1) visit(parts.slice(0, -1).join('-'))
    }
    visit(locale)
    visit(defaultLocale)
    return chain
}

/**
 * The values once, in their order
 * @param values
 */
function Unique(values: string[]): string[] {
    return [...new Set(values)]
}
