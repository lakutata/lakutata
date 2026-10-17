# 给 AI 助手用的 MCP 服务器

这个示例构建一个给 AI 助手用的笔记服务器：Claude Code、Claude Desktop 或其他 MCP 客户端运行它，模型就能用它保存、搜索和删除用户的笔记，笔记保存在一个 JSON 文件中。它从 `default` 模板开始，展示 MCP 服务器的各个部分：用 DTO 校验参数的工具、一个资源和一个提示词、客户端自己启动服务器时使用的 stdio 传输方式、HTTP 传输方式，以及用 SDK 的 MCP 客户端编写的测试。

| 名字 | 类型 | 作用 |
|---|---|---|
| `notes_add` | 工具 | 保存一条笔记：标题、正文和标签 |
| `notes_search` | 工具 | 按关键词和标签查找笔记，最新的在前 |
| `notes_delete` | 工具 | 删除一条笔记 |
| `note://{id}` | 资源 | 以 Markdown 格式给出一条笔记 |
| `notes_review` | 提示词 | 让模型总结带某个标签的笔记 |

## 1. 创建项目

```bash
npx @lakutata/cli create --name notes --template default --yes
cd notes
npm install @lakutata/mcp
npm install --save-dev @modelcontextprotocol/client
npm uninstall express @types/express
rm src/controllers/ExampleController.ts src/dtos/GreetDTO.ts
```

MCP 客户端把服务器作为单个进程运行，所以只包含一个应用的 `default` 模板正合适（见 [ProjectStructure](../ProjectStructure.md)）。`@lakutata/mcp` 通过 MCP 提供应用的动作，它不属于 `lakutata`（见 [MCP](../MCP.md)）。SDK 的 MCP 客户端 `@modelcontextprotocol/client` 只用于测试。服务器没有 HTTP 路由，所以删掉了 express 和模板中的示例控制器。

## 2. 输入和结果

**`src/dtos/NoteDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 一条笔记
 */
export class NoteDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number

    @Expect(DTO.String().required())
    public title: string

    @Expect(DTO.String().required())
    public text: string

    @Expect(DTO.Array(DTO.String()).required())
    public tags: string[]

    @Expect(DTO.String().isoDate().required())
    public createdAt: string
}

/**
 * 按 id 指定的笔记（在工具的参数中是数字，在 URI 中是文本，由 strict(false) 转换）
 */
export class NoteIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().strict(false).required().description('The id of the note'))
    public id: number
}

/**
 * 新笔记
 */
export class AddNoteDTO extends DTO {
    @Expect(DTO.String().min(1).max(200).required().description('A short title'))
    public title: string

    @Expect(DTO.String().min(1).max(20000).required().description('The text of the note, in Markdown'))
    public text: string

    @Expect(DTO.Array(DTO.String().min(1).max(30)).max(10).default([]).description('Tags, such as "home" or "work"'))
    public tags: string[]
}

/**
 * 搜索笔记的条件
 */
export class SearchNotesDTO extends DTO {
    @Expect(DTO.String().allow('').default('').description('The words that the title or the text must hold; empty for every note'))
    public query: string

    @Expect(DTO.String().optional().description('Only the notes that have this tag'))
    public tag?: string

    @Expect(DTO.Number().integer().min(1).max(50).default(10).description('The most notes to return'))
    public limit: number
}

/**
 * 找到的笔记，最新的在前
 */
export class SearchResultDTO extends DTO {
    @Expect(DTO.Number().integer().required().description('The number of the notes found'))
    public total: number

    @Expect(DTO.Array(NoteDTO.Schema()).required().description('The notes found, up to the limit'))
    public notes: NoteDTO[]
}

/**
 * 带某个标签的笔记（提示词的参数总是文本）
 */
export class TagDTO extends DTO {
    @Expect(DTO.String().required().description('The tag of the notes'))
    public tag: string
}
```

工具会把 DTO 的 JSON Schema 发给客户端，模型按这个 Schema 传入参数来调用工具；和所有动作一样，参数随后由 DTO 校验（见 [DTOValidation](../DTOValidation.md)）：

- `.description()` 向模型说明参数的含义；默认值（`tags`、`query`、`limit`）也写在 Schema 中；
- `NoteIdDTO` 既用于工具，也用于资源：工具的参数是 JSON（数字 `1`），资源的变量是文本（`note://1` 中的 `'1'`），由 `.strict(false)` 转换；
- `NoteDTO` 和 `SearchResultDTO` 描述两个工具的结果（即它们的 `output`，见第 5 节）；
- `TagDTO` 是提示词的参数；提示词的参数都是文本。

