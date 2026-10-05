import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {
    environmentLocales,
    fallbackChain,
    I18n,
    I18nCatalogException,
    I18nMessageSyntaxException,
    I18nMissingKeyException,
    I18nMissingParameterException,
    messageArguments,
    negotiateLocale,
    normalizeLocale,
    parseAcceptLanguage,
    parseMessage,
    type I18nOptions
} from '../exports/I18n.js'

/**
 * Create an i18n component
 * @param options
 */
async function create(options: I18nOptions): Promise<I18n> {
    return await new Container().set(I18n, options as Record<string, unknown>)
}

/**
 * Format a message in a language, its arguments missing thrown
 * @param message
 * @param params
 * @param locale
 * @param options
 */
async function format(message: string, params: Record<string, unknown>, locale: string, options: I18nOptions = {}): Promise<string> {
    return (await create({missing: 'throw', ...options})).format(message, params, locale)
}

/**
 * The warnings emitted while a function runs
 * @param run
 */
async function collectWarnings(run: () => unknown): Promise<string[]> {
    const warnings: string[] = []
    const onWarning = (warning: Error): number => warnings.push(warning.message)
    const printers: NodeJS.WarningListener[] = process.listeners('warning')
    process.removeAllListeners('warning')
    process.on('warning', onWarning)
    try {
        run()
        //The warnings are emitted on the next tick
        await new Promise((resolve: (value: unknown) => void): unknown => setImmediate(resolve))
    } finally {
        process.off('warning', onWarning)
        printers.forEach((printer: NodeJS.WarningListener): unknown => process.on('warning', printer))
    }
    return warnings
}

describe('The languages', (): void => {
    it('are normalized from the tags of the requests and of the environment', (): void => {
        assert.strictEqual(normalizeLocale('zh_CN.UTF-8'), 'zh-CN')
        assert.strictEqual(normalizeLocale('de_DE@euro'), 'de-DE')
        assert.strictEqual(normalizeLocale('ZH-hant-tw'), 'zh-Hant-TW')
        assert.strictEqual(normalizeLocale(' en '), 'en')
        for (const invalid of ['C', 'POSIX', '*', '', 'not a tag', 'english']) assert.strictEqual(normalizeLocale(invalid), undefined, invalid)
    })

    it('are read from Accept-Language by their quality, and from the environment', (): void => {
        assert.deepStrictEqual(parseAcceptLanguage('en;q=0.8, zh-CN, zh;q=0.9, fr;q=0, *;q=0.1'), ['zh-CN', 'zh', 'en'])
        assert.deepStrictEqual(parseAcceptLanguage(undefined), [])
        assert.deepStrictEqual(environmentLocales({LANG: 'zh_CN.UTF-8'}), ['zh-CN'])
        assert.deepStrictEqual(environmentLocales({LC_ALL: 'ja_JP.UTF-8', LANG: 'en_US.UTF-8'}), ['ja-JP'])
        assert.deepStrictEqual(environmentLocales({LANGUAGE: 'zh_TW:zh_CN:en', LANG: 'zh_TW.UTF-8'}), ['zh-TW', 'zh-CN', 'en'])
        //LANGUAGE is not used with the C locale
        assert.deepStrictEqual(environmentLocales({LANGUAGE: 'fr', LANG: 'C'}), [])
    })

    it('are negotiated: the same tag, the language alone, a tag of the same language, the default one', (): void => {
        const supported: string[] = ['en', 'zh-CN', 'zh-TW', 'pt-BR']
        assert.strictEqual(negotiateLocale(['zh-tw'], supported, 'en'), 'zh-TW')
        assert.strictEqual(negotiateLocale(['en-GB'], supported, 'en'), 'en')
        assert.strictEqual(negotiateLocale(['pt-PT'], supported, 'en'), 'pt-BR')
        assert.strictEqual(negotiateLocale(['zh'], supported, 'en'), 'zh-CN')
        assert.strictEqual(negotiateLocale(['de', 'zh-HK'], supported, 'en'), 'zh-CN')
        assert.strictEqual(negotiateLocale(['de', 'invalid tag'], supported, 'en'), 'en')
    })

    it('fall back to their fallbacks, the tags they are more specific than, then the default one', (): void => {
        assert.deepStrictEqual(fallbackChain('zh-Hant-TW', {}, 'en'), ['zh-Hant-TW', 'zh-Hant', 'zh', 'en'])
        assert.deepStrictEqual(fallbackChain('zh-HK', {'zh-HK': ['zh-TW']}, 'en'), ['zh-HK', 'zh-TW', 'zh', 'en'])
        //A cycle of fallbacks ends
        assert.deepStrictEqual(fallbackChain('a', {a: ['b'], b: ['a']}, 'en'), ['a', 'b', 'en'])
    })
})

