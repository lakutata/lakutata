# A desktop application

This example builds a desktop notes application: the notes are Markdown files in a folder that the user chooses, and
the window lists, opens, saves and deletes them. It starts from the `electron-react` template and shows both sides of
an Electron application made with lakutata: the main process, whose actions read and write the files, open a system
dialog and push an event when the folder changes; and the React renderer, which calls these actions over IPC. It also
shows tests of the main process that run without Electron.

| Message | What it does |
|---|---|
| `{cmd: 'folder.get'}` | Gives the notes folder, `null` before one is chosen |
| `{cmd: 'folder.choose'}` | Asks the user for a folder in a system dialog, and remembers it |
| `{cmd: 'notes.list'}` | Lists the notes, the most recently modified first |
| `{cmd: 'notes.read', name: 'Shopping'}` | Gives the text of a note |
| `{cmd: 'notes.save', name: 'Shopping', text: '- bread'}` | Writes a note to the file `Shopping.md` |
| `{cmd: 'notes.delete', name: 'Shopping'}` | Deletes it |
| `{cmd: 'notes.reveal', name: 'Shopping'}` | Shows its file in the file manager (Finder, Explorer…) |

When files in the folder change, the main process pushes the `notes.changed` event to the windows.

## 1. Create the project

```bash
npx @lakutata/cli create --name notes --template electron-react --yes
cd notes
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

The project is a workspace ([ProjectStructure](../ProjectStructure.md)): `packages/app` is the main process, a lakutata
application; `packages/ui` is the renderer, a React page built by Vite; `packages/resources` holds the icon. The
application needs no other package: it reads the files with `node:fs`, and its dialogs come from Electron. The example
controller of the template is removed.

## 2. The input

**`packages/app/src/dtos/NoteDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A note by its name, which is its file name without .md: no slash, and no character that a file system refuses
 */
