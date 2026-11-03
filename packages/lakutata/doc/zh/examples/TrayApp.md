# 用 NW.js 开发托盘应用

这个示例构建一个常驻系统托盘的剪贴板历史：它记下在任何程序里复制的文本，应用窗口可以列出和搜索这些文本、把其中一条再次复制到剪贴板，还可以置顶要保留的条目。它从 `nwjs-react` 模板开始，展示用 lakutata 开发的 NW.js 应用由哪几部分组成：一是后台脚本，它是一个 lakutata 应用，只要应用在运行它就在运行，不管有没有窗口（这里它负责读取剪贴板，并维护托盘图标和托盘菜单）；二是窗口，窗口中的 React 用户界面调用应用的动作，并接收应用推送的事件；三是应用的测试，测试不需要 NW.js 就能运行。

| 消息 | 作用 |
|---|---|
| `{cmd: 'clips.list'}` | 列出剪贴项，置顶的在前，然后是最新的 |
| `{cmd: 'clips.list', query: 'git'}` | 只列出文本包含 `git` 的剪贴项，不区分大小写 |
| `{cmd: 'clips.copy', id: '…'}` | 把一条剪贴项再次复制到剪贴板，它会移到最前 |
| `{cmd: 'clips.pin', id: '…', pinned: true}` | 置顶一条剪贴项：之后不管复制多少文本，它都会保留 |
| `{cmd: 'clips.delete', id: '…'}` | 删除一条剪贴项 |
| `{cmd: 'clips.clear'}` | 删除置顶以外的所有剪贴项 |

历史有变化时，应用会向窗口推送 `clips.changed` 事件。

## 1. 创建项目

```bash
npx @lakutata/cli create --name clips --template nwjs-react --yes
cd clips
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

项目是一个工作区（见 [ProjectStructure](../ProjectStructure.md)）：`packages/app` 是 NW.js 的后台脚本，也是一个 lakutata 应用；`packages/ui` 是用户界面，即由 Vite 构建的 React 页面；`packages/resources` 存放图标。应用不需要安装其他包：剪贴板和托盘由 NW.js 提供，历史是用 `node:fs` 写入的 JSON 文件。这里删掉了模板中的示例控制器。

## 2. 输入

**`packages/app/src/dtos/ClipDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 文本包含查询词的剪贴项，没有查询词时为全部
 */
export class SearchClipsDTO extends DTO {
    @Expect(DTO.String().trim().max(200).optional())
    public query?: string
}

/**
 * 按 id 指定的一条历史剪贴项
 */
export class ClipIdDTO extends DTO {
    @Expect(DTO.String().uuid().required())
    public id: string
}

/**
 * 要置顶或取消置顶的剪贴项
 */
export class PinClipDTO extends ClipIdDTO {
    @Expect(DTO.Boolean().required())
    public pinned: boolean
}
```

每个动作运行前都先用 DTO 校验输入（见 [DTOValidation](../DTOValidation.md)）。剪贴项用 id 指定，id 是历史生成的 UUID：`.uuid()` 拒绝其他字符串，报错 `"id" must be a valid GUID`。消息是 JSON，值会保留原来的类型：`pinned` 必须是布尔值。

## 3. 异常

**`packages/app/src/exceptions/ClipExceptions.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 剪贴项不在历史中（或已不在）
 */
