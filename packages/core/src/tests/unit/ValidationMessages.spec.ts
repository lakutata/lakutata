import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {runInValidationLanguage, currentValidationLanguage} from '../../lib/validation/ValidationLanguage.js'
import {Exception, exceptionParams} from '../../lib/foundation/Exception.js'
import {BUILT_IN_VALIDATION_LANGUAGES, builtInValidationLanguage, defaultValidationMessages, loadValidationMessages, registerValidationMessages, validationLanguages} from '../../lib/validation/ValidationMessages.js'

class OrderDTO extends DTO {
    @Expect(DTO.String().required())
    public customer: string

    @Expect(DTO.Number().max(100).required())
    public amount: number
}

/**
 * The message of the validation error of a value
 * @param data
 * @param language
 */
async function errorOf(data: Record<string, unknown>, language?: string): Promise<string> {
    try {
        await OrderDTO.validateAsync(data, language ? {errors: {language: language}} : {})
    } catch (error) {
        return (error as Error).message
    }
    throw new Error('valid')
}

describe('The messages of the validation errors', (): void => {
    it('are given in the language of the validation once registered, the default ones otherwise', async (): Promise<void> => {
        //Nothing registered: the language changes nothing
        assert.strictEqual(await errorOf({amount: 1}, 'zh-CN'), '"customer" is required')
        registerValidationMessages('zh-CN', {'any.required': '{{#label}} 为必填项'})
        assert.ok(validationLanguages().includes('zh-CN'))
        assert.strictEqual(await errorOf({amount: 1}, 'zh-CN'), '"customer" 为必填项')
        //A code without a message of the language: the default one
        assert.strictEqual(await errorOf({customer: 'Ada', amount: 101}, 'zh-CN'), '"amount" must be less than or equal to 100')
        //Without the language, or in another one: the default messages
        assert.strictEqual(await errorOf({amount: 1}), '"customer" is required')
        assert.strictEqual(await errorOf({amount: 1}, 'fr'), '"customer" is required')
    })

    it('are added to the ones of the language, the same codes replaced', async (): Promise<void> => {
        registerValidationMessages('zh-CN', {'any.required': '缺少 {{#label}}', 'number.max': '{{#label}} 不能大于 {{#limit}}'})
        assert.strictEqual(await errorOf({amount: 1}, 'zh-CN'), '缺少 "customer"')
        assert.strictEqual(await errorOf({customer: 'Ada', amount: 101}, 'zh-CN'), '"amount" 不能大于 100')
        //The valid values are not changed by the language
        assert.deepStrictEqual({...await OrderDTO.validateAsync({customer: 'Ada', amount: 1}, {errors: {language: 'zh-CN'}})}, {customer: 'Ada', amount: 1})
    })
})

/**
 * The variables of a template: #name
 * @param template
 */
