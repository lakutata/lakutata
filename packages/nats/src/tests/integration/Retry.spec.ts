import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, runApp, ensureNats, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {buildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {delay} from '@lakutata/utils'
import {
    buildNatsClientOptions,
    buildServiceProxy,
    NatsNoRespondersAvailableException,
    NatsRequestTimeoutException,
    ServiceInvokeException,
    ServiceProxy,
    natsServiceEntrypoint
} from '../../exports/Nats.js'

class RetryController extends Controller {
    @ServiceAction({cmd: 'ok'})
    public async ok(): Promise<{ok: boolean}> {
        return {ok: true}
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<{ok: boolean}> {
        await delay(1000)
        return {ok: true}
    }

    @ServiceAction({cmd: 'boom'})
    public async boom(): Promise<never> {
        throw new Error('boom error')
    }
}

/**
 * Verifies the safety boundary of the #7 automatic retry:
 *   - Retry only on NoResponders (the peer definitely did not process it);
 *   - Timeouts (possibly processed but the response was lost) and business exceptions (processed and returned by the peer) are never retried and are thrown directly.
 */
describe('#7 NoResponders safe retry', (): void => {
    let app: Application
    let self: ServiceProxy
    let dead: ServiceProxy
    let deadDefault: ServiceProxy

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.retry.app',
            name: 'ITRetry',
            components: {
                nats: buildNatsClientOptions({servers: n.url}),
                entrypoint: buildEntrypoints({
                    controllers: [RetryController],
                    service: natsServiceEntrypoint('nats')
                })
            },
            providers: {
                self: buildServiceProxy({serviceId: 'it.retry.app', natsComponentName: 'nats', maxRetries: 2, retryDelay: 50}),
                //Points to a serviceId with no subscribers, so NoResponders is guaranteed
                dead: buildServiceProxy({serviceId: 'nonexistent.service.xyz', natsComponentName: 'nats', maxRetries: 2, retryDelay: 50}),
                //No maxRetries/retryDelay given, to verify the defaults (3 x 100ms)
                deadDefault: buildServiceProxy({serviceId: 'nonexistent.service.xyz', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
        self = await app.getObject<ServiceProxy>('self')
        dead = await app.getObject<ServiceProxy>('dead')
        deadDefault = await app.getObject<ServiceProxy>('deadDefault')
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('NoResponders -> throws only after maxRetries retries (elapsed time proves the retries happened)', async (): Promise<void> => {
        const t0: number = performance.now()
        let caught: any
        try {
            await dead.invoke({cmd: 'x'}, 3000)
        } catch (e) {
            caught = e
        }
        const elapsed: number = performance.now() - t0
        expect(caught).toBeInstanceOf(NatsNoRespondersAvailableException)
        expect(elapsed).toBeGreaterThanOrEqual(2 * 50 - 10) //2 retries x 50ms, with margin
    })

    it('defaults: without maxRetries/retryDelay, retries 3 times x 100ms', async (): Promise<void> => {
        const t0: number = performance.now()
        let caught: any
        try {
            await deadDefault.invoke({cmd: 'x'}, 5000)
        } catch (e) {
            caught = e
        }
        const elapsed: number = performance.now() - t0
        expect(caught).toBeInstanceOf(NatsNoRespondersAvailableException)
        expect(elapsed).toBeGreaterThanOrEqual(3 * 100 - 20) //Default 3 x 100ms, with margin
    })

    it('timeout -> no retry (elapsed time is about one timeout, not maxRetries times)', async (): Promise<void> => {
        const t0: number = performance.now()
        let caught: any
        try {
            await self.invoke({cmd: 'slow'}, 200) //The handler takes 1000ms, timeout at 200ms
        } catch (e) {
            caught = e
        }
        const elapsed: number = performance.now() - t0
        expect(caught).toBeInstanceOf(NatsRequestTimeoutException)
        expect(elapsed).toBeLessThan(600) //Only one timeout (~200ms); 3 retries would take ~600ms+
    })

    it('business exception -> no retry, throws ServiceInvokeException directly', async (): Promise<void> => {
        let caught: any
        try {
            await self.invoke({cmd: 'boom'}, 3000)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(ServiceInvokeException)
    })

    it('normal request -> succeeds (retry does not interfere with the normal path)', async (): Promise<void> => {
        expect(await self.invoke({cmd: 'ok'}, 3000)).toEqual({ok: true})
    })
})
