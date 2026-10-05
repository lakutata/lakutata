import {I18nMiddleware, type ITranslator} from 'lakutata/com/i18n'

/**
 * The environment variable giving the language of the tool before the ones of the environment (LC_ALL, LANG)
 */
export const LANGUAGE_VARIABLE: string = 'LAKUTATA_LANG'

/**
 * The language of the commands of the tool: LAKUTATA_LANG, then the environment
 */
export class LanguageMiddleware extends I18nMiddleware {
    protected readonly environmentVariable: string = LANGUAGE_VARIABLE
}

/**
 * A text of the tool in the language of the user: its message (cli.<key>), its English text without it
 * @param i18n
 * @param key
 * @param text
 * @param params
 */
export function localize(i18n: ITranslator, key: string, text: string, params: Record<string, string> = {}): string {
    return i18n.has(`cli.${key}`) ? i18n.t(`cli.${key}`, params) : text.replace(/\{(\w+)\}/g, (all: string, name: string): string => params[name] ?? all)
}
