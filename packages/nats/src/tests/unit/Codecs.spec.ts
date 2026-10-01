import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {Codec} from 'nats'
import {JSONCodec, MessagePackCodec} from '../../exports/Nats.js'

//Both codecs share the same invariants: both first sanitize via JSON and wrap in a [d] array,
//So special values (undefined / Date / BigInt) must behave identically; only the binary format differs
const codecs: Array<{name: string, make: () => Codec<any>}> = [
    {name: 'MessagePackCodec', make: MessagePackCodec},
    {name: 'JSONCodec', make: JSONCodec}
]

for (const {name, make} of codecs) {
    describe(name, (): void => {
        const codec: Codec<any> = make()

        it('objects/arrays/nested structures round-trip unchanged', (): void => {
            const v = {hello: 'bun', n: 1, flag: true, arr: [1, 2, {a: true}], nested: {x: {y: 'z'}}}
            expect(codec.decode(codec.encode(v))).toEqual(v)
        })

        it('primitive values round-trip', (): void => {
            expect(codec.decode(codec.encode('hi'))).toBe('hi')
            expect(codec.decode(codec.encode(42))).toBe(42)
            expect(codec.decode(codec.encode(true))).toBe(true)
            expect(codec.decode(codec.encode(null))).toBeNull()
        })

        it('encode produces a byte sequence (Uint8Array)', (): void => {
            expect(codec.encode({a: 1})).toBeInstanceOf(Uint8Array)
        })

        it('undefined becomes null after JSON sanitization', (): void => {
            expect(codec.decode(codec.encode(undefined))).toBeNull()
        })

        it('Date is serialized as an ISO string (JSON semantics, not a Date object)', (): void => {
            const d = new Date('2020-01-01T00:00:00.000Z')
            expect(codec.decode(codec.encode(d))).toBe('2020-01-01T00:00:00.000Z')
        })

        it('BigInt cannot be encoded (JSON.stringify throws TypeError)', (): void => {
            expect((): Uint8Array => codec.encode(10n)).toThrow(TypeError)
        })
    })
}
