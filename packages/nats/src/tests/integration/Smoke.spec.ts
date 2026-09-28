import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe} from '../support/App.js'
import {Application} from '@lakutata/core'
import {BuildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {Delay} from '@lakutata/core/helper'
import {
    buildNatsClientOptions,
    BuildServiceProxy,
    NATS,
    ServiceProxy,
    SetupNatsServiceEntrypoint
} from '../../exports/Nats.js'
import {destroyApp, runApp} from '../support/App.js'
import {ensureNats, stopNats} from '../support/App.js'

/**
 * Phase 0 smoke test: verifies that bun x testcontainers x lakutata work together.
 * Covers the two most critical paths: NATS component send/receive + service-layer RPC (decorators + DI + entrypoint + ServiceProxy).
 *
 * Note: lakutata allows only one Application per process (global @runtime alias),
 * so a single app fixture is used here: one app registers all required objects and every test reuses it.
 */
class EchoController extends Controller {
    @ServiceAction({cmd: 'echo'})
    public async echo(inp: {cmd: string; value: number}): Promise<{echoed: number}> {
        return {echoed: inp.value}
    }
}

describe('Phase 0 smoke', (): void => {
    let app: Application

    before(async (): Promise<void> => {
        await ensureNats()
        app = await runApp({
            id: 'smoke.app',
            name: 'Smoke',
            components: {
                nats: buildNatsClientOptions({servers: process.env.NATS_URL!}),
                entrypoint: BuildEntrypoints({
                    controllers: [EchoController],
                    service: SetupNatsServiceEntrypoint('nats')
                }),
                self: BuildServiceProxy({serviceId: 'smoke.app', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('NATS component: publish / subscribe round-trip', async (): Promise<void> => {
        const nats: NATS = await app.getObject<NATS>('nats')
        const received: Promise<any> = new Promise<any>((resolve): void => {
            nats.subscribe('smoke.subject', (data: any): null => {
                resolve(data)
                return null
            })
        })
        await Delay(100) //Allow time for the subscription to be established
        nats.publish('smoke.subject', {hello: 'bun'})
        expect(await received).toEqual({hello: 'bun'})
    })

    it('service-layer RPC: @ServiceAction + ServiceProxy.invoke round-trip', async (): Promise<void> => {
        const proxy: ServiceProxy = await app.getObject<ServiceProxy>('self')
        const result: any = await proxy.invoke({cmd: 'echo', value: 42}, 5000)
        expect(result).toEqual({echoed: 42})
    })
})
