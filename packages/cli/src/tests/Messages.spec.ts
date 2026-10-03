import {describe, it} from 'node:test'
import assert from 'node:assert'
import {PassThrough} from 'node:stream'
import {Container} from 'lakutata'
import {BuildEntrypoints, Entrypoint} from 'lakutata/com/entrypoint'
import {CommanderCLIEntrypoint, type CLIText} from 'lakutata/adapter/commander'
import {BuildI18nOptions, I18n} from 'lakutata/com/i18n'
import {COMMAND_GROUPS, CONTROLLERS, MESSAGES} from '../Config.js'
import {CLI, Run} from './support/Workspace.js'

/**
 * The keys of the texts of the commands (their prompts, the plan of the project they show), not asked by the help
 */
const COMMAND_KEYS: string[] = [
    'prompt.json',
    'prompts.features', 'prompts.create', 'prompts.notCreated', 'prompts.version', 'prompts.notVersioned',
    'plan.title', 'plan.name', 'plan.id', 'plan.description', 'plan.author', 'plan.license', 'plan.template', 'plan.features',
    'plan.none', 'plan.directory', 'plan.dependencies', 'plan.notInstalled', 'plan.installed', 'plan.git', 'plan.initialized',
    'plan.notInitialized', 'plan.version'
]

/**
 * The keys of the texts the help of the tool asks for: its program, its commands, their arguments and options, the
 * titles
 */
async function HelpKeys(): Promise<Set<string>> {
    const keys: Set<string> = new Set()
    for (const argv of [['--help'], ['i18n', '--help']]) {
        const output: PassThrough = new PassThrough()
        output.resume()
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({
            controllers: CONTROLLERS,
            cli: CommanderCLIEntrypoint({
                bin: 'lakutata', description: 'The tool', version: '1.0.0', groups: COMMAND_GROUPS, interactive: false, argv: argv, stdout: output, stderr: output, exit: (): undefined => undefined,
                translate: () => (text: CLIText): string => {
                    keys.add(text.key)
                    return text.text
                }
            })
        }))
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
        await container.destroy()
    }
    return keys
}

/**
 * The keys of nested messages
 * @param messages
 * @param prefix
 */
function Keys(messages: Record<string, unknown>, prefix: string = ''): string[] {
    return Object.entries(messages).flatMap(([key, value]: [string, unknown]): string[] => typeof value === 'string' ? [`${prefix}${key}`] : Keys(value as Record<string, unknown>, `${prefix}${key}.`))
}

describe('The messages of the tool', (): void => {
    it('translate every text of the help and of the prompts, and only them, in every language', async (): Promise<void> => {
        const expected: string[] = [...await HelpKeys(), ...COMMAND_KEYS].sort()
        assert.ok(expected.includes('commands.create.options.with') && expected.includes('help.arguments'), expected.join(', '))
        for (const [locale, messages] of Object.entries(MESSAGES)) {
            const keys: string[] = Keys((messages as { cli: Record<string, unknown> }).cli).sort()
            assert.deepStrictEqual(keys.filter((key: string): boolean => !expected.includes(key)), [], `${locale}: the messages of no text`)
            assert.deepStrictEqual(expected.filter((key: string): boolean => !keys.includes(key)), [], `${locale}: the texts without their messages`)
        }
        //Every message is formatted (its syntax, its arguments)
        const i18n: I18n = await new Container().set(I18n, BuildI18nOptions({messages: MESSAGES, missing: 'throw'}) as Record<string, unknown>)
        const params: Record<string, string> = {value: '1', choices: '"a"', flag: '--git', manager: 'npm', from: '1.0.0', to: '1.0.1', hints: 'default: 1'}
        for (const locale of Object.keys(MESSAGES)) for (const key of expected) assert.ok(i18n.t(`cli.${key}`, params, locale).length, `${locale} ${key}`)
    })

    it('give the help in the language of the user', async (): Promise<void> => {
        const help = async (language: Record<string, string>, ...args: string[]): Promise<string> => {
            const {code, output} = await Run(process.execPath, [CLI, ...args, '--help'], process.cwd(), language)
            assert.strictEqual(code, 0, output)
            return output
        }
        const chinese: string = await help({LAKUTATA_LANG: 'zh-CN'}, 'create')
        for (const text of ['用法： lakutata create [options]', '从模板创建一个 lakutata 项目', '选项：', '--name <value>', '应用的名称', '--with <value>', '启用模板的可选功能', '--no-git', '关闭 --git', '（默认：', '显示命令的帮助']) assert.ok(chinese.includes(text), `${text}\n${chinese}`)
        const traditional: string = await help({LAKUTATA_LANG: 'zh-TW'}, 'create')
        assert.ok(traditional.includes('從範本建立一個 lakutata 專案'), traditional)
        //The language of the environment without LAKUTATA_LANG; a language without messages is the next one of the
        //environment (LANG here: the language of the system on Windows, which has none)
        assert.ok((await help({LAKUTATA_LANG: '', LC_ALL: 'zh_TW.UTF-8'})).includes('命令：'))
        const english: string = await help({LAKUTATA_LANG: 'fr', LC_ALL: '', LANG: 'en_US.UTF-8'}, 'create')
        assert.ok(english.includes('Usage: lakutata create [options]') && english.includes('Create a lakutata project from a template'), english)
    })
})
