import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {RegisterValidationMessages, ValidationLanguages} from '../../lib/validation/ValidationMessages.js'

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
