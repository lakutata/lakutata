/**
 * Ported from joi-to-json 5.0.0 test/parser/json-draft-2019-09.spec.js (MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv/dist/2019.js'
import {executeTests} from './ParserBase.js'

executeTests('json-draft-2019-09', new Ajv({ allErrors: true }))
