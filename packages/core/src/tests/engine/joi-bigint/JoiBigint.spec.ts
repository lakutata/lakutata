/**
 * Ported from @softstack/joi-bigint 1.1.1 src/__tests__/joi-bigint.test.ts (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions library and the code style differ).
 * It exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import BaseJoi from '../../../lib/validation/engine/joi/index.js'
import {extendJoi} from '../../../lib/validation/engine/joi-bigint/index.js'

const Joi = extendJoi(BaseJoi)

describe('joi-bigint', () => {

    it('Value should be bigint', () => {
        const schema = Joi.bigint().prefs({ convert: false }).required()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(3)).to.be.true()
        expect('error' in schema.validate('3')).to.be.true()
    })

    it('Value should be converted to bigint', () => {
        const schema = Joi.bigint().required()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(3)).to.be.false()
        expect('error' in schema.validate('3')).to.be.false()

        expect('error' in schema.validate(-1)).to.be.false()
        expect('error' in schema.validate(0)).to.be.false()
        expect('error' in schema.validate(1)).to.be.false()

        expect('error' in schema.validate('-1')).to.be.false()
        expect('error' in schema.validate('0')).to.be.false()
        expect('error' in schema.validate('1')).to.be.false()

        expect(typeof schema.validate(3n).value === 'bigint').to.be.true()
        expect(typeof schema.validate(3).value === 'bigint').to.be.true()
        expect(typeof schema.validate('3').value === 'bigint').to.be.true()

        expect(typeof schema.validate(-1).value === 'bigint').to.be.true()
        expect(typeof schema.validate(0).value === 'bigint').to.be.true()
        expect(typeof schema.validate(1).value === 'bigint').to.be.true()

        expect(typeof schema.validate('-1').value === 'bigint').to.be.true()
        expect(typeof schema.validate('0').value === 'bigint').to.be.true()
        expect(typeof schema.validate('1').value === 'bigint').to.be.true()

        expect(schema.validate(3n).value === 3n).to.be.true()
        expect(schema.validate(3).value === 3n).to.be.true()
        expect(schema.validate('3').value === 3n).to.be.true()

        expect(schema.validate(-1).value === -1n).to.be.true()
        expect(schema.validate(0).value === 0n).to.be.true()
        expect(schema.validate(1).value === 1n).to.be.true()

        expect(schema.validate('-1').value === -1n).to.be.true()
        expect(schema.validate('0').value === 0n).to.be.true()
        expect(schema.validate('1').value === 1n).to.be.true()
    })

    it('Value should be greater than 3', () => {
        const schema = Joi.bigint().greater(3n).required()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(3n)).to.be.true()
        expect('error' in schema.validate(4n)).to.be.false()
    })

    it('Value should be less or equal 3', () => {
        const schema = Joi.bigint().max(3n).required()
        expect('error' in schema.validate(2n)).to.be.false()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(4n)).to.be.true()
    })

    it('Value should be greater or equal 3', () => {
        const schema = Joi.bigint().min(3n).required()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(4n)).to.be.false()
    })

    it('Value shoud be multiple of 3', () => {
        const schema = Joi.bigint().multiple(3n).required()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(5n)).to.be.true()
        expect('error' in schema.validate(6n)).to.be.false()
        expect('error' in schema.validate(7n)).to.be.true()
    })

    it('Value should be negative', () => {
        const schema = Joi.bigint().negative().required()
        expect('error' in schema.validate(-1n)).to.be.false()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.true()
    })

    it('Value should be a port', () => {
        const schema = Joi.bigint().port().required()
        expect('error' in schema.validate(-1n)).to.be.true()
        expect('error' in schema.validate(0n)).to.be.false()
        expect('error' in schema.validate(65535n)).to.be.false()
        expect('error' in schema.validate(65536n)).to.be.true()
    })

    it('Value should be positive', () => {
        const schema = Joi.bigint().positive().required()
        expect('error' in schema.validate(-1n)).to.be.true()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.false()
    })

    it('Value should have a negative sign', () => {
        const schema = Joi.bigint().sign('negative').required()
        expect('error' in schema.validate(-1n)).to.be.false()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.true()
    })

    it('Value should have a positive sign', () => {
        const schema = Joi.bigint().sign('positive').required()
        expect('error' in schema.validate(-1n)).to.be.true()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.false()
    })
})
