import {describe, it} from 'node:test'
import assert from 'node:assert'
import {IncomingMessage, ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {Container, DTO, Provider} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Inject} from '@lakutata/core/decorator/di'
import {
    ActionInvocation,
    buildCLIEntrypoint,
    buildEntrypoints,
    buildHTTPEntrypoint,
    buildServiceEntrypoint,
    CLIContext,
    CLIEntrypointHandler,
    Controller,
    Entrypoint,
    HTTPContext,
    HTTPEntrypointHandler,
    InvalidMiddlewareException,
    Middleware,
    MiddlewareHandler,
    MiddlewareNextCalledException,
    Next,
    ServiceContext,
    ServiceEntrypointHandler
} from '../exports/Entrypoint.js'
import {CLIAction, GET, ServiceAction, UseMiddlewares} from '../exports/CTRLDecorators.js'

//The trace of a request
let trace: string[] = []

/**
 * A middleware function writing its name before and after the rest of the pipeline
 * @param name
 */
const Trace = (name: string): MiddlewareHandler => async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
    trace.push(`>${name}`)
    const result: unknown = await next()
    trace.push(`<${name}`)
    return result
}

class RequestCounter extends Provider {
    public count: number = 0
}

class CountRequest extends Middleware {
    @Inject(RequestCounter)
    protected readonly counter: RequestCounter

    public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
        this.counter.count++
        trace.push(`count:${this.counter.count}`)
        return next()
    }
}

class NameDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string
}

@UseMiddlewares(Trace('base'))
class BaseController extends Controller {
    @Inject(RequestCounter)
    protected readonly counter: RequestCounter

    @ServiceAction({act: 'inherited'})
    public async inherited(): Promise<string> {
        return this.constructor.name
    }
}

@UseMiddlewares(Trace('controller'), CountRequest)
@UseMiddlewares(CountRequest)
class TestController extends BaseController {

    @UseMiddlewares(Trace('method'))
    @ServiceAction({act: 'hello'}, NameDTO, {middlewares: [Trace('options')]})
    @CLIAction('hello', NameDTO)
    @GET('/hello', NameDTO)
    public async hello(input: NameDTO): Promise<string> {
        trace.push(`action:${this.counter.count}`)
        return `hello ${input.name}`
    }

    @ServiceAction({act: 'cached'}, {middlewares: [async (): Promise<unknown> => 'from cache']})
    public async cached(): Promise<string> {
        trace.push('action')
        return 'computed'
    }

    @ServiceAction({act: 'twice'}, {
        middlewares: [async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            await next()
            return next()
        }]
    })
    public async twice(): Promise<string> {
        return 'once'
    }
}

type Handlers = {
    service: ServiceEntrypointHandler
    cli: CLIEntrypointHandler
    http: HTTPEntrypointHandler
}

/**
 * Create an entrypoint with global middlewares, return its handlers
 * @param middlewares
 */
async function Create(middlewares: unknown[] = [Trace('global')]): Promise<{ handlers: Handlers, container: Container }> {
    const handlers: Partial<Handlers> = {}
    const container: Container = new Container()
    await container.load([RequestCounter])
    await container.set(Entrypoint, buildEntrypoints({
        controllers: [TestController],
        middlewares: middlewares as MiddlewareHandler[],
        service: buildServiceEntrypoint((module, handler): unknown => handlers.service = handler),
        cli: buildCLIEntrypoint((module, cliMap, handler): unknown => handlers.cli = handler),
        http: buildHTTPEntrypoint((module, routeMap, handler): unknown => handlers.http = handler)
    }))
    return {handlers: handlers as Handlers, container: container}
}

/**
 * A service request
 * @param input
 */
function Service(input: Record<string, unknown>): ServiceContext {
    return new ServiceContext({data: input})
}

describe('Middlewares', (): void => {

    it('run around the actions, in the order of their levels', async (): Promise<void> => {
        const {handlers, container} = await Create()
        trace = []
        assert.strictEqual(await handlers.service(Service({act: 'hello', name: 'a'})), 'hello a')
        assert.deepStrictEqual(trace, ['>global', '>base', '>controller', 'count:1', 'count:2', '>options', '>method', 'action:2', '<method', '<options', '<controller', '<base', '<global'])
        await container.destroy()
    })

    it('run for every transport', async (): Promise<void> => {
        const {handlers, container} = await Create()
        trace = []
        assert.strictEqual(await handlers.cli(new CLIContext({command: 'hello', data: {name: 'b'}})), 'hello b')
        const request: IncomingMessage = new IncomingMessage(new Socket())
        const response: ServerResponse = new ServerResponse(request)
        assert.strictEqual(await handlers.http(new HTTPContext({route: '/hello', method: 'get', request: request, response: response, data: {name: 'c'}})), 'hello c')
        //The middlewares of the options are the ones of the service action only
        assert.deepStrictEqual(trace.filter((step: string): boolean => step.startsWith('>')), ['>global', '>base', '>controller', '>method', '>global', '>base', '>controller', '>method'])
        await container.destroy()
    })

    it('create the middleware classes in the container of each request', async (): Promise<void> => {
        const {handlers, container} = await Create([])
        trace = []
        await handlers.service(Service({act: 'hello', name: 'a'}))
        await handlers.service(Service({act: 'hello', name: 'a'}))
        //The counter is shared by the middleware and the controller within a request only
        assert.deepStrictEqual(trace.filter((step: string): boolean => step.startsWith('action')), ['action:2', 'action:2'])
        await container.destroy()
    })

    it('can return without running the action, change the result and handle the errors', async (): Promise<void> => {
        const wrap: MiddlewareHandler = async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            try {
                return {action: invocation.action.name, data: await next()}
            } catch (e) {
                return {action: invocation.action.name, error: (e as Error).name}
            }
        }
        const {handlers, container} = await Create([wrap])
        trace = []
        assert.deepStrictEqual(await handlers.service(Service({act: 'cached'})), {action: 'TestController:cached', data: 'from cache'})
        //The action is not run
        assert.ok(!trace.includes('action'))
        //The input is validated after the middlewares
        assert.deepStrictEqual(await handlers.service(Service({act: 'hello'})), {action: 'TestController:hello', error: 'InvalidValueException'})
        assert.deepStrictEqual(await handlers.service(Service({act: 'twice'})), {action: 'TestController:twice', error: MiddlewareNextCalledException.name})
        await container.destroy()
    })

    it('run the inherited actions with the registered controller', async (): Promise<void> => {
        const {handlers, container} = await Create([])
        trace = []
        assert.strictEqual(await handlers.service(Service({act: 'inherited'})), 'TestController')
        assert.deepStrictEqual(trace, ['>base', '>controller', 'count:1', 'count:2', '<controller', '<base'])
        await container.destroy()
    })

    it('reject the invalid middlewares', async (): Promise<void> => {
        class NotMiddleware {
        }

        assert.throws((): unknown => UseMiddlewares(NotMiddleware as unknown as MiddlewareHandler), InvalidMiddlewareException)
        assert.throws((): unknown => UseMiddlewares('name' as unknown as MiddlewareHandler)({}), InvalidMiddlewareException)
        await assert.rejects(Create([NotMiddleware]), InvalidMiddlewareException)
    })
})