## 3. 异常

**`src/exceptions/NoteNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 笔记不存在
 */
export class NoteNotFoundException extends Exception {
    public errno: string = 'E_NOTE_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

异常有一个 `errno` 和一个状态码（见 [Exceptions](../Exceptions.md)）。工具抛出这个异常时，模型收到一个标记为错误的结果 `E_NOTE_NOT_FOUND: The note 9 does not exist`，可以据此修正调用。读取资源时抛出这个异常，由于状态码是 404，客户端收到的是协议错误 `-32602`（参数无效）。

## 4. 笔记

**`src/components/NoteStore.ts`**

```typescript
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {type NoteDTO} from '../dtos/NoteDTO.js'
import {NoteNotFoundException} from '../exceptions/NoteNotFoundException.js'

/**
 * 笔记，保存在一个 JSON 文件中
 */
export class NoteStore extends Component {

    /**
     * 保存笔记的 JSON 文件，保存第一条笔记时创建
     */
    @Configurable(DTO.String().required())
    protected readonly file: string

    /**
     * 文件中的笔记，每次调用都重新读取：多个客户端各自的服务器可能共用这个文件
     */
    protected read(): NoteDTO[] {
        return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : []
    }

    /**
     * 先把笔记写入临时文件，再重命名覆盖原文件，这样文件永远不会只写了一半
     * @param notes
     */
    protected write(notes: NoteDTO[]): void {
        const temporary: string = `${this.file}.${process.pid}.tmp`
        writeFileSync(temporary, JSON.stringify(notes, null, 2))
        renameSync(temporary, this.file)
    }

    /**
     * 保存一条新笔记
     * @param title
     * @param text
     * @param tags
     */
    public add(title: string, text: string, tags: string[]): NoteDTO {
        const notes: NoteDTO[] = this.read()
        const id: number = Math.max(0, ...notes.map((note: NoteDTO): number => note.id)) + 1
        const note: NoteDTO = {id: id, title: title, text: text, tags: tags, createdAt: new Date().toISOString()} as NoteDTO
        this.write([...notes, note])
        return note
    }

    /**
     * 取一条笔记
     * @param id
     */
    public get(id: number): NoteDTO {
        const note: NoteDTO | undefined = this.read().find((note: NoteDTO): boolean => note.id === id)
        if (!note) throw new NoteNotFoundException(`The note ${id} does not exist`)
        return note
    }

    /**
     * 带有该标签、并且标题或正文包含查询中每个词的笔记，最新的在前
     * @param query
     * @param tag
     */
    public search(query: string, tag?: string): NoteDTO[] {
        const words: string[] = query.toLowerCase().split(/\s+/).filter(Boolean)
        return this.read()
            .filter((note: NoteDTO): boolean => tag === undefined || note.tags.includes(tag))
            .filter((note: NoteDTO): boolean => words.every((word: string): boolean => `${note.title} ${note.text}`.toLowerCase().includes(word)))
            .reverse()
    }

    /**
     * 删除一条笔记
     * @param id
     */
    public remove(id: number): NoteDTO {
        const note: NoteDTO = this.get(id)
        this.write(this.read().filter((other: NoteDTO): boolean => other.id !== id))
        return note
    }
}
```

- `NoteStore` 是一个组件：整个应用只有一个实例，而控制器是每个请求创建一个（见 [Objects](../Objects.md)）。
- `@Configurable` 把 `file` 变成组件的选项：它的值在声明组件的地方给出（第 6 节），并在应用启动时校验（见 [Injection](../Injection.md)）。
- 每个客户端运行自己的服务器：如果 Claude Code 和 Claude Desktop 使用同一个文件，就会有两个进程读写它。所以每次调用都重新读取文件，而不是把笔记留在内存中；写入时先把全部笔记写到临时文件，再重命名覆盖原文件。

## 5. 控制器

**`src/controllers/NoteController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {Prefix} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {MCPPrompt, MCPResource, MCPTool} from '@lakutata/mcp'
import {type NoteStore} from '../components/NoteStore.js'
import {AddNoteDTO, NoteDTO, NoteIdDTO, SearchNotesDTO, SearchResultDTO, TagDTO} from '../dtos/NoteDTO.js'

