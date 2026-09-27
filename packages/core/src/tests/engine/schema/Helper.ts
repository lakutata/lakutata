/**
 * Ported from the upstream test/helper.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 * Dropped: thrownAt() (it only adjusted the error location for the reporter of the upstream test runner).
 */
// @ts-nocheck
import {expect} from '../support/Expect.js'

const internals = {}

export const skip = Symbol('skip')

export const equal = function (a, b) {

    try {
        expect(a).to.equal(b, {deepFunction: true, skip: ['$_temp', '$_root']})
    } catch (err) {
        console.error(err.stack)
        throw err
    }
}

export const validate = function (schema, prefs, tests) {

    if (!tests) {
        tests = prefs
        prefs = null
    }

    try {
        expect(schema.$_root.build(schema.describe())).to.equal(schema, {deepFunction: true, skip: ['$_temp']})

        for (const test of tests) {
            const [input, pass, expected] = test
            if (!pass) {
                expect(expected, 'Failing tests messages must be tested').to.exist()
            }

            const {error: errord, value: valued} = schema.validate(input, Object.assign({debug: true}, prefs))

            if (prefs === null) {
                internals.standardValidate(schema, test, {errord, valued})
            }

            const {error, value} = schema.validate(input, prefs)

            expect(error).to.equal(errord)
            expect(value).to.equal(valued)

            if (error &&
                pass) {

                console.log(error)
            }

            if (!error &&
                !pass) {

                console.log(input)
            }

            expect(!error).to.equal(pass)

            if (test.length === 2) {
                if (pass) {
                    expect(input).to.equal(value)
                }

                continue
            }

            if (pass) {
                if (expected !== skip) {
                    expect(value).to.equal(expected)
                }

                continue
            }

            if (typeof expected === 'string') {
                expect(error.message).to.equal(expected)
                continue
            }

            if (schema._preferences && schema._preferences.abortEarly === false ||
                prefs && prefs.abortEarly === false) {

                expect(error.message).to.equal(expected.message)
                expect(error.details).to.equal(expected.details)
            } else {
                expect(error.details).to.have.length(1)
                expect(error.message).to.equal(error.details[0].message)
                expect(error.details[0]).to.equal(expected)
            }
        }
    } catch (err) {
        console.error(err.stack)
        throw err
    }
}

internals.standardValidate = function (schema, test, {errord, valued}) {

    const [input, pass] = test
    const {issues, value} = schema['~standard'].validate(input)

    if (pass) {
        expect(issues).to.equal(undefined)
        expect(value).to.equal(valued)
    }

    if (!pass) {
        expect(value).to.equal(undefined)
    }

    if (!pass && !errord.details) {
        expect(issues.length).to.equal(1)
    }

    if (!pass && errord.details) {
        expect(issues.length).to.equal(errord.details.length)
    }
}
