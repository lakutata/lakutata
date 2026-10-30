import {readFileSync} from 'node:fs'
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {buildI18nOptions, commanderTranslator, type NestedMessages} from 'lakutata/com/i18n'
import {CommandLineController} from './controllers/CommandLineController.js'
import {WorkspaceController} from './controllers/WorkspaceController.js'
import {PackController} from './controllers/PackController.js'
import {MigrationController} from './controllers/MigrationController.js'
import {NativeController} from './controllers/NativeController.js'
import {FFIController} from './controllers/FFIController.js'
import {I18nController} from './controllers/I18nController.js'
import {LANGUAGE_VARIABLE, LanguageMiddleware} from './lib/Language.js'
import {toolPackage} from './lib/Versions.js'

/**
 * The controllers of the commands of the tool
 */
export const CONTROLLERS = [CommandLineController, WorkspaceController, PackController, MigrationController, NativeController, FFIController, I18nController]

/**
 * The messages of the tool in the languages besides English (its texts in the code): its help, its prompts
 */
/**
 * The groups of commands: lakutata package --help lists the commands of the group package
 */
export const COMMAND_GROUPS: Record<string, string> = {
    package: 'Package the compiled application: into one JavaScript file, an executable or its installers',
    ffi: 'Generate the classes of the native libraries of @lakutata/ffi from their C headers'
}

/**
 * The messages of a language, read from its file of the locales (an import of JSON needs the import attributes, which
 * Node.js 18.10 does not read)
 * @param language
 */
function messagesOf(language: string): NestedMessages {
    return JSON.parse(readFileSync(new URL(`./locales/${language}.json`, import.meta.url), 'utf8'))
}

export const MESSAGES: Record<string, NestedMessages> = {'zh-CN': messagesOf('zh-CN'), 'zh-TW': messagesOf('zh-TW')}

/**
 * The application of the tool
 */
export function config(): ApplicationOptions {
    const tool = toolPackage()
    return {
        id: 'cli.lakutata.app',
        name: 'lakutata-cli',
        components: {
            //The help and the prompts in the language of the user (LAKUTATA_LANG, LC_ALL, LANG)
            i18n: buildI18nOptions({messages: MESSAGES}),
            entrypoint: buildEntrypoints({
                controllers: CONTROLLERS,
                middlewares: [LanguageMiddleware],
                cli: commanderCLIEntrypoint({
                    bin: 'lakutata',
                    description: tool.description,
                    version: tool.version,
                    groups: COMMAND_GROUPS,
                    translate: commanderTranslator({environment: LANGUAGE_VARIABLE})
                })
            })
        },
        bootstrap: ['entrypoint']
    }
}