@Prefix({mcp: 'notes'})
export class NoteController extends Controller {

    /**
     * 笔记（选项中的组件 "notes"）
     */
    @Inject('notes')
    protected readonly notes: NoteStore

    /**
     * 工具 notes_add
     * @param input
     */
    @MCPTool('add', AddNoteDTO, {
        description: 'Save a note. Use it when the user asks you to remember something.',
        output: NoteDTO
    })
    public async add(input: AddNoteDTO): Promise<NoteDTO> {
        return this.notes.add(input.title, input.text, input.tags)
    }

    /**
     * 工具 notes_search
     * @param input
     */
    @MCPTool('search', SearchNotesDTO, {
        description: 'Search the notes of the user by words and by tag. Use it before answering a question that the notes may answer.',
        readOnly: true,
        output: SearchResultDTO
    })
    public async search(input: SearchNotesDTO): Promise<SearchResultDTO> {
        const found: NoteDTO[] = this.notes.search(input.query, input.tag)
        return {total: found.length, notes: found.slice(0, input.limit)} as SearchResultDTO
    }

    /**
     * 工具 notes_delete
     * @param input
     */
    @MCPTool('delete', NoteIdDTO, {description: 'Delete a note', destructive: true})
    public async delete(input: NoteIdDTO): Promise<string> {
        const note: NoteDTO = this.notes.remove(input.id)
        return `The note ${note.id} (${note.title}) is deleted`
    }

    /**
     * 资源 note://1：一条 Markdown 格式的笔记
     * @param input
     */
    @MCPResource('note://{id}', NoteIdDTO, {resourceName: 'note', mimeType: 'text/markdown', description: 'A note, in Markdown'})
    public async note(input: NoteIdDTO): Promise<string> {
        const note: NoteDTO = this.notes.get(input.id)
        return `# ${note.title}\n\n${note.text}\n\nTags: ${note.tags.join(', ') || 'none'}\n`
    }

    /**
     * 提示词 notes_review：让模型总结带某个标签的笔记
     * @param input
     */
    @MCPPrompt('review', TagDTO, {title: 'Review notes', description: 'Summarize the notes of a tag and list what is left to do'})
    public async review(input: TagDTO): Promise<string> {
        const notes: string[] = this.notes.search('', input.tag).map((note: NoteDTO): string => `## ${note.title}\n\n${note.text}`)
        return [`My notes tagged "${input.tag}":`, ...notes, 'Summarize them, then list what is left to do.'].join('\n\n')
    }
}
```

- `@Prefix({mcp: 'notes'})` 给工具和提示词的名字加上前缀：`add` 变成 `notes_add`。资源的 URI 不会加前缀。
- 模型根据工具的 `description` 决定什么时候调用它：要写清楚工具做什么、什么时候使用。
- `readOnly` 和 `destructive` 是给客户端的提示，客户端可能在执行删除之前先询问用户。
- 声明了 `output` 时，结果既以 JSON 文本给出，也作为结构化内容给出，客户端会按 DTO 的 Schema 检查它。这样的工具必须返回对象：`search` 返回 `{total, notes}`，而不是笔记数组。
- `note://{id}` 是一个模板：客户端填入 id，读取 `note://1`。返回的字符串就是资源的文本，类型为 `text/markdown`。
- 提示词返回一个字符串，作为一条用户消息；用户在客户端中选中这个提示词时，这条消息就会发出。

## 6. 服务器的选项

**`src/config/Config.ts`**

