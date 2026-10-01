import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe, destroyApp, runApp, ensureNats, stopNats} from '../support/App.js'
import {Application} from '@lakutata/core'
import {BuildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {connect, NatsConnection} from 'nats'
import {
    buildNatsClientOptions,
    BuildServiceProxy,
    MessagePackCodec,
    ServiceProxy,
    SetupNatsServiceEntrypoint
} from '../../exports/Nats.js'

const codec = MessagePackCodec()

class EchoController extends Controller {
    @ServiceAction({cmd: 'echo'})
    public async echo(inp: {cmd: string, value: number}): Promise<{echoed: number}> {
        return {echoed: inp.value}
    }
}

//Simulates a legacy client invoke: bare NATS, no headers, payload sent directly, response decoded directly as ServiceResponse
async function legacyInvoke(conn: NatsConnection, serviceId: string, pattern: any): Promise<any> {
    const response = await conn.request(serviceId, codec.encode(pattern), {timeout: 5000})
    const sr: any = codec.decode(response.data)
    if (!sr.success) throw new Error(sr.error?.message ?? 'service error')
    return sr.payload
}

/**
 * Real old/new version compatibility (wire level): bare NATS simulates the pre-S2 legacy version (no headers, no relay)
 * interoperating with the new component, verifying neither direction breaks.
 */
describe('old/new version compatibility (bare NATS simulating the real legacy version)', (): void => {
    let app: Application
    let selfToLegacy: ServiceProxy
    let bareConn: NatsConnection //Bare connection acting as the legacy version

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.compat.app',
            name: 'ITCompat',
            components: {
                nats: buildNatsClientOptions({servers: n.url}), //New version (bulk defaults to true)
                entrypoint: BuildEntrypoints({
                    controllers: [EchoController],
                    service: SetupNatsServiceEntrypoint('nats') //New version server, serviceId = appId
                }),
                //New version client pointing at the legacy server (the bare legacy.svc subscription below)
                selfToLegacy: BuildServiceProxy({serviceId: 'legacy.svc', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
        selfToLegacy = await app.getObject<ServiceProxy>('selfToLegacy')

        //Bare connection = legacy version. It also runs a legacy server: subscribes legacy.svc, ignores headers, replies directly
        bareConn = await connect({servers: n.url})
        bareConn.subscribe('legacy.svc', {
            callback: (err, msg): void => {
                if (err || !msg.reply) return
                const pattern: any = codec.decode(msg.data) //Legacy: decode directly, ignoring headers
                const result = {echoed: pattern.value}
                //Legacy: reply in ServiceResponse format without any headers
                msg.respond(codec.encode({success: true, error: null, payload: result}))
            }
        })
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        try {
            await bareConn?.drain()
        } catch {
            //Ignore
        }
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('legacy client -> new server: legacy sends no headers, new server handles it correctly and replies directly', async (): Promise<void> => {
        const result = await legacyInvoke(bareConn, 'it.compat.app', {cmd: 'echo', value: 7})
        expect(result).toEqual({echoed: 7})
    })

    it('new client -> legacy server: legacy server declares no capability, new client learns this, falls back to direct sends and gets the result', async (): Promise<void> => {
        const result = await selfToLegacy.invoke({cmd: 'echo', value: 8}, 5000)
        expect(result).toEqual({echoed: 8})
    })
})
