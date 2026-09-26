/**
 * Ported from joi-to-json 5.0.0 test/unit/schema_dialect.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import {toEqual} from '../support.js'

const JOI_SCHEMA = joi.object().keys({
    field: joi.string()
})

it('json - includes schema dialect', () => {
    toEqual(parse(JOI_SCHEMA, 'json', {}, { includeSchemaDialect: true }).$schema, 'http://json-schema.org/draft-07/schema#')
})

it('json - no schema dialect', () => {
    toEqual(parse(JOI_SCHEMA, 'json').$schema, undefined)
})

it('json-draft-04 - includes schema dialect', () => {
    toEqual(parse(JOI_SCHEMA, 'json-draft-04', {}, { includeSchemaDialect: true }).$schema, 'http://json-schema.org/draft-04/schema#')
})

it('json-draft-04 - no schema dialect', () => {
    toEqual(parse(JOI_SCHEMA, 'json-draft-04').$schema, undefined)
})

it('json-draft-2019-09 - includes schema dialect', () => {
    toEqual(parse(JOI_SCHEMA, 'json-draft-2019-09', {}, { includeSchemaDialect: true }).$schema, 'https://json-schema.org/draft/2019-09/schema')
})

it('json-draft-2019-09 - no schema dialect', () => {
    toEqual(parse(JOI_SCHEMA, 'json-draft-2019-09').$schema, undefined)
})

it('open-api - no schema dialect even specified', () => {
    toEqual(parse(JOI_SCHEMA, 'open-api', {}, { includeSchemaDialect: true }).$schema, undefined)
})
