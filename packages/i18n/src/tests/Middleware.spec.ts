import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {IncomingMessage, ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {Container, CurrentValidationLanguage, Exception, type Module} from '@lakutata/core'
import {Inject} from '@lakutata/core/decorator/di'
import {BaseContext, CLIContext, ContextType, HTTPContext, ScheduleContext, ServiceContext, type ActionInvocation} from '@lakutata/entrypoint'
import {I18n, I18nTranslatorException, Translator} from '../exports/I18n.js'
import {CommanderTranslator, I18nMiddleware} from '../exports/I18nMiddleware.js'

/**
 * The middleware, its I18n injected by its class, its languages requested told
 */
class TestMiddleware extends I18nMiddleware {
    @Inject(I18n)
    protected readonly i18n: I18n

    public languages(context: BaseContext): string[] {
        return this.requested(context)
    }
}

/**
 * An HTTP context of a request
 * @param url
 * @param headers
 */
function HTTP(url: string, headers: Record<string, string>): HTTPContext {
    const request: IncomingMessage = new IncomingMessage(new Socket())
    request.url = url
    request.headers = headers
    return new HTTPContext({route: '/', method: 'GET', request: request, response: new ServerResponse(request), data: {}})
}

describe('The I18n middleware', (): void => {
    let container: Container
    let middleware: TestMiddleware
    const environment: NodeJS.ProcessEnv = {...process.env}

    before(async (): Promise<void> => {
        container = new Container()
        await container.load([{class: I18n, messages: {'en': {hello: 'Hello'}, 'zh-CN': {hello: '你好'}, 'ja': {hello: 'こんにちは'}}, missing: 'throw'} as Record<string, unknown> as any, TestMiddleware])
        middleware = await container.get(TestMiddleware)
    })

    after(async (): Promise<void> => {
        process.env = environment
        await container.destroy()
    })

    it('reads the languages of an HTTP request: its query, its cookie, then Accept-Language', (): void => {
        assert.deepStrictEqual(middleware.languages(HTTP('/orders?lang=ja', {'cookie': 'theme=dark; lang=zh-CN', 'accept-language': 'en;q=0.5, fr'})), ['ja', 'zh-CN', 'fr', 'en'])
        //An invalid query or cookie is ignored
        assert.deepStrictEqual(middleware.languages(HTTP('/orders?lang=not+a+tag', {'cookie': 'lang=%E0%A4%A', 'accept-language': 'ja'})), ['ja'])
        assert.deepStrictEqual(middleware.languages(HTTP('/orders', {})), [])
    })

    it('reads the languages of a Socket.IO connection, of the environment for the command line and Electron, none for the schedules', (): void => {
        const socket = {handshake: {query: {lang: 'zh-CN'}, headers: {'accept-language': 'ja'}}}
        assert.deepStrictEqual(middleware.languages(new ServiceContext({data: {}, socket: socket})), ['zh-CN', 'ja'])
        process.env = {LANG: 'ja_JP.UTF-8'}
        const processLocale: string = new Intl.DateTimeFormat().resolvedOptions().locale
        assert.deepStrictEqual(middleware.languages(new CLIContext({command: 'run', data: {}})), ['ja-JP', processLocale])
        //Electron: a service without a connection
        assert.deepStrictEqual(middleware.languages(new ServiceContext({data: {}, event: {}})), ['ja-JP', processLocale])
        const schedule: ScheduleContext = new ScheduleContext({data: {}, schedule: 'report', scheduledAt: new Date(), run: 1})
        assert.strictEqual(schedule.type, ContextType.SCHEDULE)
        assert.deepStrictEqual(middleware.languages(schedule), [])
    })

    it('gives the request its language and its translator', async (): Promise<void> => {
        const scope: Container = container.createScope()
        const context: HTTPContext = HTTP('/', {'accept-language': 'zh-TW,zh;q=0.9'})
        const invocation = {context: context, container: scope, action: {}} as unknown as ActionInvocation
        const result: unknown = await middleware.handle(invocation, async (): Promise<string> => (await scope.get(Translator)).t('hello'))
        assert.strictEqual(context.locale, 'zh-CN')
        assert.strictEqual(result, '你好')
        await scope.destroy()
    })

    it('reads the language of its environment variable first on the command line', async (): Promise<void> => {
        class ToolMiddleware extends TestMiddleware {
            protected readonly environmentVariable: string = 'TOOL_LANG'
        }
        await container.load([ToolMiddleware])
        const tool: ToolMiddleware = await container.get(ToolMiddleware)
        process.env = {LANG: 'ja_JP.UTF-8', TOOL_LANG: 'zh_CN'}
        assert.deepStrictEqual(tool.languages(new CLIContext({command: 'run', data: {}})).slice(0, 2), ['zh-CN', 'ja-JP'])
        //An invalid value is ignored
        process.env = {LANG: 'ja_JP.UTF-8', TOOL_LANG: 'not a tag'}
        assert.strictEqual(tool.languages(new CLIContext({command: 'run', data: {}}))[0], 'ja-JP')
    })

    it('translates the help of the Commander adapter with the messages of the component', async (): Promise<void> => {
        const i18n: I18n = await container.get(I18n)
        i18n.addMessages('zh-CN', {cli: {help: {usage: '用法：', default: '默认：{value}'}, commands: {greet: {description: '问候某人'}}}})
        const module = {getObject: async (): Promise<I18n> => i18n} as unknown as Module
        process.env = {LANG: 'en_US.UTF-8', TOOL_LANG: 'zh-CN'}
        const chinese = await CommanderTranslator({component: 'unused', environment: 'TOOL_LANG'})(module)
        assert.strictEqual(chinese({key: 'help.usage', text: 'Usage:'}), '用法：')
        assert.strictEqual(chinese({key: 'help.default', text: 'default: {value}', params: {value: '1'}}), '默认：1')
        assert.strictEqual(chinese({key: 'commands.greet.description', text: 'Greet someone'}), '问候某人')
        //Without a message: the English text, its arguments filled
        assert.strictEqual(chinese({key: 'help.negate', text: 'Turn off {flag}', params: {flag: '--polite'}}), 'Turn off --polite')
        process.env = {LANG: 'zh_CN.UTF-8', TOOL_LANG: 'en'}
        assert.strictEqual((await CommanderTranslator({environment: 'TOOL_LANG'})(module))({key: 'help.usage', text: 'Usage:'}), 'Usage:')
        //The language of the environment without the variable; no prefix
        process.env = {LANG: 'zh_CN.UTF-8'}
        assert.strictEqual((await CommanderTranslator()(module))({key: 'help.usage', text: 'Usage:'}), '用法：')
        assert.strictEqual((await CommanderTranslator({prefix: ''})(module))({key: 'cli.help.usage', text: 'Usage:'}), '用法：')
    })

    it('runs the request in its language: its validations, the messages of its exceptions', async (): Promise<void> => {
        class LimitException extends Exception {
            public errno: string = 'E_LIMIT'
        }
        class OtherException extends Exception {
            public errno: string = 'E_OTHER'
        }
        const i18n: I18n = await container.get(I18n)
        i18n.addMessages('zh-CN', {errors: {E_LIMIT: '{0} 超过了上限 {1}', E_OTHER: '缺少 {missing}'}})
        const run = async (fail: () => never | Promise<never>): Promise<unknown> => {
            const scope: Container = container.createScope()
            try {
                return await middleware.handle({context: HTTP('/', {'accept-language': 'zh-CN'}), container: scope, action: {}} as unknown as ActionInvocation, async (): Promise<never> => await fail())
            } catch (error) {
                return error
            } finally {
                await scope.destroy()
            }
        }
        //The validations of the request in its language
        await middleware.handle({context: HTTP('/', {'accept-language': 'zh-CN'}), container: container.createScope(), action: {}} as unknown as ActionInvocation, async (): Promise<void> => {
            assert.strictEqual(CurrentValidationLanguage(), 'zh-CN')
        })
        //A message of its errno, the parameters given one by one
        const limit = await run((): never => {
            throw new LimitException('{0} is over the limit {1}', 12, 10)
        }) as LimitException
        assert.strictEqual(limit.message, '12 超过了上限 10')
        assert.strictEqual(limit.errMsg, '12 超过了上限 10')
        assert.strictEqual(limit.errno, 'E_LIMIT')
        //A message which cannot be formatted: the exception as it is, a warning
        const warnings: string[] = []
        const onWarning = (warning: Error): number => warnings.push(warning.message)
        process.on('warning', onWarning)
        const other = await run((): never => {
            throw new OtherException('Other')
        }) as OtherException
        await new Promise((resolve: (value: unknown) => void): unknown => setImmediate(resolve))
        process.off('warning', onWarning)
        assert.strictEqual(other.message, 'Other')
        assert.match(warnings.join('\n'), /The message errors\.E_OTHER of OtherException cannot be formatted/)
        //The errors which are not exceptions, an exception without the parameters of its message, an exception without
        //a message in the language
        const error: Error = new Error('plain')
        assert.strictEqual(await run((): never => {
            throw error
        }), error)
        assert.strictEqual((await run((): never => {
            throw new LimitException('kept')
        }) as Error).message, 'kept')
        class UntranslatedException extends Exception {
            public errno: string = 'E_UNTRANSLATED'
        }
        assert.strictEqual((await run((): never => {
            throw new UntranslatedException('Untranslated {id}', {id: 1})
        }) as Error).message, 'Untranslated 1')
    })

    it('is needed by the translator of a request', async (): Promise<void> => {
        const scope: Container = container.createScope()
        await assert.rejects(async (): Promise<unknown> => (await scope.get(Translator)).t('hello'), I18nTranslatorException)
        await scope.destroy()
    })
})
