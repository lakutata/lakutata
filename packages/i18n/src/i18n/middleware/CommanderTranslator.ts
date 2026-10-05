import type {Module} from '@lakutata/core'
import type {CLIText, CLITranslate} from '@lakutata/entrypoint/adapter/commander'
import type {I18n} from '../I18n.js'
import type {ITranslator} from '../interfaces/ITranslator.js'
import {ProcessLocales} from '../lib/Locale.js'

/**
 * The options of {@link commanderTranslator}.
 */
export type CommanderTranslatorOptions = {
    /**
     * The name the {@link I18n} component is registered under.
     * @default 'i18n'
     */
    component?: string
    /**
     * The prefix of the message keys of the texts: with `'cli'`, the description of the command `greet` is the message
     * `cli.commands.greet.description`; `''` for no prefix.
     * @default 'cli'
     */
    prefix?: string
    /**
     * The name of an environment variable (`LAKUTATA_LANG`) whose language is preferred to the ones of the environment.
     * @default none
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
 * Translate the help and the prompts of the Commander CLI adapter with the messages of an {@link I18n} component: give
 * it to the `translate` option of `commanderCLIEntrypoint()`. Each text is the message of its key under the prefix
 * (`cli.description`, `cli.commands.<command>.description`, `cli.commands.<command>.arguments.<name>`,
 * `cli.commands.<command>.options.<property>`, `cli.help.usage`, `cli.help.options`, `cli.help.default`,
 * `cli.prompt.json`…), formatted with the text's parameters (`{value}`); a text without a message keeps its English
 * text. The language is chosen once, when the adapter starts: the environment variable of the `environment` option,
 * the environment ({@link environmentLocales}), then the process's language, negotiated with the component's
 * supported languages. The names of the commands and of the options are never translated.
 * @param options The component, the key prefix and the environment variable.
 * @returns The `translate` function of the adapter, which gets the component from the application's module.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
 * import {CLIAction} from 'lakutata/decorator/ctrl'
 * import {buildI18nOptions, commanderTranslator, I18nMiddleware} from 'lakutata/com/i18n'
 *
 * class GreetController extends Controller {
 *     @CLIAction('greet', {description: 'Greet someone'})
 *     public async greet(): Promise<string> {
 *         return 'Hello'
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'tool.app',
 *     name: 'Tool',
 *     components: {
 *         i18n: buildI18nOptions({
 *             messages: {
 *                 'zh-CN': {cli: {commands: {greet: {description: '问候某人'}}, help: {usage: '用法：', options: '选项：'}}}
 *             }
 *         }),
 *         entrypoint: buildEntrypoints({
 *             controllers: [GreetController],
 *             //The controllers' Translator in the same language
 *             middlewares: [I18nMiddleware],
 *             //LANG=zh_CN.UTF-8 tool --help: the help in Chinese
 *             cli: commanderCLIEntrypoint({bin: 'tool', translate: commanderTranslator({environment: 'TOOL_LANG'})})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function commanderTranslator(options: CommanderTranslatorOptions = {}): (module: Module) => Promise<CLITranslate> {
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
