import {describe, it} from 'node:test'
import assert from 'node:assert'
import EventEmitter from 'node:events'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ActionInvocation, buildEntrypoints, Controller, Entrypoint, MiddlewareHandler, Next, ServiceContext} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'
import {electronIPCServiceEntrypoint, ipcEventOfContext, IPCMain} from '../exports/ElectronAdapter.js'
import {socketIOServiceEntrypoint} from '../exports/SocketIOAdapter.js'
import type {AddressInfo} from 'node:net'
import {io as Connect, type Socket as ClientSocket} from 'socket.io-client'

/**
 * The ipcMain of the tests: the handlers are invoked as by the renderers
 */
class FakeIPCMain implements IPCMain {
    public readonly handlers: Map<string, (event: any, ...args: any[]) => unknown> = new Map()

    public handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void {
        if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
        this.handlers.set(channel, listener)
    }

    public removeHandler(channel: string): void {
        this.handlers.delete(channel)
    }

    public readonly listeners: Map<string, (event: any, ...args: any[]) => void> = new Map()

    public on(channel: string, listener: (event: any, ...args: any[]) => void): void {
        this.listeners.set(channel, listener)
    }

    public removeAllListeners(channel: string): void {
        this.listeners.delete(channel)
    }

    /**
     * Send to a channel as the page of a renderer
     * @param channel
     * @param page its web contents, its process and its frame
     * @param args
     */
    public send(channel: string, page: Page, ...args: unknown[]): void {
        this.listeners.get(channel)?.(pageEvent(page), ...args)
    }

    /**
     * Invoke a channel as a renderer
     * @param channel
     * @param sender the web contents of the renderer, or a page of it
     * @param data
     * @param clientId
     */
    public async invoke(channel: string, sender: EventEmitter | Page, data: unknown, clientId?: string): Promise<any> {
        const handler = this.handlers.get(channel)
        if (!handler) throw new Error(`No handler registered for '${channel}'`)
        return await handler(sender instanceof EventEmitter ? {sender: sender} : pageEvent(sender), data, clientId)
    }
}

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

let signals: AbortSignal[] = []

class EchoController extends Controller {

    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<unknown> {
        return {value: input.value, renderer: (ipcEventOfContext(this.context as ServiceContext)?.sender as any)?.id}
    }

    @ServiceAction({cmd: 'whoami'})
    public async whoami(): Promise<string | undefined> {
        return (this.context as ServiceContext).clientId
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }
}

/**
 * A renderer
 * @param id
 */
function createRenderer(id: number): EventEmitter & { received: unknown[][] } {
    const received: unknown[][] = []
    return Object.assign(new EventEmitter(), {id: id, received: received, sendToFrame: (...args: unknown[]): unknown => received.push(args)})
}

/**
 * A page of a renderer: its web contents, the process of the renderer and its frame in it
 */
type Page = { renderer: EventEmitter, processId: number, frameId: number }

/**
 * The event of the IPC sent by a page (of the main frame of its window)
 * @param page
 */
function pageEvent(page: Page): Record<string, unknown> {
    return {sender: page.renderer, processId: page.processId, frameId: page.frameId, senderFrame: {parent: null}}
}

/**
 * Start an entrypoint with an Electron adapter
 * @param ipcMain
 * @param entrypointOptions
 */
async function start(ipcMain: FakeIPCMain, entrypointOptions: Record<string, unknown> = {}): Promise<Container> {
    const container: Container = new Container()
    await container.set(Entrypoint, buildEntrypoints({controllers: [EchoController], ...entrypointOptions, service: electronIPCServiceEntrypoint({ipcMain: ipcMain})}))
    return container
}

