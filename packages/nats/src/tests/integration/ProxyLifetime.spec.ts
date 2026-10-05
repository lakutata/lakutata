import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, ensureNats, runApp, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {Delay} from '@lakutata/utils'
import {Inject} from '@lakutata/core/decorator/di'
import {BuildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {BuildNatsClientOptions, BuildServiceProxy, NATS, NatsServiceEntrypoint, ServiceProxy} from '../../exports/Nats.js'

class ProxyController extends Controller {
    @Inject('peer')
    protected readonly peer: ServiceProxy

    @ServiceAction({act: 'proxyId'})
    public async proxyId(): Promise<string> {
        return this.peer.$uuid
    }
}

/**
 * The service proxies are singleton providers (as in 2.x): one instance shared by the requests, its event subscriptions end with it
 */
describe('service proxy lifetime', (): void => {
    let app: Application

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.proxy.app',
            name: 'ITProxy',
            components: {
                nats: BuildNatsClientOptions({servers: n.url, bulk: false}),
                entrypoint: BuildEntrypoints({controllers: [ProxyController], service: NatsServiceEntrypoint('nats')})
            },
            providers: {
                peer: BuildServiceProxy({serviceId: 'it.proxy.app', natsComponentName: 'nats'}),
                listener: BuildServiceProxy({serviceId: 'it.proxy.app', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('is one instance for all the requests', async (): Promise<void> => {
        const peer: ServiceProxy = await app.getObject<ServiceProxy>('peer')
        const first: string = await peer.invoke({act: 'proxyId'})
        const second: string = await peer.invoke({act: 'proxyId'})
        expect(first).toBe(second)
        expect(first).toBe(peer.$uuid)
    })

    it('cancels its event subscriptions when it is destroyed', async (): Promise<void> => {
        const nats: NATS = await app.getObject<NATS>('nats')
        const listener: ServiceProxy = await app.getObject<ServiceProxy>('listener')
        const received: string[] = []
        listener.on('proxyEvent', (value: string): unknown => received.push(`listener:${value}`))
        nats.onServiceEvent('it.proxy.app', 'proxyEvent', (value: string): unknown => received.push(`other:${value}`))
        await Delay(120)
        nats.emitServiceEvent('proxyEvent', 'before')
        await Delay(120)
        await listener.dispose()
        nats.emitServiceEvent('proxyEvent', 'after')
        await Delay(120)
        //The subscriptions made by others are kept
        expect(received.sort()).toEqual(['listener:before', 'other:after', 'other:before'])
    })
})
