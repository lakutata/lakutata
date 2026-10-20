import {test, expect} from '../../../support/vitest.js'
import {ChangeCipherSpec} from '../../../../../lib/dtls/handshake/message/changeCipherSpec.js'
test('handshake_message_changeCipherSpec', () => {
    const c = new ChangeCipherSpec()
    const raw = c.serialize()

    const cNew = ChangeCipherSpec.deSerialize(raw)

    expect(c).toEqual(cNew)
})