describe('The messages', (): void => {
    it('give their arguments, numbers, currencies, percents, dates and times in the language', async (): Promise<void> => {
        assert.strictEqual(await format('Hello, {name}! You have {count} items.', {name: 'Ada', count: 1234.5}, 'en'), 'Hello, Ada! You have 1,234.5 items.')
        assert.strictEqual(await format('{n, number}', {n: 1234.5}, 'de'), '1.234,5')
        assert.strictEqual(await format('{n, number, integer}', {n: 1234.56}, 'en'), '1,235')
        assert.strictEqual(await format('{n, number, percent}', {n: 0.25}, 'en'), '25%')
        assert.strictEqual(await format('{n, number, currency/EUR}', {n: 9.5}, 'en'), '€9.50')
        assert.strictEqual(await format('{n, number, currency}', {n: 9.5, currency: 'USD'}, 'en'), '$9.50')
        assert.strictEqual(await format('{n, number, currency}', {n: 9.5}, 'zh-CN', {currency: 'CNY'}), '¥9.50')
        await assert.rejects(format('{n, number, currency}', {n: 9.5}, 'en'), I18nMissingParameterException)
        //Without a currency and with missing: 'key', a plain number and a warning, once
        const lenient: I18n = await create({messages: {en: {total: 'Total: {n, number, currency}'}}, missing: 'key'})
        const warnings: string[] = await collectWarnings((): void => {
            assert.strictEqual(lenient.t('total', {n: 1234.5}), 'Total: 1,234.5')
            assert.strictEqual(lenient.t('total', {n: 9.5}), 'Total: 9.5')
        })
        assert.deepStrictEqual(warnings, ['en: total: the currency is missing (currency/XXX, the "currency" argument, or the currency of the configuration)'])
        const at: Date = new Date(Date.UTC(2026, 9, 3, 14, 5))
        assert.strictEqual(await format('{at, date, long} {at, time, short}', {at: at}, 'en', {timeZone: 'UTC'}), 'October 3, 2026 2:05 PM')
        assert.strictEqual(await format('{at, date, long}', {at: at.getTime()}, 'zh-CN', {timeZone: 'UTC'}), '2026年10月3日')
        assert.strictEqual(await format('{at, date, short}', {at: {toDate: (): Date => at}}, 'en', {timeZone: 'Asia/Shanghai'}), '10/3/26')
    })

    it('choose by the plural rules of the language, its exact values first, offsets and ordinals too', async (): Promise<void> => {
        const items: string = '{count, plural, =0 {none} one {# item} few {# items (few)} many {# items (many)} other {# items}}'
        assert.deepStrictEqual(await Promise.all([0, 1, 2, 1000].map((count: number): Promise<string> => format(items, {count: count}, 'en'))), ['none', '1 item', '2 items', '1,000 items'])
        //Chinese has no plural forms
        assert.deepStrictEqual(await Promise.all([1, 2].map((count: number): Promise<string> => format(items, {count: count}, 'zh-CN'))), ['1 items', '2 items'])
        //Russian: one (1, 21), few (2-4, 22), many (5-20)
        assert.deepStrictEqual(await Promise.all([1, 3, 5, 21, 22].map((count: number): Promise<string> => format(items, {count: count}, 'ru'))), ['1 item', '3 items (few)', '5 items (many)', '21 item', '22 items (few)'])
        //Arabic: few (3-10), many (11-99); the digits of Egypt
        assert.deepStrictEqual(await Promise.all([3, 11].map((count: number): Promise<string> => format(items, {count: count}, 'ar'))), ['3 items (few)', '11 items (many)'])
        assert.strictEqual(await format(items, {count: 3}, 'ar-EG'), '٣ items (few)')
        const guests: string = '{guests, plural, offset:1 =0 {nobody} =1 {{host}} one {{host} and # other} other {{host} and # others}}'
        assert.strictEqual(await format(guests, {guests: 1, host: 'Ada'}, 'en'), 'Ada')
        assert.strictEqual(await format(guests, {guests: 2, host: 'Ada'}, 'en'), 'Ada and 1 other')
        assert.strictEqual(await format(guests, {guests: 4, host: 'Ada'}, 'en'), 'Ada and 3 others')
        const place: string = '{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'
        assert.deepStrictEqual(await Promise.all([1, 2, 3, 4, 11, 22].map((value: number): Promise<string> => format(place, {place: value}, 'en'))), ['1st', '2nd', '3rd', '4th', '11th', '22nd'])
    })

    it('choose by a value, # of a plural inside of a select, the apostrophes quoting', async (): Promise<void> => {
        const message: string = '{count, plural, one {{role, select, admin {# admin} other {# user}}} other {{role, select, admin {# admins} other {# users}}}}'
        assert.strictEqual(await format(message, {count: 2, role: 'admin'}, 'en'), '2 admins')
        assert.strictEqual(await format(message, {count: 1, role: 'guest'}, 'en'), '1 user')
        assert.strictEqual(await format("It's '{literal}' and '' and '#' {n, plural, other {'#'#}}", {n: 3}, 'en'), "It's {literal} and ' and '#' #3")
    })

    it('tell where their syntax is wrong', (): void => {
        const cases: [string, RegExp][] = [
            ['Hello {name', /unterminated argument at 7/],
            ['Hello }', /unexpected "}" at 7/],
            ['{n, plural, one {x}}', /the "other" option is required at 1/],
            ['{n, plural, one {x} one {y} other {z}}', /selector "one" repeated at 21/],
            ['{n, money}', /unknown argument type "money" .* at 5/],
            ['{n, number, decimal}', /unknown number style "decimal" .* at 12/],
            ['{n, date, tiny}', /unknown date style "tiny" .* at 10/],
            ['{n, select, other {x}', /unterminated argument at 1/],
            ['{}', /expected the name of an argument at 2/]
        ]
        for (const [message, error] of cases) {
            assert.throws((): unknown => parseMessage(message, 'test.key'), (thrown: Error): boolean => thrown instanceof I18nMessageSyntaxException && /^test\.key: /.test(thrown.message) && error.test(thrown.message), message)
        }
    })

    it('tell their arguments and their types', (): void => {
        assert.deepStrictEqual([...messageArguments(parseMessage('{a} {b, number} {c, plural, other {{d, select, other {{e, date}}}}}'))], [['a', 'argument'], ['b', 'number'], ['c', 'plural'], ['d', 'select'], ['e', 'date']])
    })
})

