/**
 * Ported from joi/test/common.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Common from '../../../lib/validation/engine/schema/common.js'
const internals = {}

describe('Common', () => {

    describe('assertOptions', () => {

        it('validates null', () => {

            expect(() => Common.assertOptions()).to.throw('Options must be of type object')
        })
    })
})
