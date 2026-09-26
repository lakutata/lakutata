/**
 * Not from upstream: the JSON Schema 2020-12 parser, on the cases of the 2019-09 parser. Not type-checked.
 */
// @ts-nocheck
import Ajv from 'ajv/dist/2020.js'
import {executeTests} from './ParserBase.js'

executeTests('json-2020-12', new Ajv({ allErrors: true }))
