import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component, Container, DTO, type ActionPattern} from '@lakutata/core'
import {Expect, Return} from '@lakutata/core/decorator/dto'
import {Autoload, Singleton} from '@lakutata/core/decorator/di'
import {
    ActionInvocation,
    BaseContext,
    BuildEntrypoints,
    BuildServiceEntrypoint,
    ChannelActionInfo,
    ChannelRuntime,
    Controller,
    Entrypoint,
    EntrypointAdapter,
    InvalidEntrypointAdapterException,
    MiddlewareHandler,
    Next,
    ServiceContext,
    ServiceEntrypointHandler
} from '../exports/Entrypoint.js'
import {ChannelDefinition, ChannelEntry, ChannelMatch, DefineChannel, GetActionDTOAndOptions, RegisterControllerAction} from '../exports/Channel.js'
import {Prefix, ServiceAction, UseMiddlewares} from '../exports/CTRLDecorators.js'

class TestContext extends BaseContext {
    @Expect(DTO.String().valid('TEST').default('TEST'))
    public readonly type: string

    @Expect(DTO.String().required())
    public readonly path: string

    constructor(params: { path: string, data: Record<string, unknown> }) {
        super(params)
    }
}

/**
 * A channel addressed by path templates such as "/device/{sn}"
 */
const TestChannel: ChannelDefinition = DefineChannel({
    name: 'test',
    kind: 'request',
    contextType: 'TEST',
    identify: (pattern: ActionPattern): string => pattern.path,
    describe: (pattern: ActionPattern): Record<string, unknown> => ({path: pattern.path}),
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => prefix.test === undefined ? undefined : {path: `${prefix.test}${pattern.path}`},
    createMatcher: (entries: ChannelEntry[]) => ({
        match: (context: BaseContext): ChannelMatch | undefined => {
            for (const entry of entries) {
                const names: string[] = []
                const expression: RegExp = new RegExp(`^${entry.details.pattern.path.replace(/\{(\w+)}/g, (match: string, name: string): string => {
                    names.push(name)
                    return '([^/]+)'
                })}$`)
                const matched: RegExpExecArray | null = expression.exec((context as TestContext).path)
                if (matched) return {entry: entry, params: Object.fromEntries(names.map((name: string, index: number): [string, string] => [name, matched[index + 1]]))}
            }
            return undefined
        }
    }),
    notFound: (context: BaseContext): Error => new Error(`No action at ${(context as TestContext).path}`)
})

/**
 * The action decorator of the test channel
 * @param path
 * @param dto
 */
function TestAction(path: string, dto?: typeof DTO) {
    return (target: Controller, propertyKey: string): void => {
        const [dtoConstructor, options] = GetActionDTOAndOptions(dto)
        RegisterControllerAction(TestChannel, target, propertyKey as never, {path: path}, dtoConstructor, options)
    }
}

/**
 * An adapter of the test channel, keeping its runtime
 * @param middlewares
 */
function TestAdapter(middlewares: MiddlewareHandler[] = []): EntrypointAdapter & { runtime?: ChannelRuntime, stopped: boolean } {
    const adapter = {
        channel: 'test',
        middlewares: middlewares,
        stopped: false,
        runtime: undefined as ChannelRuntime | undefined,
        start: (runtime: ChannelRuntime): void => {
            adapter.runtime = runtime
        },
        stop: (): void => {
            adapter.stopped = true
        }
    }
    return adapter
}

let trace: string[] = []

const Trace = (name: string): MiddlewareHandler => async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
    trace.push(name)
    return next()
}

class DeviceDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.String().optional())
    public name?: string
}

@Autoload()
@Singleton()
class DeviceRegistry extends Component {
    public readonly bound: string[] = []
}

@Prefix({test: '/device'})
@UseMiddlewares(Trace('controller'))
class DeviceController extends Controller {

    @TestAction('/{sn}', DeviceDTO)
    @ServiceAction({act: 'device'}, DeviceDTO)
    @Return(DeviceDTO)
    public async device(input: DeviceDTO): Promise<DeviceDTO> {
        trace.push('action')
        return input
    }

    @TestAction('/slow/{sn}', DeviceDTO)
    public async slow(input: DeviceDTO): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
        return `slow ${input.sn}`
    }
}

/**
 * Create an entrypoint
 * @param options
 */
async function Create(options: Record<string, unknown>): Promise<{ entrypoint: Entrypoint, container: Container }> {
    const container: Container = new Container()
    const entrypoint: Entrypoint = await container.set(Entrypoint, BuildEntrypoints({controllers: [DeviceController], ...options} as never))
    return {entrypoint: entrypoint, container: container}
}

