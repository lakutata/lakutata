/**
 * Ported from the upstream test/parser/json-draft-2019-09.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md). Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv/dist/2019.js'
import {executeTests} from './ParserBase.js'

executeTests('json-draft-2019-09', new Ajv({ allErrors: true }))
