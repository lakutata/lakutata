/**
 * Ported from joi-to-json 5.0.0 test/parser/parser.base.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept (only the runner, the module loading and the code style differ). Not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import Ajv from 'ajv'
import {expect} from '../../support/Expect.js'
import {JsonDraft04SchemaParser, JsonDraft201909SchemaParser, JsonSchemaParser, OpenApiSchemaParser, OpenApi31SchemaParser} from '../../../../lib/validation/engine/json-schema/index.js'
import {hasData, listData, readJson, toEqual} from '../support.js'

const parsers = {
    'json': JsonSchemaParser,
    'json-draft-04': JsonDraft04SchemaParser,
    'json-draft-2019-09': JsonDraft201909SchemaParser,
    'open-api': OpenApiSchemaParser,
    'open-api-3.1': OpenApi31SchemaParser
}

export function executeTests(outputType, ajv = new Ajv({ allErrors: true })) {
    const Parser = parsers[outputType]
    const parser = new Parser()
    const schemaTypeInputs = listData('outputs-baseline')

    schemaTypeInputs.forEach((schemaType) => {
        const parserCaseInputs = listData(`outputs-baseline/${schemaType}`)

        parserCaseInputs.forEach((schemaCase) => {
            if (process.env.TEST_CASE && !process.env.TEST_CASE.split(',').includes(schemaCase.replace('.json', ''))) {
                return
            }

            if (!hasData(`outputs-parsers/${outputType}/${schemaType}/${schemaCase}`)) {
                return
            }

            it(`${outputType} schema parsing - ${schemaType} - ${schemaCase} `, () => {
                const expected = readJson(`outputs-parsers/${outputType}/${schemaType}/${schemaCase}`)
                const schemaObj = readJson(`outputs-baseline/${schemaType}/${schemaCase}`)
                const destSchema = parser.parse(schemaObj, {})

                //Safety net in case the expected output is not compatible to json schema
                const validationResult = ajv.validateSchema(destSchema)
                if (!validationResult) {
                    console.error(`${outputType} schema validation failed on case: ${schemaType} - ${schemaCase}`, JSON.stringify(ajv.errors, null, 2))
                }
                expect(!!(validationResult)).to.be.true()

                toEqual(destSchema, expected)
            })
        })
    })
}
