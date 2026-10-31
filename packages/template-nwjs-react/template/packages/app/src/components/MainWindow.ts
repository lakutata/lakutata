import {Application, Component, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

/**
 * The window of the application: its host page (packages/app/host) holds the user interface in a webview, isolated from
 * Node.js and from NW.js (the user interface invokes the actions of the application through the messages of the host
 * page only)
 */
export class MainWindow extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Configurable(DTO.Number().optional().default(1024))
    protected readonly width: number

    @Configurable(DTO.Number().optional().default(720))
    protected readonly height: number

    /**
     * The URL of the user interface in development, its built files otherwise
     */
    @Configurable(DTO.String().optional())
    protected readonly ui?: string

    #window: nw.Window | undefined

    protected async init(): Promise<void> {
        //The pages are files of the application: its resources (lakutata.resources) are in its directory resources, the
        //user interface is given relative to the host page
        const query: URLSearchParams = new URLSearchParams({ui: this.ui ?? '../ui/index.html'})
        //The DevTools of the user interface in development (the user interface served by Vite)
        if (this.ui) query.set('devtools', 'true')
        const window: nw.Window = await new Promise((resolve: (window: nw.Window) => void): void => nw.Window.open(`resources/host/index.html?${query}`, {
            title: this.app.appName,
            width: this.width,
            height: this.height,
            //The icon of the window (Windows, Linux: the windows of macOS show the one of the application)
            icon: 'resources/logo.png'
        }, resolve))
        this.#window = window
        //The application ends with its window
        window.on('closed', (): void => this.app.exit(0))
        //A second instance of the application gives its window back
        nw.App.on('open', (): void => {
            window.restore()
            window.focus()
        })
    }

    protected async destroy(): Promise<void> {
        this.#window?.removeAllListeners('closed').close(true)
    }
}
