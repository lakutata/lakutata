# A tray application with NW.js

This example builds a clipboard history that lives in the tray of the system: it keeps the texts copied in any program,
and its window lists them, searches them, copies one to the clipboard again and pins the ones to keep. It starts from
the `nwjs-react` template and shows what an NW.js application made with lakutata is made of: its background script, a
lakutata application that runs as long as the application does, with or without a window (here it reads the clipboard
and keeps the icon in the tray with its menu); its window, whose React user interface calls the actions of the
application and receives its events; and the tests of the application, which run without NW.js.

| Message | What it does |
|---|---|
| `{cmd: 'clips.list'}` | Lists the clips, the pinned ones first, then the latest |
| `{cmd: 'clips.list', query: 'git'}` | Lists only the clips whose text holds `git`, whatever its case |
| `{cmd: 'clips.copy', id: '…'}` | Copies a clip to the clipboard again, which moves it to the top |
| `{cmd: 'clips.pin', id: '…', pinned: true}` | Pins a clip: it stays, however many texts are copied after it |
| `{cmd: 'clips.delete', id: '…'}` | Removes a clip |
| `{cmd: 'clips.clear'}` | Removes the clips, except the pinned ones |

When the history changes, the application pushes the `clips.changed` event to the window.

## 1. Create the project

```bash
npx @lakutata/cli create --name clips --template nwjs-react --yes
cd clips
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

The project is a workspace ([ProjectStructure](../ProjectStructure.md)): `packages/app` is the background script of
NW.js, a lakutata application; `packages/ui` is the user interface, a React page built by Vite; `packages/resources`
holds the icon. The application needs no other package: the clipboard and the tray come from NW.js, and the history is a
JSON file written with `node:fs`. The example controller of the template is removed.

## 2. The input

**`packages/app/src/dtos/ClipDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * The clips whose text holds a query, all of them without one
 */
export class SearchClipsDTO extends DTO {
    @Expect(DTO.String().trim().max(200).optional())
    public query?: string
}

/**
 * A clip of the history, by its id
 */
export class ClipIdDTO extends DTO {
    @Expect(DTO.String().uuid().required())
    public id: string
}

/**
 * A clip to pin, or to unpin
 */
export class PinClipDTO extends ClipIdDTO {
    @Expect(DTO.Boolean().required())
    public pinned: boolean
}
```

Each action validates its input with a DTO before it runs ([DTOValidation](../DTOValidation.md)). A clip is named by its
id, a UUID given by the history: `.uuid()` refuses any other string, `"id" must be a valid GUID`. A message is JSON, so
its values keep their types: `pinned` must be a boolean.

## 3. The exception

**`packages/app/src/exceptions/ClipExceptions.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * The clip is not in the history (any more)
 */
export class ClipNotFoundException extends Exception {
    public errno: string = 'E_CLIP_NOT_FOUND'
}
```

An exception has an `errno`, the code that the user interface checks ([Exceptions](../Exceptions.md)). The window
receives the error as it was thrown, with all its properties ([ServiceCalls](../ServiceCalls.md), section 3):
`error.errno` is `'E_CLIP_NOT_FOUND'`. The service transports always answer with an envelope, whatever the status of the
error, so the exception needs no `statusCode`.

## 4. The history

**`packages/app/src/components/History.ts`**

```typescript
import {Component, DTO} from 'lakutata'
import {type Entrypoint} from 'lakutata/com/entrypoint'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {ClipNotFoundException} from '../exceptions/ClipExceptions.js'

/**
 * A text copied to the clipboard
 */
export type Clip = { id: string, text: string, copiedAt: string, pinned: boolean }

/**
 * The text of the clipboard, read and written: the clipboard of NW.js in the application, a stand-in in the tests
 */
export type ClipboardAccess = { read(): string, write(text: string): void }

/**
 * The history of the clipboard: the texts copied, the latest first, kept in a file. NW.js tells no change of the
 * clipboard, so the component reads it at an interval. Its changes are pushed to the windows (clips.changed) and
 * emitted to the other components (changed)
 */
export class History extends Component {

    /**
     * Pushes the events to the windows
     */
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    /**
     * The clipboard read and written
     */
    @Configurable(DTO.Object({read: DTO.Function().required(), write: DTO.Function().required()}).required())
    protected readonly clipboard: ClipboardAccess

    /**
     * The file of the history
     */
    @Configurable(DTO.String().required())
    protected readonly file: string

    /**
     * How often the clipboard is read, in milliseconds
     */
    @Configurable(DTO.Number().integer().min(10).optional().default(500))
    protected readonly interval: number

