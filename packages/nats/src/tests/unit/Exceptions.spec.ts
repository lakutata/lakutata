import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {Exception} from '@lakutata/core'
import {
    NatsBadRequestException,
    NatsForbiddenException,
    NatsInternalServerException,
    NatsNoRespondersAvailableException,
    NatsNotFoundException,
    NatsRequestTimeoutException,
    ServiceInvokeException,
    NatsBulkException
} from '../../exports/Nats.js'

const cases: Array<{Cls: new (msg?: string) => any, errno: string, message: string, statusCode: number}> = [
    {Cls: NatsBadRequestException, errno: 'E_NATS_BAD_REQUEST', message: 'Bad Request', statusCode: 400},
    {Cls: NatsForbiddenException, errno: 'E_NATS_FORBIDDEN', message: 'Forbidden', statusCode: 403},
    {Cls: NatsNotFoundException, errno: 'E_NATS_NOT_FOUND', message: 'Subject Not Found', statusCode: 404},
    {Cls: NatsRequestTimeoutException, errno: 'E_NATS_REQUEST_TIMEOUT', message: 'Request Timeout', statusCode: 408},
    {Cls: NatsInternalServerException, errno: 'E_NATS_INTERNAL_SERVER', message: 'Internal Server Error', statusCode: 500},
    {Cls: NatsNoRespondersAvailableException, errno: 'E_NATS_NO_RESPONDERS_AVAILABLE', message: 'No Responders Available', statusCode: 503}
]

describe('Nats*Exception', (): void => {
    for (const {Cls, errno, message, statusCode} of cases) {
        it(`${Cls.name}: errno/message/statusCode are correct and it is an Exception/Error instance`, (): void => {
            const e = new Cls()
            expect(e).toBeInstanceOf(Exception)
            expect(e).toBeInstanceOf(Error)
            expect(e.errno).toBe(errno)
            expect(e.message).toBe(message)
            expect(e.errMsg).toBe(message)
            expect(e.statusCode).toBe(statusCode)
        })
    }

    it('keeps the message given to the constructor, the built-in one otherwise', (): void => {
        expect(new NatsForbiddenException('whatever').message).toBe('whatever')
        expect(new NatsForbiddenException('whatever').errMsg).toBe('whatever')
        expect(new NatsForbiddenException('Subject {0} forbidden', 'a.b').errMsg).toBe('Subject a.b forbidden')
    })
})

describe('ServiceInvokeException', (): void => {
    it('default errno, optional service field, message taken from the constructor argument', (): void => {
        const e = new ServiceInvokeException('boom')
        expect(e).toBeInstanceOf(Exception)
        expect(e.errno).toBe('E_SERVICE_INVOKE')
        expect(e.message).toBe('boom')
        expect(e.service).toBeUndefined()
    })
})

describe('NatsBulkException', (): void => {
    it('errno/statusCode + constructor message, and not NoResponders (so not auto-retried by #7)', (): void => {
        const e = new NatsBulkException('bulk get failed')
        expect(e).toBeInstanceOf(Exception)
        expect(e.errno).toBe('E_NATS_BULK')
        expect(e.statusCode).toBe(502)
        expect(e.message).toBe('bulk get failed') //No default message, so the constructor argument takes effect
        expect(e).not.toBeInstanceOf(NatsNoRespondersAvailableException) //Will not be auto-retried
    })
})
