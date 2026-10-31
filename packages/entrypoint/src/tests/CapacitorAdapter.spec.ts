import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {EventEmitter} from 'node:events'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {type ActionInvocation, buildEntrypoints, Controller, Entrypoint, type Next, ServiceContext} from '../exports/Entrypoint.js'
import type {ServiceResponse} from '../exports/Channel.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'
import {type CapacitorBridge, capacitorServiceEntrypoint, type CapacitorServiceMessage} from '../exports/CapacitorAdapter.js'

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

class EchoController extends Controller {

    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<{ value: number, clientId?: string }> {
        return {value: input.value, clientId: (this.context as ServiceContext).clientId}
    }

    @ServiceAction({cmd: 'big'})
    public async big(): Promise<bigint> {
        return 1n
    }

    @ServiceAction({cmd: 'wait'})
    public async wait(): Promise<string> {
        //Its signal aborted once its client is unsubscribed
        await new Promise<void>((resolve: () => void): void => void this.signal?.addEventListener('abort', (): void => resolve(), {once: true}))
        return 'aborted'
    }

    @ServiceAction({cmd: 'notify'})
    public async notify(input: { to: string }): Promise<boolean> {
        const entrypoint: Entrypoint = await this.getObject<Entrypoint>('entrypoint')
        return entrypoint.notify(input.to, 'progress', 50)
    }
}

/**
 * The bridge of @capawesome/capacitor-nodejs in the tests: the messages of the page are emitted on its channel, the
 * ones posted to the page kept (as the plugin sends them: in JSON)
 */
class FakeBridge implements CapacitorBridge {
    public readonly posted: CapacitorServiceMessage[] = []
    public readonly channel = Object.assign(new EventEmitter(), {
        post: (event: string, ...args: unknown[]): void => {
            assert.strictEqual(event, 'lakutata:service')
            this.posted.push(...JSON.parse(JSON.stringify(args)) as CapacitorServiceMessage[])
        }
    })
    public readonly app = new EventEmitter()

    /**
     * Send a message of the page
     * @param message
     */
    public send(message: unknown): void {
        this.channel.emit('lakutata:service', message)
    }

    /**
     * The response of an invocation, once posted
     * @param id
     */
    public async response(id: string | number): Promise<CapacitorServiceMessage & { response: ServiceResponse }> {
        for (let attempt: number = 0; attempt < 200; attempt++) {
            const found = this.posted.find((message: CapacitorServiceMessage): boolean => message.type === 'response' && message.id === id)
            if (found) return found as CapacitorServiceMessage & { response: ServiceResponse }
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
        }
        throw new Error(`No response ${id}`)
    }
}

/**
 * Start an application whose entrypoint serves the bridge of the tests
 * @param bridge
 * @param options
 */
async function start(bridge: FakeBridge, options: Partial<Parameters<typeof capacitorServiceEntrypoint>[0]> = {}): Promise<Container> {
    const container: Container = new Container()
    await container.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [EchoController],
        service: capacitorServiceEntrypoint({bridge: bridge, ...options})
    }))
    return container
}

