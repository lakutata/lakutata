/**
 * Ported from tlds/test/index.ts (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'

import { tlds } from '../../../lib/validation/engine/tlds/index.js'


describe('email', () => {
    it('available as direct require', () => {
        expect(tlds.has('com')).to.be.true()
    })
})
