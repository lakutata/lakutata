/**
 * The tag of a language (BCP 47), canonical: zh-CN, zh-Hant-TW, en. The tags of the environment (zh_CN.UTF-8,
 * en_US@euro) are converted; an invalid tag gives undefined
 * @param tag
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
 * The languages of an Accept-Language header, by their quality (the first one preferred): "zh-CN,zh;q=0.9,en;q=0.8"
 * @param header
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
 * The languages of the environment of a process, preferred first: LANGUAGE (a list), LC_ALL, LC_MESSAGES, LANG
 * @param environment
 */
export function EnvironmentLocales(environment: NodeJS.ProcessEnv = process.env): string[] {
    //LANGUAGE is used by gettext only when the locale is not C
    const locale: string | undefined = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG
    const list: string[] = locale && NormalizeLocale(locale) !== undefined && environment.LANGUAGE ? environment.LANGUAGE.split(':') : []
    return Unique([...list, ...(locale ? [locale] : [])].map(NormalizeLocale).filter((tag: string | undefined): tag is string => tag !== undefined))
}

/**
 * The language among the supported ones for the requested ones, preferred first: the same tag, the language of the
 * requested one supported alone (en-GB → en), a tag of the same language (en-GB → en-US, in the order of the supported
 * ones); the default one when none matches
 * @param requested
 * @param supported
 * @param defaultLocale
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
 * The languages looked up for a message of a language, in their order: the language, its fallbacks (and theirs), the
 * tags it is more specific than (zh-Hant-TW → zh-Hant → zh), the default language
 * @param locale
 * @param fallbacks
 * @param defaultLocale
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
