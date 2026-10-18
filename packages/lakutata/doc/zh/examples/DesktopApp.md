# 桌面应用

这个示例构建一个桌面笔记应用：笔记是用户所选文件夹中的 Markdown 文件，应用窗口可以列出、打开、保存和删除笔记。它从 `electron-react` 模板开始，展示用 lakutata 开发的 Electron 应用的两部分：一是主进程，它的动作负责读写文件、打开系统对话框，并在文件夹变化时推送事件；二是 React 渲染进程，它通过 IPC 调用这些动作。示例还展示了主进程的测试，测试不需要 Electron 就能运行。

| 消息 | 作用 |
|---|---|
| `{cmd: 'folder.get'}` | 返回笔记文件夹，还没选择时为 `null` |
| `{cmd: 'folder.choose'}` | 用系统对话框让用户选择文件夹，并记住它 |
| `{cmd: 'notes.list'}` | 列出笔记，最近修改的排在前面 |
| `{cmd: 'notes.read', name: 'Shopping'}` | 返回一条笔记的文本 |
| `{cmd: 'notes.save', name: 'Shopping', text: '- bread'}` | 把笔记写入文件 `Shopping.md` |
| `{cmd: 'notes.delete', name: 'Shopping'}` | 删除笔记 |
| `{cmd: 'notes.reveal', name: 'Shopping'}` | 在文件管理器（Finder、资源管理器等）中显示笔记文件 |

文件夹中的文件有变化时，主进程会向窗口推送 `notes.changed` 事件。

## 1. 创建项目

```bash
npx @lakutata/cli create --name notes --template electron-react --yes
cd notes
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

项目是一个工作区（见 [ProjectStructure](../ProjectStructure.md)）：`packages/app` 是主进程，也是一个 lakutata 应用；`packages/ui` 是渲染进程，即由 Vite 构建的 React 页面；`packages/resources` 存放图标。应用不需要安装其他包：文件用 `node:fs` 读写，对话框由 Electron 提供。这里删掉了模板中的示例控制器。

## 2. 输入

**`packages/app/src/dtos/NoteDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 按名称指定的笔记，名称就是文件名去掉 .md：不能有斜杠，也不能有文件系统不接受的字符
 */
