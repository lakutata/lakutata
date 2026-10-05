import assert from 'node:assert'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import electron, {type BrowserWindow} from 'electron'
import {Application, Component, DTO} from '../../../exports/Lakutata.js'
import {buildEntrypoints, Controller, type ActionInvocation, type Next, type ServiceContext} from '../../../exports/EntrypointComponent.js'
import {electronIPCServiceEntrypoint, ipcEventOfContext} from '../../../exports/ElectronAdapter.js'
import {ServiceAction} from '../../../exports/CTRLDecorators.js'
import {Configurable, Inject} from '../../../exports/DIDecorators.js'
import {Expect} from '../../../exports/DTODecorators.js'
import {runChecks} from '../support/Scenario.js'

/**
 * An Electron application built as the Electron templates build theirs: the main process runs the application, its
 * window is a component loading the built renderer, isolated from Node.js, which invokes the actions through the
 * preload script; the application ends with its window. Run by Integration.spec with the Electron of the repository
 */

/**
 * The directory of the main process: the preload script and the built renderer, whose page invokes an action once loaded
 */
const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-electron-'))
writeFileSync(path.join(directory, 'preload.cjs'), 'const {contextBridge, ipcRenderer} = require(\'electron\')\ncontextBridge.exposeInMainWorld(\'lakutata\', {invoke: (data) => ipcRenderer.invoke(\'lakutata:service\', data)})\n')
mkdirSync(path.join(directory, 'renderer'))
writeFileSync(path.join(directory, 'renderer', 'index.html'), [
    '<!doctype html><title>renderer</title><p id="result">pending</p>',
    '<script>window.lakutata.invoke({cmd: \'greet\', name: \'renderer\'}).then((response) => document.getElementById(\'result\').textContent = JSON.stringify(response))</script>'
].join('\n'))

/**
 * A window of the application, as the MainWindow of the templates: created once Electron is ready, destroyed with
 * the application; the main window ends the application when it is closed
 */
class MainWindow extends Component {
    @Inject(Application)
    protected readonly app: Application

    @Configurable(DTO.Number().optional().default(800))
    protected readonly width: number

    @Configurable(DTO.Number().optional().default(600))
    protected readonly height: number

    /**
     * The directory of the main process, where the preload script and the built renderer are
     */
    @Configurable(DTO.String().required())
    protected readonly directory: string

    /**
     * Whether the application ends with this window
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly main: boolean

    #window: BrowserWindow | undefined

    /**
     * The window (for the checks)
     */
    public get window(): BrowserWindow {
        return this.#window!
    }

    protected async init(): Promise<void> {
        const {app, BrowserWindow} = (await import('electron')).default
        await app.whenReady()
        const window: BrowserWindow = new BrowserWindow({
            width: this.width,
            height: this.height,
            title: this.app.appName,
            show: false,
            webPreferences: {
                preload: path.join(this.directory, 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        })
        this.#window = window
        //The application ends with its main window
        if (this.main) window.once('closed', (): void => this.app.exit(0))
        await window.loadFile(path.join(this.directory, 'renderer', 'index.html'))
    }

    protected async destroy(): Promise<void> {
        if (this.#window && !this.#window.isDestroyed()) this.#window.destroy()
    }
}

class GreetDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string
}

/**
 * The signals of the actions, aborted when their renderer is destroyed
 */
const signals: AbortSignal[] = []

async function recordSignals(invocation: ActionInvocation, next: Next): Promise<unknown> {
    if (invocation.signal) signals.push(invocation.signal)
    return await next()
}

class GreetController extends Controller {
    @ServiceAction({cmd: 'greet'}, GreetDTO)
    public async greet(input: GreetDTO): Promise<{ greeting: string, renderer: number }> {
        //The renderer invoking the action
        const sender: { id: number } = ipcEventOfContext(this.context as ServiceContext)!.sender as unknown as { id: number }
        return {greeting: `Hello, ${input.name}`, renderer: sender.id}
    }

    @ServiceAction({cmd: 'wait'})
    public async wait(): Promise<string> {
        await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 3000))
        return 'waited'
    }
}

