import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, runApp, ensureNats, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {BuildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {Delay} from '@lakutata/utils'
import {BuildServiceProxy, buildNatsClientOptions, NATS, NatsServiceEntrypoint, ServiceProxy} from '../../exports/Nats.js'

class OrderController extends Controller {
}

/**
 * The events of the entrypoint to the proxies of a service with its own subject, the listeners of each proxy kept apart
 */
describe('service events through the proxies', (): void => {
    let app: Application
    let nats: NATS
    let entrypoint: Entrypoint
    let first: ServiceProxy
    let second: ServiceProxy

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.proxy-events.app',
            name: 'ITProxyEvents',
            components: {
                nats: buildNatsClientOptions({servers: n.url}),
                entrypoint: BuildEntrypoints({controllers: [OrderController], service: NatsServiceEntrypoint('nats', {subject: 'it.custom.orders'})})
            },
            providers: {
                first: BuildServiceProxy({serviceId: 'it.custom.orders', natsComponentName: 'nats'}),
                second: BuildServiceProxy({serviceId: 'it.custom.orders', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
        nats = await app.getObject<NATS>('nats')
        entrypoint = await app.getObject<Entrypoint>('entrypoint')
        first = await app.getObject<ServiceProxy>('first')
        second = await app.getObject<ServiceProxy>('second')
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('broadcasts the events of the entrypoint under its subject', async (): Promise<void> => {
        const received: unknown[] = []
        first.on('shipped', (id: number): unknown => received.push(id))
        await Delay(150)
        entrypoint.broadcast('shipped', 7)
        await Delay(300)
        expect(received).toEqual([7])
        first.off('shipped')
    })

    it('removes the listeners of a proxy only, the same function on another proxy kept', async (): Promise<void> => {
        const received: string[] = []
        const listener = (name: string): unknown => received.push(name)
        first.on('renamed', listener)
        second.on('renamed', listener)
        await Delay(150)
        entrypoint.broadcast('renamed', 'a')
        await Delay(300)
        expect(received).toEqual(['a', 'a'])
        first.off('renamed')
        await Delay(150)
        entrypoint.broadcast('renamed', 'b')
        await Delay(300)
        expect(received).toEqual(['a', 'a', 'b'])
        second.off('renamed', listener)
    })

    it('reports the rejections of the async listeners as errors of the component', async (): Promise<void> => {
        const errors: string[] = []
        nats.on('error', (error: Error): unknown => errors.push(error.message))
        //An async listener (its promise returned to the proxy)
        const failing = async (): Promise<void> => {
            throw new Error('the listener failed')
        }
        first.on('failed', failing as (...args: any[]) => void)
        await Delay(150)
        entrypoint.broadcast('failed')
        await Delay(300)
        expect(errors.includes('the listener failed')).toBe(true)
        first.off('failed')
    })
})