```typescript
import os from 'node:os'
import path from 'node:path'
import type {IncomingMessage} from 'node:http'
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {Logger} from 'lakutata/com/logger'
import {httpMCPEntrypoint, type MCPAuthInfo, stdioMCPEntrypoint} from '@lakutata/mcp'
import {NoteStore} from '../components/NoteStore.js'
import {NoteController} from '../controllers/NoteController.js'

/**
 * 给模型看的服务器说明
 */
const instructions: string = 'The notes of the user. Search them before answering a question they may answer, and save a note when the user asks you to remember something.'

/**
 * 通过 HTTP 时，如果环境变量中有 MCP_TOKEN，请求必须带上 "Authorization: Bearer <MCP_TOKEN>"；抛出错误时响应 401
 * @param request
 */
function authenticate(request: IncomingMessage): MCPAuthInfo | undefined {
    const token: string | undefined = process.env.MCP_TOKEN
    if (!token) return undefined
    if (request.headers.authorization !== `Bearer ${token}`) throw new Error('Invalid token')
    return {token: token, clientId: 'assistant', scopes: []}
}

/**
 * 服务器的选项
 * @param file 保存笔记的 JSON 文件，默认取环境变量 NOTES_FILE，没有时为主目录下的 notes.json
 * @param port 通过 HTTP 提供服务的端口，取环境变量 MCP_PORT；没有它时，服务器通过 stdio 通信
 */
export function config(file: string = process.env.NOTES_FILE ?? path.join(os.homedir(), 'notes.json'), port: number | undefined = process.env.MCP_PORT ? Number(process.env.MCP_PORT) : undefined): ApplicationOptions {
    return {
        id: 'notes',
        name: 'notes',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //通过 stdio 时，标准输出属于协议：日志写到标准错误
            log: {class: Logger, destinations: [process.stderr]},
            notes: {class: NoteStore, file: file},
            entrypoint: buildEntrypoints({
                controllers: [NoteController],
                mcp: port === undefined
                    ? stdioMCPEntrypoint({instructions: instructions})
                    : httpMCPEntrypoint({port: port, authenticate: authenticate, instructions: instructions})
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

这是模板中的 `Config.ts`，改动如下：

- 新增 `log` 组件，日志写到标准错误（见 [Logger](../Logger.md) 第 5 节）：通过 stdio 时，标准输出承载协议的消息，往里面写一行日志就会破坏这些消息，所以其他任何代码都不能写标准输出，连 `console.log()` 也不行。模板中的 `App.ts` 保持不变，它通过这个组件记录启动日志；
- 新增 `notes` 组件和它的文件：环境变量 `NOTES_FILE`，没有时为主目录下的 `notes.json`。客户端会在它自己选择的目录中启动服务器，所以默认路径是绝对路径；
- 入口的 `mcp` 适配器（见 [Entrypoint](../Entrypoint.md)）：默认是 `stdioMCPEntrypoint()`，设置了 `MCP_PORT` 时是监听 `127.0.0.1` 的 `httpMCPEntrypoint()`。如果同时设置了 `MCP_TOKEN`，`authenticate` 会要求请求带上它，没带的请求得到 401；
- `instructions`：客户端连接时收到这段说明，并交给模型。

## 7. 运行

```bash
npm run build
```

不用客户端也可以试用服务器：把协议消息写到它的标准输入，先初始化，再调用 `notes_add`。

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"shell","version":"1.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_add","arguments":{"title":"Wi-Fi","text":"The password is on the back of the router.","tags":["home"]}}}' \
  | NOTES_FILE=/tmp/notes.json node build/App.js 2>/dev/null
```

```
{"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true},"resources":{"listChanged":true,"subscribe":true},"prompts":{"listChanged":true}},"serverInfo":{"name":"notes","version":"1.0.0"},"instructions":"The notes of the user. Search them before answering a question they may answer, and save a note when the user asks you to remember something."},"jsonrpc":"2.0","id":1}
{"result":{"content":[{"type":"text","text":"{\n  \"id\": 1,\n  \"title\": \"Wi-Fi\",\n  \"text\": \"The password is on the back of the router.\",\n  \"tags\": [\n    \"home\"\n  ],\n  \"createdAt\": \"2026-10-17T14:56:05.346Z\"\n}"}],"structuredContent":{"id":1,"title":"Wi-Fi","text":"The password is on the back of the router.","tags":["home"],"createdAt":"2026-10-17T14:56:05.346Z"}},"jsonrpc":"2.0","id":2}
```

标准输出中只有响应，每行一条消息；启动日志写到了标准错误，这里把它丢弃了。输入关闭后，服务器就会退出。客户端要运行 `node build/App.js`，而不是 `npm start`：npm 会把它自己的输出（`> notes@0.0.1 start`）写到标准输出。

**在 Claude Code 中。** 注册一次服务器，供所有项目使用（`--scope user`），同时给出笔记文件的路径：

```bash
claude mcp add --scope user notes -e NOTES_FILE=$HOME/notes.json -- node $PWD/build/App.js
claude mcp get notes
```

`claude mcp get notes` 会启动服务器检查连接，并显示 `Status: ✔ Connected`。之后在对话中，Claude 就能把你让它记住的内容存下来，也能搜索你的笔记；工具的描述和服务器的说明会告诉它什么时候这样做。`/mcp__notes__notes_review home` 会发送这个提示词，并填入带 `home` 标签的笔记。

