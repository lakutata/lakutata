import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe} from '../support/App.js'
import {Application} from '@lakutata/core'
import {Delay} from '@lakutata/core/helper'
import {buildNatsClientOptions, JSONCodec, NATS} from '../../exports/Nats.js'
import {destroyApp, runApp} from '../support/App.js'
import {ensureNats, stopNats} from '../support/App.js'

/**
 * Transport layer: explicit codec selection, queue load balancing, subscribe iterator mode.
 * One app registers three connections: nats (default MessagePack), natsJson (explicit JSON), nats2 (default, the second queue consumer).
 */
describe('transport: codec / queue / subscribe', (): void => {
    let app: Application
    let nats: NATS
    let natsJson: NATS
    let nats2: NATS

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.transport.app',
            name: 'ITTransport',
            components: {
                nats: buildNatsClientOptions({servers: n.url}),
                natsJson: buildNatsClientOptions({servers: n.url, codec: JSONCodec()}),
                nats2: buildNatsClientOptions({servers: n.url})
            }
        })
        nats = await app.getObject<NATS>('nats')
        natsJson = await app.getObject<NATS>('natsJson')
        nats2 = await app.getObject<NATS>('nats2')
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('explicit JSONCodec: publish / subscribe round-trip', async (): Promise<void> => {
        const got: Promise<any> = new Promise<any>((resolve): void => {
            natsJson.subscribe('json.subject', (data: any): null => {
                resolve(data)
                return null
            })
        })
        await Delay(120)
        natsJson.publish('json.subject', {via: 'json', n: 7, nested: {ok: true}})
        expect(await got).toEqual({via: 'json', n: 7, nested: {ok: true}})
    })

    it('queue load balancing: two subscribers in the same queue, only one receives a publish', async (): Promise<void> => {
        let c1: number = 0
        let c2: number = 0
        nats.subscribe('q.subject', (): null => {
            c1++
            return null
        }, {queue: 'qgroup'})
        nats2.subscribe('q.subject', (): null => {
            c2++
            return null
        }, {queue: 'qgroup'})
        await Delay(180)
        nats.publish('q.subject', {x: 1})
        await Delay(300)
        expect(c1 + c2).toBe(1)
    })

    it('subscribe iterator mode: receives and decodes messages', async (): Promise<void> => {
        const got: Promise<any> = new Promise<any>((resolve): void => {
            nats.subscribe('iter.subject', (data: any): null => {
                resolve(data)
                return null
            }, {iterator: true})
        })
        await Delay(120)
        nats.publish('iter.subject', {mode: 'iterator'})
        expect(await got).toEqual({mode: 'iterator'})
    })
})
