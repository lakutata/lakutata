import assert from 'node:assert'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {io, type Socket} from 'socket.io-client'
import {Application, DTO, Exception, Provider} from '../../../exports/Lakutata.js'
import {buildEntrypoints, Controller} from '../../../exports/EntrypointComponent.js'
import {expressHTTPEntrypoint, jsonEnvelope} from '../../../exports/ExpressAdapter.js'
import {socketIOServiceEntrypoint} from '../../../exports/SocketIOAdapter.js'
import {commanderCLIEntrypoint} from '../../../exports/CommanderAdapter.js'
import {CLIAction, GET, POST, ServiceAction} from '../../../exports/CTRLDecorators.js'
import {Autoload, Inject, Scoped} from '../../../exports/DIDecorators.js'
import {Accept, Expect} from '../../../exports/DTODecorators.js'
import {buildI18nOptions, I18n, I18nMiddleware, I18nMissingKeyException, Translator} from '../../../exports/I18nComponent.js'
import {FreePort, MemoryStream, RunChecks} from '../support/Scenario.js'

//The messages of the application: a file by language, a directory by language whose files prefix their keys; the
//messages of the validation errors by their codes
const locales: string = mkdtempSync(path.join(tmpdir(), 'lakutata-scenario-i18n-'))
writeFileSync(path.join(locales, 'en.json'), JSON.stringify({
    order: {
        count: '{count, plural, =0 {No orders yet} one {# order} other {# orders}}',
        total: 'Total: {total, number, currency}',
        created: 'Order created for {customer}'
    }
}))
writeFileSync(path.join(locales, 'zh-CN.json'), JSON.stringify({
    order: {count: '{count, plural, =0 {还没有订单} other {共 # 个订单}}', total: '合计：{total, number, currency}', created: '已为 {customer} 创建订单'},
    validation: {any: {required: '{{#label}} 为必填项'}},
    errors: {E_ORDER_NOT_FOUND: '订单 {id} 不存在'}
}))
mkdirSync(path.join(locales, 'zh-TW'))
writeFileSync(path.join(locales, 'zh-TW', 'order.json'), JSON.stringify({count: '{count, plural, other {共 # 筆訂單}}'}))

//The command line runs in the language of its environment
delete process.env.LC_ALL
delete process.env.LC_MESSAGES
process.env.LANG = 'zh_TW.UTF-8'

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

/**
 * The discounts, their arguments validated
 */
@Scoped()
@Autoload()
class Discounts extends Provider {
    @Accept(DTO.Number().max(50).required())
    public async rate(percent: number): Promise<number> {
        return percent / 100
    }
}

class CreateOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public customer: string
}

/**
 * An object of a request: the translator of the request is the one of its controller
 */
@Scoped()
@Autoload()
class Receipt extends Provider {
    @Inject(Translator)
    public readonly i18n: Translator
}

/**
 * Answers the requests in their languages, by HTTP, Socket.IO and the command line
 */
class OrderController extends Controller {
    @Inject(Translator)
    protected readonly i18n: Translator

    @Inject(Receipt)
    protected readonly receipt: Receipt

    @Inject(Discounts)
    protected readonly discounts: Discounts

    @GET('/order/:id')
    public async find(input: { id: string }): Promise<string> {
        throw new OrderNotFoundException('Order {id} not found', {id: input.id})
    }

    @GET('/discounts/:percent')
    public async discount(input: { percent: string }): Promise<number> {
        return await this.discounts.rate(Number(input.percent))
    }

    @GET('/orders/count')
    @CLIAction('count-orders')
    @ServiceAction({act: 'count'})
    public async count(): Promise<{ locale: string, message: string, total: string, shared: boolean }> {
        return {
            locale: this.i18n.locale,
            message: this.i18n.t('order.count', {count: 1200}),
            total: this.i18n.t('order.total', {total: 9.5}),
            shared: this.receipt.i18n === this.i18n
        }
    }

