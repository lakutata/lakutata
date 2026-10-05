import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {I18n, type I18nOptions} from '../exports/I18n.js'

class OrderDTO extends DTO {
    @Expect(DTO.String().required())
    public customer: string

    @Expect(DTO.Number().max(100).optional())
    public amount?: number
}

/**
 * The message of the validation error of a value in a language
 * @param data
 * @param language
 */
async function errorOf(data: Record<string, unknown>, language: string): Promise<string> {
    return (await OrderDTO.validateAsync(data, {errors: {language: language}}).catch((error: Error): Error => error) as Error).message
}

/**
 * Create an i18n component
 * @param options
 */
async function create(options: I18nOptions): Promise<I18n> {
    return await new Container().set(I18n, options as Record<string, unknown>)
}

//The messages of the validation are registered for the process: the cases are in their order
describe('The validation messages of the i18n component', (): void => {
    it('are the ones of its messages only without the built-in ones', async (): Promise<void> => {
        await create({messages: {'ja': {validation: {any: {required: '{{#label}} を入力してください'}}}}, validationMessages: false})
        assert.strictEqual(await errorOf({}, 'ja'), '"customer" を入力してください')
        //The codes without a message: the default ones
        assert.strictEqual(await errorOf({customer: 'Ada', amount: 101}, 'ja'), '"amount" must be less than or equal to 100')
    })

    it('are the built-in ones of its languages, its messages replacing them, each language falling back', async (): Promise<void> => {
        await create({
            defaultLocale: 'zh-CN',
            locales: ['zh-CN', 'zh-TW', 'en', 'fr'],
            messages: {
                'zh-CN': {validation: {any: {required: '请填写 {{#label}}'}}},
                'zh-HK': {app: {name: '商店'}}
            }
        })
        //The message of the application, the built-in ones for the other codes
        assert.strictEqual(await errorOf({}, 'zh-CN'), '请填写 "customer"')
        assert.strictEqual(await errorOf({customer: 'Ada', amount: 101}, 'zh-CN'), '"amount" 必须小于或等于 100')
        //zh-TW and zh-HK (its messages loaded): the built-in Traditional Chinese, not the messages of zh-CN
        assert.strictEqual(await errorOf({}, 'zh-TW'), '"customer" 為必填欄位')
        assert.strictEqual(await errorOf({}, 'zh-HK'), '"customer" 為必填欄位')
        //English, falling back to zh-CN, is English
        assert.strictEqual(await errorOf({}, 'en'), '"customer" is required')
        assert.notStrictEqual(await errorOf({}, 'fr'), '"customer" is required')
    })
    it('are registered for the languages added at run time, and for their validation messages', async (): Promise<void> => {
        const i18n: I18n = await create({defaultLocale: 'ko', messages: {ko: {hello: '안녕하세요'}}})
        //A new language: its built-in messages
        await i18n.addMessages('it', {hello: 'Ciao'})
        assert.strictEqual(await errorOf({}, 'it'), '"customer" è obbligatorio')
        //sv has no built-in messages: the ones of the default language, ko
        await i18n.addMessages('sv', {hello: 'Hej'})
        assert.strictEqual(await errorOf({}, 'sv'), '"customer"은(는) 필수입니다')
        //The validation messages of a language known already, and of the languages falling back to it
        await i18n.addMessages('ko', {validation: {any: {required: '{{#label}}를 입력하세요'}}})
        assert.strictEqual(await errorOf({}, 'ko'), '"customer"를 입력하세요')
        assert.strictEqual(await errorOf({}, 'sv'), '"customer"를 입력하세요')
    })
})
