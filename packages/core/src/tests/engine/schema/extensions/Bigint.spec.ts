/**
 * Ported from @softstack/joi-bigint 1.1.1 src/__tests__/joi-bigint.test.ts (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions library and the code style differ).
 * It exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../../support/Expect.js'
import BaseEngine from '../../../../lib/validation/engine/schema/index.js'
import {extendBigInt} from '../../../../lib/validation/engine/schema/extensions/bigint.js'

const Engine = extendBigInt(BaseEngine)

describe('joi-bigint', () => {

    it('Value should be bigint', () => {
        const schema = Engine.bigint().prefs({ convert: false }).required()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(3)).to.be.true()
        expect('error' in schema.validate('3')).to.be.true()
    })

    it('Value should be converted to bigint', () => {
        const schema = Engine.bigint().required()
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
        const schema = Engine.bigint().greater(3n).required()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(3n)).to.be.true()
        expect('error' in schema.validate(4n)).to.be.false()
    })

    it('Value should be less or equal 3', () => {
        const schema = Engine.bigint().max(3n).required()
        expect('error' in schema.validate(2n)).to.be.false()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(4n)).to.be.true()
    })

    it('Value should be greater or equal 3', () => {
        const schema = Engine.bigint().min(3n).required()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(4n)).to.be.false()
    })

    it('Value shoud be multiple of 3', () => {
        const schema = Engine.bigint().multiple(3n).required()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(3n)).to.be.false()
        expect('error' in schema.validate(2n)).to.be.true()
        expect('error' in schema.validate(5n)).to.be.true()
        expect('error' in schema.validate(6n)).to.be.false()
        expect('error' in schema.validate(7n)).to.be.true()
    })

    it('Value should be negative', () => {
        const schema = Engine.bigint().negative().required()
        expect('error' in schema.validate(-1n)).to.be.false()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.true()
    })

    it('Value should be a port', () => {
        const schema = Engine.bigint().port().required()
        expect('error' in schema.validate(-1n)).to.be.true()
        expect('error' in schema.validate(0n)).to.be.false()
        expect('error' in schema.validate(65535n)).to.be.false()
        expect('error' in schema.validate(65536n)).to.be.true()
    })

    it('Value should be positive', () => {
        const schema = Engine.bigint().positive().required()
        expect('error' in schema.validate(-1n)).to.be.true()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.false()
    })

    it('Value should have a negative sign', () => {
        const schema = Engine.bigint().sign('negative').required()
        expect('error' in schema.validate(-1n)).to.be.false()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.true()
    })

    it('Value should have a positive sign', () => {
        const schema = Engine.bigint().sign('positive').required()
        expect('error' in schema.validate(-1n)).to.be.true()
        expect('error' in schema.validate(0n)).to.be.true()
        expect('error' in schema.validate(1n)).to.be.false()
    })
})