/**
 * Invoke an action from the page of a window, as its code does
 * @param window
 * @param data
 */
function invoke(window: BrowserWindow, data: Record<string, unknown>): Promise<any> {
    return window.webContents.executeJavaScript(`window.lakutata.invoke(${JSON.stringify(data)})`)
}

//One instance of the application, as the templates
if (!electron.app.requestSingleInstanceLock()) {
    electron.app.exit(0)
} else {
    Application
        .run(() => ({
            id: 'integration.electron',
            name: 'IntegrationElectron',
            components: {
                log: {level: 'warn'},
                entrypoint: buildEntrypoints({
                    controllers: [GreetController],
                    middlewares: [recordSignals],
                    service: electronIPCServiceEntrypoint()
                }),
                window: {class: MainWindow, directory: directory},
                panel: {class: MainWindow, directory: directory, main: false, width: 400}
            },
            //The actions are served before the windows load the renderer
            bootstrap: ['entrypoint', 'window', 'panel']
        }))
        .onLaunched((app: Application): Promise<void> => {
            let main: BrowserWindow
            return runChecks(app, async (check): Promise<void> => {
                main = (await app.getObject<MainWindow>('window')).window
                const panel: BrowserWindow = (await app.getObject<MainWindow>('panel')).window

                await check('the windows are the components of the application, configured', (): void => {
                    assert.deepStrictEqual(main.getSize(), [800, 600])
                    assert.strictEqual(panel.getSize()[0], 400)
                    assert.strictEqual(main.getTitle(), 'renderer')
                })

                await check('the page of the built renderer invokes an action through the preload script once loaded', async (): Promise<void> => {
                    let text: string = 'pending'
                    for (let attempt: number = 0; attempt < 50 && text === 'pending'; attempt++) {
                        text = await main.webContents.executeJavaScript('document.getElementById(\'result\').textContent')
                        if (text === 'pending') await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 50))
                    }
                    assert.deepStrictEqual(JSON.parse(text), {success: true, error: null, payload: {greeting: 'Hello, renderer', renderer: main.webContents.id}})
                })

                await check('each window is the renderer of its invocations', async (): Promise<void> => {
                    assert.strictEqual((await invoke(panel, {cmd: 'greet', name: 'panel'})).payload.renderer, panel.webContents.id)
                    assert.notStrictEqual(main.webContents.id, panel.webContents.id)
                })

                await check('the invocations of the renderers are validated by the DTO of the action', async (): Promise<void> => {
                    const invalid = await invoke(main, {cmd: 'greet', name: 3})
                    assert.strictEqual(invalid.success, false)
                    assert.strictEqual(invalid.error.errno, 'E_INVALID_VALUE')
                    assert.strictEqual((await invoke(main, {cmd: 'remove'})).success, false)
                })

                await check('the pages reach the invocations only, not Node.js', async (): Promise<void> => {
                    assert.strictEqual(await main.webContents.executeJavaScript('[typeof require, typeof process, typeof window.lakutata.invoke].join()'), 'undefined,undefined,function')
                })

                await check('closing a window aborts the actions it invoked, the application keeps running', async (): Promise<void> => {
                    const before: number = signals.length
                    void invoke(panel, {cmd: 'wait'}).catch((): undefined => undefined)
                    for (let attempt: number = 0; attempt < 50 && signals.length === before; attempt++) await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 20))
                    const signal: AbortSignal = signals.at(-1)!
                    assert.strictEqual(signal.aborted, false)
                    panel.close()
                    for (let attempt: number = 0; attempt < 50 && !signal.aborted; attempt++) await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 20))
                    assert.strictEqual(signal.aborted, true)
                    assert.strictEqual((await invoke(main, {cmd: 'greet', name: 'again'})).payload.greeting, 'Hello, again')
                })
            }, (): void => main.close())
        })
        //The application ended by its window is done (told to Integration.spec)
        .onDone((): void => console.log('DONE the application ended with its window'))
        .onFatalException((error: Error): void => {
            console.error(error)
            electron.app.exit(1)
        })
}
