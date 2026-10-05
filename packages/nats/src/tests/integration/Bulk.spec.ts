import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, runApp, ensureNats, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {buildNatsClientOptions, NATS, NatsBulkException} from '../../exports/Nats.js'
import {millis, StorageType} from 'nats'

/**
 * S1: verifies the basic bulk capabilities of the NATS component (dedicated connection + Object Store + threshold/header probes).
 * No relay/service-layer logic involved, pure infrastructure.
 */
describe('S1 bulk basic capabilities', (): void => {
    let app: Application
    let nats: NATS
    let natsNoBulk: NATS
    let natsDefaults: NATS

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.bulk.app',
            name: 'ITBulk',
            components: {
                nats: buildNatsClientOptions({servers: n.url, bulk: true, bulkBucket: 'test-bulk', bulkTTL: 60000}),
                natsNoBulk: buildNatsClientOptions({servers: n.url, bulk: false}),
                //No bulk* options given (unique name to avoid bucket name collisions), to verify the defaults
                natsDefaults: buildNatsClientOptions({servers: n.url, name: 'defaults'})
            }
        })
        nats = await app.getObject<NATS>('nats')
        natsNoBulk = await app.getObject<NATS>('natsNoBulk')
        natsDefaults = await app.getObject<NATS>('natsDefaults')
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('bulkEnabled reflects the configuration', (): void => {
        expect(nats.bulkEnabled).toBe(true)
        expect(natsNoBulk.bulkEnabled).toBe(false)
    })

    it('bulkThreshold = max_payload x 0.9 (read automatically from the connection info)', (): void => {
        //NATS default max_payload is 1MB, so threshold = floor(1MB x 0.9)
        expect(nats.bulkThreshold).toBe(Math.floor(1024 * 1024 * 0.9))
    })

    it('headersSupported (NATS 2.x server supports headers)', (): void => {
        expect(nats.headersSupported).toBe(true)
    })

    it('putBulk / getBulk round-trip returns identical bytes', async (): Promise<void> => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128])
        const objId: string = await nats.putBulk(bytes)
        expect(typeof objId).toBe('string')
        const got: Uint8Array = await nats.getBulk(objId)
        expect(Array.from(got)).toEqual([1, 2, 3, 4, 5, 255, 0, 128])
    })

    it('object does not exist after deleteBulk', async (): Promise<void> => {
        const objId: string = await nats.putBulk(new Uint8Array([9, 9, 9]))
        await nats.deleteBulk(objId)
        let caught: any
        try {
            await nats.getBulk(objId)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(NatsBulkException) //Deleted, so not found, surfaced as NatsBulkException
    })

    it('putBulk throws NatsBulkException when bulk is disabled', async (): Promise<void> => {
        let caught: any
        try {
            await natsNoBulk.putBulk(new Uint8Array([1]))
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(NatsBulkException)
    })

    it('defaults: bulk=true / bucket=lkt-bulk-${name} / ttl=5min / replicas=1 / File storage', async (): Promise<void> => {
        expect(natsDefaults.bulkEnabled).toBe(true) //bulk defaults to true
        const status = await natsDefaults.bulkStatus()
        expect(status).toBeDefined()
        expect(status!.bucket).toBe('lkt-bulk-defaults')  //Default bucket name = lkt-bulk-${name}
        expect(millis(status!.ttl)).toBe(5 * 60 * 1000)   //Default TTL 5 minutes
        expect(status!.replicas).toBe(1)                  //Default replicas 1
        expect(status!.storage).toBe(StorageType.File)    //File storage
    })
})