describe('The i18n component', (): void => {
    let directory: string

    before((): void => {
        directory = mkdtempSync(path.join(tmpdir(), 'lakutata-i18n-'))
        writeFileSync(path.join(directory, 'en.json'), JSON.stringify({order: {count: '{count, plural, =0 {No orders yet} one {# order} other {# orders}}', created: 'Order created for {customer}'}, app: {name: 'Shop'}}))
        writeFileSync(path.join(directory, 'zh-CN.json'), JSON.stringify({order: {count: '{count, plural, =0 {还没有订单} other {共 # 个订单}}', created: '已为 {customer} 创建订单'}}))
        //A directory by language: its files prefix their keys
        mkdirSync(path.join(directory, 'zh-TW', 'admin'), {recursive: true})
        writeFileSync(path.join(directory, 'zh-TW', 'order.json'), JSON.stringify({count: '{count, plural, other {共 # 筆訂單}}'}))
        writeFileSync(path.join(directory, 'zh-TW', 'admin', 'user.json'), JSON.stringify({title: '使用者'}))
    })

    after((): void => rmSync(directory, {recursive: true, force: true}))

    it('loads the messages of its directories and of its options, the later ones replacing the earlier ones', async (): Promise<void> => {
        const i18n: I18n = await create({directory: directory, messages: {en: {app: {name: 'Store'}}, ja: {order: {created: '{customer} の注文を作成しました'}}}, missing: 'throw'})
        assert.deepStrictEqual(i18n.getLocales(), ['en', 'ja', 'zh-CN', 'zh-TW'])
        assert.strictEqual(i18n.getDefaultLocale(), 'en')
        assert.strictEqual(i18n.t('app.name'), 'Store')
        assert.strictEqual(i18n.t('order.count', {count: 0}, 'zh-CN'), '还没有订单')
        assert.strictEqual(i18n.t('order.count', {count: 3}, 'zh-TW'), '共 3 筆訂單')
        assert.strictEqual(i18n.t('admin.user.title', {}, 'zh-TW'), '使用者')
        assert.strictEqual(i18n.t('order.created', {customer: '山田'}, 'ja'), '山田 の注文を作成しました')
        assert.deepStrictEqual(i18n.getKeys('zh-TW').sort(), ['admin.user.title', 'order.count'])
        //Added at run time, the messages already formatted replaced
        await i18n.addMessages('zh-CN', {order: {count: '{count, plural, other {# 单}}'}})
        assert.strictEqual(i18n.t('order.count', {count: 2}, 'zh-CN'), '2 单')
    })

    it('falls back to its fallbacks, the language alone, then the default language, in the language asked', async (): Promise<void> => {
        const i18n: I18n = await create({directory: directory, locales: ['en', 'zh-CN', 'zh-TW'], fallback: {'zh-TW': 'zh-CN'}, missing: 'throw'})
        assert.deepStrictEqual(i18n.getLocales(), ['en', 'zh-CN', 'zh-TW'])
        //zh-TW has no order.created: zh-CN
        assert.strictEqual(i18n.t('order.created', {customer: '小明'}, 'zh-TW'), '已为 小明 创建订单')
        //zh-CN has no app.name: en
        assert.strictEqual(i18n.t('app.name', {}, 'zh-CN'), 'Shop')
        //A language not supported: the default one, its numbers in the language asked
        assert.strictEqual(i18n.t('order.count', {count: 1000}, 'de'), '1.000 orders')
        assert.ok(i18n.has('order.created', 'zh-TW') && !i18n.has('order.missing', 'zh-TW'))
        assert.strictEqual(i18n.negotiate(['zh-HK', 'en']), 'zh-CN')
        const translator = i18n.translator('zh_TW.UTF-8')
        assert.strictEqual(translator.locale, 'zh-TW')
        assert.strictEqual(translator.t('order.count', {count: 2}), '共 2 筆訂單')
        assert.ok(translator.has('admin.user.title'))
        assert.strictEqual(translator.format('{n, number, percent}', {n: 0.5}), '50%')
        assert.strictEqual(translator.number(1234.5), '1,234.5')
        assert.strictEqual(new Intl.DateTimeFormat('zh-TW', {dateStyle: 'long', timeZone: 'UTC'}).format(0), translator.date(0, {dateStyle: 'long', timeZone: 'UTC'}))
    })

    it('throws on a missing message or argument, or gives its key and warns once', async (): Promise<void> => {
        const strict: I18n = await create({directory: directory, missing: 'throw'})
        assert.throws((): unknown => strict.t('order.missing', {}, 'zh-CN'), (error: Error): boolean => error instanceof I18nMissingKeyException && error.message === 'No message "order.missing" in zh-CN, zh, en')
        assert.throws((): unknown => strict.t('order.created', {}, 'zh-CN'), (error: Error): boolean => error instanceof I18nMissingParameterException && error.message === 'zh-CN: order.created: the argument "customer" is missing')
        const lenient: I18n = await create({directory: directory, missing: 'key'})
        const warnings: string[] = await collectWarnings((): void => {
            assert.strictEqual(lenient.t('order.missing', {}, 'zh-CN'), 'order.missing')
            assert.strictEqual(lenient.t('order.missing', {}, 'zh-CN'), 'order.missing')
            assert.strictEqual(lenient.t('order.created', {}, 'zh-CN'), '已为 {customer} 创建订单')
            assert.strictEqual(lenient.t('order.created', {}, 'zh-CN'), '已为 {customer} 创建订单')
            //Another message missing the same argument warns too
            assert.strictEqual(lenient.t('order.created', {}, 'en'), 'Order created for {customer}')
            assert.strictEqual(lenient.format('Hi {name}', {}), 'Hi {name}')
        })
        assert.deepStrictEqual(warnings, [
            'No message "order.missing" in zh-CN, zh, en',
            'zh-CN: order.created: the argument "customer" is missing',
            'en: order.created: the argument "customer" is missing',
            'message "Hi {name}": the argument "name" is missing'
        ])
        //By default: thrown, the key given in production
        const environment: string | undefined = process.env.NODE_ENV
        try {
            process.env.NODE_ENV = 'production'
            assert.strictEqual((await create({directory: directory})).t('order.missing'), 'order.missing')
        } finally {
            if (environment === undefined) delete process.env.NODE_ENV
            else process.env.NODE_ENV = environment
        }
    })

    it('supports the languages added at run time, unless its languages are given', async (): Promise<void> => {
        const i18n: I18n = await create({messages: {en: {hello: 'Hello'}}, missing: 'throw'})
        assert.deepStrictEqual(i18n.getLocales(), ['en'])
        await i18n.addMessages('fr', {hello: 'Bonjour'})
        await i18n.addMessages('de', {hello: 'Hallo'})
        assert.deepStrictEqual(i18n.getLocales(), ['en', 'de', 'fr'])
        assert.strictEqual(i18n.negotiate(['fr-CA']), 'fr')
        assert.strictEqual(i18n.t('hello', {}, i18n.negotiate(['de-AT'])), 'Hallo')
        //Invalid: thrown by the call, nothing added
        assert.throws((): unknown => i18n.addMessages('not a tag', {hello: 'x'}), I18nCatalogException)
        const fixed: I18n = await create({locales: ['en'], messages: {en: {hello: 'Hello'}}, missing: 'throw'})
        await fixed.addMessages('fr', {hello: 'Bonjour'})
        assert.deepStrictEqual(fixed.getLocales(), ['en'])
        assert.strictEqual(fixed.negotiate(['fr']), 'en')
        assert.strictEqual(fixed.t('hello', {}, 'fr'), 'Bonjour')
    })

    it('refuses invalid catalogs, telling the file', async (): Promise<void> => {
        const broken: string = mkdtempSync(path.join(tmpdir(), 'lakutata-i18n-broken-'))
        try {
            writeFileSync(path.join(broken, 'en.json'), '{"a": ')
            await assert.rejects(create({directory: broken}), (error: Error): boolean => error instanceof I18nCatalogException && error.message.startsWith(path.join(broken, 'en.json')))
            writeFileSync(path.join(broken, 'en.json'), JSON.stringify({a: ['not', 'a', 'message']}))
            await assert.rejects(create({directory: broken}), /en\.json: the messages must be an object \(a\)/)
            writeFileSync(path.join(broken, 'en.json'), JSON.stringify({'a.b': 'dotted'}))
            await assert.rejects(create({directory: broken}), /invalid key "a\.b"/)
            rmSync(path.join(broken, 'en.json'))
            writeFileSync(path.join(broken, 'english.json'), '{}')
            await assert.rejects(create({directory: broken}), /"english" is not the tag of a language/)
            await assert.rejects(create({directory: path.join(broken, 'missing')}), /the directory of the messages does not exist/)
            await assert.rejects(create({defaultLocale: 'not a tag'}), /defaultLocale: "not a tag" is not the tag of a language/)
            await assert.rejects(create({directory: '@app/locales'}), /the alias of "@app\/locales" is resolved by an application/)
            //A syntax error is told by the key of its message, when it is used
            const i18n: I18n = await create({messages: {en: {bad: '{n, plural, one {x}}'}}})
            assert.throws((): unknown => i18n.t('bad'), /^.*en: bad: the "other" option is required at 1/)
        } finally {
            rmSync(broken, {recursive: true, force: true})
        }
    })
})