**在 Claude Desktop 和其他客户端中。** 通过 stdio 运行服务器的客户端，会在配置的 `mcpServers` 中列出各个服务器的启动命令。Claude Desktop 的配置文件是 `claude_desktop_config.json`（通过 Settings > Developer > Edit Config 打开），应用启动时读取它：

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["/Users/me/notes/build/App.js"],
      "env": {"NOTES_FILE": "/Users/me/notes.json"}
    }
  }
}
```

路径都要写绝对路径。如果客户端找不到 `node`（例如用 nvm 安装的 Node.js），就要写出它的完整路径，也就是 `which node` 的输出。

**通过 HTTP。** 这时服务器独立运行，客户端连接它的 URL：

```bash
MCP_PORT=3000 MCP_TOKEN=change-me node build/App.js
```

在另一个终端中：

```bash
curl -i -X POST localhost:3000/mcp -H 'Content-Type: application/json' -d '{}'
# HTTP/1.1 401 Unauthorized
# {"error":"unauthorized","error_description":"Invalid token"}

claude mcp add --transport http --scope user notes-http http://127.0.0.1:3000/mcp --header "Authorization: Bearer change-me"
```

不带令牌的请求会被拒绝；Claude Code 会发送 `--header` 给出的请求头。通过 HTTP 时，服务器使用 2026-07-28 版本的协议；使用 2025 年各版本协议的客户端也能连接，只是没有会话（见 [MCP](../MCP.md) 第 6 节）。

## 8. 测试

模板中的测试换成了针对服务器的测试，覆盖两种传输方式。通过 stdio 时，SDK 的 MCP 客户端像 Claude Code 一样把 `build/App.js` 作为子进程运行；通过 HTTP 时，服务器运行在测试进程中，端口为 18088：

**`src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Application} from 'lakutata'
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18088)

describe('notes over stdio', (): void => {

    let directory: string
    let client: Client
    let logs: string = ''

    before(async (): Promise<void> => {
        directory = mkdtempSync(path.join(os.tmpdir(), 'notes-'))
        //客户端像 Claude Code 一样把服务器作为子进程运行，并给它单独的笔记文件
        const transport: StdioClientTransport = new StdioClientTransport({
            command: process.execPath,
            args: [fileURLToPath(new URL('../App.js', import.meta.url))],
            env: {NOTES_FILE: path.join(directory, 'notes.json')},
            stderr: 'pipe'
        })
        transport.stderr?.on('data', (chunk: Buffer): void => void (logs += chunk.toString()))
        client = new Client({name: 'test', version: '1.0.0'})
        await client.connect(transport)
    })

    after(async (): Promise<void> => {
        await client?.close()
        rmSync(directory, {recursive: true, force: true})
    })

    it('lists its tools, its resource and its prompt', async (): Promise<void> => {
        assert.deepStrictEqual((await client.listTools()).tools.map((tool): string => tool.name).sort(), ['notes_add', 'notes_delete', 'notes_search'])
        assert.deepStrictEqual((await client.listResourceTemplates()).resourceTemplates.map((template): string => template.uriTemplate), ['note://{id}'])
        assert.deepStrictEqual((await client.listPrompts()).prompts.map((prompt): string => prompt.name), ['notes_review'])
    })

    it('saves the notes and finds them', async (): Promise<void> => {
        const added = await client.callTool({name: 'notes_add', arguments: {title: 'Wi-Fi', text: 'The password is on the back of the router.', tags: ['home']}})
        assert.strictEqual((added.structuredContent as { id: number }).id, 1)
        await client.callTool({name: 'notes_add', arguments: {title: 'Quarterly report', text: 'Send it to Anna before Friday.', tags: ['work']}})
        const found = await client.callTool({name: 'notes_search', arguments: {query: 'password'}})
        const result = found.structuredContent as { total: number, notes: { title: string }[] }
        assert.strictEqual(result.total, 1)
        assert.strictEqual(result.notes[0].title, 'Wi-Fi')
        //笔记已经写入文件
        const saved: { title: string }[] = JSON.parse(readFileSync(path.join(directory, 'notes.json'), 'utf8'))
        assert.deepStrictEqual(saved.map((note: { title: string }): string => note.title), ['Wi-Fi', 'Quarterly report'])
    })

    it('gives a note as a resource, and the notes of a tag as a prompt', async (): Promise<void> => {
        const resource = await client.readResource({uri: 'note://2'})
        assert.deepStrictEqual(resource.contents, [{uri: 'note://2', mimeType: 'text/markdown', text: '# Quarterly report\n\nSend it to Anna before Friday.\n\nTags: work\n'}])
        const prompt = await client.getPrompt({name: 'notes_review', arguments: {tag: 'work'}})
        assert.match((prompt.messages[0].content as { text: string }).text, /Send it to Anna before Friday/)
    })

    it('tells the model what went wrong', async (): Promise<void> => {
        const missing = await client.callTool({name: 'notes_delete', arguments: {id: 9}})
        assert.strictEqual(missing.isError, true)
        assert.deepStrictEqual(missing.content, [{type: 'text', text: 'E_NOTE_NOT_FOUND: The note 9 does not exist'}])
        const invalid = await client.callTool({name: 'notes_add', arguments: {title: '', text: 'Nothing'}})
        assert.deepStrictEqual(invalid.content, [{type: 'text', text: 'E_INVALID_VALUE: "title" is not allowed to be empty'}])
    })

    it('writes its logs to the standard error', async (): Promise<void> => {
        assert.match(logs, /notes started in development mode/)
    })
})