    /**
     * The clips kept, the pinned ones aside
     */
    @Configurable(DTO.Number().integer().min(1).optional().default(50))
    protected readonly limit: number

    #clips: Clip[] = []

    //The text read last from the clipboard: a copy is a change of it
    #last: string = ''

    #timer: NodeJS.Timeout | undefined

    //The writes of the file, one after the other
    #saved: Promise<void> = Promise.resolve()

    /**
     * Read the history from its file, then the clipboard at each interval: what it holds when the application starts
     * is not a copy
     */
    protected async init(): Promise<void> {
        this.#clips = await readFile(this.file, 'utf8').then((text: string): Clip[] => JSON.parse(text), (): Clip[] => [])
        this.#last = this.clipboard.read()
        this.#timer = setInterval((): void => this.read(), this.interval)
    }

    protected async destroy(): Promise<void> {
        clearInterval(this.#timer)
        await this.#saved
    }

    /**
     * Read the clipboard: a text other than the last one read is a copy
     */
    protected read(): void {
        const text: string = this.clipboard.read()
        if (!text.trim() || text === this.#last) return
        this.#last = text
        this.add(text)
    }

    /**
     * Put a text at the top of the history: a text copied again moves up, and the oldest clips not pinned beyond the
     * limit are dropped
     * @param text
     */
    protected add(text: string): Clip {
        const clip: Clip = this.#clips.find((item: Clip): boolean => item.text === text) ?? {id: randomUUID(), text: text, copiedAt: '', pinned: false}
        clip.copiedAt = new Date().toISOString()
        let kept: number = 0
        this.#clips = [clip, ...this.#clips.filter((item: Clip): boolean => item !== clip)].filter((item: Clip): boolean => item.pinned || ++kept <= this.limit)
        this.changed()
        return clip
    }

    /**
     * Save the history, and tell it changed: the file written aside, then renamed, so that it is never left half written
     */
    protected changed(): void {
        const json: string = JSON.stringify(this.#clips)
        this.#saved = this.#saved.then(async (): Promise<void> => {
            await mkdir(path.dirname(this.file), {recursive: true})
            await writeFile(`${this.file}.tmp`, json)
            await rename(`${this.file}.tmp`, this.file)
        })
        this.entrypoint.broadcast('clips.changed')
        this.emit('changed')
    }

    /**
     * The clips, the pinned ones first, then the latest; those whose text holds the query only (whatever its case)
     * @param query
     */
    public list(query?: string): Clip[] {
        const lowered: string | undefined = query?.toLowerCase()
        return this.#clips
            .filter((clip: Clip): boolean => !lowered || clip.text.toLowerCase().includes(lowered))
            .sort((a: Clip, b: Clip): number => Number(b.pinned) - Number(a.pinned) || b.copiedAt.localeCompare(a.copiedAt))
            .map((clip: Clip): Clip => ({...clip}))
    }

    /**
     * A clip of the history
     * @param id
     */
    protected find(id: string): Clip {
        const clip: Clip | undefined = this.#clips.find((item: Clip): boolean => item.id === id)
        if (!clip) throw new ClipNotFoundException('The clip {0} is not in the history', id)
        return clip
    }

    /**
     * Copy a clip to the clipboard again: it moves to the top
     * @param id
     */
    public copy(id: string): Clip {
        const {text} = this.find(id)
        this.#last = text
        this.clipboard.write(text)
        return {...this.add(text)}
    }

    /**
     * Pin a clip, or unpin it: a pinned clip stays, whatever is copied after it
     * @param id
     * @param pinned
     */
    public pin(id: string, pinned: boolean): Clip {
        const clip: Clip = this.find(id)
        clip.pinned = pinned
        this.changed()
        return {...clip}
    }

    /**
     * Remove a clip
     * @param id
     */
    public remove(id: string): void {
        const clip: Clip = this.find(id)
        this.#clips = this.#clips.filter((item: Clip): boolean => item !== clip)
        this.changed()
    }

    /**
     * Remove the clips, but the pinned ones
     */
    public clear(): void {
        this.#clips = this.#clips.filter((clip: Clip): boolean => clip.pinned)
        this.changed()
    }
}
```

- A component is created once and shared by the whole application ([Objects](../Objects.md)): it keeps the clips, which
  outlive the requests, while a controller lives for one request only ([Controllers](../Controllers.md), section 2).
- The component knows nothing of NW.js. Its options give it what it uses ([Injection](../Injection.md)): `clipboard`,
  the functions that read and write the text of the clipboard (the clipboard of NW.js in the application, section 8; a
  variable in the tests, section 11), and `file`, where the history is kept.
- NW.js does not tell when the clipboard changes, so `init()` reads it every `interval` milliseconds. A text other than
  the last one read is a copy; the text that the clipboard holds when the application starts is not one, and neither is
  the text that `copy()` writes itself.
- A text copied again moves to the top instead of being added twice. Beyond `limit` clips, the oldest ones are dropped,
  except the pinned ones.
- Each change saves the file and tells it: `this.entrypoint.broadcast()` pushes `clips.changed` to the window
  ([ServiceCalls](../ServiceCalls.md), section 5), and `this.emit('changed')` tells the other components, such as the
  tray (section 6). The file is written to a file beside it (`history.json.tmp`), then renamed over it, so that a crash
  never leaves it half written; the writes wait for each other, and `destroy()` waits for the last one when the
  application stops.

## 5. The controller

**`packages/app/src/controllers/ClipController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Clip, History} from '../components/History.js'
import {ClipIdDTO, PinClipDTO, SearchClipsDTO} from '../dtos/ClipDTO.js'