export class NoteNameDTO extends DTO {
    @Expect(DTO.String().trim().min(1).max(100).pattern(/^[^\\/:*?"<>|]+$/, 'file name').required())
    public name: string
}

/**
 * 要写入的笔记
 */
export class SaveNoteDTO extends NoteNameDTO {
    @Expect(DTO.String().allow('').max(1000000).required())
    public text: string
}
```

每个动作在运行前都会用 DTO 校验输入（见 [DTOValidation](../DTOValidation.md)）：

- 笔记就是文件夹中的 `<name>.md` 文件：这个模式不允许斜杠，也不允许 Windows 文件名中禁用的字符，所以名称无法指向文件夹之外。`.pattern()` 的第二个参数是这个模式在错误消息中显示的名字：`"name" with value "a/b" fails to match the file name pattern`；
- `.allow('')` 允许空笔记；
- 消息是 JSON，值会保留各自的类型，所以不需要像 HTTP 请求的查询字符串那样使用 `.strict(false)`（见 [ServiceCalls](../ServiceCalls.md) 第 2 节）。

## 3. 异常

**`packages/app/src/exceptions/NoteExceptions.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 还没有选择笔记文件夹
 */
export class NoFolderException extends Exception {
    public errno: string = 'E_NO_FOLDER'
}

/**
 * 请求的笔记不在文件夹中
 */
export class NoteNotFoundException extends Exception {
    public errno: string = 'E_NOTE_NOT_FOUND'
}
```

异常有一个 `errno`，渲染进程用它判断是哪种错误（见 [Exceptions](../Exceptions.md)）。通过 IPC 发送错误时，会带上它的全部属性（见 [ServiceCalls](../ServiceCalls.md) 第 3 节），渲染进程收到的就是抛出时的错误：`error.errno` 为 `'E_NOTE_NOT_FOUND'`。服务调用的传输方式总是以封套回复，不管错误的状态码是多少，所以这些异常不需要 `statusCode`。

## 4. 笔记

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
 * 文件夹中的一条笔记：名称，以及文件的修改时间
 */
export type NoteInfo = { name: string, modifiedAt: string }

/**
 * 笔记：用户所选文件夹中的 Markdown 文件，这个文件夹记录在应用的设置中。文件夹中的文件有变化时，不论是应用自己
 * 还是其他程序改的，都会通知窗口（notes.changed）
 */
export class Notes extends Component {

    /**
     * 向窗口推送事件
     */
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    /**
     * 设置文件，记录所选的文件夹
     */
    @Configurable(DTO.String().required())
    protected readonly settings: string

    #folder: string | null = null

    #watcher: FSWatcher | undefined

    #timer: NodeJS.Timeout | undefined

    /**
     * 笔记文件夹，选择之前为 null
     */
    public get folder(): string | null {
        return this.#folder
    }

    /**
     * 使用设置中记录的文件夹（如果它还存在）
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
     * 监视文件夹中的文件：等变化稳定下来，再推送给窗口
     * @param folder
     */
    protected watch(folder: string): void {
        this.#watcher?.close()
        const watcher: FSWatcher = watch(folder, (): void => {
            clearTimeout(this.#timer)
            this.#timer = setTimeout((): number => this.entrypoint.broadcast('notes.changed'), 100)
        })
        //文件夹被删除了，或者无法再读取
        watcher.on('error', (): void => watcher.close())
        this.#watcher = watcher
        this.#folder = folder
    }

    /**
     * 改用另一个文件夹，并记住它
     * @param folder
     */
    public async use(folder: string): Promise<void> {
        this.watch(folder)
        await mkdir(path.dirname(this.settings), {recursive: true})
        await writeFile(this.settings, JSON.stringify({folder: folder}))
    }

    /**
     * 一条笔记的文件
     * @param name
     */
    protected file(name: string): string {
        if (!this.#folder) throw new NoFolderException('No folder of notes is chosen')
        return path.join(this.#folder, `${name}.md`)
    }

    /**
     * 一条已有笔记的文件
     * @param name
     */
    public find(name: string): string {
        const file: string = this.file(name)
        if (!existsSync(file)) throw new NoteNotFoundException(`The note ${name} does not exist`)
        return file
    }

    /**
     * 所有笔记，最近修改的排在前面
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
     * 一条笔记的文本
     * @param name
     */
    public async read(name: string): Promise<string> {
        return await readFile(this.find(name), 'utf8')
    }

    /**
     * 写入一条笔记，新建或者覆盖
     * @param name
     * @param text
     */
    public async write(name: string, text: string): Promise<NoteInfo> {
        const file: string = this.file(name)
        await writeFile(file, text)
        return {name: name, modifiedAt: (await stat(file)).mtime.toISOString()}
    }

    /**
     * 删除一条笔记
     * @param name
     */
    public async remove(name: string): Promise<void> {
        await rm(this.find(name))
    }
}
```

- 组件只创建一次，由整个应用共享（见 [Objects](../Objects.md)）。它保存着文件夹，而文件夹在请求结束之后仍然要用：控制器只存在于一次请求之内（见 [Controllers](../Controllers.md) 第 2 节）。
- `settings` 是组件的选项，也就是记录文件夹的那个文件：它用 `@Configurable` 声明，值由应用的选项传入（见 [Injection](../Injection.md)）。应用启动时，`init()` 会读取这个文件。
- `node:fs` 的 `watch()` 监视文件夹。文件夹中的文件有变化时，不论是应用保存的还是其他程序（编辑器、同步工具）改的，`this.entrypoint.broadcast()` 都会向每个窗口推送 `notes.changed`（见 [ServiceCalls](../ServiceCalls.md) 第 5 节）。保存一次文件往往会产生好几次变化，所以用定时器等变化稳定下来再推送。
- 应用停止时，`destroy()` 停止监视。

## 5. 控制器

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
 * 笔记的动作，由窗口调用：window.ipc.invoke({cmd: 'notes.list'})
 */
export class NoteController extends Controller {

    @Inject('notes')
    protected readonly notes: Notes

    /**
     * 笔记文件夹，选择之前为 null
     */
    @ServiceAction({cmd: 'folder.get'})
    public async folder(): Promise<string | null> {
        return this.notes.folder
    }

    /**
     * 弹出系统对话框（属于发出请求的窗口），让用户选择文件夹；取消对话框时文件夹不变
     */
    @ServiceAction({cmd: 'folder.choose'})
    public async choose(): Promise<string | null> {
        //Electron 由用到它的动作自己加载：测试用 Node.js 运行，不会调用这些动作
        const {BrowserWindow, dialog} = (await import('electron')).default
        const event: IpcMainInvokeEvent | undefined = ipcEventOfContext<IpcMainInvokeEvent>(this.context as ServiceContext)
        const window: BrowserWindow | null = event ? BrowserWindow.fromWebContents(event.sender) : null
        const options: OpenDialogOptions = {title: 'The folder of the notes', properties: ['openDirectory', 'createDirectory']}
        const result: OpenDialogReturnValue = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
        if (!result.canceled && result.filePaths.length) await this.notes.use(result.filePaths[0])
        return this.notes.folder
    }

    /**
     * 所有笔记，最近修改的排在前面
     */
    @ServiceAction({cmd: 'notes.list'})
    public async list(): Promise<NoteInfo[]> {
        return await this.notes.list()
    }

    /**
     * 一条笔记及其文本
     * @param input
     */
    @ServiceAction({cmd: 'notes.read'}, NoteNameDTO)
    public async read(input: NoteNameDTO): Promise<{ name: string, text: string }> {
        return {name: input.name, text: await this.notes.read(input.name)}
    }

    /**
     * 写入一条笔记：文件夹中的 <name>.md 文件
     * @param input
     */
    @ServiceAction({cmd: 'notes.save'}, SaveNoteDTO)
    public async save(input: SaveNoteDTO): Promise<NoteInfo> {
        return await this.notes.write(input.name, input.text)
    }

    /**
     * 删除一条笔记
     * @param input
     */
    @ServiceAction({cmd: 'notes.delete'}, NoteNameDTO)
    public async remove(input: NoteNameDTO): Promise<void> {
        await this.notes.remove(input.name)
    }

    /**
     * 在系统的文件管理器（Finder、资源管理器等）中显示笔记文件
     * @param input
     */
    @ServiceAction({cmd: 'notes.reveal'}, NoteNameDTO)
    public async reveal(input: NoteNameDTO): Promise<void> {
        const {shell} = (await import('electron')).default
        shell.showItemInFolder(this.notes.find(input.name))
    }
}
```

- 每个 `@ServiceAction` 都由消息调用：`{cmd: 'notes.save', name: 'Shopping', text: '- bread'}` 会把 `{name: 'Shopping', text: '- bread'}` 作为输入调用 `save()`，输入由 `SaveNoteDTO` 校验（见 [ServiceCalls](../ServiceCalls.md) 第 2 节）。动作都很短：实际工作由控制器注入的 `notes` 组件完成。
- `folder.choose` 和 `notes.reveal` 用到只有主进程才有的 API：`dialog` 和 `shell`。和模板中的 `MainWindow` 一样，它们在运行时才导入 Electron，所以用 Node.js 运行的测试从不加载 Electron。
- `ipcEventOfContext()` 返回请求的 IPC 事件。它的 `sender` 是发出调用的页面，`BrowserWindow.fromWebContents()` 由此找到页面所在的窗口，对话框就属于这个窗口（在 macOS 上，对话框附着在窗口上显示）。通过开发用的 HTTP 入口调用时（见第 9 节），动作没有 IPC 事件，对话框也就不属于任何窗口。
- 没有返回值的动作（例如 `remove()`）回复 `{success: true, error: null}`。

## 6. 应用的选项

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
     * 设置文件，记录笔记文件夹
     */
    settings: string
    /**
     * 主进程所在的目录，预加载脚本和构建好的渲染进程都在这里
     */
    directory?: string
    /**
     * 开发时渲染进程的 URL（Vite 的开发服务器），不提供时使用构建好的渲染进程
     */
    renderer?: string
    mode?: 'development' | 'production'
    /**
     * 是否打开窗口，默认为 true（测试时只提供动作，不打开窗口）
     */
    window?: boolean
    /**
     * 提供动作的 ipcMain，默认为 Electron 的（测试传入自己的）
     */
    ipcMain?: IPCMain
    /**
     * 开发用 HTTP 入口的端口，默认不启用：供工具（Postman、curl）调用动作（POST /，带上模式和输入），并接收推送给
     * 它们的事件（GET /events，Server-Sent Events）；客户端 id 放在请求头 id 中（也可以用查询参数 id）
     */
    devPort?: number
}

/**
 * 应用的选项
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
                //渲染进程通过 IPC 调用动作：window.ipc.invoke({cmd: 'notes.list'})
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
        //先提供动作、开始监视文件夹，再让窗口加载渲染进程
        bootstrap: options.window === false ? ['entrypoint', 'notes'] : ['entrypoint', 'notes', 'window']
    }
}
```

这是模板中的 `Config.ts`，改动如下：

- 新增必填的 `settings` 选项，即设置文件；
- 新增 `notes` 组件，把设置文件传给它；用 `NoteController` 代替示例控制器；
- `bootstrap: ['entrypoint', 'notes', 'window']`：先提供动作、开始监视文件夹，窗口再加载渲染进程。测试启动应用时不打开窗口（`window: false`），并传入自己的 `ipcMain`。

## 7. 主进程

**`packages/app/src/App.ts`**

```typescript
import {Application, resourcesPath, type ILogger} from 'lakutata'
import electron from 'electron'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {config} from './config/Config.js'

/**
 * 预加载脚本和构建好的渲染进程所在目录：打包后是应用的资源目录（lakutata.resources），开发时是主进程所在目录
 * （build/，渲染进程取自 ui 包）
 */
const directory: string = resourcesPath() ?? path.dirname(fileURLToPath(import.meta.url))

/**
 * 开发时渲染进程的 URL（--renderer=<url>，Vite 的开发服务器）
 */
const renderer: string | undefined = process.argv.find((argument: string): boolean => argument.startsWith('--renderer='))?.slice('--renderer='.length)

//应用只运行一个实例：再启动一个实例时，新实例直接退出，已在运行的实例把窗口切到前台
if (!electron.app.requestSingleInstanceLock()) {
    electron.app.exit(0)
} else {
    Application
        .run(config({
            //笔记文件夹记录在应用的数据目录中
            settings: path.join(electron.app.getPath('userData'), 'settings.json'),
            directory: directory,
            renderer: renderer,
            mode: electron.app.isPackaged ? 'production' : 'development',
            //开发时也向工具（Postman、curl）提供动作，打包后的应用不提供
            devPort: electron.app.isPackaged ? undefined : Number(process.env.DEV_PORT ?? 9000)
        }))
        .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
        .onFatalException((error: Error, log: ILogger): void => {
            log.error('The application cannot start: %s', error.message)
            electron.app.exit(1)
        })
}
```

和模板中的 `App.ts` 相比，只改了一处：`settings`，即记录笔记文件夹的文件，放在应用的数据目录（`app.getPath('userData')`）中。这个目录以 `packages/app/package.json` 的 `productName`（`notes`）命名，开发时和打包后都一样：在 macOS 上是 `~/Library/Application Support/notes`，在 Windows 上是 `%APPDATA%\notes`，在 Linux 上是 `~/.config/notes`。

模板的预加载脚本（`packages/app/src/preload.cts`）保持不变：它只把动作和事件的 IPC 通道交给渲染进程，Electron 和 Node.js 的其他能力一概不暴露。

## 8. 窗口

**`packages/ui/src/App.tsx`**

```tsx
import {type FormEvent, type KeyboardEvent, useEffect, useState} from 'react'

/**
 * 主进程列出的一条笔记
 */
type NoteInfo = { name: string, modifiedAt: string }

export function App() {
    const [folder, setFolder] = useState<string | null>(null)
    const [notes, setNotes] = useState<NoteInfo[]>([])
    const [current, setCurrent] = useState<string | null>(null)
    const [text, setText] = useState<string>('')
    const [newName, setNewName] = useState<string>('')
    const [status, setStatus] = useState<string>('')

    //调用主进程的一个动作；出错时（笔记不存在、名称不合法）把错误显示在笔记下方
    const run = (action: () => Promise<void>): void => {
        action().catch((error: Error): void => setStatus(error.message))
    }
    const list = (): void => run(async (): Promise<void> => setNotes(await window.ipc.invoke<NoteInfo[]>({cmd: 'notes.list'})))

    useEffect((): () => void => {
        run(async (): Promise<void> => setFolder(await window.ipc.invoke<string | null>({cmd: 'folder.get'})))
        //文件夹中的文件变化时由主进程推送：不论是在这里保存的，还是其他程序改的
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

    //Ctrl+S，在 macOS 上是 Cmd+S
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

- `window.ipc` 来自模板（`packages/ui/src/ipc.ts`），通过预加载脚本工作。`invoke()` 发送消息，返回动作的结果，或者抛出动作的错误（带有 `errno`）；`on()` 和 `off()` 监听主进程的事件（见 [ServiceCalls](../ServiceCalls.md) 第 4 节）。
- 渲染进程与 Node.js 和 Electron 隔离：它自己不读文件，也不打开对话框，而是调用负责这些事情的动作。
- 收到 `notes.changed` 时，它重新列出笔记：用编辑器保存的笔记也会出现在窗口中。
- 错误（例如名称不合法）显示在笔记下方。

## 9. 运行

```bash
npm run dev
```

这条命令启动 Vite 的开发服务器（它提供渲染进程，`packages/ui` 有改动时自动重新加载），同时启动 Electron，它的窗口加载渲染进程并打开 DevTools。主进程会输出 `notes started in development mode`。第一次运行时，窗口会请你选择一个文件夹；以后再启动，它会打开设置中记录的文件夹。

开发时，动作还会通过 HTTP 在 9000 端口（`DEV_PORT`）上提供，方便用 curl 或 Postman 试用：`POST /` 发送消息，`GET /events` 以 Server-Sent Events 的形式输出推送给某个客户端的事件（见 [ServiceCalls](../ServiceCalls.md) 第 4 节）。在窗口中选好文件夹（里面已经有一条笔记 `Ideas`）之后，在另一个终端中执行：

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

窗口会立刻显示新笔记，因为事件也推送给了它。错误带有异常的全部属性，包括调用栈（这里省略了）。

## 10. 测试

模板中的测试换成了针对笔记的测试。和模板中的测试一样，它用 Node.js 运行主进程，不需要 Electron，也不打开窗口：测试用自己的 `ipcMain` 代替 Electron 的，并通过它像渲染进程那样调用动作。测试在设置中记录了临时目录下的一个文件夹。

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
 * 测试用的 ipcMain：通过它像渲染进程那样调用动作，不需要 Electron
 */
const handlers: Map<string, (event: unknown, data: unknown) => Promise<unknown>> = new Map()
const listeners: Map<string, (event: unknown, clientId: string) => void> = new Map()
const ipcMain: IPCMain = {
    handle: (channel: string, listener: (event: unknown, data: unknown) => Promise<unknown>): unknown => handlers.set(channel, listener),
    removeHandler: (channel: string): unknown => handlers.delete(channel),
    on: (channel: string, listener: (event: unknown, clientId: string) => void): unknown => listeners.set(channel, listener),
    removeAllListeners: (channel: string): unknown => listeners.delete(channel)
}
//渲染进程的 web contents：收集推送给它的事件
const received: unknown[][] = []
const sender = {once: (): void => undefined, off: (): void => undefined, send: (...args: unknown[]): unknown => received.push(args)}

/**
 * 像渲染进程那样调用动作（window.ipc.invoke）
 * @param data
 */
function invoke(data: Record<string, unknown>): Promise<any> {
    return (handlers.get('lakutata:service') as (event: unknown, data: unknown, clientId: string) => Promise<unknown>)({sender: sender}, data, 'page')
}

/**
 * 等待条件成立，最多等 5 秒
 * @param condition
 */
async function until(condition: () => boolean): Promise<void> {
    for (let waited: number = 0; !condition(); waited += 50) {
        if (waited >= 5000) throw new Error('Waited too long')
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
    }
}

describe('notes', (): void => {

    //应用的数据目录，以及设置中记录的笔记文件夹
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
        //页面订阅事件
        listeners.get('lakutata:service:subscribe')!({sender: sender}, 'page')
        //其他程序写入一条笔记
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

`npm test` 先构建所有包（包括渲染进程），再运行测试。用到 Electron 的两个动作（对话框和文件管理器）要在窗口中试用。

## 11. 打包

- `npm run package:host` 构建所有包，然后在 `dist/installer` 中生成当前平台的安装包：macOS 上是 `dmg`，Linux 上是 `deb`，Windows 上是 `nsis` 安装程序和一个便携版可执行文件。`npm run package:linux` 在 Docker 中生成 Linux 安装包，在任何平台上都可以运行。安装包由 electron-builder 根据 `packages/app/package.json` 中的 `lakutata.installer` 制作（见 [Installers](../Installers.md) 第 8 节）。
- 主进程会连同它的依赖打包在一起。构建好的渲染进程和预加载脚本放进 Electron 的资源目录（由 `packages/app/package.json` 中的 `lakutata.resources` 指定），`resourcesPath()` 在那里找到它们（见 [Packaging](../Packaging.md) 第 6 节）。
- 打包后的应用没有 HTTP 入口（只有 `app.isPackaged` 为 false 时才传入 `devPort`），设置仍然保存在同一个数据目录中。
