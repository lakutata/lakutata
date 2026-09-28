import {describe, it} from 'node:test'
import assert from 'node:assert'
import EventEmitter from 'node:events'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ActionInvocation, BuildEntrypoints, Controller, Entrypoint, MiddlewareHandler, Next, ServiceContext} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'
import {ElectronIPCServiceEntrypoint, IPCEventOfContext, IPCMain} from '../exports/ElectronAdapter.js'

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

    /**
     * Invoke a channel as a renderer
     * @param channel
     * @param sender the web contents of the renderer
     * @param data
     */
    public async invoke(channel: string, sender: EventEmitter, data: unknown): Promise<any> {
        const handler = this.handlers.get(channel)
        if (!handler) throw new Error(`No handler registered for '${channel}'`)
        return await handler({sender: sender}, data)
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
        return {value: input.value, renderer: (IPCEventOfContext(this.context as ServiceContext)?.sender as any)?.id}
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
function Renderer(id: number): EventEmitter {
    return Object.assign(new EventEmitter(), {id: id})
}

/**
 * Start an entrypoint with an Electron adapter
 * @param ipcMain
 * @param entrypointOptions
 */
async function Start(ipcMain: FakeIPCMain, entrypointOptions: Record<string, unknown> = {}): Promise<Container> {
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({controllers: [EchoController], ...entrypointOptions, service: ElectronIPCServiceEntrypoint({ipcMain: ipcMain})}))
    return container
}

describe('Electron adapter', (): void => {

    it('answers the invocations of the renderers', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        const container: Container = await Start(ipcMain)
        assert.deepStrictEqual(await ipcMain.invoke('lakutata:service', Renderer(7), {cmd: 'echo', value: 3}), {success: true, error: null, payload: {value: 3, renderer: 7}})
        const invalid = await ipcMain.invoke('lakutata:service', Renderer(7), {cmd: 'echo', value: 'x'})
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
        const container: Container = await Start(ipcMain, {middlewares: [traced('global')]})
        await ipcMain.invoke('lakutata:service', Renderer(1), {cmd: 'echo', value: 1})
        assert.deepStrictEqual(trace, ['global'])
        signals = []
        const renderer: EventEmitter = Renderer(2)
        const pending: Promise<any> = ipcMain.invoke('lakutata:service', renderer, {cmd: 'slow'})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        renderer.emit('destroyed')
        assert.ok(signals.at(-1)!.aborted)
        await pending
        await container.destroy()
    })

    it('stops gracefully', async (): Promise<void> => {
        const ipcMain: FakeIPCMain = new FakeIPCMain()
        const container: Container = await Start(ipcMain)
        const inProgress: Promise<any> = ipcMain.invoke('lakutata:service', Renderer(1), {cmd: 'slow'})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        const destroyed: Promise<void> = container.destroy()
        const refused = await ipcMain.invoke('lakutata:service', Renderer(1), {cmd: 'echo', value: 1})
        assert.strictEqual(refused.error.errno, 'E_ENTRYPOINT_STOPPED')
        assert.deepStrictEqual(await inProgress, {success: true, error: null, payload: 'slow'})
        await destroyed
    })

    it('fails to start outside of the main process of Electron', async (): Promise<void> => {
        const container: Container = new Container()
        await assert.rejects(container.set(Entrypoint, BuildEntrypoints({controllers: [EchoController], service: ElectronIPCServiceEntrypoint()})), /main process of Electron/)
        await container.destroy()
    })
})