    @POST('/orders', CreateOrderDTO)
    @ServiceAction({act: 'create'}, CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<string> {
        return this.i18n.t('order.created', {customer: input.customer})
    }
}

const [httpPort, ioPort] = [await FreePort(), await FreePort()]
const cliOutput: MemoryStream = new MemoryStream()
let cliExited: (code: number) => void
const cliCode: Promise<number> = new Promise((resolve: (code: number) => void): unknown => cliExited = resolve)

Application
    .alias({'@locales': locales})
    .run(() => ({
        id: 'integration.i18n',
        name: 'IntegrationI18n',
        components: {
            i18n: buildI18nOptions({directory: '@locales', fallback: {'zh-TW': 'zh-CN'}, currency: 'CNY', missing: 'throw'}),
            entrypoint: buildEntrypoints({
                controllers: [OrderController],
                middlewares: [I18nMiddleware],
                http: expressHTTPEntrypoint({port: httpPort, host: '127.0.0.1', respond: jsonEnvelope({errorStatus: 200})}),
                service: socketIOServiceEntrypoint({port: ioPort, host: '127.0.0.1'}),
                cli: commanderCLIEntrypoint({bin: 'shop', argv: ['count-orders'], interactive: false, stdout: cliOutput, exit: (code: number): void => cliExited(code)})
            })
        },
        bootstrap: ['i18n', 'entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const request = async (route: string, headers: Record<string, string>, body?: unknown): Promise<{ data: unknown, errMsg: string | null }> => await (await fetch(`http://127.0.0.1:${httpPort}${route}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {'content-type': 'application/json', ...headers},
            body: body === undefined ? undefined : JSON.stringify(body)
        })).json() as { data: unknown, errMsg: string | null }

        await check('the messages of the directory of an alias are loaded, by language', async (): Promise<void> => {
            const i18n: I18n = await app.getObject<I18n>('i18n')
            assert.deepStrictEqual(i18n.getLocales(), ['en', 'zh-CN', 'zh-TW'])
            assert.strictEqual(i18n.t('order.count', {count: 0}, 'zh-CN'), '还没有订单')
            assert.strictEqual(i18n.t('order.count', {count: 1}), '1 order')
            assert.throws((): unknown => i18n.t('order.missing'), I18nMissingKeyException)
            assert.strictEqual(i18n.translator('zh-TW').t('order.created', {customer: '小明'}), '已为 小明 创建订单')
        })

        await check('an HTTP request is answered in its language: the query, the cookie, then Accept-Language, falling back', async (): Promise<void> => {
            assert.deepStrictEqual((await request('/orders/count', {'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'})).data, {locale: 'zh-CN', message: '共 1,200 个订单', total: '合计：¥9.50', shared: true})
            //zh-TW has its count; its total is the message of zh-CN, formatted in zh-TW
            assert.deepStrictEqual((await request('/orders/count?lang=zh-TW', {'accept-language': 'en'})).data, {locale: 'zh-TW', message: '共 1,200 筆訂單', total: '合计：CN¥9.50', shared: true})
            assert.strictEqual(((await request('/orders/count', {'accept-language': 'en', cookie: 'theme=dark; lang=zh-CN'})).data as { locale: string }).locale, 'zh-CN')
            //A language not supported: the default one
            assert.deepStrictEqual((await request('/orders/count', {'accept-language': 'fr-FR,fr;q=0.9'})).data, {locale: 'en', message: '1,200 orders', total: 'Total: CN¥9.50', shared: true})
        })

        await check('the errors of the validation are in the language of the request: the messages of the application, the built-in ones', async (): Promise<void> => {
            //The message of the application replaces the built-in one of zh-CN
            assert.strictEqual((await request('/orders', {'accept-language': 'zh-CN'}, {})).errMsg, '"customer" 为必填项')
            //zh-TW: its built-in messages
            assert.strictEqual((await request('/orders', {'accept-language': 'zh-TW'}, {})).errMsg, '"customer" 為必填欄位')
            assert.strictEqual((await request('/orders', {'accept-language': 'en'}, {})).errMsg, '"customer" is required')
            assert.strictEqual((await request('/orders', {'accept-language': 'zh-CN'}, {customer: '小明'})).data, '已为 小明 创建订单')
        })

        await check('the exceptions and the validations of the methods are in the language of the request', async (): Promise<void> => {
            const chinese = await request('/order/7', {'accept-language': 'zh-CN'}) as { data: unknown, errMsg: string, errno?: string }
            assert.strictEqual(chinese.errMsg, '订单 7 不存在')
            assert.strictEqual(chinese.errno, 'E_ORDER_NOT_FOUND')
            assert.strictEqual((await request('/order/7', {'accept-language': 'en'})).errMsg, 'Order 7 not found')
            //The arguments of a method of a provider (@Accept): the built-in messages of the language
            assert.match((await request('/discounts/60', {'accept-language': 'zh-CN'})).errMsg ?? '', /不能大于 50|必须小于或等于 50/)
            assert.match((await request('/discounts/60', {'accept-language': 'en'})).errMsg ?? '', /must be less than or equal to 50/)
            assert.strictEqual((await request('/discounts/20', {'accept-language': 'zh-CN'})).data, 0.2)
        })

        await check('a Socket.IO request is answered in the language of its connection', async (): Promise<void> => {
            const socket: Socket = io(`http://127.0.0.1:${ioPort}`, {transports: ['websocket'], query: {lang: 'zh-TW'}})
            try {
                const counted = await socket.timeout(5000).emitWithAck('message', {act: 'count'})
                assert.deepStrictEqual(counted.payload, {locale: 'zh-TW', message: '共 1,200 筆訂單', total: '合计：CN¥9.50', shared: true})
                const invalid = await socket.timeout(5000).emitWithAck('message', {act: 'create'})
                assert.strictEqual(invalid.error.message, '"customer" 為必填欄位')
            } finally {
                socket.disconnect()
            }
        })

        await check('the command line is answered in the language of its environment', async (): Promise<void> => {
            assert.strictEqual(await cliCode, 0)
            assert.match(cliOutput.text(), /"locale":\s*"zh-TW"/)
            assert.match(cliOutput.text(), /共 1,200 筆訂單/)
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })
