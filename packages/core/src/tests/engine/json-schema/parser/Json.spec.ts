/**
 * Ported from joi-to-json 5.0.0 test/parser/json.spec.js (MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv'
import {executeTests} from './ParserBase.js'

executeTests('json', new Ajv({ allErrors: true }))
