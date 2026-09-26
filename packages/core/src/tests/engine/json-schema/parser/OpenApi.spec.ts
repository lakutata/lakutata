/**
 * Ported from the upstream test/parser/open-api.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv-draft-04'
import {readJson} from '../support.js'
import {executeTests} from './ParserBase.js'

const ajv = new Ajv()
ajv.addMetaSchema(readJson('schemas/openapi-3.0.json'))
executeTests('open-api', ajv)
