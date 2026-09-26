/**
 * Ported from the upstream test/parser/json-draft-04.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv-draft-04'
import {executeTests} from './ParserBase.js'

executeTests('json-draft-04', new Ajv())
