import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {fuzz, type FuzzFailure} from './support/Fuzz.js'

describe('the fuzzing', () => {
    it('finds no error but the package\'s own exceptions, in the messages, the filters, the DNs, LDIF and the schemas', () => {
        const failures: FuzzFailure[] = fuzz(3000, 20261108)
        assert.deepEqual(failures.map((failure: FuzzFailure): string => `${failure.target} ${JSON.stringify(failure.input)}: ${failure.error.message}`), [])
    })
})
