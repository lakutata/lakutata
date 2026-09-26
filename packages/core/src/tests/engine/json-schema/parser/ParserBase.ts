/**
 * Ported from joi-to-json 5.0.0 test/parser/parser.base.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept (only the runner, the module loading and the code style differ). Not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import Ajv from 'ajv'
import {expect} from '../../support/Expect.js'
import {JoiJsonDraftSchemaParser, JoiJsonDraftSchemaParser19, JoiJsonSchemaParser, JoiOpenApiSchemaParser, JoiOpenApiThreePointOneSchemaParser} from '../../../../lib/validation/engine/json-schema/index.js'
import {hasData, listData, readJson, toEqual} from '../support.js'

const parsers = {
    'json': JoiJsonSchemaParser,
    'json-draft-04': JoiJsonDraftSchemaParser,
    'json-draft-2019-09': JoiJsonDraftSchemaParser19,
    'open-api': JoiOpenApiSchemaParser,
    'open-api-3.1': JoiOpenApiThreePointOneSchemaParser
}

export function executeTests(outputType, ajv = new Ajv({ allErrors: true })) {
    const Parser = parsers[outputType]
    const parser = new Parser()
    const joiTypeInputs = listData('outputs-baseline')

    joiTypeInputs.forEach((joiType) => {
        const parserCaseInputs = listData(`outputs-baseline/${joiType}`)

        parserCaseInputs.forEach((joiCase) => {
            if (process.env.TEST_CASE && !process.env.TEST_CASE.split(',').includes(joiCase.replace('.json', ''))) {
                return
            }

            if (!hasData(`outputs-parsers/${outputType}/${joiType}/${joiCase}`)) {
                return
            }

            it(`${outputType} schema parsing - ${joiType} - ${joiCase} `, () => {
                const expected = readJson(`outputs-parsers/${outputType}/${joiType}/${joiCase}`)
                const joiObj = readJson(`outputs-baseline/${joiType}/${joiCase}`)
                const destSchema = parser.parse(joiObj, {})

                //Safety net in case the expected output is not compatible to json schema
                const validationResult = ajv.validateSchema(destSchema)
                if (!validationResult) {
                    console.error(`${outputType} schema validation failed on case: ${joiType} - ${joiCase}`, JSON.stringify(ajv.errors, null, 2))
                }
                expect(!!(validationResult)).to.be.true()

                toEqual(destSchema, expected)
            })
        })
    })
}
