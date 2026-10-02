import type {Module} from '@lakutata/core'
import type {CLIText, CLITranslate} from '@lakutata/entrypoint/adapter/commander'
import type {I18n} from '../I18n.js'
import type {ITranslator} from '../interfaces/ITranslator.js'
import {ProcessLocales} from '../lib/Locale.js'

export type CommanderTranslatorOptions = {
    /**
     * The I18n component, the object "i18n" by default
     */
    component?: string
    /**
     * The prefix of the keys of the texts in the messages, "cli" by default (cli.commands.greet.description); "" for
     * none
     */
    prefix?: string
    /**
     * The environment variable giving the language before the ones of the environment (LAKUTATA_LANG), none by default
     */
    environment?: string
}

/**
 * The English text of a text, its arguments filled
 * @param text
 */
function English(text: CLIText): string {
    return text.text.replace(/\{(\w+)\}/g, (all: string, name: string): string => text.params?.[name] ?? all)
}

/**
 * The texts of the help and of the prompts of the Commander adapter in the language of the user
 * (CommanderCLIEntrypoint({translate: CommanderTranslator()})): the messages of an I18n component, by the keys of the
 * texts (cli.commands.<command>.description, cli.commands.<command>.options.<property>, cli.help.usage…), in the
 * language of the environment; the English texts for the ones without a message
 * @param options
 */
export function CommanderTranslator(options: CommanderTranslatorOptions = {}): (module: Module) => Promise<CLITranslate> {
    const prefix: string = options.prefix ?? 'cli'
    return async (module: Module): Promise<CLITranslate> => {
        const i18n: I18n = await module.getObject<I18n>(options.component ?? 'i18n')
        const translator: ITranslator = i18n.translator(i18n.negotiate(ProcessLocales(options.environment)))
        return (text: CLIText): string => {
            const key: string = prefix ? `${prefix}.${text.key}` : text.key
            return translator.has(key) ? translator.t(key, text.params) : English(text)
        }
    }
}
