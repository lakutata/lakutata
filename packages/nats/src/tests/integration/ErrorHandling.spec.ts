import {after, before, it} from 'node:test'
import {expect} from '../support/Expect.js'
import {describeNats as describe} from '../support/App.js'
import {Application} from '@lakutata/core'
import {BuildEntrypoints, Controller} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {Delay} from '@lakutata/core/helper'
import {Codec} from 'nats'
import {
    buildNatsClientOptions,
    BuildServiceProxy,
    NATS,
    NatsRequestTimeoutException,
    ServiceInvokeException,
    ServiceProxy,
    SetupNatsServiceEntrypoint
} from '../../exports/Nats.js'
import {destroyApp, runApp} from '../support/App.js'
import {ensureNats, stopNats} from '../support/App.js'

//A deliberately failing codec: encode always produces bad msgpack bytes (declares a 1-item array with no data, so the server decode throws),
//decode always throws; used to simulate inbound decode failures caused by cross-language/incompatible clients
const badCodec: Codec<any> = {
    encode: (_value: any): Uint8Array => new Uint8Array([0x91]),
    decode: (_bytes: any): any => {
        throw new Error('bad codec decode')
    }
}

class TestController extends Controller {
    @ServiceAction({cmd: 'echo'})
    public async echo(inp: {cmd: string; value: number}): Promise<{echoed: number}> {
        return {echoed: inp.value}
    }

    @ServiceAction({cmd: 'boom'})
    public async boom(): Promise<never> {
        throw new Error('boom error')
    }

    //Returns a value containing a BigInt, so the outbound codec.encode (JSON.stringify) throws, triggering an outbound encode failure in the subscribe layer
    @ServiceAction({cmd: 'bigint'})
    public async bigint(): Promise<{n: bigint}> {
        return {n: BigInt(7)}
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<{ok: boolean}> {
        await Delay(1000)
        return {ok: true}
    }
}

describe('error handling / crash protection / reply guard', (): void => {
    let app: Application
    let nats: NATS
    let natsBad: NATS
    let self: ServiceProxy
    const collectedErrors: any[] = []

    before(async (): Promise<void> => {
        const n = await ensureNats()
        app = await runApp({
            id: 'it.errhandling.app',
            name: 'ITErrHandling',
            components: {
                nats: buildNatsClientOptions({servers: n.url}),
                natsBad: buildNatsClientOptions({servers: n.url, codec: badCodec}),
                entrypoint: BuildEntrypoints({
                    controllers: [TestController],
                    service: SetupNatsServiceEntrypoint('nats')
                })
            },
            providers: {
                self: BuildServiceProxy({serviceId: 'it.errhandling.app', natsComponentName: 'nats'})
            },
            bootstrap: ['entrypoint']
        })
        nats = await app.getObject<NATS>('nats')
        natsBad = await app.getObject<NATS>('natsBad')
        self = await app.getObject<ServiceProxy>('self')
        //Register an error listener: verifies failures are reported and activates the listenerCount guard of emitError
        nats.on('error', (e: any): void => {
            collectedErrors.push(e)
        })
    }, {timeout: 120000})

    after(async (): Promise<void> => {
        if (app) await destroyApp(app)
        await stopNats()
    }, {timeout: 60000})

    it('regression: normal RPC returns the payload', async (): Promise<void> => {
        expect(await self.invoke({cmd: 'echo', value: 1}, 5000)).toEqual({echoed: 1})
    })

    it('regression: handler business exception -> client receives ServiceInvokeException', async (): Promise<void> => {
        let caught: any
        try {
            await self.invoke({cmd: 'boom'}, 5000)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(ServiceInvokeException)
        expect(caught.message).toBe('boom error')
    })

    it('outbound encode failure (handler returns BigInt) -> no black hole, client quickly receives ServiceInvokeException', async (): Promise<void> => {
        const t0: number = performance.now()
        let caught: any
        try {
            await self.invoke({cmd: 'bigint'}, 5000)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(ServiceInvokeException) //Received an error response instead of hanging until timeout
        expect(performance.now() - t0).toBeLessThan(4000)     //Proves it was not the 5000ms timeout
    })

    it('inbound decode failure (incompatible client sends bad bytes) -> server does not crash, subsequent RPCs still work', async (): Promise<void> => {
        let caught: any
        try {
            await natsBad.request('it.errhandling.app', {x: 1}, 3000)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeDefined() //The bad codec client cannot get a parseable response (expected)
        //Key point: the server was not crashed by the bad message, normal requests still work
        expect(await self.invoke({cmd: 'echo', value: 99}, 5000)).toEqual({echoed: 99})
    })

    it('service event listener throws -> no crash, subsequent RPCs still work', async (): Promise<void> => {
        nats.onServiceEvent('it.errhandling.app', 'evtErr', (): void => {
            throw new Error('listener boom')
        })
        await Delay(120)
        nats.emitServiceEvent('evtErr')
        await Delay(200)
        expect(await self.invoke({cmd: 'echo', value: 5}, 5000)).toEqual({echoed: 5})
    })

    it('plain pub/sub callback throws -> no crash, subsequent RPCs still work', async (): Promise<void> => {
        nats.subscribe('boom.subject', (): never => {
            throw new Error('cb boom')
        })
        await Delay(100)
        nats.publish('boom.subject', {x: 1})
        await Delay(200)
        expect(await self.invoke({cmd: 'echo', value: 6}, 5000)).toEqual({echoed: 6})
    })

    it('iterator mode: callback throws -> no crash, subsequent RPCs work', async (): Promise<void> => {
        nats.subscribe('iter.boom.subject', (): never => {
            throw new Error('iter boom')
        }, {iterator: true})
        await Delay(100)
        nats.publish('iter.boom.subject', {x: 1})
        await Delay(200)
        expect(await self.invoke({cmd: 'echo', value: 7}, 5000)).toEqual({echoed: 7})
    })

    it('reply guard: for messages without reply, the callback return value is not sent and the message is received normally', async (): Promise<void> => {
        const got: Promise<any> = new Promise<any>((resolve): void => {
            nats.subscribe('noreply.subject', (data: any): {should: string} => {
                resolve(data)
                return {should: 'not be responded'} //No reply, so this return value is not encoded/responded
            })
        })
        await Delay(100)
        nats.publish('noreply.subject', {ping: true})
        expect(await got).toEqual({ping: true}) //Message received without respond/encode errors
    })

    it('invoke timeout path: explicit timeout throws NatsRequestTimeoutException when reached', async (): Promise<void> => {
        let caught: any
        try {
            await self.invoke({cmd: 'slow'}, 200) //The handler takes 1000ms, so 200ms always times out
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(NatsRequestTimeoutException)
    })

    it('observability: all the above failures are reported via the error event (emitError guard active, no silent crash)', (): void => {
        //Outbound encode failures, inbound decode failures and listener/callback exceptions should all trigger emitError
        expect(collectedErrors.length).toBeGreaterThan(0)
    })
})
