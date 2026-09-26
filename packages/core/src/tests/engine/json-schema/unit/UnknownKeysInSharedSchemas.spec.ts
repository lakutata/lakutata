/**
 * Ported from the upstream test/unit/unknown_keys_in_shared_schemas.spec.js (commit 79228c3, see UPSTREAM.md; MIT, see
 * THIRD_PARTY_NOTICES.md). Upstream test logic is kept line by line (only the runner, the assertions and the code
 * style differ). Not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import engine from '../../../../lib/validation/engine/schema/index.js'
import parse from '../../../../lib/validation/engine/json-schema/index.js'
import {toEqual} from '../support.js'

const SCHEMA_DEFINITION = engine.object().pattern(/a/, engine.array().items(engine.string())).id('patternObject')

const expected = {
    'additionalProperties': { 'items': { 'type': 'string', 'minLength': 1 }, 'type': 'array' },
    'properties': {}, 'type': 'object'
}

it('open-api - patternProperties should not in shared schemas', () => {
    const sharedSchemas = {}
    const result = parse(SCHEMA_DEFINITION, 'open-api', sharedSchemas)
    toEqual(result, {
        '$ref': '#/components/schemas/patternObject',
        schemas: { patternObject: expected }
    })
    toEqual(sharedSchemas['patternObject'], expected)
})
