import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {IncomingMessage, ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {Container} from '@lakutata/core'
import {Inject} from '@lakutata/core/decorator/di'
import {BaseContext, CLIContext, ContextType, HTTPContext, ScheduleContext, ServiceContext, type ActionInvocation} from '@lakutata/entrypoint'
import {I18n, I18nTranslatorException, Translator} from '../exports/I18n.js'
import {I18nMiddleware} from '../exports/I18nMiddleware.js'

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

    it('is needed by the translator of a request', async (): Promise<void> => {
        const scope: Container = container.createScope()
        await assert.rejects(async (): Promise<unknown> => (await scope.get(Translator)).t('hello'), I18nTranslatorException)
        await scope.destroy()
    })
})
