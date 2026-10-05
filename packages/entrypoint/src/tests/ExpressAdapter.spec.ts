import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import type {Server} from 'node:http'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Component, Container, DTO, Exception} from '@lakutata/core'
import {Inject} from '@lakutata/core/decorator/di'
import {Expect} from '@lakutata/core/decorator/dto'
import {
    ActionInvocation,
    BuildEntrypoints,
    Controller,
    Entrypoint,
    MiddlewareHandler,
    Next,
    Result
} from '../exports/Entrypoint.js'
import {GET, POST} from '../exports/CTRLDecorators.js'
import {ExpressHTTPEntrypoint, ExpressHTTPEntrypointOptions, JSONEnvelope, StaticUI} from '../exports/ExpressAdapter.js'

class DeviceDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.String().optional())
    public name?: string
}

class MissingException extends Exception {
    public errno: string = 'E_MISSING'

    public readonly statusCode: number = 404
}

let fileDirectory: string

let signals: AbortSignal[] = []

class DeviceController extends Controller {

    @GET('/device/:sn', DeviceDTO)
    @POST('/device/:sn', DeviceDTO)
    public async device(input: DeviceDTO): Promise<DeviceDTO> {
        return input
    }

    @GET('/missing')
    public async missing(): Promise<void> {
        throw new MissingException('Nothing here')
    }

    @POST('/created')
    public async created(): Promise<unknown> {
        return Result.status(201, {created: true}, {'Location': '/device/1'})
    }

    @GET('/empty')
    public async empty(): Promise<void> {
    }

    @GET('/buffer')
    public async buffer(): Promise<unknown> {
        return Result.file(Buffer.from('binary'), {contentType: 'application/octet-stream', etag: 'v1'})
    }

    @GET('/file')
    public async file(): Promise<unknown> {
        return Result.file(path.join(fileDirectory, 'hello.txt'), {filename: 'hello.txt'})
    }

    @GET('/events')
    public async events(): Promise<unknown> {
        return Result.events(async (send): Promise<void> => {
            send({n: 1}, 'tick', '1')
            send('two\nlines')
        })
    }

    @GET('/slow')
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }
}

/**
 * Start an entrypoint with an express adapter on a random port
 * @param options
 * @param entrypointOptions
 */
async function Start(options: ExpressHTTPEntrypointOptions = {}, entrypointOptions: Record<string, unknown> = {}): Promise<{ url: string, container: Container }> {
    let server: Server | undefined
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({
        controllers: [DeviceController],
        ...entrypointOptions,
        http: ExpressHTTPEntrypoint({
            port: 0,
            host: '127.0.0.1',
            ...options,
            before: async (app, context): Promise<void> => {
                server = context.server
                await options.before?.(app, context)
            }
        })
    }))
    return {url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, container: container}
}