export class ClipNotFoundException extends Exception {
    public errno: string = 'E_CLIP_NOT_FOUND'
}
```

异常带有 `errno`，用户界面根据这个代码判断错误（见 [Exceptions](../Exceptions.md)）。窗口收到的错误和抛出时一样，带有全部属性（见 [ServiceCalls](../ServiceCalls.md) 第 3 节）：`error.errno` 是 `'E_CLIP_NOT_FOUND'`。服务传输方式无论错误的状态码是什么，都用统一的响应结构返回，所以这个异常不需要 `statusCode`。

## 4. 历史

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
 * 复制到剪贴板的一段文本
 */
export type Clip = { id: string, text: string, copiedAt: string, pinned: boolean }

/**
 * 读写剪贴板的文本：在应用中是 NW.js 的剪贴板，在测试中是一个替身
 */
export type ClipboardAccess = { read(): string, write(text: string): void }

/**
 * 剪贴板历史：复制过的文本，最新的在前，保存在文件中。NW.js 不会通知剪贴板的变化，所以组件定时读取剪贴板。历史的变化会推送给
 * 窗口（clips.changed），并通知其他组件（changed）
 */
export class History extends Component {

    /**
     * 向窗口推送事件
     */
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    /**
     * 读写的剪贴板
     */
    @Configurable(DTO.Object({read: DTO.Function().required(), write: DTO.Function().required()}).required())
    protected readonly clipboard: ClipboardAccess

    /**
     * 历史文件
     */
    @Configurable(DTO.String().required())
    protected readonly file: string

    /**
     * 读取剪贴板的间隔，单位为毫秒
     */
    @Configurable(DTO.Number().integer().min(10).optional().default(500))
    protected readonly interval: number

    /**
     * 保留的剪贴项数量，不算置顶的
     */
    @Configurable(DTO.Number().integer().min(1).optional().default(50))
    protected readonly limit: number

    #clips: Clip[] = []

    //最后一次从剪贴板读到的文本：它发生变化就是一次复制
    #last: string = ''

    #timer: NodeJS.Timeout | undefined

    //文件的写入，一个接一个进行
    #saved: Promise<void> = Promise.resolve()

    /**
     * 从文件读取历史，然后定时读取剪贴板：应用启动时剪贴板里已有的内容不算复制
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
     * 读取剪贴板：与上次读到的不同的文本就是一次复制
     */
    protected read(): void {
        const text: string = this.clipboard.read()
        if (!text.trim() || text === this.#last) return
        this.#last = text
        this.add(text)
    }

    /**
     * 把文本放到历史的最前面：再次复制的文本会移到最前，超出上限的最旧的未置顶剪贴项会被丢弃
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
     * 保存历史并通知它已变化：先写到旁边的文件，再重命名过去，这样文件永远不会只写了一半
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
     * 剪贴项：置顶的在前，然后是最新的；有查询词时只返回文本包含它的（不区分大小写）
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
     * 历史中的一条剪贴项
     * @param id
     */
    protected find(id: string): Clip {
        const clip: Clip | undefined = this.#clips.find((item: Clip): boolean => item.id === id)
        if (!clip) throw new ClipNotFoundException('The clip {0} is not in the history', id)
        return clip
    }

    /**
     * 把剪贴项再次复制到剪贴板：它会移到最前
     * @param id
     */
    public copy(id: string): Clip {
        const {text} = this.find(id)
        this.#last = text
        this.clipboard.write(text)
        return {...this.add(text)}
    }

    /**
     * 置顶或取消置顶剪贴项：置顶的剪贴项会一直保留，不管之后复制了什么
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
     * 删除一条剪贴项
     * @param id
     */
    public remove(id: string): void {
        const clip: Clip = this.find(id)
        this.#clips = this.#clips.filter((item: Clip): boolean => item !== clip)
        this.changed()
    }

    /**
     * 删除置顶以外的所有剪贴项
     */
    public clear(): void {
        this.#clips = this.#clips.filter((clip: Clip): boolean => clip.pinned)
        this.changed()
    }
}
```

- 组件只创建一次，由整个应用共用（见 [Objects](../Objects.md)）：剪贴项由它保存，因为剪贴项要跨越多次请求保留，而控制器只在一次请求中存在（见 [Controllers](../Controllers.md) 第 2 节）。
- 组件对 NW.js 一无所知，它用到的东西都由选项提供（见 [Injection](../Injection.md)）：`clipboard` 是读写剪贴板文本的两个函数（在应用中是 NW.js 的剪贴板，见第 8 节；在测试中是一个变量，见第 11 节），`file` 是保存历史的文件。
- NW.js 不会通知剪贴板的变化，所以 `init()` 每隔 `interval` 毫秒读取一次剪贴板。与上次读到的不同的文本就是一次复制；应用启动时剪贴板里已有的文本不算，`copy()` 自己写入的文本也不算。
- 再次复制的文本会移到最前，而不是再加一条。超过 `limit` 条时，最旧的剪贴项会被丢弃，置顶的除外。
- 每次变化都会保存文件并发出通知：`this.entrypoint.broadcast()` 向窗口推送 `clips.changed`（见 [ServiceCalls](../ServiceCalls.md) 第 5 节），`this.emit('changed')` 通知其他组件，比如托盘（见第 6 节）。文件先写到旁边的临时文件（`history.json.tmp`），再重命名覆盖原文件，这样即使程序崩溃，文件也不会只写了一半；写入按顺序进行，应用停止时 `destroy()` 会等最后一次写入完成。

