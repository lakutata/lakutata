import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {ServiceResponseCodec} from '@lakutata/entrypoint/channel'
import {ServiceInvokeException} from '../../exports/Nats.js'

describe('ServiceResponseCodec', (): void => {

    it('encode success response: {success:true, error:null, payload}', (): void => {
        expect(ServiceResponseCodec.encode({a: 1}, false)).toEqual({success: true, error: null, payload: {a: 1}})
    })

    it('encode error response: {success:false, error, payload:null}', (): void => {
        const err: any = {message: 'boom', errno: 'X', statusCode: 500}
        expect(ServiceResponseCodec.encode(err, true)).toEqual({success: false, error: err, payload: null})
    })

    it('decode success response returns the payload', (): void => {
        const r = ServiceResponseCodec.encode({a: 1}, false)
        expect(ServiceResponseCodec.decode(r)).toEqual({a: 1})
    })

    it('decode error response throws ServiceInvokeException carrying serviceId and the original error fields', (): void => {
        const r = ServiceResponseCodec.encode({message: 'boom', errno: 'X_ERR', statusCode: 503}, true)
        let caught: any
        try {
            ServiceResponseCodec.decode(r, 'svc.id')
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(ServiceInvokeException)
        expect(caught.message).toBe('boom')
        expect(caught.service).toBe('svc.id')
        expect(caught.errno).toBe('X_ERR')      //Object.assign overrides the default errno with the remote field
        expect(caught.statusCode).toBe(503)
    })

    it('decode error response: missing message falls back to Unknown Error; service is unset without serviceId', (): void => {
        const r = ServiceResponseCodec.encode({}, true)
        let caught: any
        try {
            ServiceResponseCodec.decode(r)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(ServiceInvokeException)
        expect(caught.message).toBe('Unknown Error')
        expect(caught.errno).toBe('E_SERVICE_INVOKE') //Not overridden by a remote field, default kept
        expect(caught.service).toBeUndefined()
    })
})