describe('Capacitor service adapter', (): void => {

    it('answers the invocations of the page on the bridge, in JSON, its errors whole', async (): Promise<void> => {
        const bridge: FakeBridge = new FakeBridge()
        const container: Container = await start(bridge)
        try {
            bridge.send({type: 'invoke', id: 1, clientId: 'page', data: {cmd: 'echo', value: 3}})
            assert.deepStrictEqual((await bridge.response(1)).response, {success: true, error: null, payload: {value: 3, clientId: 'page'}})
            bridge.send({type: 'invoke', id: 'two', data: {cmd: 'echo', value: 'x'}})
            const failed = (await bridge.response('two')).response
            assert.strictEqual(failed.success, false)
            assert.strictEqual((failed.error as unknown as Record<string, unknown>).errno, 'E_INVALID_VALUE')
            bridge.send({type: 'invoke', id: 3, data: {cmd: 'missing'}})
            assert.strictEqual(((await bridge.response(3)).response.error as unknown as Record<string, unknown>).statusCode, 404)
            //A result JSON cannot hold: an error
            bridge.send({type: 'invoke', id: 4, data: {cmd: 'big'}})
            assert.match(((await bridge.response(4)).response.error as unknown as Record<string, unknown>).message as string, /cannot be sent as JSON/)
            //The messages that are not requests are ignored
            bridge.send('hello')
            bridge.send({type: 'invoke', data: {cmd: 'echo', value: 1}})
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            assert.strictEqual(bridge.posted.length, 4)
        } finally {
            await container.destroy()
        }
    })

    it('pushes the events to the clients subscribed, aborts the requests of a client unsubscribed', async (): Promise<void> => {
        const bridge: FakeBridge = new FakeBridge()
        //The signals of the requests, given to their invocations
        const signals: AbortSignal[] = []
        const container: Container = await start(bridge, {
            middlewares: [async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
                signals.push(invocation.signal!)
                return next()
            }]
        })
        try {
            bridge.send({type: 'subscribe', clientId: 'page'})
            bridge.send({type: 'invoke', id: 1, clientId: 'other', data: {cmd: 'notify', to: 'page'}})
            assert.strictEqual((await bridge.response(1)).response.payload, true)
            assert.deepStrictEqual(bridge.posted.filter((message: CapacitorServiceMessage): boolean => message.type === 'event'), [{type: 'event', clientId: 'page', event: 'progress', args: [50]}])
            //An unknown client: nothing pushed
            bridge.send({type: 'invoke', id: 2, data: {cmd: 'notify', to: 'nobody'}})
            assert.strictEqual((await bridge.response(2)).response.payload, false)
            const entrypoint: Entrypoint = await container.get<Entrypoint>('entrypoint')
            assert.strictEqual(entrypoint.broadcast('ready'), 1)
            //Unsubscribed: its request in progress aborted (its result not given), no event pushed to it
            bridge.send({type: 'invoke', id: 3, clientId: 'page', data: {cmd: 'wait'}})
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            assert.strictEqual(signals.at(-1)!.aborted, false)
            bridge.send({type: 'unsubscribe', clientId: 'page'})
            assert.strictEqual(signals.at(-1)!.aborted, true)
            assert.strictEqual((await bridge.response(3)).response.success, true)
            assert.strictEqual(entrypoint.broadcast('ready'), 0)
        } finally {
            await container.destroy()
        }
    })

    it('calls its pause option before releasing the lock of the plugin, its resume option, their failures ignored', async (): Promise<void> => {
        const bridge: FakeBridge = new FakeBridge()
        const calls: string[] = []
        const container: Container = await start(bridge, {
            pause: async (): Promise<void> => {
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
                calls.push('pause')
                throw new Error('nothing to write')
            },
            resume: (): void => void calls.push('resume')
        })
        try {
            await new Promise<void>((resolve: () => void): unknown => bridge.app.emit('pause', {release: (): void => {
                calls.push('released')
                resolve()
            }}))
            bridge.app.emit('resume')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
            assert.deepStrictEqual(calls, ['pause', 'released', 'resume'])
        } finally {
            await container.destroy()
        }
        //Stopped: it listens no more
        assert.strictEqual(bridge.channel.listenerCount('lakutata:service'), 0)
        assert.strictEqual(bridge.app.listenerCount('pause'), 0)
    })

    it('requires the bridge of the plugin by NODE_PATH, refused in a worker thread', (): void => {
        //The builtin module of the plugin, found through the NODE_PATH it sets
        const modules: string = mkdtempSync(path.join(tmpdir(), 'lakutata-capacitor-'))
        try {
            mkdirSync(path.join(modules, 'bridge'))
            writeFileSync(path.join(modules, 'bridge', 'index.js'), `
const {EventEmitter} = require('node:events')
const {isMainThread} = require('node:worker_threads')
if (!isMainThread) throw new Error('Channel already exists.')
const channel = new EventEmitter()
channel.post = (event, message) => console.log('POSTED ' + JSON.stringify(message))
module.exports = {channel, app: new EventEmitter()}
`)
            const adapter: string = new URL('../exports/CapacitorAdapter.js', import.meta.url).href
            const script = (inWorker: boolean): string => `
const {capacitorServiceEntrypoint} = await import(${JSON.stringify(adapter)})
const run = () => {
    const entrypoint = capacitorServiceEntrypoint()
    entrypoint.start({dispatch: async (context) => context.data.text})
    require('bridge').channel.emit('lakutata:service', {type: 'invoke', id: 1, data: {text: 'hi'}})
}
${inWorker ? `
const {Worker} = await import('node:worker_threads')
const worker = new Worker(${JSON.stringify(`import(${JSON.stringify(adapter)}).then(({capacitorServiceEntrypoint}) => { try { capacitorServiceEntrypoint().start({}) } catch (error) { console.log('REFUSED ' + error.message) } })`)}, {eval: true})
await new Promise((resolve) => worker.once('exit', resolve))` : `
const {createRequire} = await import('node:module')
const require = createRequire(import.meta.url)
run()
await new Promise((resolve) => setTimeout(resolve, 100))`}
`
            const options = {cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), encoding: 'utf8' as const, timeout: 30000, env: {...process.env, NODE_PATH: modules}}
            const main = spawnSync(process.execPath, ['--input-type=module', '-e', script(false)], options)
            assert.strictEqual(main.status, 0, main.stdout + main.stderr)
            assert.match(main.stdout, /POSTED \{"type":"response","id":1,"response":\{"success":true,"error":null,"payload":"hi"\}\}/)
            const worker = spawnSync(process.execPath, ['--input-type=module', '-e', script(true)], options)
            assert.strictEqual(worker.status, 0, worker.stdout + worker.stderr)
            assert.match(worker.stdout, /REFUSED capacitorServiceEntrypoint runs in the main thread of Node\.js/)
        } finally {
            rmSync(modules, {recursive: true, force: true})
        }
    })
})