export class NoteNameDTO extends DTO {
    @Expect(DTO.String().trim().min(1).max(100).pattern(/^[^\\/:*?"<>|]+$/, 'file name').required())
    public name: string
}

/**
 * A note to write
 */
export class SaveNoteDTO extends NoteNameDTO {
    @Expect(DTO.String().allow('').max(1000000).required())
    public text: string
}
```

Each action validates its input with a DTO before it runs ([DTOValidation](../DTOValidation.md)):

- a note is a file `<name>.md` in the folder: the pattern refuses slashes and the characters that Windows does not
  allow in file names, so a name cannot lead out of the folder. The second argument of `.pattern()` names the pattern
  in the error message: `"name" with value "a/b" fails to match the file name pattern`;
- `.allow('')` accepts an empty note;
- a message is JSON, so its values keep their types: no `.strict(false)` is needed, unlike the query string of an HTTP
  request ([ServiceCalls](../ServiceCalls.md), section 2).

## 3. The exceptions

**`packages/app/src/exceptions/NoteExceptions.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * No notes folder has been chosen yet
 */
export class NoFolderException extends Exception {
    public errno: string = 'E_NO_FOLDER'
}

/**
 * The requested note is not in the folder
 */
export class NoteNotFoundException extends Exception {
    public errno: string = 'E_NOTE_NOT_FOUND'
}
```

An exception has an `errno`, the code that the renderer checks ([Exceptions](../Exceptions.md)). Over IPC, the error is
sent with all its properties ([ServiceCalls](../ServiceCalls.md), section 3), so the renderer receives it as it was
thrown: `error.errno` is `'E_NOTE_NOT_FOUND'`. The service transports always answer with an envelope, whatever the
status of the error, so these exceptions need no `statusCode`.

## 4. The notes

**`packages/app/src/components/Notes.ts`**

```typescript
import {Component, DTO} from 'lakutata'
import {type Entrypoint} from 'lakutata/com/entrypoint'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {existsSync, watch, type FSWatcher} from 'node:fs'
import {mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {NoFolderException, NoteNotFoundException} from '../exceptions/NoteExceptions.js'

/**
 * A note of the folder: its name, and when its file was modified
 */
export type NoteInfo = { name: string, modifiedAt: string }

/**
 * The notes: the Markdown files in the folder that the user chose, which the settings of the application remember.
 * Changes to its files, made by the application or by another program, are pushed to the windows (notes.changed)
 */
export class Notes extends Component {

    /**
     * Pushes the events to the windows
     */
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    /**
     * The settings file, where the folder is remembered
     */
    @Configurable(DTO.String().required())
    protected readonly settings: string

    #folder: string | null = null

    #watcher: FSWatcher | undefined

    #timer: NodeJS.Timeout | undefined

    /**
     * The notes folder, null before one is chosen
     */
    public get folder(): string | null {
        return this.#folder
    }

    /**
     * Use the folder remembered in the settings, if it still exists
     */
    protected async init(): Promise<void> {
        const settings: { folder?: string } = await readFile(this.settings, 'utf8').then((text: string) => JSON.parse(text), () => ({}))
        if (settings.folder && existsSync(settings.folder)) this.watch(settings.folder)
    }

    protected async destroy(): Promise<void> {
        clearTimeout(this.#timer)
        this.#watcher?.close()
    }

    /**
     * Watch the files of a folder: their changes are pushed to the windows once they settle
     * @param folder
     */
    protected watch(folder: string): void {
        this.#watcher?.close()
        const watcher: FSWatcher = watch(folder, (): void => {
            clearTimeout(this.#timer)
            this.#timer = setTimeout((): number => this.entrypoint.broadcast('notes.changed'), 100)
        })
        //The folder was removed, or can no longer be read
        watcher.on('error', (): void => watcher.close())
        this.#watcher = watcher
        this.#folder = folder
    }

    /**
     * Use another folder, and remember it
     * @param folder
     */
    public async use(folder: string): Promise<void> {
        this.watch(folder)
        await mkdir(path.dirname(this.settings), {recursive: true})
        await writeFile(this.settings, JSON.stringify({folder: folder}))
    }

    /**
     * The file of a note
     * @param name
     */
    protected file(name: string): string {
        if (!this.#folder) throw new NoFolderException('No folder of notes is chosen')
        return path.join(this.#folder, `${name}.md`)
    }

    /**
     * The file of an existing note
     * @param name
     */
    public find(name: string): string {
        const file: string = this.file(name)
        if (!existsSync(file)) throw new NoteNotFoundException(`The note ${name} does not exist`)
        return file
    }

    /**
     * The notes, the most recently modified first
     */
    public async list(): Promise<NoteInfo[]> {
        if (!this.#folder) return []
        const notes: NoteInfo[] = []
        for (const entry of await readdir(this.#folder, {withFileTypes: true})) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue
            const modified: Date = (await stat(path.join(this.#folder, entry.name))).mtime
            notes.push({name: entry.name.slice(0, -'.md'.length), modifiedAt: modified.toISOString()})
        }
        return notes.sort((a: NoteInfo, b: NoteInfo): number => b.modifiedAt.localeCompare(a.modifiedAt))
    }

    /**
     * The text of a note
     * @param name
     */
    public async read(name: string): Promise<string> {
        return await readFile(this.find(name), 'utf8')
    }

    /**
     * Write a note, new or existing
     * @param name
     * @param text
     */
    public async write(name: string, text: string): Promise<NoteInfo> {
        const file: string = this.file(name)
        await writeFile(file, text)
        return {name: name, modifiedAt: (await stat(file)).mtime.toISOString()}
    }

    /**
     * Delete a note
     * @param name
     */
    public async remove(name: string): Promise<void> {
        await rm(this.find(name))
    }
}
```

- A component is created once and shared by the whole application ([Objects](../Objects.md)). It keeps the folder,
  which outlives the requests: a controller lives for one request only ([Controllers](../Controllers.md), section 2).
- `settings`, the file where the folder is remembered, is an option of the component: `@Configurable` declares it, and
  the options of the application give its value ([Injection](../Injection.md)). `init()` reads the file when the
  application starts.
- `watch()` from `node:fs` watches the folder. When its files change, whether the application or another program (an
  editor, a sync tool) saved them, `this.entrypoint.broadcast()` pushes `notes.changed` to every window
  ([ServiceCalls](../ServiceCalls.md), section 5). The timer waits for the changes to settle, as one save often causes
  several of them.
- `destroy()` stops watching when the application stops.

## 5. The controller

**`packages/app/src/controllers/NoteController.ts`**

```typescript
import {Controller, type ServiceContext} from 'lakutata/com/entrypoint'
import {ipcEventOfContext} from 'lakutata/adapter/electron'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import type {BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue} from 'electron'
import {type NoteInfo, Notes} from '../components/Notes.js'
import {NoteNameDTO, SaveNoteDTO} from '../dtos/NoteDTO.js'

/**
 * The note actions, invoked by the window: window.ipc.invoke({cmd: 'notes.list'})
 */
export class NoteController extends Controller {

    @Inject('notes')
    protected readonly notes: Notes

    /**
     * The notes folder, null before one is chosen
     */
    @ServiceAction({cmd: 'folder.get'})
    public async folder(): Promise<string | null> {
        return this.notes.folder
    }

    /**
     * Ask the user for a folder in a system dialog, attached to the window that called; the folder stays the same when
     * the dialog is canceled
     */
    @ServiceAction({cmd: 'folder.choose'})
    public async choose(): Promise<string | null> {
        //Electron is loaded by the actions that use it: the tests, run by Node.js, do not invoke them
        const {BrowserWindow, dialog} = (await import('electron')).default
        const event: IpcMainInvokeEvent | undefined = ipcEventOfContext<IpcMainInvokeEvent>(this.context as ServiceContext)
        const window: BrowserWindow | null = event ? BrowserWindow.fromWebContents(event.sender) : null
        const options: OpenDialogOptions = {title: 'The folder of the notes', properties: ['openDirectory', 'createDirectory']}
        const result: OpenDialogReturnValue = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
        if (!result.canceled && result.filePaths.length) await this.notes.use(result.filePaths[0])
        return this.notes.folder
    }

    /**
     * The notes, the most recently modified first
     */
    @ServiceAction({cmd: 'notes.list'})
    public async list(): Promise<NoteInfo[]> {
        return await this.notes.list()
    }

    /**
     * A note and its text
     * @param input
     */
    @ServiceAction({cmd: 'notes.read'}, NoteNameDTO)
    public async read(input: NoteNameDTO): Promise<{ name: string, text: string }> {
        return {name: input.name, text: await this.notes.read(input.name)}
    }

    /**
     * Write a note: the file <name>.md in the folder
     * @param input
     */
    @ServiceAction({cmd: 'notes.save'}, SaveNoteDTO)
    public async save(input: SaveNoteDTO): Promise<NoteInfo> {
        return await this.notes.write(input.name, input.text)
    }

    /**
     * Delete a note
     * @param input
     */
    @ServiceAction({cmd: 'notes.delete'}, NoteNameDTO)
    public async remove(input: NoteNameDTO): Promise<void> {
        await this.notes.remove(input.name)
    }

    /**
     * Show the file of a note in the system file manager (Finder, Explorer…)
     * @param input
     */
    @ServiceAction({cmd: 'notes.reveal'}, NoteNameDTO)
    public async reveal(input: NoteNameDTO): Promise<void> {
        const {shell} = (await import('electron')).default
        shell.showItemInFolder(this.notes.find(input.name))
    }
}
```

- Each `@ServiceAction` is called by a message: `{cmd: 'notes.save', name: 'Shopping', text: '- bread'}` calls `save()`
  with `{name: 'Shopping', text: '- bread'}`, validated by `SaveNoteDTO` ([ServiceCalls](../ServiceCalls.md),
  section 2). The actions are short: the work is done by the `notes` component, which the controller injects.
- `folder.choose` and `notes.reveal` use APIs that only the main process has: `dialog` and `shell`. Like the
  `MainWindow` of the template, they import Electron only when they run, so the tests, which run with Node.js, never
  load it.
- `ipcEventOfContext()` gives the IPC event of the request. Its `sender` is the page that called, and
  `BrowserWindow.fromWebContents()` gives the window of that page, which the dialog belongs to (on macOS, a sheet
  attached to the window). When the action is called over the HTTP entrypoint for development (section 9), there is no
  IPC event, and the dialog belongs to no window.
- An action that returns nothing, such as `remove()`, answers `{success: true, error: null}`.

## 6. The options of the application

**`packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {electronIPCServiceEntrypoint, type IPCMain} from 'lakutata/adapter/electron'
import {MainWindow} from '../components/MainWindow.js'
import {Notes} from '../components/Notes.js'
import {NoteController} from '../controllers/NoteController.js'

export type ConfigOptions = {
    /**
     * The settings file, where the notes folder is remembered
     */
    settings: string
    /**
     * The directory of the main process, where the preload script and the built renderer are
     */
    directory?: string
    /**
     * The URL of the renderer in development (the Vite dev server); without it, the built renderer is loaded
     */
    renderer?: string
    mode?: 'development' | 'production'
    /**
     * Whether to open the window, true by default (the tests serve the actions without a window)
     */
    window?: boolean
    /**
     * The ipcMain that serves the actions, Electron's by default (the tests pass their own)
     */
    ipcMain?: IPCMain
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
        id: 'notes',
        name: 'notes',
        mode: options.mode ?? 'development',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [NoteController],
                //The renderer invokes the actions over IPC: window.ipc.invoke({cmd: 'notes.list'})
                service: [
                    electronIPCServiceEntrypoint({ipcMain: options.ipcMain}),
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            }),
            notes: {
                class: Notes,
                settings: options.settings
            },
            ...(options.window === false ? {} : {
                window: {
                    class: MainWindow,
                    directory: options.directory,
                    renderer: options.renderer
                }
            })
        },
        //The actions are served, and the folder watched, before the window loads the renderer
        bootstrap: options.window === false ? ['entrypoint', 'notes'] : ['entrypoint', 'notes', 'window']
    }
}
```

This is the `Config.ts` of the template, with:

- the required `settings` option, the settings file;
- the `notes` component, which receives that file, and the `NoteController` instead of the example controller;
- `bootstrap: ['entrypoint', 'notes', 'window']`: the actions are served and the folder is watched before the window
  loads the renderer. The tests start the application without its window (`window: false`), with their own `ipcMain`.

## 7. The main process

**`packages/app/src/App.ts`**

```typescript
import {Application, resourcesPath, type ILogger} from 'lakutata'
import electron from 'electron'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {config} from './config/Config.js'

/**
 * The directory of the preload script and of the built renderer: the resources of the packaged application
 * (lakutata.resources), or in development the directory of the main process (build/, with the renderer from the ui
 * package)
 */
const directory: string = resourcesPath() ?? path.dirname(fileURLToPath(import.meta.url))

/**
 * The URL of the renderer in development (--renderer=<url>, the Vite dev server)
 */
const renderer: string | undefined = process.argv.find((argument: string): boolean => argument.startsWith('--renderer='))?.slice('--renderer='.length)

//A single instance of the application: a second one exits, and the first one brings its window to the front
if (!electron.app.requestSingleInstanceLock()) {
    electron.app.exit(0)
} else {
    Application
        .run(config({
            //The notes folder is remembered in the data directory of the application
            settings: path.join(electron.app.getPath('userData'), 'settings.json'),
            directory: directory,
            renderer: renderer,
            mode: electron.app.isPackaged ? 'production' : 'development',
            //In development, the actions are also served to tools (Postman, curl); the packaged application does not serve them
            devPort: electron.app.isPackaged ? undefined : Number(process.env.DEV_PORT ?? 9000)
        }))
        .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
        .onFatalException((error: Error, log: ILogger): void => {
            log.error('The application cannot start: %s', error.message)
            electron.app.exit(1)
        })
}
```

One option is added to the `App.ts` of the template: `settings`, the file that remembers the notes folder, in the data
directory of the application (`app.getPath('userData')`). That directory is named after the `productName` of
`packages/app/package.json` (`notes`), in development as in the packaged application:
`~/Library/Application Support/notes` on macOS, `%APPDATA%\notes` on Windows and `~/.config/notes` on Linux.

The preload script of the template (`packages/app/src/preload.cts`) stays as it is: it gives the renderer the IPC
channel for the actions and the events, and nothing else from Electron or Node.js.

## 8. The window

**`packages/ui/src/App.tsx`**

```tsx
import {type FormEvent, type KeyboardEvent, useEffect, useState} from 'react'

/**
 * A note of the folder, as the main process lists it
 */
type NoteInfo = { name: string, modifiedAt: string }

export function App() {
    const [folder, setFolder] = useState<string | null>(null)
    const [notes, setNotes] = useState<NoteInfo[]>([])
    const [current, setCurrent] = useState<string | null>(null)
    const [text, setText] = useState<string>('')
    const [newName, setNewName] = useState<string>('')
    const [status, setStatus] = useState<string>('')

    //Run an action of the main process; its error (a note not found, an invalid name) is shown under the note
    const run = (action: () => Promise<void>): void => {
        action().catch((error: Error): void => setStatus(error.message))
    }
    const list = (): void => run(async (): Promise<void> => setNotes(await window.ipc.invoke<NoteInfo[]>({cmd: 'notes.list'})))

    useEffect((): () => void => {
        run(async (): Promise<void> => setFolder(await window.ipc.invoke<string | null>({cmd: 'folder.get'})))
        //Pushed by the main process when files in the folder change, whether saved here or by another program
        window.ipc.on('notes.changed', list)
        return (): void => {
            window.ipc.off('notes.changed', list)
        }
    }, [])

    useEffect((): void => {
        if (folder) list()
    }, [folder])

    const choose = (): void => run(async (): Promise<void> => setFolder(await window.ipc.invoke<string | null>({cmd: 'folder.choose'})))

    const open = (name: string): void => run(async (): Promise<void> => {
        const note = await window.ipc.invoke<{ name: string, text: string }>({cmd: 'notes.read', name: name})
        setCurrent(note.name)
        setText(note.text)
        setStatus('')
    })

    const create = (event: FormEvent): void => {
        event.preventDefault()
        run(async (): Promise<void> => {
            await window.ipc.invoke({cmd: 'notes.save', name: newName, text: ''})
            setCurrent(newName.trim())
            setText('')
            setNewName('')
            setStatus('')
        })
    }

    const save = (): void => run(async (): Promise<void> => {
        await window.ipc.invoke({cmd: 'notes.save', name: current, text: text})
        setStatus(`Saved at ${new Date().toLocaleTimeString()}`)
    })

    const remove = (): void => run(async (): Promise<void> => {
        await window.ipc.invoke({cmd: 'notes.delete', name: current})
        setCurrent(null)
        setStatus('')
    })

    //Ctrl+S, or Cmd+S on macOS
    const shortcut = (event: KeyboardEvent): void => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault()
            save()
        }
    }

    if (!folder) {
        return (
            <main style={{fontFamily: 'system-ui', padding: 32}}>
                <p>The notes are Markdown files, in a folder of your choice.</p>
                <button onClick={choose}>Choose a folder…</button>
                <p>{status}</p>
            </main>
        )
    }

    return (
        <main style={{fontFamily: 'system-ui', position: 'fixed', inset: 0, display: 'grid', gridTemplateColumns: '240px 1fr'}}>
            <aside style={{borderRight: '1px solid #ddd', padding: 12, overflow: 'auto'}}>
                <button onClick={choose} title={folder} style={{width: '100%'}}>{folder.split(/[\\/]/).pop()}</button>
                <form onSubmit={create}>
                    <input value={newName} onChange={(event): void => setNewName(event.target.value)} placeholder="New note" style={{width: '100%', margin: '12px 0', boxSizing: 'border-box'}}/>
                </form>
                {notes.map((note: NoteInfo) => (
                    <div key={note.name} onClick={(): void => open(note.name)} style={{padding: 6, cursor: 'pointer', fontWeight: note.name === current ? 'bold' : 'normal'}}>
                        {note.name}
                        <div style={{fontSize: 11, color: '#888'}}>{new Date(note.modifiedAt).toLocaleString()}</div>
                    </div>
                ))}
            </aside>
            <section style={{display: 'flex', flexDirection: 'column', padding: 12, gap: 8}}>
                {current === null ? <p>Open a note, or create one.</p> : (
                    <>
                        <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                            <strong style={{flex: 1}}>{current}</strong>
                            <button onClick={save}>Save</button>
                            <button onClick={(): void => run(() => window.ipc.invoke({cmd: 'notes.reveal', name: current}))}>Show in folder</button>
                            <button onClick={remove}>Delete</button>
                        </div>
                        <textarea value={text} onChange={(event): void => setText(event.target.value)} onKeyDown={shortcut} style={{flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 14}}/>
                    </>
                )}
                <small style={{color: '#888'}}>{status}</small>
            </section>
        </main>
    )
}
```

- `window.ipc` comes from the template (`packages/ui/src/ipc.ts`), through the preload script. `invoke()` sends a
  message and returns the result of the action, or throws its error, `errno` included; `on()` and `off()` listen to
  the events of the main process ([ServiceCalls](../ServiceCalls.md), section 4).
- The renderer is isolated from Node.js and Electron: it reads no files and opens no dialogs itself, but calls the
  actions that do.
- On `notes.changed`, it lists the notes again: a note saved by an editor appears in the window.
- Errors, such as an invalid name, are shown under the note.

## 9. Run it

```bash
npm run dev
```

The command starts the Vite dev server, which serves the renderer and reloads it whenever `packages/ui` changes, and
Electron, whose window loads the renderer with its DevTools open. The main process logs
`notes started in development mode`. The first time, the window asks you to choose a folder; after that, it opens the
folder remembered in the settings.

In development, the actions are also served over HTTP on port 9000 (`DEV_PORT`), so you can try them with curl or
Postman: `POST /` sends a message, and `GET /events` streams the events of a client as Server-Sent Events
([ServiceCalls](../ServiceCalls.md), section 4). Once a folder is chosen in the window (here, one that already holds a
note `Ideas`), run in another terminal:

```bash
curl -N 'localhost:9000/events?id=me' &
# event: client
# data: ["me"]

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "notes.save", "name": "Shopping", "text": "- bread\n- tea\n"}'
# {"success":true,"error":null,"payload":{"name":"Shopping","modifiedAt":"2026-10-17T14:57:41.391Z"}}
# event: notes.changed
# data: []

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "notes.list"}'
# {"success":true,"error":null,"payload":[{"name":"Shopping","modifiedAt":"2026-10-17T14:57:41.391Z"},{"name":"Ideas","modifiedAt":"2026-10-17T14:57:23.287Z"}]}

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "notes.read", "name": "Lunch"}'
# {"success":false,"error":{…,"message":"The note Lunch does not exist","errMsg":"The note Lunch does not exist","err":"NoteNotFoundException","errno":"E_NOTE_NOT_FOUND"},"payload":null}
```

The window shows the new note at once, as the event reached it too. The error carries all the properties of the
exception, including its stack (left out here).

## 10. Test it

The test of the template is replaced by a test of the notes. Like the test of the template, it runs the main process
with Node.js, without Electron or a window: its own `ipcMain` stands in for Electron's, and the test calls the actions
through it as the renderer does. The settings of the test remember a folder in a temporary directory.

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Application} from 'lakutata'
import type {IPCMain} from 'lakutata/adapter/electron'
import {config} from '../config/Config.js'

/**
 * The ipcMain of the tests: through it, the actions are invoked as the renderer invokes them, without Electron
 */
const handlers: Map<string, (event: unknown, data: unknown) => Promise<unknown>> = new Map()
const listeners: Map<string, (event: unknown, clientId: string) => void> = new Map()
const ipcMain: IPCMain = {
    handle: (channel: string, listener: (event: unknown, data: unknown) => Promise<unknown>): unknown => handlers.set(channel, listener),
    removeHandler: (channel: string): unknown => handlers.delete(channel),
    on: (channel: string, listener: (event: unknown, clientId: string) => void): unknown => listeners.set(channel, listener),
    removeAllListeners: (channel: string): unknown => listeners.delete(channel)
}
//The web contents of the renderer, which collects the events pushed to it
const received: unknown[][] = []
const sender = {once: (): void => undefined, off: (): void => undefined, send: (...args: unknown[]): unknown => received.push(args)}

/**
 * Invoke an action as the renderer does (window.ipc.invoke)
 * @param data
 */
function invoke(data: Record<string, unknown>): Promise<any> {
    return (handlers.get('lakutata:service') as (event: unknown, data: unknown, clientId: string) => Promise<unknown>)({sender: sender}, data, 'page')
}

/**
 * Wait until a condition holds, 5 seconds at most
 * @param condition
 */
async function until(condition: () => boolean): Promise<void> {
    for (let waited: number = 0; !condition(); waited += 50) {
        if (waited >= 5000) throw new Error('Waited too long')
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
    }
}

describe('notes', (): void => {

    //The data directory of the application, and the notes folder that its settings remember
    const data: string = mkdtempSync(path.join(tmpdir(), 'notes-'))
    const folder: string = path.join(data, 'My notes')
    let app: Application

    before(async (): Promise<void> => {
        mkdirSync(folder)
        writeFileSync(path.join(data, 'settings.json'), JSON.stringify({folder: folder}))
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config({settings: path.join(data, 'settings.json'), window: false, ipcMain: ipcMain})).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        rmSync(data, {recursive: true, force: true})
    })

    it('gives the folder remembered by the settings', async (): Promise<void> => {
        assert.deepStrictEqual(await invoke({cmd: 'folder.get'}), {success: true, error: null, payload: folder})
    })

    it('pushes notes.changed to the renderer when the files of the folder change', async (): Promise<void> => {
        //The page subscribes to the events
        listeners.get('lakutata:service:subscribe')!({sender: sender}, 'page')
        //Another program writes a note
        writeFileSync(path.join(folder, 'Ideas.md'), '# Ideas\n')
        await until((): boolean => received.length > 0)
        assert.deepStrictEqual(received[0], ['lakutata:service:event', 'notes.changed', []])
    })

    it('saves, lists, reads and deletes the notes', async (): Promise<void> => {
        const saved = await invoke({cmd: 'notes.save', name: 'Shopping', text: '- bread\n- tea\n'})
        assert.strictEqual(saved.payload.name, 'Shopping')
        assert.strictEqual(readFileSync(path.join(folder, 'Shopping.md'), 'utf8'), '- bread\n- tea\n')
        const listed = await invoke({cmd: 'notes.list'})
        assert.deepStrictEqual(listed.payload.map((note: { name: string }): string => note.name), ['Shopping', 'Ideas'])
        assert.deepStrictEqual((await invoke({cmd: 'notes.read', name: 'Shopping'})).payload, {name: 'Shopping', text: '- bread\n- tea\n'})
        assert.strictEqual((await invoke({cmd: 'notes.delete', name: 'Shopping'})).success, true)
        assert.strictEqual(existsSync(path.join(folder, 'Shopping.md')), false)
    })

    it('refuses a note that does not exist', async (): Promise<void> => {
        const response = await invoke({cmd: 'notes.read', name: 'Missing'})
        assert.strictEqual(response.success, false)
        assert.strictEqual(response.error.errno, 'E_NOTE_NOT_FOUND')
    })

    it('refuses a name that is not a file name', async (): Promise<void> => {
        const response = await invoke({cmd: 'notes.save', name: '../outside', text: ''})
        assert.strictEqual(response.success, false)
        assert.match(response.error.message, /file name/)
        assert.strictEqual(existsSync(path.join(data, 'outside.md')), false)
    })
})
```

```bash
npm test
```

```
app │   ✔ gives the folder remembered by the settings
app │   ✔ pushes notes.changed to the renderer when the files of the folder change
app │   ✔ saves, lists, reads and deletes the notes
app │   ✔ refuses a note that does not exist
app │   ✔ refuses a name that is not a file name
app │ ℹ pass 5
✔ test ran in app
```

`npm test` builds the packages, the renderer included, then runs the tests. The two actions that use Electron, the
dialog and the file manager, are tried out in the window.

## 11. Package it

- `npm run package:host` builds the packages, then makes the installers for the platform it runs on, in
  `dist/installer`: a `dmg` on macOS, a `deb` on Linux, an `nsis` installer and a portable executable on Windows.
  `npm run package:linux` makes the Linux ones in Docker, from any platform. They are made by electron-builder, from
  `lakutata.installer` in `packages/app/package.json` ([Installers](../Installers.md), section 8).
- The main process is bundled with its dependencies. The built renderer and the preload script go into the resources of
  Electron (`lakutata.resources` in `packages/app/package.json`), where `resourcesPath()` finds them
  ([Packaging](../Packaging.md), section 6).
- The packaged application has no HTTP entrypoint (`devPort` is given only when `app.isPackaged` is false), and keeps
  its settings in the same data directory.

<!--
check:
  create: notes electron-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
  run: npm run typecheck -w ui
-->