/**
 * The actions of the history, invoked by the window: window.ipc.invoke({cmd: 'clips.list'})
 */
export class ClipController extends Controller {

    @Inject('history')
    protected readonly history: History

    @ServiceAction({cmd: 'clips.list'}, SearchClipsDTO)
    public async list(input: SearchClipsDTO): Promise<Clip[]> {
        return this.history.list(input.query)
    }

    @ServiceAction({cmd: 'clips.copy'}, ClipIdDTO)
    public async copy(input: ClipIdDTO): Promise<Clip> {
        return this.history.copy(input.id)
    }

    @ServiceAction({cmd: 'clips.pin'}, PinClipDTO)
    public async pin(input: PinClipDTO): Promise<Clip> {
        return this.history.pin(input.id, input.pinned)
    }

    @ServiceAction({cmd: 'clips.delete'}, ClipIdDTO)
    public async remove(input: ClipIdDTO): Promise<void> {
        this.history.remove(input.id)
    }

    @ServiceAction({cmd: 'clips.clear'})
    public async clear(): Promise<void> {
        this.history.clear()
    }
}
```

Each `@ServiceAction` is called by a message: `{cmd: 'clips.pin', id: '…', pinned: true}` calls `pin()` with
`{id: '…', pinned: true}`, validated by `PinClipDTO` ([ServiceCalls](../ServiceCalls.md), section 2). The actions are
short: the work is done by the `history` component, which the controller injects. An action that returns nothing, such
as `remove()`, answers `{success: true, error: null}`.

## 6. The window and the tray

The application stays in the tray: closing the window hides it, and the menu of the tray shows it again or quits the
application. Two files of the template change, the component of the window and the types of the API of NW.js, and the
tray is a new component.

**`packages/app/src/components/MainWindow.ts`**

```typescript
import {Application, Component, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

/**
 * The window of the application: its host page (packages/app/host) holds the user interface in a webview, isolated from
 * Node.js and from NW.js (the user interface invokes the actions of the application through the messages of the host
 * page only). Closing it hides it: the application keeps reading the clipboard, in the tray
 */
export class MainWindow extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Configurable(DTO.Number().optional().default(420))
    protected readonly width: number

    @Configurable(DTO.Number().optional().default(640))
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
        //Closed, the window is hidden: the application quits from its tray, or when it is asked to (Cmd+Q on macOS)
        window.on('close', (reason?: 'quit'): unknown => reason === 'quit' ? this.app.exit(0) : window.hide())
        //A second instance of the application gives its window back
        nw.App.on('open', (): void => this.show())
    }

    /**
     * Show the window again, in front of the others
     */
    public show(): void {
        this.#window?.show()
        this.#window?.restore()
        this.#window?.focus()
    }

    protected async destroy(): Promise<void> {
        this.#window?.removeAllListeners('close').close(true)
    }
}
```

- The window opens the host page of the template (`packages/app/host`), which holds the user interface in a webview. The
  user interface runs isolated from Node.js and from NW.js: it reaches the application through the messages of the host
  page only, the role that the preload script plays in Electron.
- NW.js asks a window to close with its `close` event; once the event is listened to, the window closes only through
  `close(true)`. Here the listener hides it, unless the application is quitting (Cmd+Q on macOS, which passes `'quit'`
  to the listener). `destroy()` removes the listener and closes the window when the application stops.
- `show()` brings the window back, from the menu of the tray or when the application is started a second time
  (`nw.App.on('open')`: NW.js runs a single instance of the application).

**`packages/app/src/components/Tray.ts`**

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Clip, History} from './History.js'
import {MainWindow} from './MainWindow.js'

/**
 * The longest label of a clip in the menu of the tray
 */
const LABEL: number = 40

/**
 * The icon of the application in the tray of the system (the menu bar of macOS, the notification area of Windows):
 * its menu copies one of the latest clips again, shows the window or quits the application
 */
export class Tray extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Inject('history')
    protected readonly history: History

    @Inject('window')
    protected readonly window: MainWindow

    #tray: nw.Tray | undefined

    protected async init(): Promise<void> {
        //The menu bar of macOS shows an icon at its size, without making it smaller: the name of the application stands
        //there instead of the icon (a template image of 22 pixels, black and transparent, would fit)
        this.#tray = new nw.Tray(process.platform === 'darwin' ? {title: this.app.appName} : {icon: 'resources/logo.png', tooltip: this.app.appName})
        this.update()
        this.history.on('changed', (): void => this.update())
    }

    /**
     * Make the menu again, from the latest clips
     */
    protected update(): void {
        const menu: nw.Menu = new nw.Menu()
        for (const clip of this.history.list().slice(0, 5)) {
            menu.append(new nw.MenuItem({label: this.label(clip), click: (): unknown => this.history.copy(clip.id)}))
        }
        menu.append(new nw.MenuItem({type: 'separator'}))
        menu.append(new nw.MenuItem({label: 'Show the history', click: (): void => this.window.show()}))
        menu.append(new nw.MenuItem({label: 'Quit', click: (): unknown => this.app.exit(0)}))
        this.#tray!.menu = menu
    }

    /**
     * The label of a clip: its first line, shortened
     * @param clip
     */
    protected label(clip: Clip): string {
        const line: string = clip.text.trim().split('\n')[0]
        return `${clip.pinned ? '★ ' : ''}${line.length > LABEL ? `${line.slice(0, LABEL - 1)}…` : line}`
    }

    protected async destroy(): Promise<void> {
        this.#tray?.remove()
    }
}
```

