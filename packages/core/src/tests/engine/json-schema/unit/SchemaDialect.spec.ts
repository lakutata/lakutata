/**
 * Ported from joi-to-json 5.0.0 test/unit/schema_dialect.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import engine from '../../../../lib/validation/engine/schema/index.js'
import parse from '../../../../lib/validation/engine/json-schema/index.js'
import {toEqual} from '../support.js'

const SCHEMA_DEFINITION = engine.object().keys({
    field: engine.string()
})

it('json - includes schema dialect', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'json', {}, { includeSchemaDialect: true }).$schema, 'http://json-schema.org/draft-07/schema#')
})

it('json - no schema dialect', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'json').$schema, undefined)
})

it('json-draft-04 - includes schema dialect', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'json-draft-04', {}, { includeSchemaDialect: true }).$schema, 'http://json-schema.org/draft-04/schema#')
})

it('json-draft-04 - no schema dialect', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'json-draft-04').$schema, undefined)
})

it('json-draft-2019-09 - includes schema dialect', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'json-draft-2019-09', {}, { includeSchemaDialect: true }).$schema, 'https://json-schema.org/draft/2019-09/schema')
})

it('json-draft-2019-09 - no schema dialect', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'json-draft-2019-09').$schema, undefined)
})

it('open-api - no schema dialect even specified', () => {
    toEqual(parse(SCHEMA_DEFINITION, 'open-api', {}, { includeSchemaDialect: true }).$schema, undefined)
})
