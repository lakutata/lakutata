/**
 * Ported from joi/test/isAsync.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
describe('isAsync()', () => {

    it('returns false for schemas without async rules', () => {

        expect(Engine.alternatives().isAsync()).to.be.false()
        expect(Engine.array().isAsync()).to.be.false()
        expect(Engine.boolean().isAsync()).to.be.false()
        expect(Engine.date().isAsync()).to.be.false()
        expect(Engine.number().isAsync()).to.be.false()
        expect(Engine.object().isAsync()).to.be.false()
        expect(Engine.string().isAsync()).to.be.false()
    })

    it('returns true for schemas with external rules', () => {

        expect(Engine.string().external(() => {}).isAsync()).to.be.true()
        expect(Engine.number().external(() => {}).isAsync()).to.be.true()
        expect(Engine.boolean().external(() => {}).isAsync()).to.be.true()
        expect(Engine.date().external(() => {}).isAsync()).to.be.true()
        expect(Engine.object().external(() => {}).isAsync()).to.be.true()
        expect(Engine.array().external(() => {}).isAsync()).to.be.true()
        expect(Engine.alternatives().external(() => {}).isAsync()).to.be.true()
    })

    it('returns true for objects with async child schemas', () => {

        expect(Engine.object({ a: Engine.string().external(() => {}) }).isAsync()).to.be.true()
        expect(Engine.object({ a: Engine.string() }).isAsync()).to.be.false()
        expect(Engine.object().pattern(/a/, Engine.string().external(() => {})).isAsync()).to.be.true()
        expect(Engine.object().pattern(/a/, Engine.string()).isAsync()).to.be.false()
        expect(Engine.object().pattern(Engine.string(), { a: Engine.string().external(() => {}) }).isAsync()).to.be.true()
        expect(Engine.object().pattern(Engine.string(), { a: Engine.string() }).isAsync()).to.be.false()
    })

    it('returns true for arrays with async items', () => {

        expect(Engine.array().items(Engine.string().external(() => {})).isAsync()).to.be.true()
        expect(Engine.array().items(Engine.string()).isAsync()).to.be.false()
        expect(Engine.array().ordered(Engine.string().external(() => {})).isAsync()).to.be.true()
        expect(Engine.array().ordered(Engine.string()).isAsync()).to.be.false()
    })

    it('returns true for alternatives with async schemas', () => {

        expect(Engine.alternatives().try(Engine.string().external(() => {})).isAsync()).to.be.true()
        expect(Engine.alternatives().conditional('a', { is: 'b', then: Engine.string().external(() => {}) }).isAsync()).to.be.true()
        expect(Engine.alternatives().conditional('a', { is: 'b', otherwise: Engine.string().external(() => {}) }).isAsync()).to.be.true()
        expect(Engine.alternatives().conditional('a', {
            is: 'b',
            otherwise: Engine.string().external(() => {})
        }).isAsync()).to.be.true()
        expect(Engine.alternatives().conditional('a', {
            is: 'b',
            then: Engine.string(),
            otherwise: Engine.number()
        }).isAsync()).to.be.false()
        expect(Engine.any().when('a', {
            is: 'b',
            then: Engine.string().external(() => {})
        }).isAsync()).to.be.true()
        expect(Engine.any().when('a', {
            is: 'b',
            otherwise: Engine.string().external(() => {})
        }).isAsync()).to.be.true()
        expect(Engine.any().when('a', {
            is: 'b',
            otherwise: Engine.string()
        }).isAsync()).to.be.false()
        expect(Engine.any().when('a', {
            switch: [
                { is: 'b', then: Engine.string() },
                { is: 'c', then: Engine.number().external(() => {}), otherwise: Engine.string() }
            ]
        }).isAsync()).to.be.true()
        expect(Engine.any().when('a', {
            switch: [
                { is: 'b', then: Engine.string() },
                { is: 'c', then: Engine.number(), otherwise: Engine.string() }
            ]
        }).isAsync()).to.be.false()
        expect(Engine.any().when('a', {
            switch: [
                { is: 'b', then: Engine.string() },
                { is: 'c', then: Engine.string(), otherwise: Engine.number().external(() => {}) }
            ]
        }).isAsync()).to.be.true()
        expect(Engine.any().when('a', {
            switch: [
                { is: 'b', then: Engine.string() },
                { is: 'c', then: Engine.string(), otherwise: Engine.number() }
            ]
        }).isAsync()).to.be.false()
    })
})