describe('Channels', (): void => {

    it('dispatch the requests of a channel defined by another package', async (): Promise<void> => {
        const adapter = TestAdapter([Trace('adapter')])
        const {entrypoint, container} = await Create({middlewares: [Trace('global')], test: adapter})
        trace = []
        //The parameters of the address are merged into the input, over the data
        assert.deepStrictEqual(await adapter.runtime!.dispatch(new TestContext({path: '/device/sn-1', data: {sn: 'other', name: 'Pump'}})), {sn: 'sn-1', name: 'Pump'})
        assert.deepStrictEqual(trace, ['global', 'adapter', 'controller', 'action'])
        await assert.rejects(adapter.runtime!.dispatch(new TestContext({path: '/nowhere', data: {}})), {message: 'No action at /nowhere'})
        //The actions of the channel, one per address
        assert.deepStrictEqual(adapter.runtime!.actions.map((action: ChannelActionInfo): unknown => action.address), [{path: '/device/{sn}'}, {path: '/device/slow/{sn}'}])
        assert.deepStrictEqual(entrypoint.getActions('test').actions.map((action): unknown => action.path), ['/device/{sn}', '/device/slow/{sn}'])
        await container.destroy()
        assert.ok(adapter.stopped)
    })

    it('dispatch to an action directly, with the parameters given by the transport', async (): Promise<void> => {
        const adapter = TestAdapter()
        const {container} = await Create({test: adapter})
        const action: ChannelActionInfo = adapter.runtime!.actions[0]
        //The schema of the result declared with @Return, given to the channels
        assert.ok(action.returnSchema)
        assert.strictEqual(adapter.runtime!.actions[1].returnSchema, undefined)
        assert.deepStrictEqual(await adapter.runtime!.dispatchTo(action, new TestContext({path: 'direct', data: {sn: 'data'}}), {params: {sn: 'param'}}), {sn: 'param'})
        await container.destroy()
    })

    it('run the adapters of the 2.x callbacks and the new adapters together', async (): Promise<void> => {
        let legacy: ServiceEntrypointHandler | undefined
        let legacyStopped: boolean = false
        const adapter: EntrypointAdapter = {
            channel: 'service',
            middlewares: [Trace('service adapter')],
            start: (runtime: ChannelRuntime): void => {
                modern = runtime
            }
        }
        let modern: ChannelRuntime | undefined
        const {container} = await Create({
            service: [BuildServiceEntrypoint((module, handler, registerDestroy): void => {
                legacy = handler
                registerDestroy((): void => {
                    legacyStopped = true
                })
            }), adapter]
        })
        trace = []
        assert.deepStrictEqual(await legacy!(new ServiceContext({data: {act: 'device', sn: 'a'}})), {sn: 'a'})
        assert.deepStrictEqual(await modern!.dispatch(new ServiceContext({data: {act: 'device', sn: 'b'}})), {sn: 'b'})
        assert.deepStrictEqual(trace, ['controller', 'action', 'service adapter', 'controller', 'action'])
        await container.destroy()
        assert.ok(legacyStopped)
    })

    it('reject the options which are not adapters of their channel', async (): Promise<void> => {
        await assert.rejects(Create({test: {channel: 'service', start: (): void => undefined}}), InvalidEntrypointAdapterException)
        await assert.rejects(Create({htpp: BuildServiceEntrypoint((): void => undefined)}), InvalidEntrypointAdapterException)
        await assert.rejects(Create({test: BuildServiceEntrypoint((): void => undefined)}), InvalidEntrypointAdapterException)
        await assert.rejects(Create({unknown: {channel: 'unknown', start: (): void => undefined}}), InvalidEntrypointAdapterException)
    })

    it('accept the adapters and the 2.x callbacks as options, not the misspelled channels nor the other values', (): void => {
        const adapter: EntrypointAdapter = {channel: 'nats', start: (): void => undefined}
        assert.ok(Entrypoint.acceptsOption('nats', adapter))
        assert.ok(Entrypoint.acceptsOption('nats', [adapter, adapter]))
        assert.ok(Entrypoint.acceptsOption('service', BuildServiceEntrypoint((): void => undefined)))
        assert.ok(!Entrypoint.acceptsOption('htpp', BuildServiceEntrypoint((): void => undefined)))
        assert.ok(!Entrypoint.acceptsOption('nats', [adapter, 1]))
        assert.ok(!Entrypoint.acceptsOption('timeout', 1000))
    })

    it('wait for the requests in progress when stopping, and abort them after the timeout', async (): Promise<void> => {
        const adapter = TestAdapter()
        const {container} = await Create({test: adapter})
        const request: Promise<unknown> = adapter.runtime!.dispatch(new TestContext({path: '/device/slow/a', data: {}}))
        await container.destroy()
        assert.strictEqual(await request, 'slow a')
        const impatient = TestAdapter()
        const second = await Create({test: impatient, shutdownTimeout: 10})
        const aborted: Promise<unknown> = impatient.runtime!.dispatch(new TestContext({path: '/device/slow/b', data: {}}))
        const start: number = Date.now()
        await second.container.destroy()
        assert.ok(Date.now() - start < 90)
        //A request aborted by the stop of the entrypoint fails
        await assert.rejects(aborted, {name: 'EntrypointStoppedException', statusCode: 503})
    })

    it('provide the services of an adapter through autoloaded objects', async (): Promise<void> => {
        const container: Container = new Container()
        //Injected before the entrypoint and its adapters start
        const registry: DeviceRegistry = await container.get(DeviceRegistry)
        const adapter: EntrypointAdapter = {
            channel: 'test',
            start: async (runtime: ChannelRuntime): Promise<void> => {
                (await runtime.module?.getObject<DeviceRegistry>(DeviceRegistry) ?? await container.get(DeviceRegistry)).bound.push('test')
            }
        }
        await container.set(Entrypoint, BuildEntrypoints({controllers: [DeviceController], test: adapter} as never))
        assert.deepStrictEqual(registry.bound, ['test'])
        await container.destroy()
    })
})