describe('Express adapter', (): void => {

    it('dispatches the requests to the actions', async (): Promise<void> => {
        const {url, container} = await Start()
        //The route parameters take precedence over the query and the body
        assert.deepStrictEqual(await (await fetch(`${url}/device/sn-1?name=Pump&sn=other`)).json(), {sn: 'sn-1', name: 'Pump'})
        const posted: Response = await fetch(`${url}/device/sn-2`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sn: 'other', name: 'Valve'})})
        assert.deepStrictEqual(await posted.json(), {sn: 'sn-2', name: 'Valve'})
        assert.strictEqual((await fetch(`${url}/empty`)).status, 204)
        await container.destroy()
    })

    it('writes the errors with their status', async (): Promise<void> => {
        const {url, container} = await Start()
        const invalid: Response = await fetch(`${url}/device/sn-1`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 1})})
        assert.strictEqual(invalid.status, 400)
        assert.strictEqual(((await invalid.json()) as any).errno, 'E_INVALID_VALUE')
        const missing: Response = await fetch(`${url}/missing`)
        assert.strictEqual(missing.status, 404)
        assert.deepStrictEqual(await missing.json(), {errno: 'E_MISSING', errMsg: 'Nothing here'})
        const notFound: Response = await fetch(`${url}/nowhere`)
        assert.strictEqual(notFound.status, 404)
        assert.strictEqual(((await notFound.json()) as any).errno, 'E_ROUTE_NOT_FOUND')
        const malformed: Response = await fetch(`${url}/device/sn-1`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'})
        assert.strictEqual(malformed.status, 400)
        await container.destroy()
    })

    it('writes the results with their status, headers, files and events', async (): Promise<void> => {
        fileDirectory = await mkdtemp(path.join(tmpdir(), 'express-adapter-'))
        await writeFile(path.join(fileDirectory, 'hello.txt'), 'hello')
        const {url, container} = await Start()
        const created: Response = await fetch(`${url}/created`, {method: 'POST'})
        assert.strictEqual(created.status, 201)
        assert.strictEqual(created.headers.get('location'), '/device/1')
        assert.deepStrictEqual(await created.json(), {created: true})
        const buffer: Response = await fetch(`${url}/buffer`)
        assert.strictEqual(await buffer.text(), 'binary')
        assert.strictEqual(buffer.headers.get('etag'), '"v1"')
        assert.strictEqual((await fetch(`${url}/buffer`, {headers: {'If-None-Match': '"v1"'}})).status, 304)
        const file: Response = await fetch(`${url}/file`)
        assert.strictEqual(await file.text(), 'hello')
        assert.match(file.headers.get('content-disposition')!, /attachment; filename="hello.txt"/)
        const events: Response = await fetch(`${url}/events`)
        assert.strictEqual(events.headers.get('content-type'), 'text/event-stream; charset=utf-8')
        assert.strictEqual(await events.text(), 'id: 1\nevent: tick\ndata: {"n":1}\n\ndata: two\ndata: lines\n\n')
        await container.destroy()
        await rm(fileDirectory, {recursive: true, force: true})
    })

    it('mounts the application routes, the fallback and the envelope', async (): Promise<void> => {
        const {url, container} = await Start({
            before: (app, {actionPrefixes, isActionPath}): void => {
                assert.deepStrictEqual(actionPrefixes.sort(), ['/buffer', '/created', '/device', '/empty', '/events', '/file', '/missing', '/slow'])
                assert.ok(isActionPath('/device/x') && !isActionPath('/devices'))
                app.get('/health', (request, response): unknown => response.json({status: 'ok'}))
            },
            fallback: (request, response): unknown => response.type('html').send(`<page ${request.path}>`),
            respond: JSONEnvelope({errorStatus: 200})
        })
        assert.deepStrictEqual(await (await fetch(`${url}/health`)).json(), {status: 'ok'})
        assert.strictEqual(await (await fetch(`${url}/about`)).text(), '<page /about>')
        //The paths of the actions are not given to the fallback
        const unknownAction: Response = await fetch(`${url}/device`)
        assert.strictEqual(unknownAction.status, 200)
        assert.deepStrictEqual(await unknownAction.json(), {errno: 'E_ROUTE_NOT_FOUND', errMsg: 'Route /device not found', data: null})
        assert.deepStrictEqual(await (await fetch(`${url}/device/a`)).json(), {errno: null, errMsg: null, data: {sn: 'a'}})
        await container.destroy()
    })

    it('runs the middlewares of the adapter and aborts the requests of the clients who left', async (): Promise<void> => {
        const trace: string[] = []
        const traced = (name: string): MiddlewareHandler => async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            trace.push(name)
            signals.push(invocation.signal!)
            return next()
        }
        const {url, container} = await Start({middlewares: [traced('adapter')]}, {middlewares: [traced('global')]})
        await fetch(`${url}/device/a`)
        assert.deepStrictEqual(trace, ['global', 'adapter'])
        signals = []
        const leaving: AbortController = new AbortController()
        const pending: Promise<Response> = fetch(`${url}/slow`, {signal: leaving.signal})
        setTimeout((): void => leaving.abort(), 20)
        await assert.rejects(pending)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        assert.ok(signals.at(-1)!.aborted)
        await container.destroy()
    })

    it('stops gracefully', async (): Promise<void> => {
        const {url, container} = await Start()
        const inProgress: Promise<Response> = fetch(`${url}/slow`)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        await container.destroy()
        assert.strictEqual(await (await inProgress).json(), 'slow')
        await assert.rejects(fetch(`${url}/device/a`))
        const impatient = await Start({}, {shutdownTimeout: 20})
        const aborted: Promise<Response> = fetch(`${impatient.url}/slow`)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        await impatient.container.destroy()
        const response: Response = await aborted
        assert.strictEqual(response.status, 503)
        assert.strictEqual(((await response.json()) as any).errno, 'E_ENTRYPOINT_STOPPED')
    })

    it('serves a single-page application outside of the paths of the actions', async (): Promise<void> => {
        const ui: string = await mkdtemp(path.join(tmpdir(), 'express-ui-'))
        await writeFile(path.join(ui, 'index.html'), '<div id="app"></div>')
        await mkdir(path.join(ui, 'assets'))
        await writeFile(path.join(ui, 'assets', 'main-Cx7aB3dE.js'), 'console.log(1)')
        //Not hashed: a name of lowercase words
        await writeFile(path.join(ui, 'assets', 'my-component.js'), 'console.log(2)')
        assert.throws((): unknown => StaticUI(ui, {assetsMaxAge: 'soon'}), /Invalid duration/)
        const {url, container} = await Start({fallback: StaticUI(ui, {assetsMaxAge: '30d'})})
        const page: Response = await fetch(`${url}/`, {headers: {Accept: 'text/html'}})
        assert.strictEqual(await page.text(), '<div id="app"></div>')
        assert.strictEqual(page.headers.get('cache-control'), 'no-cache')
        //A route of the application is its index
        assert.strictEqual(await (await fetch(`${url}/stations/42`, {headers: {Accept: 'text/html'}})).text(), '<div id="app"></div>')
        const asset: Response = await fetch(`${url}/assets/main-Cx7aB3dE.js`)
        assert.strictEqual(await asset.text(), 'console.log(1)')
        assert.strictEqual(asset.headers.get('cache-control'), 'public, max-age=2592000, immutable')
        assert.strictEqual((await fetch(`${url}/assets/my-component.js`)).headers.get('cache-control'), 'no-cache')
        //A missing file, and the paths of the actions, are not the index
        assert.strictEqual((await fetch(`${url}/assets/missing.js`)).status, 404)
        assert.strictEqual(((await (await fetch(`${url}/device`, {headers: {Accept: 'text/html'}})).json()) as any).errno, 'E_ROUTE_NOT_FOUND')
        assert.deepStrictEqual(await (await fetch(`${url}/device/a`)).json(), {sn: 'a'})
        await container.destroy()
        await rm(ui, {recursive: true, force: true})
    })

    it('fails to start on an occupied port', async (): Promise<void> => {
        let server: Server | undefined
        const first: Container = new Container()
        await first.set(Entrypoint, BuildEntrypoints({
            controllers: [DeviceController],
            http: ExpressHTTPEntrypoint({port: 0, host: '127.0.0.1', before: (app, context): void => {
                server = context.server
            }})
        }))
        const port: number = (server!.address() as AddressInfo).port
        const second: Container = new Container()
        await assert.rejects(second.set(Entrypoint, BuildEntrypoints({controllers: [DeviceController], http: ExpressHTTPEntrypoint({port: port, host: '127.0.0.1'})})), {code: 'EADDRINUSE'})
        await second.destroy()
        await first.destroy()
    })

    it('starts when its before hook gets an object injecting the entrypoint', async (): Promise<void> => {
        //An authenticator of the requests, its express middleware added in the hook
        class Guard extends Component {
            @Inject('entrypoint')
            public readonly entrypoint: Entrypoint
        }

        const container: Container = new Container()
        await container.registerNamed('guard', Guard)
        let guarded: Guard | undefined
        const starting: Promise<unknown> = container.setNamed('entrypoint', Entrypoint, BuildEntrypoints({
            controllers: [DeviceController],
            http: ExpressHTTPEntrypoint({
                port: 0,
                host: '127.0.0.1',
                before: async (): Promise<void> => {
                    guarded = await container.get<Guard>('guard')
                }
            })
        }))
        const timeout: Promise<string> = new Promise((resolve): unknown => setTimeout(resolve, 5000, 'deadlocked').unref())
        assert.notStrictEqual(await Promise.race([starting.then((): string => 'started'), timeout]), 'deadlocked')
        assert.ok(guarded?.entrypoint instanceof Entrypoint)
        await container.destroy()
    })
})