- The menu of the tray lists the five latest clips; choosing one copies it to the clipboard again. The component makes
  the menu again whenever the history emits `changed`.
- **Quit** calls `this.app.exit(0)`: the application stops gracefully, its components destroyed in turn
  ([Application](../Application.md), section 3), the icon removed from the tray and the window closed.
- On Windows, the notification area shows the icon of the application made smaller. The menu bar of macOS shows an icon
  at its size (the 512 pixels of `logo.png`), so the name of the application stands there instead. NW.js recommends
  creating the tray in the background script, which lasts as long as the application: a tray created by a page stops
  working when the page navigates.

The types of the template describe what it uses of the API of NW.js. They gain the `close` event and `hide()` of a
window, `nw.App.dataPath`, the clipboard, the tray and its menu:

**`packages/app/src/nw.d.ts`**

```typescript
/**
 * What the application uses of the API of NW.js (the global nw of its background script): https://docs.nwjs.io
 */
declare namespace nw {

    /**
     * A window of NW.js
     */
    interface Window {
        on(event: 'closed' | 'loaded' | 'focus' | 'blur' | 'minimize' | 'restore', listener: () => void): this
        /**
         * The window is asked to close: by the user, or with quit when the application quits (Cmd+Q on macOS). Listened
         * to, it closes only through close(true)
         * @param event
         * @param listener
         */
        on(event: 'close', listener: (reason?: 'quit') => void): this
        removeAllListeners(event?: string): this
        show(): void
        hide(): void
        focus(): void
        restore(): void
        /**
         * Close the window: with true, without its close event
         * @param force
         */
        close(force?: boolean): void
    }

    /**
     * The options of a window: https://docs.nwjs.io/References/Manifest%20Format/#window-subfields
     */
    interface WindowOptions {
        title?: string
        width?: number
        height?: number
        icon?: string
        show?: boolean
        [option: string]: unknown
    }

    /**
     * The clipboard of the system: https://docs.nwjs.io/References/Clipboard/
     */
    interface Clipboard {
        get(type?: 'text' | 'html' | 'rtf' | 'png' | 'jpeg'): string
        set(data: string, type?: 'text' | 'html' | 'rtf' | 'png' | 'jpeg'): void
    }

    /**
     * An item of a menu: https://docs.nwjs.io/References/MenuItem/
     */
    class MenuItem {
        constructor(options: {label?: string, type?: 'normal' | 'separator', enabled?: boolean, click?: () => void})
    }

    /**
     * A menu: https://docs.nwjs.io/References/Menu/
     */
    class Menu {
        append(item: MenuItem): void
    }

    /**
     * An icon in the tray of the system (the menu bar of macOS, the notification area of Windows):
     * https://docs.nwjs.io/References/Tray/
     */
    class Tray {
        constructor(options: {title?: string, tooltip?: string, icon?: string})
        menu: Menu
        remove(): void
    }

    const App: {
        /**
         * The arguments of the application, after the directory of the application
         */
        readonly argv: string[]
        /**
         * The directory of the data of the application, in the one of the user
         */
        readonly dataPath: string
        /**
         * Quit the application
         */
        quit(): void
        /**
         * A second instance of the application started: its command line given to the first one
         * @param event
         * @param listener
         */
        on(event: 'open', listener: (commandLine: string) => void): void
    }

    const Window: {
        /**
         * Open a window: its URL relative to the directory of the application
         * @param url
         * @param options
         * @param callback
         */
        open(url: string, options: WindowOptions, callback: (window: nw.Window) => void): void
    }

    const Clipboard: {
        /**
         * The clipboard
         */
        get(): Clipboard
    }
}
```

