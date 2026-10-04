import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, runApp, ensureNats, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {BuildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {
    buildNatsClientOptions,
    BuildServiceProxy,
    NatsBulkException,
    ServiceInvokeException,
    ServiceProxy,
    SetupNatsServiceEntrypoint
} from '../../exports/Nats.js'

//1.5MB: larger than max_payload (default 1MB), so a successful transfer proves it went through the Object Store rather than directly
const BIG = 1.5 * 1024 * 1024

class BulkController extends Controller {
    @ServiceAction({cmd: 'echo'})
    public async echo(inp: {cmd: string, value: number}): Promise<{echoed: number}> {
        return {echoed: inp.value}
    }

    @ServiceAction({cmd: 'bigResponse'})
    public async bigResponse(inp: {cmd: string, size: number}): Promise<{data: string}> {
        return {data: 'x'.repeat(inp.size)}
    }

    @ServiceAction({cmd: 'bigEcho'})
    public async bigEcho(inp: {cmd: string, data: string}): Promise<{len: number}> {
        return {len: inp.data.length}
    }
}

/**
 * S2: large RPC data transparently relayed through the Object Store + bidirectional capability negotiation + fallback.
 * Data > max_payload, so a successful transfer proves the Object Store was used (a direct send would be rejected by NATS).
 */
describe('S2 RPC large data relay', (): void => {
    let app: Application
    let self: ServiceProxy
    let legacy: ServiceProxy
    let mismatch: ServiceProxy
    let cold: ServiceProxy

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.bulkrpc.app',
            name: 'ITBulkRpc',
            components: {
                nats: buildNatsClientOptions({servers: n.url}), //bulk defaults to true (server + self client)
                natsLegacy: buildNatsClientOptions({servers: n.url, bulk: false}), //Simulates a client without bulk support
                //Uses a different bucket: the server puts the large response into its own bucket, this client cannot fetch it from its own bucket, simulating an unresolvable reference
                natsMismatch: buildNatsClientOptions({servers: n.url, bulkBucket: 'mismatch-bucket'}),
                //A client which never requested the service: its capability unknown
                natsCold: buildNatsClientOptions({servers: n.url}),
                entrypoint: BuildEntrypoints({
                    controllers: [BulkController],
                    service: SetupNatsServiceEntrypoint('nats')
                }),
                self: BuildServiceProxy({serviceId: 'it.bulkrpc.app', natsComponentName: 'nats'}),
                legacy: BuildServiceProxy({serviceId: 'it.bulkrpc.app', natsComponentName: 'natsLegacy'}),
                mismatch: BuildServiceProxy({serviceId: 'it.bulkrpc.app', natsComponentName: 'natsMismatch'}),
                cold: BuildServiceProxy({serviceId: 'it.bulkrpc.app', natsComponentName: 'natsCold'})
            },
            bootstrap: ['entrypoint']
        })
        self = await app.getObject<ServiceProxy>('self')
        legacy = await app.getObject<ServiceProxy>('legacy')
        mismatch = await app.getObject<ServiceProxy>('mismatch')
        cold = await app.getObject<ServiceProxy>('cold')
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('large request first: the capability of the service is probed, the 1.5MB request relayed', async (): Promise<void> => {
        const result: any = await cold.invoke({cmd: 'bigEcho', data: 'x'.repeat(BIG)}, 30000)
        expect(result.len).toBe(BIG)
    })

    it('large response: invoke gets the full 1.5MB response (>max_payload, proving the Object Store was used)', async (): Promise<void> => {
        const result: any = await self.invoke({cmd: 'bigResponse', size: BIG}, 30000)
        expect(result.data.length).toBe(BIG) //Received in full, transparent to the API
    })

    it('large request: after warming the cache, a 1.5MB request is received in full by the server', async (): Promise<void> => {
        //Send a small request first to warm the peer capability cache (required for request-side references)
        await self.invoke({cmd: 'echo', value: 1}, 5000)
        const result: any = await self.invoke({cmd: 'bigEcho', data: 'x'.repeat(BIG)}, 30000)
        expect(result.len).toBe(BIG) //Server received the full large request
    })

    it('fallback: client without bulk (no capability declared) -> server sends the large response directly -> fails exceeding max_payload', async (): Promise<void> => {
        let caught: any
        try {
            await legacy.invoke({cmd: 'bigResponse', size: BIG}, 30000)
        } catch (e) {
            caught = e
        }
        //legacy declares nothing, so the server skips references, sends 1.5MB directly, exceeds max_payload and replies with an error
        expect(caught).toBeInstanceOf(ServiceInvokeException)
    })

    it('small messages are transparent: sent directly, not via the Object Store', async (): Promise<void> => {
        expect(await self.invoke({cmd: 'echo', value: 42}, 5000)).toEqual({echoed: 42})
    })

    it('error propagation: unresolvable response reference (different bucket) -> client throws NatsBulkException (not silent, not wrongly retried)', async (): Promise<void> => {
        //The server puts the large response into its own bucket; mismatch cannot resolve the reference from its own bucket
        let caught: any
        try {
            await mismatch.invoke({cmd: 'bigResponse', size: BIG}, 30000)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(NatsBulkException)
    })
})