## 5. 控制器

**`packages/app/src/controllers/ClipController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Clip, History} from '../components/History.js'
import {ClipIdDTO, PinClipDTO, SearchClipsDTO} from '../dtos/ClipDTO.js'

/**
 * 历史的动作，由窗口调用：window.ipc.invoke({cmd: 'clips.list'})
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

每个 `@ServiceAction` 由一条消息调用：`{cmd: 'clips.pin', id: '…', pinned: true}` 会以 `{id: '…', pinned: true}` 调用 `pin()`，输入由 `PinClipDTO` 校验（见 [ServiceCalls](../ServiceCalls.md) 第 2 节）。动作都很短：实际工作由控制器注入的 `history` 组件完成。没有返回值的动作（比如 `remove()`）会返回 `{success: true, error: null}`。

## 6. 窗口和托盘

应用常驻托盘：关闭窗口只是把它隐藏，从托盘菜单可以重新显示窗口或退出应用。模板中有两个文件要修改：窗口组件和 NW.js API 的类型声明；托盘是一个新组件。

**`packages/app/src/components/MainWindow.ts`**

```typescript
import {Application, Component, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

/**
 * 应用的窗口：它的宿主页面（packages/app/host）把用户界面放在 webview 中，与 Node.js 和 NW.js 隔离（用户界面只能通过宿主页面
 * 的消息调用应用的动作）。关闭窗口只是把它隐藏：应用在托盘中继续读取剪贴板
 */
export class MainWindow extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Configurable(DTO.Number().optional().default(420))
    protected readonly width: number

    @Configurable(DTO.Number().optional().default(640))
    protected readonly height: number

    /**
     * 开发时用户界面的 URL，否则使用构建好的文件
     */
    @Configurable(DTO.String().optional())
    protected readonly ui?: string

    #window: nw.Window | undefined

    protected async init(): Promise<void> {
        //页面是应用中的文件：应用的资源（lakutata.resources）在它的 resources 目录中，用户界面的路径相对于宿主页面
        const query: URLSearchParams = new URLSearchParams({ui: this.ui ?? '../ui/index.html'})
        //开发时打开用户界面的 DevTools（用户界面由 Vite 提供）
        if (this.ui) query.set('devtools', 'true')
        const window: nw.Window = await new Promise((resolve: (window: nw.Window) => void): void => nw.Window.open(`resources/host/index.html?${query}`, {
            title: this.app.appName,
            width: this.width,
            height: this.height,
            //窗口的图标（Windows、Linux；macOS 的窗口显示应用的图标）
            icon: 'resources/logo.png'
        }, resolve))
        this.#window = window
        //关闭窗口时把它隐藏：应用从托盘退出，或者在被要求退出时退出（macOS 上的 Cmd+Q）
        window.on('close', (reason?: 'quit'): unknown => reason === 'quit' ? this.app.exit(0) : window.hide())
        //再次启动应用时，把窗口重新显示出来
        nw.App.on('open', (): void => this.show())
    }

    /**
     * 重新显示窗口，放到其他窗口前面
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

- 窗口打开模板的宿主页面（`packages/app/host`），宿主页面把用户界面放在 webview 中。用户界面与 Node.js 和 NW.js 隔离运行：它只能通过宿主页面的消息访问应用，相当于 Electron 中预加载脚本的角色。
- NW.js 通过 `close` 事件要求窗口关闭；监听了这个事件后，窗口只有通过 `close(true)` 才会关闭。这里的监听器把窗口隐藏，除非应用正在退出（macOS 上的 Cmd+Q，这时监听器会收到 `'quit'`）。应用停止时，`destroy()` 移除监听器并关闭窗口。
- `show()` 把窗口重新显示出来，托盘菜单会调用它，再次启动应用时也会调用它（`nw.App.on('open')`：NW.js 只运行应用的一个实例）。

**`packages/app/src/components/Tray.ts`**

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Clip, History} from './History.js'
import {MainWindow} from './MainWindow.js'

/**
 * 托盘菜单中剪贴项标签的最大长度
 */
const LABEL: number = 40

/**
 * 应用在系统托盘中的图标（macOS 的菜单栏、Windows 的通知区域）：它的菜单可以再次复制最近的剪贴项、显示窗口或退出应用
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
        //macOS 的菜单栏按图标的原始尺寸显示，不会缩小：所以这里显示应用的名称来代替图标（22 像素、只有黑色和透明的模板图片可以放得下）
        this.#tray = new nw.Tray(process.platform === 'darwin' ? {title: this.app.appName} : {icon: 'resources/logo.png', tooltip: this.app.appName})
        this.update()
        this.history.on('changed', (): void => this.update())
    }

    /**
     * 用最近的剪贴项重新生成菜单
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
     * 剪贴项的标签：它的第一行，过长时截短
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

- 托盘菜单列出最近的五条剪贴项，选中一条就把它再次复制到剪贴板。每当历史发出 `changed`，组件就重新生成菜单。
- **Quit** 调用 `this.app.exit(0)`：应用正常停止，组件依次销毁（见 [Application](../Application.md) 第 3 节），托盘图标被移除，窗口被关闭。
- 在 Windows 上，通知区域会把应用的图标缩小显示。macOS 的菜单栏按图标的原始尺寸显示（`logo.png` 有 512 像素），所以那里显示应用的名称来代替图标。NW.js 建议在后台脚本中创建托盘，因为后台脚本和应用存在得一样久：页面中创建的托盘在页面跳转后就不再工作。

模板的类型声明描述了它用到的 NW.js API。这里加上了窗口的 `close` 事件和 `hide()`、`nw.App.dataPath`、剪贴板、托盘及其菜单：

**`packages/app/src/nw.d.ts`**

```typescript
/**
 * 应用用到的 NW.js API（后台脚本中的全局对象 nw）：https://docs.nwjs.io
 */
declare namespace nw {

    /**
     * NW.js 的窗口
     */
    interface Window {
        on(event: 'closed' | 'loaded' | 'focus' | 'blur' | 'minimize' | 'restore', listener: () => void): this
        /**
         * 窗口被要求关闭：由用户关闭，或在应用退出时（macOS 上的 Cmd+Q）带着 quit 参数。监听了这个事件后，窗口只有通过
         * close(true) 才会关闭
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
         * 关闭窗口：传 true 时不触发 close 事件
         * @param force
         */
        close(force?: boolean): void
    }

    /**
     * 窗口的选项：https://docs.nwjs.io/References/Manifest%20Format/#window-subfields
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
     * 系统剪贴板：https://docs.nwjs.io/References/Clipboard/
     */
    interface Clipboard {
        get(type?: 'text' | 'html' | 'rtf' | 'png' | 'jpeg'): string
        set(data: string, type?: 'text' | 'html' | 'rtf' | 'png' | 'jpeg'): void
    }

    /**
     * 菜单项：https://docs.nwjs.io/References/MenuItem/
     */
    class MenuItem {
        constructor(options: {label?: string, type?: 'normal' | 'separator', enabled?: boolean, click?: () => void})
    }

    /**
     * 菜单：https://docs.nwjs.io/References/Menu/
     */
    class Menu {
        append(item: MenuItem): void
    }

    /**
     * 系统托盘中的图标（macOS 的菜单栏、Windows 的通知区域）：https://docs.nwjs.io/References/Tray/
     */
    class Tray {
        constructor(options: {title?: string, tooltip?: string, icon?: string})
        menu: Menu
        remove(): void
    }

    const App: {
        /**
         * 应用的参数，位于应用目录之后
         */
        readonly argv: string[]
        /**
         * 应用的数据目录，位于用户的数据目录中
         */
        readonly dataPath: string
        /**
         * 退出应用
         */
        quit(): void
        /**
         * 应用再次启动：它的命令行交给第一个实例
         * @param event
         * @param listener
         */
        on(event: 'open', listener: (commandLine: string) => void): void
    }

    const Window: {
        /**
         * 打开窗口：URL 相对于应用的目录
         * @param url
         * @param options
         * @param callback
         */
        open(url: string, options: WindowOptions, callback: (window: nw.Window) => void): void
    }

    const Clipboard: {
        /**
         * 剪贴板
         */
        get(): Clipboard
    }
}
```

## 7. 应用的选项

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
     * 读写的剪贴板，在应用中是 NW.js 的剪贴板（测试传入自己的）
     */
    clipboard: ClipboardAccess
    /**
     * 应用的数据目录，历史保存在这里
     */
    dataPath: string
    /**
     * 读取剪贴板的间隔，单位为毫秒（默认 500）
     */
    interval?: number
    /**
     * 保留的剪贴项数量，不算置顶的（默认 50）
     */
    limit?: number
    /**
     * 开发时用户界面的 URL（Vite 的开发服务器），否则使用构建好的文件
     */
    ui?: string
    mode?: 'development' | 'production'
    /**
     * 是否打开窗口和托盘图标，默认为 true（测试在没有它们的情况下提供动作）
     */
    window?: boolean
    /**
     * 放置动作桥接对象的全局对象，默认是 NW.js 的（测试传入自己的）
     */
    global?: object
    /**
     * 开发用的 HTTP 入口的端口，默认没有。工具（Postman、curl）用 POST / 和消息（模式和输入）调用动作，用 GET /events
     * 接收推送给它们的事件（Server-Sent Events），并在 id 请求头（或 id 查询参数）中给出客户端 id
     */
    devPort?: number
}

/**
 * 应用的选项
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
                //用户界面通过窗口的宿主页面调用动作：window.ipc.invoke({cmd: 'clips.list'})
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
        //先提供动作，窗口再加载用户界面；历史从一开始就读取剪贴板，窗口隐藏时也一样
        bootstrap: options.window === false ? ['entrypoint', 'history'] : ['entrypoint', 'history', 'window', 'tray']
    }
}
```

`history` 的选项就是组件的选项：剪贴板、文件（数据目录中的 `history.json`），以及间隔和上限，这两项为 `undefined` 时使用默认值。没有窗口时（`window: false`，即测试中），也没有托盘：需要 NW.js 的组件都不创建，动作通过测试传入的全局对象提供。

## 8. 后台脚本

**`packages/app/src/App.ts`**

```typescript
import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

/**
 * 开发时用户界面的 URL（--ui=<url>，Vite 的开发服务器），由 lakutata nwjs run 传入
 */
const ui: string | undefined = nw.App.argv.find((argument: string): boolean => argument.startsWith('--ui='))?.slice('--ui='.length)

/**
 * 开发时应用运行在开发用的 NW.js 中（lakutata nwjs run：sdk 版本，带 DevTools），安装后运行在普通版本中
 */
const development: boolean = process.versions['nw-flavor'] === 'sdk'

/**
 * 通过 NW.js 访问的系统剪贴板
 */
const clipboard: nw.Clipboard = nw.Clipboard.get()

//NW.js 只运行应用的一个实例：再次启动的实例会退出，第一个实例把窗口放到最前面
Application
    .run(config({
        clipboard: {read: (): string => clipboard.get('text'), write: (text: string): void => clipboard.set(text, 'text')},
        //NW.js 为应用提供的数据目录，位于用户的数据目录中
        dataPath: nw.App.dataPath,
        ui: ui,
        mode: development ? 'development' : 'production',
        //开发时把动作提供给工具（Postman、curl），安装后的应用不提供
        devPort: development ? Number(process.env.DEV_PORT ?? 9000) : undefined
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => {
        log.error('The application cannot start: %s', error.message)
        process.exit(1)
    })
```

模板的 `App.ts` 中加了两个选项：`clipboard` 是按文本读写的 NW.js 剪贴板（`nw.Clipboard.get()`），`dataPath` 是 NW.js 给应用的数据目录（`nw.App.dataPath`）。这个目录以 `packages/app/package.json` 中 `lakutata.installer` 的 `appId`（`clips`）命名，开发时和安装后都一样：macOS 上是 `~/Library/Application Support/clips/Default`，Windows 上是 `%LOCALAPPDATA%\clips`，Linux 上是 `~/.config/clips`。

模板的宿主页面和桥接代码（`packages/app/host`、`packages/ui/src/ipc.ts`）保持不变：它们给用户界面提供应用的动作和事件，不提供 NW.js 或 Node.js 的其他任何东西。

## 9. 用户界面

**`packages/ui/src/App.tsx`**

```tsx
import {useCallback, useEffect, useState} from 'react'

/**
 * 历史中的一条剪贴项，即动作返回的格式
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
        //历史变化了：在这里或从托盘复制了内容
        window.ipc.on('clips.changed', load)
        return (): void => {
            window.ipc.off('clips.changed', load)
        }
    }, [load])

    /**
     * 调用历史的动作，历史会推送它的变化
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

- `window.ipc` 是模板的桥接对象（`packages/ui/src/ipc.ts`）：`invoke()` 调用动作，返回它的 `payload` 或抛出它的错误；`on()` 和 `off()` 监听应用推送的事件。
- 每次收到 `clips.changed` 都重新加载列表，不管变化来自哪里：在其他程序中复制、窗口中的操作，还是在托盘菜单中选了一条剪贴项。
- 按钮不直接修改列表：历史推送它的变化，列表随之更新。

## 10. 运行

```bash
npm run dev
```

这个命令启动 Vite 的开发服务器和 NW.js：开发服务器提供用户界面，`packages/ui` 有变化时会重新加载它；NW.js 的窗口加载用户界面并打开它的 DevTools。应用会输出日志 `Clips started in development mode`。在任何程序中复制几段文本：它们会出现在窗口的最上面，也会出现在托盘菜单中（macOS 菜单栏上显示名称 `Clips`）。

开发时，动作也通过 HTTP 在 9000 端口（`DEV_PORT`）提供，可以用 curl 或 Postman 试用：`POST /` 发送消息，`GET /events` 以 Server-Sent Events 的形式接收某个客户端的事件（见 [ServiceCalls](../ServiceCalls.md) 第 4 节）。先复制 `git log --oneline -5`，再复制 `https://docs.nwjs.io/References/Tray/`，然后在另一个终端中运行：

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

窗口立即显示了置顶，因为事件也推送到了窗口。错误带有异常的全部属性，包括调用栈（这里省略了）。

## 11. 测试

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
 * 测试用的剪贴板文本，应用在没有 NW.js 的情况下读写它
 */
let copied: string = ''

/**
 * 测试的全局对象：通过放在它上面的桥接对象调用动作，与窗口的宿主页面调用方式相同
 */
const shared: Record<symbol, unknown> = {}

/**
 * 像用户界面那样调用动作（window.ipc.invoke）
 * @param data
 */
function invoke(data: Record<string, unknown>): Promise<any> {
    return (shared[Symbol.for(NWJS_SERVICE_BRIDGE)] as NwjsServiceBridge).invoke(data, 'page')
}

/**
 * 历史中的文本，按历史的顺序
 */
async function texts(): Promise<string[]> {
    return (await invoke({cmd: 'clips.list'})).payload.map((clip: Clip): string => clip.text)
}

/**
 * 像其他程序那样把文本复制到剪贴板，并等历史读到它：即最新的未置顶剪贴项
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
        //页面订阅应用的事件
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
        //窗口收到了通知
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

测试用 Node.js 运行应用，不需要 NW.js：`window: false` 不创建窗口和托盘，剪贴板是一个变量，数据目录是一个临时目录。`nwjsServiceEntrypoint` 把它的桥接对象放在传入的全局对象上（`global: shared`），在 NW.js 中窗口的宿主页面就是在那里找到它的；测试和窗口一样通过它调用动作，并订阅某个客户端的事件。10 毫秒的间隔和 3 条的上限让测试运行得更快。

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

`npm test` 先构建各个包（包括用户界面），再运行测试。需要 NW.js 的部分，即系统剪贴板、托盘和窗口，用 `npm run dev` 实际试用。

## 12. 打包

- `npm run package:host` 构建各个包，然后在 `dist/installer` 中生成当前平台的安装包：macOS 上是 `dmg`，Linux 上是 `deb`，Windows 上是 `nsis` 安装程序和 `zip`。`npm run package:linux` 在 Docker 中生成 Linux 的安装包，在任何平台上都可以运行。安装包由 `lakutata package installer` 根据 `packages/app/package.json` 中的 `lakutata.installer` 生成（见 [Installers](../Installers.md)）。
- 安装后的应用运行在普通版本的 NW.js 中，没有 DevTools：它的模式是 `production`，也没有 HTTP 入口（只有在 `lakutata nwjs run` 的 sdk 版本中才会传入 `devPort`）。
- 应用运行在 `packages/app/package.json` 中 `lakutata.nwjs` 指定的 NW.js 版本中；`npm run nwjs:use -- <version>` 可以换成其他版本，比如 `win7`，即 NW.js 0.72，能在 Windows 7、8 和 8.1 上运行的最后一个版本（见 [ProjectStructure](../ProjectStructure.md)）。

<!--
check:
  create: clips nwjs-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
  run: npm run typecheck -w ui
-->