## 7. The options of the application

**`packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {nwjsServiceEntrypoint} from 'lakutata/adapter/nwjs'
import path from 'node:path'
import {type ClipboardAccess, History} from '../components/History.js'
import {MainWindow} from '../components/MainWindow.js'
import {Tray} from '../components/Tray.js'
import {ClipController} from '../controllers/ClipController.js'

export type ConfigOptions = {
    /**
     * The clipboard read and written, the one of NW.js in the application (the tests give theirs)
     */
    clipboard: ClipboardAccess
    /**
     * The directory of the data of the application, where the history is kept
     */
    dataPath: string
    /**
     * How often the clipboard is read, in milliseconds (500 by default)
     */
    interval?: number
    /**
     * The clips kept, the pinned ones aside (50 by default)
     */
    limit?: number
    /**
     * The URL of the user interface in development (the dev server of Vite), its built files otherwise
     */
    ui?: string
    mode?: 'development' | 'production'
    /**
     * Open the window and the icon in the tray, true by default (the tests serve the actions without them)
     */
    window?: boolean
    /**
     * The global object the bridge of the actions is put on, the one of NW.js by default (the tests give theirs)
     */
    global?: object
    /**
     * The port of an HTTP entrypoint for development, none by default. Tools (Postman, curl) invoke the actions with
     * POST / and the message (the pattern and the input), receive the events pushed to them with GET /events
     * (Server-Sent Events), and give their client id in the id header (or the id query parameter)
     */
    devPort?: number
}

/**
 * The options of the application
 * @param options
 */
export function config(options: ConfigOptions): ApplicationOptions {
    return {
        id: 'clips',
        name: 'Clips',
        mode: options.mode ?? 'development',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [ClipController],
                //The user interface invokes the actions through the host page of the window: window.ipc.invoke({cmd: 'clips.list'})
                service: [
                    nwjsServiceEntrypoint({global: options.global}),
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            }),
            history: {
                class: History,
                clipboard: options.clipboard,
                file: path.join(options.dataPath, 'history.json'),
                interval: options.interval,
                limit: options.limit
            },
            ...(options.window === false ? {} : {
                window: {
                    class: MainWindow,
                    ui: options.ui
                },
                tray: {
                    class: Tray
                }
            })
        },
        //The actions are served before the window loads the user interface; the history reads the clipboard from the
        //start, the window hidden too
        bootstrap: options.window === false ? ['entrypoint', 'history'] : ['entrypoint', 'history', 'window', 'tray']
    }
}
```

The options of `history` are those of the component: the clipboard, the file (`history.json` in the data directory) and
the interval and the limit, which take their default values when they are `undefined`. Without a window
(`window: false`, the tests), there is no tray either: the components that need NW.js are left out, and the actions are
served through the global object that the tests give.

## 8. The background script

**`packages/app/src/App.ts`**

```typescript
import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

/**
 * The URL of the user interface in development (--ui=<url>, the dev server of Vite), given to lakutata nwjs run
 */
const ui: string | undefined = nw.App.argv.find((argument: string): boolean => argument.startsWith('--ui='))?.slice('--ui='.length)

/**
 * The application runs in the NW.js of the development (lakutata nwjs run: the sdk flavor, with the DevTools), in the
 * normal one once installed
 */
const development: boolean = process.versions['nw-flavor'] === 'sdk'

/**
 * The clipboard of the system, through NW.js
 */
const clipboard: nw.Clipboard = nw.Clipboard.get()

//NW.js runs a single instance of the application: a second one exits, and the first one brings its window to the front
Application
    .run(config({
        clipboard: {read: (): string => clipboard.get('text'), write: (text: string): void => clipboard.set(text, 'text')},
        //The directory of the data of NW.js for the application, in the one of the user
        dataPath: nw.App.dataPath,
        ui: ui,
        mode: development ? 'development' : 'production',
        //The actions served to the tools in development (Postman, curl), not by the installed application
        devPort: development ? Number(process.env.DEV_PORT ?? 9000) : undefined
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => {
        log.error('The application cannot start: %s', error.message)
        process.exit(1)
    })
```

