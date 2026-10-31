import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ActionInvocation, buildEntrypoints, Controller, Entrypoint, MiddlewareHandler, Next, ServiceContext} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'
import {nwjsServiceEntrypoint, type NwjsServiceBridge} from '../exports/NwjsAdapter.js'

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

let signals: AbortSignal[] = []

class EchoController extends Controller {

    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<{ value: number, clientId?: string }> {
        return {value: input.value, clientId: (this.context as ServiceContext).clientId}
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<string> {
        const signal: AbortSignal = signals.at(-1)!
        await new Promise<void>((resolve: () => void): unknown => signal.aborted ? resolve() : signal.addEventListener('abort', (): void => resolve(), {once: true}))
        return 'done'
    }

    @ServiceAction({cmd: 'notify'})
    public async notify(input: { to: string }): Promise<boolean> {
        const entrypoint: Entrypoint = await this.getObject<Entrypoint>('entrypoint')
        return entrypoint.notify(input.to, 'progress', 50)
    }
}

/**
 * The global object of NW.js in the tests: the one the windows share with the Node.js context
 */
type FakeGlobal = Record<symbol, NwjsServiceBridge | undefined>

/**
 * Start an application whose entrypoint serves the bridge on a global object of the tests
 * @param shared
 * @param options
 */
async function start(shared: FakeGlobal, options: Partial<Parameters<typeof nwjsServiceEntrypoint>[0]> = {}): Promise<{ container: Container, bridge: () => NwjsServiceBridge }> {
    const container: Container = new Container()
    await container.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [EchoController],
        service: nwjsServiceEntrypoint({global: shared, ...options})
    }))
    return {container: container, bridge: (): NwjsServiceBridge => shared[Symbol.for(options.key ?? 'lakutata:service')]!}
}

describe('NW.js service adapter', (): void => {

    it('puts its bridge on the global object, which answers the invocations of the pages', async (): Promise<void> => {
        const shared: FakeGlobal = {}
        const {container, bridge} = await start(shared)
        try {
            assert.deepStrictEqual(await bridge().invoke({cmd: 'echo', value: 7}, 'page-1'), {success: true, error: null, payload: {value: 7, clientId: 'page-1'}})
            //Without a client id, the request has none
            assert.deepStrictEqual((await bridge().invoke({cmd: 'echo', value: 8})).payload, {value: 8, clientId: undefined})
            //A failed action resolves with its error
            const invalid = await bridge().invoke({cmd: 'echo', value: 'x'}, 'page-1')
            assert.strictEqual(invalid.success, false)
            assert.match(String((invalid.error as { message?: string }).message), /value/)
            assert.strictEqual((await bridge().invoke({cmd: 'missing'}, 'page-1')).success, false)
        } finally {
            await container.destroy()
        }
        assert.strictEqual(shared[Symbol.for('lakutata:service')], undefined)
    })

    it('runs the middlewares of the adapter, on its own key', async (): Promise<void> => {
        const shared: FakeGlobal = {}
        const seen: string[] = []
        const middleware: MiddlewareHandler = async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            seen.push((invocation.context as ServiceContext).clientId ?? '')
            return next()
        }
        const {container, bridge} = await start(shared, {key: 'app:service', middlewares: [middleware]})
        try {
            assert.strictEqual(shared[Symbol.for('lakutata:service')], undefined)
            assert.strictEqual((await bridge().invoke({cmd: 'echo', value: 1}, 'page-1')).success, true)
            assert.deepStrictEqual(seen, ['page-1'])
        } finally {
            await container.destroy()
        }
    })

    it('pushes the events to the pages subscribed, drops a page whose push throws', async (): Promise<void> => {
        const shared: FakeGlobal = {}
        const {container, bridge} = await start(shared)
        try {
            const pushed: [string, string, unknown[]][] = []
            bridge().subscribe('page-1', (event: string, args: unknown[]): unknown => pushed.push(['page-1', event, args]))
            bridge().subscribe('page-2', (event: string, args: unknown[]): unknown => pushed.push(['page-2', event, args]))
            //Not a client id: ignored
            bridge().subscribe('', (): void => undefined)
            assert.strictEqual((await bridge().invoke({cmd: 'notify', to: 'page-1'}, 'page-2')).payload, true)
            assert.strictEqual((await bridge().invoke({cmd: 'notify', to: 'page-3'}, 'page-2')).payload, false)
            const entrypoint: Entrypoint = await container.get<Entrypoint>('entrypoint')
            assert.strictEqual(entrypoint.broadcast('saved', 1, 'two'), 2)
            assert.deepStrictEqual(pushed, [['page-1', 'progress', [50]], ['page-1', 'saved', [1, 'two']], ['page-2', 'saved', [1, 'two']]])
            //A window gone: its push throws
            bridge().subscribe('page-2', (): never => {
                throw new Error('The window is closed')
            })
            assert.strictEqual(entrypoint.broadcast('saved'), 1)
            assert.strictEqual(entrypoint.broadcast('saved'), 1)
            bridge().unsubscribe('page-1')
            assert.strictEqual(entrypoint.broadcast('saved'), 0)
        } finally {
            await container.destroy()
        }
    })

    it('aborts the requests of a page removed', async (): Promise<void> => {
        signals = []
        const shared: FakeGlobal = {}
        //The signal of the request, given to its invocation
        const middleware: MiddlewareHandler = async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            signals.push(invocation.signal!)
            return next()
        }
        const {container, bridge} = await start(shared, {middlewares: [middleware]})
        try {
            bridge().subscribe('page-1', (): void => undefined)
            const slow: Promise<unknown> = bridge().invoke({cmd: 'slow'}, 'page-1')
            await new Promise<void>((resolve: () => void): unknown => setTimeout(resolve, 20))
            assert.strictEqual(signals[0].aborted, false)
            bridge().unsubscribe('page-1')
            assert.strictEqual(signals[0].aborted, true)
            //The aborted request ends: its result is not given
            assert.strictEqual(((await slow) as { success: boolean }).success, true)
        } finally {
            await container.destroy()
        }
    })

    it('stops gracefully: the new invocations refused, the bridge removed', async (): Promise<void> => {
        const shared: FakeGlobal = {}
        const {container, bridge} = await start(shared)
        const kept: NwjsServiceBridge = bridge()
        await container.destroy()
        assert.strictEqual(shared[Symbol.for('lakutata:service')], undefined)
        const refused = await kept.invoke({cmd: 'echo', value: 1}, 'page-1')
        assert.strictEqual(refused.success, false)
        assert.match(String((refused.error as { message?: string }).message), /stopping/)
    })
})
