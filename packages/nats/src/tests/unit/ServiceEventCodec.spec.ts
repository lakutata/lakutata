import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {ServiceEventCodec} from '../../lib/ServiceEventCodec.js'

describe('ServiceEventCodec', (): void => {

    it('encode/decode round-trip preserves the argument array', (): void => {
        const args = [1, 'a', {x: true}, [2, 3]]
        expect(ServiceEventCodec.decode(ServiceEventCodec.encode(args))).toEqual(args)
    })

    it('encode produces {args}', (): void => {
        expect(ServiceEventCodec.encode([1, 2])).toEqual({args: [1, 2]})
    })

    it('formatSubject is deterministic and carries the framework prefix', (): void => {
        const s = ServiceEventCodec.formatSubject('svc', 'evt')
        expect(s).toBe(ServiceEventCodec.formatSubject('svc', 'evt'))
        expect(s.startsWith('framework.internal.service.event.')).toBe(true)
    })

    it('formatSubject produces distinct subjects for different serviceId / eventName', (): void => {
        const base = ServiceEventCodec.formatSubject('svc', 'evt')
        expect(ServiceEventCodec.formatSubject('svc', 'evt2')).not.toBe(base)
        expect(ServiceEventCodec.formatSubject('svc2', 'evt')).not.toBe(base)
    })
})
