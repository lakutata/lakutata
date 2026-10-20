import {readFixture} from '../support/fixture.js'

import type {Transport} from '../../../lib/rtp/transport.js'

export function load(name: string) {
    return readFixture('rtp/data/' + name)
}

export function createMockTransportPair(): [Transport, Transport] {
    class Mock implements Transport {
        onData!: (buf: Buffer) => void
        target!: Mock

        send(buf: Buffer) {
            this.target.onData(buf)
        }
        close() {}
    }

    const a = new Mock()
    const b = new Mock()
    a.target = b
    b.target = a

    return [a, b]
}