describe('Electron adapter', (): void => {

    it('answers the invocations of the renderers', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        const container: Container = await start(ipcMain)
        assert.deepStrictEqual(await ipcMain.invoke('lakutata:service', createRenderer(7), {cmd: 'echo', value: 3}), {success: true, error: null, payload: {value: 3, renderer: 7}})
        const invalid = await ipcMain.invoke('lakutata:service', createRenderer(7), {cmd: 'echo', value: 'x'})
        assert.strictEqual(invalid.success, false)
        assert.strictEqual(invalid.error.errno, 'E_INVALID_VALUE')
        await container.destroy()
        //The handler is removed with the adapter
        assert.strictEqual(ipcMain.handlers.size, 0)
    })

    it('runs the middlewares of the adapter and aborts the requests of the destroyed renderers', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        const trace: string[] = []
        const traced = (name: string): MiddlewareHandler => async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            trace.push(name)
            signals.push(invocation.signal!)
            return next()
        }
        const container: Container = await start(ipcMain, {middlewares: [traced('global')]})
        await ipcMain.invoke('lakutata:service', createRenderer(1), {cmd: 'echo', value: 1})
        assert.deepStrictEqual(trace, ['global'])
        signals = []
        const renderer: EventEmitter = createRenderer(2)
        const pending: Promise<any> = ipcMain.invoke('lakutata:service', renderer, {cmd: 'slow'})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        renderer.emit('destroyed')
        assert.ok(signals.at(-1)!.aborted)
        await pending
        await container.destroy()
    })

    it('pushes the events to the pages by their client ids, to every page, as long as they are loaded', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        const container: Container = await start(ipcMain)
        const entrypoint: Entrypoint = await container.get(Entrypoint)
        //Two windows: the main frames of their renderers have the same id (the ones of the frames are the ones of their process)
        const [first, second] = [createRenderer(1), createRenderer(2)]
        const one: Page = {renderer: first, processId: 5, frameId: 1}
        const two: Page = {renderer: second, processId: 6, frameId: 1}
        ipcMain.send('lakutata:service:subscribe', one, 'one')
        ipcMain.send('lakutata:service:subscribe', two, 'two')
        //The client of the requests of a page
        assert.deepStrictEqual(await ipcMain.invoke('lakutata:service', one, {cmd: 'whoami'}, 'one'), {success: true, error: null, payload: 'one'})
        assert.strictEqual(entrypoint.notify('one', 'progress', 1, 'a'), true)
        assert.deepStrictEqual(first.received, [[[5, 1], 'lakutata:service:event', 'progress', [1, 'a']]])
        assert.deepStrictEqual(second.received, [])
        assert.strictEqual(entrypoint.broadcast('all'), 2)
        assert.deepStrictEqual(second.received, [[[6, 1], 'lakutata:service:event', 'all', []]])
        //The page loaded again: a new client, the one of the page replaced
        ipcMain.send('lakutata:service:subscribe', {renderer: first, processId: 5, frameId: 8}, 'three')
        assert.strictEqual(entrypoint.notify('one', 'progress'), false)
        assert.strictEqual(entrypoint.notify('three', 'progress'), true)
        assert.deepStrictEqual(first.received.at(-1), [[5, 8], 'lakutata:service:event', 'progress', []])
        //A destroyed window has no client
        second.emit('destroyed')
        assert.strictEqual(entrypoint.notify('two', 'progress'), false)
        assert.strictEqual(entrypoint.broadcast('all'), 1)
        //The requests without client id
        assert.deepStrictEqual(await ipcMain.invoke('lakutata:service', createRenderer(4), {cmd: 'whoami'}), {success: true, error: null, payload: undefined})
        await container.destroy()
        assert.strictEqual(ipcMain.listeners.size, 0)
    })

    it('pushes the events to the clients of the windows and of the sockets (the tools of the development)', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        let port: number = 0
        const container: Container = new Container()
        await container.set(Entrypoint, buildEntrypoints({
            controllers: [EchoController],
            service: [
                electronIPCServiceEntrypoint({ipcMain: ipcMain}),
                socketIOServiceEntrypoint({port: 0, host: '127.0.0.1', event: 'request', listening: (io, server): void => {
                    port = (server!.address() as AddressInfo).port
                }})
            ]
        }))
        const entrypoint: Entrypoint = await container.get(Entrypoint)
        const window: EventEmitter & { received: unknown[][] } = createRenderer(1)
        ipcMain.send('lakutata:service:subscribe', {renderer: window, processId: 5, frameId: 1}, 'window')
        const tool: ClientSocket = Connect(`http://127.0.0.1:${port}`, {transports: ['websocket'], reconnection: false, extraHeaders: {id: 'postman'}})
        await new Promise<void>((resolve: () => void): unknown => tool.once('connect', resolve))
        assert.strictEqual((await tool.emitWithAck('request', {cmd: 'whoami'})).payload, 'postman')
        const pushed: Promise<unknown[]> = new Promise((resolve: (args: unknown[]) => void): unknown => tool.once('done', (...args: unknown[]): void => resolve(args)))
        assert.strictEqual(entrypoint.notify('postman', 'done', 1), true)
        assert.deepStrictEqual(await pushed, [1])
        assert.strictEqual(entrypoint.notify('window', 'done', 2), true)
        assert.deepStrictEqual(window.received, [[[5, 1], 'lakutata:service:event', 'done', [2]]])
        assert.strictEqual(entrypoint.broadcast('all'), 2)
        tool.disconnect()
        await container.destroy()
    })

    it('stops gracefully', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        const container: Container = await start(ipcMain)
        const inProgress: Promise<any> = ipcMain.invoke('lakutata:service', createRenderer(1), {cmd: 'slow'})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        const destroyed: Promise<void> = container.destroy()
        const refused = await ipcMain.invoke('lakutata:service', createRenderer(1), {cmd: 'echo', value: 1})
        assert.strictEqual(refused.error.errno, 'E_ENTRYPOINT_STOPPED')
        assert.deepStrictEqual(await inProgress, {success: true, error: null, payload: 'slow'})
        await destroyed
    })

    it('fails to start outside of the main process of Electron', async (): Promise<void> => {
        const container: Container = new Container()
        await assert.rejects(container.set(Entrypoint, buildEntrypoints({controllers: [EchoController], service: electronIPCServiceEntrypoint()})), /main process of Electron/)
        await container.destroy()
    })
})
