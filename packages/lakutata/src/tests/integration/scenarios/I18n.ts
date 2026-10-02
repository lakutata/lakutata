import assert from 'node:assert'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Application} from '../../../exports/Lakutata.js'
import {BuildEntrypoints, Controller, type HTTPContext} from '../../../exports/EntrypointComponent.js'
import {ExpressHTTPEntrypoint, JSONEnvelope} from '../../../exports/ExpressAdapter.js'
import {GET} from '../../../exports/CTRLDecorators.js'
import {Inject} from '../../../exports/DIDecorators.js'
import {BuildI18nOptions, I18n, I18nMissingKeyException, ParseAcceptLanguage, type Translator} from '../../../exports/I18nComponent.js'
import {FreePort, RunChecks} from '../support/Scenario.js'

//The messages of the application: a file by language, a directory by language whose files prefix their keys
const locales: string = mkdtempSync(path.join(tmpdir(), 'lakutata-scenario-i18n-'))
writeFileSync(path.join(locales, 'en.json'), JSON.stringify({
    order: {count: '{count, plural, =0 {No orders yet} one {# order} other {# orders}}', total: 'Total: {total, number, currency}'},
    app: {name: 'Shop'}
}))
writeFileSync(path.join(locales, 'zh-CN.json'), JSON.stringify({
    order: {count: '{count, plural, =0 {还没有订单} other {共 # 个订单}}', total: '合计：{total, number, currency}'}
}))
mkdirSync(path.join(locales, 'zh-TW'))
writeFileSync(path.join(locales, 'zh-TW', 'order.json'), JSON.stringify({count: '{count, plural, other {共 # 筆訂單}}'}))

/**
 * Translates the requests in their languages (Accept-Language)
 */
class OrderController extends Controller {
    @Inject('i18n')
    protected readonly i18n: I18n

    protected get translator(): Translator {
        return this.i18n.translator(this.i18n.negotiate(ParseAcceptLanguage((this.context as HTTPContext).request.headers['accept-language'])))
    }

    @GET('/orders/count')
    public async count(): Promise<{ locale: string, message: string, total: string }> {
        const translator: Translator = this.translator
        return {locale: translator.locale, message: translator.t('order.count', {count: 1200}), total: translator.t('order.total', {total: 9.5})}
    }
}

const port: number = await FreePort()

Application
    .alias({'@locales': locales})
    .run(() => ({
        id: 'integration.i18n',
        name: 'IntegrationI18n',
        components: {
            i18n: BuildI18nOptions({directory: '@locales', fallback: {'zh-TW': 'zh-CN'}, currency: 'CNY', missing: 'throw'}),
            entrypoint: BuildEntrypoints({
                controllers: [OrderController],
                http: ExpressHTTPEntrypoint({port: port, host: '127.0.0.1', respond: JSONEnvelope({errorStatus: 200})})
            })
        },
        bootstrap: ['i18n', 'entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const get = async (languages: string): Promise<unknown> => (await (await fetch(`http://127.0.0.1:${port}/orders/count`, {headers: {'accept-language': languages}})).json() as { data: unknown }).data

        await check('the messages of the directory of an alias are loaded, by language', async (): Promise<void> => {
            const i18n: I18n = await app.getObject<I18n>('i18n')
            assert.deepStrictEqual(i18n.getLocales(), ['en', 'zh-CN', 'zh-TW'])
            assert.strictEqual(i18n.t('order.count', {count: 0}, 'zh-CN'), '还没有订单')
            assert.strictEqual(i18n.t('order.count', {count: 1}), '1 order')
            assert.throws((): unknown => i18n.t('order.missing'), I18nMissingKeyException)
        })

        await check('a request is answered in its language, negotiated from Accept-Language, falling back', async (): Promise<void> => {
            assert.deepStrictEqual(await get('zh-CN,zh;q=0.9,en;q=0.8'), {locale: 'zh-CN', message: '共 1,200 个订单', total: '合计：¥9.50'})
            //zh-TW has its count; its total is the message of zh-CN, formatted in zh-TW (its currency CN¥)
            assert.deepStrictEqual(await get('zh-TW'), {locale: 'zh-TW', message: '共 1,200 筆訂單', total: '合计：CN¥9.50'})
            //A language not supported: the default one
            assert.deepStrictEqual(await get('fr-FR,fr;q=0.9'), {locale: 'en', message: '1,200 orders', total: 'Total: CN¥9.50'})
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })
