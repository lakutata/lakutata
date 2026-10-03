import {Application, Component, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import type {BrowserWindow} from 'electron'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'

/**
 * The window of the application: the renderer, isolated from Node.js (it invokes the actions of the main process through
 * the preload script only)
 */
export class MainWindow extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Configurable(DTO.Number().optional().default(1024))
    protected readonly width: number

    @Configurable(DTO.Number().optional().default(720))
    protected readonly height: number

    /**
     * The directory of the preload script and of the built renderer (the resources of the packaged application)
     */
    @Configurable(DTO.String().optional())
    protected readonly directory?: string

    /**
     * The URL of the renderer in development, the built renderer otherwise
     */
    @Configurable(DTO.String().optional())
    protected readonly renderer?: string

    #window: BrowserWindow | undefined

    /**
     * The index.html of the built renderer: in the resources of the packaged application, in the ui package otherwise
     */
    protected rendererFile(): string {
        const packaged: string = path.join(this.directory ?? '', 'renderer', 'index.html')
        if (existsSync(packaged)) return packaged
        return path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist', 'index.html')
    }

    /**
     * Load the URL of the renderer in development: the dev server of Vite may start after the application
     * @param window
     * @param url
     */
    protected async loadURL(window: BrowserWindow, url: string): Promise<void> {
        for (let attempt: number = 1; ; attempt++) {
            try {
                return await window.loadURL(url)
            } catch (error) {
                if (attempt >= 30 || window.isDestroyed()) throw error
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            }
        }
    }

    protected async init(): Promise<void> {
        //Electron is loaded with the window: the tests, run by Node.js, serve the actions without it (the package of
        //Electron downloads its binary when it is loaded)
        const {app, BrowserWindow} = (await import('electron')).default
        await app.whenReady()
        const window: BrowserWindow = new BrowserWindow({
            width: this.width,
            height: this.height,
            title: this.app.appName,
            show: false,
            webPreferences: {
                preload: path.join(this.directory ?? '', 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        })
        this.#window = window
        window.once('ready-to-show', (): void => window.show())
        //The application ends with its window
        window.once('closed', (): void => this.app.exit(0))
        if (this.renderer) {
            await this.loadURL(window, this.renderer)
            window.webContents.openDevTools({mode: 'detach'})
        } else {
            await window.loadFile(this.rendererFile())
        }
        //A second instance of the application gives its window back
        app.on('second-instance', (): void => {
            if (window.isMinimized()) window.restore()
            window.focus()
        })
    }

    protected async destroy(): Promise<void> {
        if (this.#window && !this.#window.isDestroyed()) this.#window.destroy()
    }
}
