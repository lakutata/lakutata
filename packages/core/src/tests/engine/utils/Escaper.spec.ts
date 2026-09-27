/**
 * Ported from the upstream test/escaper.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as Utils from '../../../lib/validation/engine/utils/index.js'
const internals = {}

describe('escapeHtml()', () => {

    it('encodes / characters', () => {

        const encoded = Utils.escapeHtml('<script>alert(1)</script>')
        expect(encoded).to.equal('&lt;script&gt;alert&#x28;1&#x29;&lt;&#x2f;script&gt;')
    })

    it('encodes < and > as named characters', () => {

        const encoded = Utils.escapeHtml('<script><>')
        expect(encoded).to.equal('&lt;script&gt;&lt;&gt;')
    })

    it('encodes large unicode characters', () => {

        const encoded = Utils.escapeHtml(String.fromCharCode(500) + String.fromCharCode(1000))
        expect(encoded).to.equal('&#500;&#1000;')
    })

    it('doesn\'t throw an exception when passed null', () => {

        const encoded = Utils.escapeHtml(null)
        expect(encoded).to.equal('')
    })

    it('encodes {} characters', () => {

        const encoded = Utils.escapeHtml('{}')
        expect(encoded).to.equal('&#x7b;&#x7d;')
    })
})