Two options are added to the `App.ts` of the template: `clipboard`, the clipboard of NW.js (`nw.Clipboard.get()`) read
and written as text, and `dataPath`, the data directory that NW.js gives the application (`nw.App.dataPath`). That
directory is named after the `appId` of `lakutata.installer` in `packages/app/package.json` (`clips`), in development as
in the installed application: `~/Library/Application Support/clips/Default` on macOS, `%LOCALAPPDATA%\clips` on Windows
and `~/.config/clips` on Linux.

The host page and the bridge of the template (`packages/app/host`, `packages/ui/src/ipc.ts`) stay as they are: they give
the user interface the actions and the events of the application, and nothing else from NW.js or Node.js.

## 9. The user interface

**`packages/ui/src/App.tsx`**

```tsx
import {useCallback, useEffect, useState} from 'react'

/**
 * A clip of the history, as the actions give it
 */
type Clip = { id: string, text: string, copiedAt: string, pinned: boolean }

export function App() {
    const [query, setQuery] = useState<string>('')
    const [clips, setClips] = useState<Clip[]>([])
    const [failure, setFailure] = useState<string>('')

    const load = useCallback((): void => {
        window.ipc.invoke<Clip[]>({cmd: 'clips.list', query: query || undefined})
            .then((loaded: Clip[]): void => setClips(loaded))
            .catch((error: Error): void => setFailure(error.message))
    }, [query])

    useEffect((): () => void => {
        load()
        //The history changed: a copy, here or from the tray
        window.ipc.on('clips.changed', load)
        return (): void => {
            window.ipc.off('clips.changed', load)
        }
    }, [load])

    /**
     * Invoke an action on the history, which pushes its change
     * @param data
     */
    const act = (data: Record<string, unknown>): void => {
        window.ipc.invoke(data).catch((error: Error): void => setFailure(error.message))
    }

    return (
        <main>
            <input type="search" placeholder="Search the history" value={query} onChange={(event): void => setQuery(event.target.value)}/>
            <button onClick={(): void => act({cmd: 'clips.clear'})}>Clear</button>
            {failure && <p role="alert">{failure}</p>}
            <ul>
                {clips.map((clip: Clip) => (
                    <li key={clip.id}>
                        <pre title={new Date(clip.copiedAt).toLocaleString()}>{clip.text}</pre>
                        <button onClick={(): void => act({cmd: 'clips.copy', id: clip.id})}>Copy</button>
                        <button onClick={(): void => act({cmd: 'clips.pin', id: clip.id, pinned: !clip.pinned})}>{clip.pinned ? 'Unpin' : 'Pin'}</button>
                        <button onClick={(): void => act({cmd: 'clips.delete', id: clip.id})}>Delete</button>
                    </li>
                ))}
            </ul>
        </main>
    )
}
```

- `window.ipc` is the bridge of the template (`packages/ui/src/ipc.ts`): `invoke()` calls an action and gives its
  `payload`, or throws its error; `on()` and `off()` listen to the events pushed by the application.
- The list is loaded again on each `clips.changed`, whatever caused it: a copy in another program, an action of the
  window, or a clip chosen in the menu of the tray.
- The buttons do not change the list themselves: the history pushes its change, and the list follows.

## 10. Run it

```bash
npm run dev
```

The command starts the dev server of Vite, which serves the user interface and reloads it whenever `packages/ui`
changes, and NW.js, whose window loads the user interface with its DevTools open. The application logs
`Clips started in development mode`. Copy a few texts in any program: they appear at the top of the window, and in the
menu of the tray (the name `Clips` in the menu bar of macOS).

In development, the actions are also served over HTTP on port 9000 (`DEV_PORT`), so you can try them with curl or
Postman: `POST /` sends a message, and `GET /events` streams the events of a client as Server-Sent Events
([ServiceCalls](../ServiceCalls.md), section 4). After copying `git log --oneline -5`, then
`https://docs.nwjs.io/References/Tray/`, run in another terminal:

