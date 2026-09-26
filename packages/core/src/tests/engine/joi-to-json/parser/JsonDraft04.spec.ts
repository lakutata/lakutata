/**
 * Ported from joi-to-json 5.0.0 test/parser/json-draft-04.spec.js (MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv-draft-04'
import {executeTests} from './ParserBase.js'

executeTests('json-draft-04', new Ajv())
