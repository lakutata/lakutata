/**
 * Not from upstream: the preferences caches of the engine (lakutata) must never serve stale settings
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Joi from '../../../lib/validation/engine/joi/index.js'

describe('preferences caches', () => {

    it('applies the changes of a mutable options object between validations', () => {
        const schema = Joi.number()
        const options = {convert: false}
        expect(schema.validate('1', options).error).to.exist()
        options.convert = true
        expect(schema.validate('1', options).error).to.not.exist()
        expect(schema.validate('1', options).value).to.equal(1)
    })

    it('reuses frozen options of primitive values without changing the results', () => {
        const schema = Joi.object({a: Joi.number(), b: Joi.string().prefs({convert: false})})
        const options = Object.freeze({convert: true, abortEarly: false})
        for (let i = 0; i < 3; i++) {
            const result = schema.validate({a: '1', b: 2}, options)
            expect(result.value).to.equal({a: 1, b: 2})
            expect(result.error.details.map((detail) => detail.type)).to.equal(['string.base'])
        }
    })

    it('does not reuse frozen options holding objects (they may change)', () => {
        const schema = Joi.number()
        const errors = {label: 'path'}
        const options = Object.freeze({errors})
        expect(schema.validate('x', options).error.message).to.equal('"value" must be a number')
        errors.label = false
        expect(schema.validate('x', options).error.message).to.equal('must be a number')
    })

    it('merges the schema preferences with each parent preferences', () => {
        const inner = Joi.string().prefs({abortEarly: false}).min(3).pattern(/^\d+$/)
        const schema = Joi.object({s: inner})
        const strict = Object.freeze({convert: false})
        const loose = Object.freeze({convert: true})
        expect(Joi.object({n: Joi.number()}).validate({n: '1'}, strict).error).to.exist()
        expect(Joi.object({n: Joi.number()}).validate({n: '1'}, loose).error).to.not.exist()
        for (let i = 0; i < 2; i++) {
            expect(schema.validate({s: 'ab'}, strict).error.details.map((detail) => detail.type)).to.equal(['string.min', 'string.pattern.base'])
            expect(schema.validate({s: '1234'}, loose).error).to.not.exist()
        }
    })

    it('matches conditions with the preferences of each validation', () => {
        const schema = Joi.object({a: Joi.any(), b: Joi.any().when('a', {is: Joi.number(), then: Joi.required()})})
        expect(schema.validate({a: '1'}, Object.freeze({convert: false})).error).to.not.exist()
        expect(schema.validate({a: '1'}, Object.freeze({convert: true})).error).to.exist()
    })
})
