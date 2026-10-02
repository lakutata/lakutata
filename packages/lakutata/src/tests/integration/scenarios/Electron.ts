import assert from 'node:assert'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import electron from 'electron'
import {Application, DTO} from '../../../exports/Lakutata.js'
import {BuildEntrypoints, Controller, type ActionInvocation, type Next, type ServiceContext} from '../../../exports/EntrypointComponent.js'
import {ElectronIPCServiceEntrypoint, IPCEventOfContext} from '../../../exports/ElectronAdapter.js'
import {ServiceAction} from '../../../exports/CTRLDecorators.js'
import {Expect} from '../../../exports/DTODecorators.js'
import {RunChecks} from '../support/Scenario.js'

/**
 * The main process of Electron: its windows are renderers isolated from Node.js, invoking the actions through the
 * preload script, as the Electron templates do (run by Integration.spec with the Electron of the repository)
 */
const {app: electronApp, BrowserWindow, ipcMain} = electron

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

/**
 * The signals of the actions waiting, aborted when their renderer is destroyed
 */
const signals: AbortSignal[] = []

async function RecordSignals(invocation: ActionInvocation, next: Next): Promise<unknown> {
    if (invocation.signal) signals.push(invocation.signal)
    return await next()
}

class RendererController extends Controller {
    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<{ value: number, renderer: number }> {
        //The renderer invoking the action
        const sender: { id: number } = IPCEventOfContext(this.context as ServiceContext)!.sender as unknown as { id: number }
        return {value: input.value, renderer: sender.id}
    }

    @ServiceAction({cmd: 'wait'})
    public async wait(): Promise<string> {
        await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 3000))
        return 'waited'
    }
}

/**
 * Start the application once Electron is ready: the main script does not await it at its top level (its ready event
 * waits for the evaluation of the main script)
 */
async function Main(): Promise<void> {

    //The preload script exposing the invocations to the renderers, as the one of the templates
    const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-electron-'))
    const preload: string = path.join(directory, 'preload.cjs')
    writeFileSync(preload, 'const {contextBridge, ipcRenderer} = require(\'electron\')\ncontextBridge.exposeInMainWorld(\'lakutata\', {invoke: (data) => ipcRenderer.invoke(\'lakutata:service\', data)})\n')

    /**
     * A window of the application, hidden
     */
    async function Window(): Promise<electron.BrowserWindow> {
        const window: electron.BrowserWindow = new BrowserWindow({show: false, webPreferences: {preload: preload, contextIsolation: true, sandbox: true, nodeIntegration: false}})
        await window.loadURL('data:text/html,<!doctype html><title>renderer</title>')
        return window
    }

    /**
     * Invoke an action from the page of a window, as its code does
     * @param window
     * @param data
     */
    function Invoke(window: electron.BrowserWindow, data: Record<string, unknown>): Promise<any> {
        return window.webContents.executeJavaScript(`window.lakutata.invoke(${JSON.stringify(data)})`)
    }

    Application
        .run(() => ({
            id: 'integration.electron',
            name: 'IntegrationElectron',
            components: {
                log: {level: 'warn'},
                entrypoint: BuildEntrypoints({
                    controllers: [RendererController],
                    middlewares: [RecordSignals],
                    service: ElectronIPCServiceEntrypoint({ipcMain: ipcMain})
                })
            },
            bootstrap: ['entrypoint']
        }))
        .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
            const [first, second] = [await Window(), await Window()]

            await check('the page of a window invokes an action through the preload script (isolated, sandboxed)', async (): Promise<void> => {
                assert.deepStrictEqual(await Invoke(first, {cmd: 'echo', value: 3}), {success: true, error: null, payload: {value: 3, renderer: first.webContents.id}})
            })

            await check('each window is the renderer of its invocations', async (): Promise<void> => {
                assert.strictEqual((await Invoke(second, {cmd: 'echo', value: 4})).payload.renderer, second.webContents.id)
                assert.notStrictEqual(first.webContents.id, second.webContents.id)
            })

            await check('the invocations of the renderers are validated by the DTO of the action', async (): Promise<void> => {
                const invalid = await Invoke(first, {cmd: 'echo', value: 'three'})
                assert.strictEqual(invalid.success, false)
                assert.strictEqual(invalid.error.errno, 'E_INVALID_VALUE')
                const unknown = await Invoke(first, {cmd: 'remove'})
                assert.strictEqual(unknown.success, false)
            })

            await check('the pages reach the invocations only, not Node.js', async (): Promise<void> => {
                assert.strictEqual(await first.webContents.executeJavaScript('[typeof require, typeof process, typeof window.lakutata.invoke].join()'), 'undefined,undefined,function')
            })

            await check('closing a window aborts the actions it invoked', async (): Promise<void> => {
                const before: number = signals.length
                void Invoke(second, {cmd: 'wait'}).catch((): undefined => undefined)
                for (let attempt: number = 0; attempt < 50 && signals.length === before; attempt++) await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 20))
                const signal: AbortSignal = signals.at(-1)!
                assert.strictEqual(signal.aborted, false)
                second.destroy()
                for (let attempt: number = 0; attempt < 50 && !signal.aborted; attempt++) await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 20))
                assert.strictEqual(signal.aborted, true)
                //The other window still invokes
                assert.strictEqual((await Invoke(first, {cmd: 'echo', value: 5})).payload.value, 5)
            })
            first.destroy()
        }))
        .onFatalException((error: Error): number => {
            console.error(error)
            return 1
        })
}

void electronApp.whenReady().then(Main)
