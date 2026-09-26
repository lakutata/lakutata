/**
 * Ported from joi-to-json 5.0.4 test/unit/unknown_keys_in_shared_schemas.spec.js (commit 79228c3, MIT, see
 * THIRD_PARTY_NOTICES.md). Upstream test logic is kept line by line (only the runner, the assertions and the code
 * style differ). Not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import {toEqual} from '../support.js'

const JOI_SCHEMA = joi.object().pattern(/a/, joi.array().items(joi.string())).id('patternObject')

const expected = {
    'additionalProperties': false,
    'properties': { '/a/': { 'items': { 'type': 'string' }, 'type': 'array' } }, 'type': 'object'
}

it('open-api - patternProperties should not in shared schemas', () => {
    const sharedSchemas = {}
    const result = parse(JOI_SCHEMA, 'open-api', sharedSchemas)
    toEqual(result, {
        '$ref': '#/components/schemas/patternObject',
        schemas: { patternObject: expected }
    })
    toEqual(sharedSchemas['patternObject'], expected)
})
