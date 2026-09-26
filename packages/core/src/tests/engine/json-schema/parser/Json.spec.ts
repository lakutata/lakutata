/**
 * Ported from the upstream test/parser/json.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv'
import {executeTests} from './ParserBase.js'

executeTests('json', new Ajv({ allErrors: true }))
