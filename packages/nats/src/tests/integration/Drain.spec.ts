import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe} from '../support/App.js'
import {Application} from '@lakutata/core'
import {BuildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {Delay} from '@lakutata/utils'
import {
    buildNatsClientOptions,
    BuildServiceProxy,
    ServiceProxy,
    SetupNatsServiceEntrypoint
} from '../../exports/Nats.js'
import {destroyApp, runApp} from '../support/App.js'
import {ensureNats, stopNats} from '../support/App.js'

class SlowController extends Controller {
    @ServiceAction({cmd: 'slow'})
    public async slow(inp: {cmd: string; value: number}): Promise<{done: number}> {
        await Delay(250) //Simulate processing time
        return {done: inp.value}
    }
}

/**
 * Verifies #3 graceful shutdown: destroy() uses drain() instead of close().
 * drain stops accepting new messages, finishes in-flight processing, and flushes outbound before closing;
 * so requests in progress during shutdown should complete normally instead of being cut off as with close.
 */
describe('graceful shutdown drain', (): void => {
    let natsUrl: string

    before(async (): Promise<void> => {
        natsUrl = (await ensureNats()).url
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        await stopNats()
    }, {timeout: 60000})

    it('in-flight requests complete normally during destroy(drain) without being cut off', async (): Promise<void> => {
        const app: Application = await runApp({
            id: 'it.drain.app',
            name: 'ITDrain',
            components: {
                nats: buildNatsClientOptions({servers: natsUrl}),
                entrypoint: BuildEntrypoints({
                    controllers: [SlowController],
                    service: SetupNatsServiceEntrypoint('nats')
                }),
                self: BuildServiceProxy({serviceId: 'it.drain.app', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
        const self: ServiceProxy = await app.getObject<ServiceProxy>('self')

        //Fire a slow request (not awaited) so it enters the "processing" state
        const inflight: Promise<any> = self.invoke({cmd: 'slow', value: 42}, 10000)
        await Delay(60) //Ensure the handler has started processing (still within the 250ms delay)

        //Trigger graceful shutdown: drain should wait for in-flight processing and the reply instead of cutting off immediately
        const stopping: Promise<void> = destroyApp(app)

        //close would cut it off (timeout/failure); drain should let it get a normal result
        expect(await inflight).toEqual({done: 42})

        await stopping
    })
})