function variables(template: string): string[] {
    return [...new Set(template.match(/#[A-Za-z]+/g) ?? [])].sort()
}

class SampleDTO extends DTO {
    @Expect(DTO.String().min(3).required())
    public name: string

    @Expect(DTO.Number().integer().max(10).optional())
    public count?: number

    @Expect(DTO.String().valid('a', 'b').optional())
    public choice?: string

    @Expect(DTO.String().valid('only').optional())
    public single?: string

    @Expect(DTO.Object({x: DTO.Any()}).length(2).optional())
    public pair?: Record<string, unknown>

    @Expect(DTO.Date().iso().optional())
    public at?: Date

    @Expect(DTO.String().email().optional())
    public email?: string

    @Expect(DTO.Array().items(DTO.Number()).min(2).optional())
    public list?: number[]
}

describe('The built-in messages of the validation errors', (): void => {
    const defaults: Record<string, string> = defaultValidationMessages()

    it('give every message of the validation, their variables kept, in every built-in language', async (): Promise<void> => {
        assert.strictEqual(Object.keys(defaults).length, 137)
        assert.strictEqual(defaults['any.required'], '{{#label}} is required')
        assert.deepStrictEqual(await loadValidationMessages('en-GB'), defaults)
        for (const language of BUILT_IN_VALIDATION_LANGUAGES.filter((tag: string): boolean => tag !== 'en')) {
            const messages: Record<string, string> | undefined = await loadValidationMessages(language)
            assert.ok(messages, language)
            assert.deepStrictEqual(Object.keys(messages).sort(), Object.keys(defaults).sort(), language)
            for (const [code, template] of Object.entries(defaults)) {
                assert.deepStrictEqual(variables(messages[code]), variables(template), `${language} ${code}: ${messages[code]}`)
            }
        }
    })

    it('are rendered in their languages, every template compiled', async (): Promise<void> => {
        const invalid: Record<string, unknown>[] = [
            {}, {name: 'ab'}, {name: 'abc', count: 11}, {name: 'abc', count: 1.5}, {name: 'abc', choice: 'c'},
            {name: 'abc', single: 'x'}, {name: 'abc', pair: {x: 1}}, {name: 'abc', at: 'yesterday'},
            {name: 'abc', email: 'nobody'}, {name: 'abc', list: [1]}, {name: 'abc', unknownKey: {}, count: 'x'}
        ]
        const english: string[] = []
        for (const data of invalid) english.push((await SampleDTO.validateAsync(data).catch((error: Error): Error => error) as Error).message)
        for (const language of BUILT_IN_VALIDATION_LANGUAGES.filter((tag: string): boolean => tag !== 'en')) {
            registerValidationMessages(language, (await loadValidationMessages(language))!)
            for (const [index, data] of invalid.entries()) {
                const error: Error = await SampleDTO.validateAsync(data, {errors: {language: language}}).catch((error: Error): Error => error) as Error
                assert.ok(error instanceof Error, `${language}: ${JSON.stringify(data)} is valid`)
                assert.notStrictEqual(error.message, english[index], `${language}: not translated: ${error.message}`)
                assert.doesNotMatch(error.message, /\{\{|\}\}|#[a-z]|\bif\(|msg\(/i, `${language}: ${error.message}`)
            }
        }
    })

    it('are the ones of the closest built-in language', (): void => {
        const cases: [string, string | undefined][] = [
            ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'], ['zh-Hans-CN', 'zh-CN'], ['zh-SG', 'zh-CN'],
            ['zh-TW', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh_MO', 'zh-TW'],
            ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'], ['ja-JP', 'ja'], ['FR-ca', 'fr'], ['ar-EG', 'ar'],
            ['en', 'en'], ['en-GB', 'en'], ['sw', undefined], ['', undefined]
        ]
        for (const [language, builtIn] of cases) assert.strictEqual(builtInValidationLanguage(language), builtIn, language)
    })
})

class Orders {
    @Accept(DTO.Number().max(100).required())
    public async take(amount: number): Promise<number> {
        return amount
    }

    @Accept(DTO.String().required())
    public label(name: string): string {
        return name
    }
}

/**
 * The message of an error
 * @param fn
 */
async function failure(fn: () => unknown): Promise<string> {
    try {
        await fn()
    } catch (error) {
        return (error as Error).message
    }
    throw new Error('no error')
}

describe('The language of the validations of the code running', (): void => {
    it('gives the errors of every validation in the language, the valid values unchanged', async (): Promise<void> => {
        registerValidationMessages('ja', {'any.required': '{{#label}} は必須です', 'number.max': '{{#label}} は {{#limit}} 以下にしてください'})
        const orders: Orders = new Orders()
        assert.strictEqual(currentValidationLanguage(), undefined)
        await runInValidationLanguage('ja', async (): Promise<void> => {
            assert.strictEqual(currentValidationLanguage(), 'ja')
            //An explicit validation, a validation of the arguments of a method (async, sync), a nested asynchronous call
            assert.strictEqual(await failure((): Promise<unknown> => OrderDTO.validateAsync({amount: 1})), '"customer" は必須です')
            assert.strictEqual(await failure((): unknown => OrderDTO.validate({amount: 1})), '"customer" は必須です')
            assert.match(await failure((): Promise<unknown> => orders.take(101)), /は 100 以下にしてください/)
            const english: string = await failure((): unknown => runInValidationLanguage('en', (): unknown => orders.label(1 as unknown as string)))
            const japanese: string = await failure((): unknown => orders.label(1 as unknown as string))
            assert.match(english, /must be a string/)
            assert.ok(japanese !== english && /^Method \[label\]/.test(japanese), japanese)
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1))
            assert.strictEqual(await failure((): Promise<unknown> => OrderDTO.validateAsync({amount: 1})), '"customer" は必須です')
            //The language given by the validation, the valid values
            assert.strictEqual(await failure((): Promise<unknown> => OrderDTO.validateAsync({amount: 1}, {errors: {language: 'en'}})), '"customer" is required')
            assert.strictEqual(await orders.take(5), 5)
            assert.deepStrictEqual({...await OrderDTO.validateAsync({customer: 'Ada', amount: 1})}, {customer: 'Ada', amount: 1})
        })
        //Out of it: the default messages
        assert.strictEqual(await failure((): Promise<unknown> => OrderDTO.validateAsync({amount: 1})), '"customer" is required')
    })
})

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

describe('The parameters of the exceptions', (): void => {
    it('are kept for the translations of their messages, not as properties', (): void => {
        const named: OrderNotFoundException = new OrderNotFoundException('Order {id} not found', {id: 7})
        assert.strictEqual(named.message, 'Order 7 not found')
        assert.deepStrictEqual(exceptionParams(named), {id: 7})
        assert.deepStrictEqual(exceptionParams(new OrderNotFoundException('Order {0} of {1}', 7, 'ada')), [7, 'ada'])
        assert.deepStrictEqual(exceptionParams(new OrderNotFoundException('Order %s not found', 7)), [7])
        assert.strictEqual(exceptionParams(new OrderNotFoundException('Order not found')), undefined)
        //Not in the properties of the error sent
        assert.ok(!Object.keys(named).some((key: string): boolean => key.includes('PARAMS')))
        assert.ok(!JSON.stringify(named).includes('"id"'))
    })
})
