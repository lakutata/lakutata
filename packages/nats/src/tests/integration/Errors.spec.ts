import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, runApp, ensureNats, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {delay} from '@lakutata/utils'
import {
    buildNatsClientOptions,
    NATS,
    NatsNoRespondersAvailableException,
    NatsRequestTimeoutException
} from '../../exports/Nats.js'

/**
 * Verifies the error code to exception mapping of NATS.request().
 * Only 503 (no responders) and 408 (response timeout) can be triggered naturally with a real NATS;
 * 400/403/404/500 never occur naturally in core NATS requests, so they are covered by service-layer exception round-trips + unit tests.
 */
describe('NATS.request error mapping', (): void => {
    let app: Application
    let nats: NATS

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.errors.app',
            name: 'ITErrors',
            components: {nats: buildNatsClientOptions({servers: n.url})}
        })
        nats = await app.getObject<NATS>('nats')
        //A subscription that never responds, used to trigger a request timeout (408)
        nats.subscribe('slow.subject', (): Promise<any> => new Promise<any>((): void => {}))
        await delay(150)
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('request to a subject with no subscribers -> NatsNoRespondersAvailableException (503)', async (): Promise<void> => {
        let caught: any
        try {
            await nats.request('no.responder.subject.xyz', {ping: true}, 1000)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(NatsNoRespondersAvailableException)
    })

    //The code of a nats.js core timeout error is "TIMEOUT" (ErrorCode.Timeout); NATS.ts adds
    //case 'TIMEOUT' to map it to NatsRequestTimeoutException
    it('response timeout -> NatsRequestTimeoutException (408)', async (): Promise<void> => {
        let caught: any
        try {
            await nats.request('slow.subject', {ping: true}, 300)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(NatsRequestTimeoutException)
    })
})
