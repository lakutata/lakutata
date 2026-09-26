import {describe, it} from 'node:test'
import assert from 'node:assert'
import {VLD, VLDMethods} from '../../lib/validation/VLD.js'

describe('VLD', (): void => {

    it('applies the changes of an options object reused between validations', (): void => {
        const schema = VLD.number()
        const options: { convert: boolean } = {convert: false}
        assert.throws((): unknown => VLDMethods.validate('1', schema, options))
        options.convert = true
        assert.strictEqual(VLDMethods.validate('1', schema, options), 1)
    })

    it('validates a schema under different target names', async (): Promise<void> => {
        const schema = VLD.string().min(2)
        const symbolName: unique symbol = Symbol('name')
        assert.strictEqual(VLDMethods.validate('ab', schema, {targetName: 'first'}), 'ab')
        assert.strictEqual(VLDMethods.validate('cd', schema, {targetName: 'second'}), 'cd')
        assert.strictEqual(VLDMethods.validate('ef', schema, {targetName: symbolName}), 'ef')
        assert.strictEqual(await VLDMethods.validateAsync('gh', schema, {targetName: 'first'}), 'gh')
        assert.throws((): unknown => VLDMethods.validate('a', schema, {targetName: 'first'}), /"first" length must be at least 2/)
        await assert.rejects(VLDMethods.validateAsync('a', schema, {targetName: 'second'}), /"second" length must be at least 2/)
    })

    it('validates with options holding objects', (): void => {
        const schema = VLD.object({a: VLD.number()})
        assert.throws((): unknown => VLDMethods.validate({a: 'x'}, schema, {errors: {label: false}}), (error: Error): boolean => error.message === 'must be a number')
        assert.throws((): unknown => VLDMethods.validate({a: 'x'}, schema, {errors: {label: 'key'}}), (error: Error): boolean => error.message === '"a" must be a number')
    })

    it('keeps the default options', (): void => {
        const schema = VLD.object({a: VLD.number()})
        //allowUnknown and stripUnknown, convert
        assert.deepStrictEqual(VLDMethods.validate({a: '1', b: 2}, schema), {a: 1})
        assert.deepStrictEqual(VLDMethods.validate({a: '1', b: 2}, schema, {stripUnknown: false}), {a: 1, b: 2})
    })
})
