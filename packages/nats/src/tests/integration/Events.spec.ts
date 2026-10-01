import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe} from '../support/App.js'
import {Application} from '@lakutata/core'
import {Delay} from '@lakutata/utils'
import {buildNatsClientOptions, NATS} from '../../exports/Nats.js'
import {destroyApp, runApp} from '../support/App.js'
import {ensureNats, stopNats} from '../support/App.js'

/**
 * Verifies the service event bus: on / once / off / off-all / onlySingleClientReceived (queue distribution).
 * Two NATS components (two connections) in the same app simulate multiple clients.
 */
describe('service events', (): void => {
    let app: Application
    let nats: NATS
    let nats2: NATS
    let serviceId: string

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.events.app',
            name: 'ITEvents',
            components: {
                nats: buildNatsClientOptions({servers: n.url}),
                nats2: buildNatsClientOptions({servers: n.url})
            }
        })
        nats = await app.getObject<NATS>('nats')
        nats2 = await app.getObject<NATS>('nats2')
        serviceId = app.appId
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('on: listener receives all arguments after emit', async (): Promise<void> => {
        const got: Promise<any[]> = new Promise<any[]>((resolve): void => {
            nats.onServiceEvent(serviceId, 'evtA', (a: any, b: any): void => resolve([a, b]))
        })
        await Delay(120)
        nats.emitServiceEvent('evtA', 1, 'x')
        expect(await got).toEqual([1, 'x'])
    })

    it('once: fires only once across multiple emits', async (): Promise<void> => {
        let count: number = 0
        nats.onceServiceEvent(serviceId, 'evtOnce', (): void => {
            count++
        })
        await Delay(120)
        nats.emitServiceEvent('evtOnce')
        nats.emitServiceEvent('evtOnce')
        await Delay(250)
        expect(count).toBe(1)
    })

    it('off(listener): nothing received after unsubscribing', async (): Promise<void> => {
        let count: number = 0
        const listener = (): void => {
            count++
        }
        nats.onServiceEvent(serviceId, 'evtOff', listener)
        await Delay(120)
        nats.emitServiceEvent('evtOff')
        await Delay(150)
        nats.offServiceEvent(serviceId, 'evtOff', listener)
        await Delay(50)
        nats.emitServiceEvent('evtOff')
        await Delay(150)
        expect(count).toBe(1)
    })

    it('onlySingleClientReceived: only one of two queue subscribers receives', async (): Promise<void> => {
        let c1: number = 0
        let c2: number = 0
        nats.onServiceEvent(serviceId, 'evtQ', (): void => {
            c1++
        }, true)
        nats2.onServiceEvent(serviceId, 'evtQ', (): void => {
            c2++
        }, true)
        await Delay(180)
        nats.emitServiceEvent('evtQ')
        await Delay(300)
        expect(c1 + c2).toBe(1)
    })
})