```bash
curl -N 'localhost:9000/events?id=me' &
# event: client
# data: ["me"]

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "clips.list"}'
# {"success":true,"error":null,"payload":[{"id":"89994a65-872a-44f1-bdf2-d44d2ead2748","text":"https://docs.nwjs.io/References/Tray/","copiedAt":"2026-11-03T15:29:26.787Z","pinned":false},{"id":"7de7167d-cfaa-4861-807c-f65ea10b97fc","text":"git log --oneline -5","copiedAt":"2026-11-03T15:29:25.786Z","pinned":false}]}

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "clips.pin", "id": "7de7167d-cfaa-4861-807c-f65ea10b97fc", "pinned": true}'
# {"success":true,"error":null,"payload":{"id":"7de7167d-cfaa-4861-807c-f65ea10b97fc","text":"git log --oneline -5","copiedAt":"2026-11-03T15:29:25.786Z","pinned":true}}
# event: clips.changed
# data: []

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "clips.list", "query": "TRAY"}'
# {"success":true,"error":null,"payload":[{"id":"89994a65-872a-44f1-bdf2-d44d2ead2748","text":"https://docs.nwjs.io/References/Tray/","copiedAt":"2026-11-03T15:29:26.787Z","pinned":false}]}

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "clips.copy", "id": "00000000-0000-4000-8000-000000000000"}'
# {"success":false,"error":{…,"message":"The clip 00000000-0000-4000-8000-000000000000 is not in the history","errMsg":"The clip 00000000-0000-4000-8000-000000000000 is not in the history","err":"ClipNotFoundException","errno":"E_CLIP_NOT_FOUND"},"payload":null}
```

The window shows the pin at once, as the event reached it too. The error carries all the properties of the exception,
including its stack (left out here).

## 11. Test it

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Application} from 'lakutata'
import {NWJS_SERVICE_BRIDGE, type NwjsServiceBridge} from 'lakutata/adapter/nwjs'
import type {Clip} from '../components/History.js'
import {config} from '../config/Config.js'

/**
 * The text of the clipboard of the tests, which the application reads and writes without NW.js
 */
let copied: string = ''

/**
 * The global object of the tests: the actions are invoked through the bridge put on it, as the host page of the window
 * invokes them
 */
const shared: Record<symbol, unknown> = {}

/**
 * Invoke an action as the user interface does (window.ipc.invoke)
 * @param data
 */
function invoke(data: Record<string, unknown>): Promise<any> {
    return (shared[Symbol.for(NWJS_SERVICE_BRIDGE)] as NwjsServiceBridge).invoke(data, 'page')
}

/**
 * The texts of the history, in its order
 */
async function texts(): Promise<string[]> {
    return (await invoke({cmd: 'clips.list'})).payload.map((clip: Clip): string => clip.text)
}

/**
 * Copy a text to the clipboard, as another program does, and wait for the history to read it: the latest clip that is
 * not pinned
 * @param text
 */
async function copy(text: string): Promise<void> {
    copied = text
    const latest = async (): Promise<string | undefined> => (await invoke({cmd: 'clips.list'})).payload.find((clip: Clip): boolean => !clip.pinned)?.text
    for (let attempt: number = 0; await latest() !== text; attempt++) {
        if (attempt === 100) throw new Error(`${text} was not read from the clipboard`)
        await new Promise((resolve): unknown => setTimeout(resolve, 10))
    }
}

