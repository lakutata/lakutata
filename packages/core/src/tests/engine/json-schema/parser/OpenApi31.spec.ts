/**
 * Ported from joi-to-json 5.0.0 test/parser/open-api-3.1.spec.js (MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv/dist/2020.js'
import {readJson} from '../support.js'
import {executeTests} from './ParserBase.js'

const ajv = new Ajv({ allErrors: true })
ajv.addMetaSchema(readJson('schemas/openapi-3.1/meta/base.schema.json'))
ajv.addMetaSchema(readJson('schemas/openapi-3.1/dialect/base.schema.json'))
ajv.addMetaSchema(readJson('schemas/openapi-3.1/schema-base.json'))
ajv.addMetaSchema(readJson('schemas/openapi-3.1/schema.json'))
executeTests('open-api-3.1', ajv)
