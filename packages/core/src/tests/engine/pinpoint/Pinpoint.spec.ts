/**
 * Ported from pinpoint/test/index.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Pinpoint from '../../../lib/validation/engine/pinpoint/index.js'

/**
 * Adapted assertions: upstream compares with a hard-coded file name, line number and @hapi/lab frame. Here the
 * expected location comes from an Error created on the same line, so the test does not depend on the runner.
 * @param error
 */
function locationOf(error) {
    const frame = error.stack.split('\n')[1]
    const [, filename, line] = frame.match(/\(?([^()\s]+):(\d+):\d+\)?$/)
    return {filename, line: Number(line)}
}

function callerLocation() {
    return Pinpoint.location(1)
}

describe('Pinpoint', () => {

    describe('location()', () => {

        it('returns current location', () => {

            const [location, error] = [Pinpoint.location(), new Error()]
            expect(location).to.equal(locationOf(error))
        })

        it('returns location or upper caller', () => {

            const [location, error] = [callerLocation(), new Error()]
            expect(location).to.equal(locationOf(error))
        })
    })
})