describe('Clips', (): void => {

    let app: Application
    let data: string
    const pushed: string[] = []

    before(async (): Promise<void> => {
        data = mkdtempSync(path.join(os.tmpdir(), 'clips-'))
        copied = 'On the clipboard before the application starts'
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config({
                clipboard: {read: (): string => copied, write: (text: string): void => void (copied = text)},
                dataPath: data,
                interval: 10,
                limit: 3,
                window: false,
                global: shared
            })).onLaunched((launched: Application): void => resolve(launched))
        })
        //The page subscribed to the events of the application
        const bridge: NwjsServiceBridge = shared[Symbol.for(NWJS_SERVICE_BRIDGE)] as NwjsServiceBridge
        bridge.subscribe('page', (event: string): unknown => pushed.push(event))
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        rmSync(data, {recursive: true, force: true})
    })

    it('keeps the texts copied, the latest first, but not what the clipboard held at the start', async (): Promise<void> => {
        await copy('git status')
        await copy('npm test')
        assert.deepStrictEqual(await texts(), ['npm test', 'git status'])
        //The window was told
        assert.ok(pushed.includes('clips.changed'))
    })

    it('moves a text copied again to the top, and drops the oldest clips beyond the limit', async (): Promise<void> => {
        await copy('git status')
        await copy('ls -la')
        await copy('pwd')
        assert.deepStrictEqual(await texts(), ['pwd', 'ls -la', 'git status'])
    })

    it('keeps the pinned clips first, beyond the limit', async (): Promise<void> => {
        const [, , oldest] = (await invoke({cmd: 'clips.list'})).payload
        assert.strictEqual((await invoke({cmd: 'clips.pin', id: oldest.id, pinned: true})).payload.pinned, true)
        await copy('make')
        await copy('make install')
        await copy('make clean')
        assert.deepStrictEqual(await texts(), ['git status', 'make clean', 'make install', 'make'])
    })

    it('copies a clip to the clipboard again', async (): Promise<void> => {
        const clips: Clip[] = (await invoke({cmd: 'clips.list', query: 'INSTALL'})).payload
        assert.deepStrictEqual(clips.map((clip: Clip): string => clip.text), ['make install'])
        await invoke({cmd: 'clips.copy', id: clips[0].id})
        assert.strictEqual(copied, 'make install')
        assert.deepStrictEqual(await texts(), ['git status', 'make install', 'make clean', 'make'])
    })

    it('removes a clip, then all of them but the pinned ones', async (): Promise<void> => {
        const [, second] = (await invoke({cmd: 'clips.list'})).payload
        assert.strictEqual((await invoke({cmd: 'clips.delete', id: second.id})).success, true)
        assert.deepStrictEqual(await texts(), ['git status', 'make clean', 'make'])
        await invoke({cmd: 'clips.clear'})
        assert.deepStrictEqual(await texts(), ['git status'])
    })

    it('keeps the history in its file', async (): Promise<void> => {
        await new Promise((resolve): unknown => setTimeout(resolve, 50))
        const saved: Clip[] = JSON.parse(readFileSync(path.join(data, 'history.json'), 'utf8'))
        assert.deepStrictEqual(saved.map((clip: Clip): string => clip.text), ['git status'])
    })

    it('refuses a clip that is not in the history, and an invalid input', async (): Promise<void> => {
        const missing = await invoke({cmd: 'clips.copy', id: '00000000-0000-4000-8000-000000000000'})
        assert.strictEqual(missing.success, false)
        assert.strictEqual(missing.error.errno, 'E_CLIP_NOT_FOUND')
        const invalid = await invoke({cmd: 'clips.pin', id: 'first'})
        assert.strictEqual(invalid.success, false)
        assert.match(invalid.error.message, /id/)
    })
})
```

The tests run the application with Node.js, without NW.js: `window: false` leaves out the window and the tray, the
clipboard is a variable, and the data directory a temporary one. `nwjsServiceEntrypoint` puts its bridge on the global
object it is given (`global: shared`), where the host page of a window finds it in NW.js; the tests call the actions
through it, as the window does, and subscribe to the events of a client. The interval of 10 milliseconds and the limit
of 3 clips keep the tests short.

```bash
npm test
```

```
app │   ✔ keeps the texts copied, the latest first, but not what the clipboard held at the start
app │   ✔ moves a text copied again to the top, and drops the oldest clips beyond the limit
app │   ✔ keeps the pinned clips first, beyond the limit
app │   ✔ copies a clip to the clipboard again
app │   ✔ removes a clip, then all of them but the pinned ones
app │   ✔ keeps the history in its file
app │   ✔ refuses a clip that is not in the history, and an invalid input
app │ ℹ pass 7
✔ test ran in app
```

`npm test` builds the packages, the user interface included, then runs the tests. What needs NW.js, the clipboard of the
system, the tray and the window, is tried out with `npm run dev`.

## 12. Package it

- `npm run package:host` builds the packages, then makes the installers for the platform it runs on, in
  `dist/installer`: a `dmg` on macOS, a `deb` on Linux, an `nsis` installer and a `zip` on Windows.
  `npm run package:linux` makes the Linux ones in Docker, from any platform. They are made by
  `lakutata package installer`, from `lakutata.installer` in `packages/app/package.json`
  ([Installers](../Installers.md)).
- The installed application runs in the normal flavor of NW.js, without the DevTools: its mode is `production` and it
  has no HTTP entrypoint (`devPort` is given only in the sdk flavor of `lakutata nwjs run`).
- The application runs in the version of NW.js given by `lakutata.nwjs` in `packages/app/package.json`;
  `npm run nwjs:use -- <version>` gives it another one, such as `win7`, NW.js 0.72, the last release that runs on
  Windows 7, 8 and 8.1 ([ProjectStructure](../ProjectStructure.md)).

<!--
check:
  create: clips nwjs-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
  run: npm run typecheck -w ui
-->
