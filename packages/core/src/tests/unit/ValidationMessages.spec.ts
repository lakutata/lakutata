import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {BUILT_IN_VALIDATION_LANGUAGES, BuiltInValidationLanguage, DefaultValidationMessages, LoadValidationMessages, RegisterValidationMessages, ValidationLanguages} from '../../lib/validation/ValidationMessages.js'

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
async function ErrorOf(data: Record<string, unknown>, language?: string): Promise<string> {
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
        assert.strictEqual(await ErrorOf({amount: 1}, 'zh-CN'), '"customer" is required')
        RegisterValidationMessages('zh-CN', {'any.required': '{{#label}} 为必填项'})
        assert.ok(ValidationLanguages().includes('zh-CN'))
        assert.strictEqual(await ErrorOf({amount: 1}, 'zh-CN'), '"customer" 为必填项')
        //A code without a message of the language: the default one
        assert.strictEqual(await ErrorOf({customer: 'Ada', amount: 101}, 'zh-CN'), '"amount" must be less than or equal to 100')
        //Without the language, or in another one: the default messages
        assert.strictEqual(await ErrorOf({amount: 1}), '"customer" is required')
        assert.strictEqual(await ErrorOf({amount: 1}, 'fr'), '"customer" is required')
    })

    it('are added to the ones of the language, the same codes replaced', async (): Promise<void> => {
        RegisterValidationMessages('zh-CN', {'any.required': '缺少 {{#label}}', 'number.max': '{{#label}} 不能大于 {{#limit}}'})
        assert.strictEqual(await ErrorOf({amount: 1}, 'zh-CN'), '缺少 "customer"')
        assert.strictEqual(await ErrorOf({customer: 'Ada', amount: 101}, 'zh-CN'), '"amount" 不能大于 100')
        //The valid values are not changed by the language
        assert.deepStrictEqual({...await OrderDTO.validateAsync({customer: 'Ada', amount: 1}, {errors: {language: 'zh-CN'}})}, {customer: 'Ada', amount: 1})
    })
})

/**
 * The variables of a template: #name
 * @param template
 */
function Variables(template: string): string[] {
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
    const defaults: Record<string, string> = DefaultValidationMessages()

    it('give every message of the validation, their variables kept, in every built-in language', async (): Promise<void> => {
        assert.strictEqual(Object.keys(defaults).length, 137)
        assert.strictEqual(defaults['any.required'], '{{#label}} is required')
        assert.deepStrictEqual(await LoadValidationMessages('en-GB'), defaults)
        for (const language of BUILT_IN_VALIDATION_LANGUAGES.filter((tag: string): boolean => tag !== 'en')) {
            const messages: Record<string, string> | undefined = await LoadValidationMessages(language)
            assert.ok(messages, language)
            assert.deepStrictEqual(Object.keys(messages).sort(), Object.keys(defaults).sort(), language)
            for (const [code, template] of Object.entries(defaults)) {
                assert.deepStrictEqual(Variables(messages[code]), Variables(template), `${language} ${code}: ${messages[code]}`)
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
            RegisterValidationMessages(language, (await LoadValidationMessages(language))!)
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
        for (const [language, builtIn] of cases) assert.strictEqual(BuiltInValidationLanguage(language), builtIn, language)
    })
})