describe('notes over HTTP', (): void => {

    let directory: string
    let app: Application

    before(async (): Promise<void> => {
        process.env.MCP_TOKEN = 'test-token'
        directory = mkdtempSync(path.join(os.tmpdir(), 'notes-'))
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(path.join(directory, 'notes.json'), PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        rmSync(directory, {recursive: true, force: true})
    })

    it('refuses the clients without the token', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/mcp`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})
        assert.strictEqual(response.status, 401)
    })

    it('serves the clients with the token', async (): Promise<void> => {
        const client: Client = new Client({name: 'test', version: '1.0.0'})
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {requestInit: {headers: {Authorization: 'Bearer test-token'}}}))
        try {
            await client.callTool({name: 'notes_add', arguments: {title: 'Parking', text: 'Level 3, row F.'}})
            const found = await client.callTool({name: 'notes_search', arguments: {query: 'parking'}})
            assert.strictEqual((found.structuredContent as { total: number }).total, 1)
        } finally {
            await client.close()
        }
    })
})
```

- `env` 把 `NOTES_FILE` 加到 SDK 传给服务器的环境变量中（SDK 只传 `PATH` 等少数几个变量，而不是测试的全部环境），让服务器使用单独的文件。`stderr: 'pipe'` 收集服务器的日志。
- 调用失败时，`callTool()` 返回一个 `isError` 为 true 的结果，而不是抛出异常：模型像读取普通结果一样读取错误。

```bash
npm test
```

```
▶ notes over stdio
  ✔ lists its tools, its resource and its prompt (4.520208ms)
  ✔ saves the notes and finds them (11.459792ms)
  ✔ gives a note as a resource, and the notes of a tag as a prompt (2.052833ms)
  ✔ tells the model what went wrong (1.021584ms)
  ✔ writes its logs to the standard error (0.061291ms)
✔ notes over stdio (201.009875ms)
▶ notes over HTTP
  ✔ refuses the clients without the token (8.533542ms)
  ✔ serves the clients with the token (18.563167ms)
✔ notes over HTTP (55.262209ms)
ℹ tests 7
ℹ suites 2
ℹ pass 7
ℹ fail 0
```

## 9. 分发

```bash
npm install --save-dev @lakutata/builder
echo '/dist' >> .gitignore
npx lakutata package bundle
```

```
✔ dist/notes.cjs (0.9 MB): node dist/notes.cjs
```

- 单文件包只有一个文件，不需要 `node_modules` 就能运行（见 [Packaging](../Packaging.md)），git 会忽略它。把它复制到任意位置，再把路径告诉客户端：`claude mcp add --scope user notes -- node /path/to/notes.cjs`。
- 每次调用都会完整地读写笔记文件，这对个人笔记来说足够了。笔记很多，或者有多个客户端同时写入时，请把笔记保存在数据库中（见 [Database](../Database.md)）。
- 要通过 HTTP 为其他机器提供服务，请在服务器前面放一个带 TLS 的代理，并在 `allowedHosts` 中列出客户端连接时使用的主机名（见 [MCP](../MCP.md) 第 6 节）。
