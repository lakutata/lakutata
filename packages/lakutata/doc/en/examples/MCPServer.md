# An MCP server for AI assistants

This example builds a notes server for AI assistants: Claude Code, Claude Desktop or another MCP client runs it, and the
model uses it to save, search and delete the user's notes, kept in a JSON file. It starts from the `default` template
and shows the parts of an MCP server: tools whose arguments are validated by DTOs, a resource and a prompt, the stdio
transport for the clients that start the server themselves, the HTTP transport, and tests that use the SDK's MCP client.

| Name | Kind | What it does |
|---|---|---|
| `notes_add` | Tool | Saves a note: its title, its text and its tags |
| `notes_search` | Tool | Finds the notes by words and by tag, the newest first |
| `notes_delete` | Tool | Deletes a note |
| `note://{id}` | Resource | Gives a note in Markdown |
| `notes_review` | Prompt | Asks the model to summarize the notes with a tag |

## 1. Create the project

```bash
npx @lakutata/cli create --name notes --template default --yes
cd notes
npm install @lakutata/mcp
npm install --save-dev @modelcontextprotocol/client
npm uninstall express @types/express
rm src/controllers/ExampleController.ts src/dtos/GreetDTO.ts
```

An MCP client runs the server as a single process, so the `default` template, which makes one application, fits it
([ProjectStructure](../ProjectStructure.md)). `@lakutata/mcp` serves the actions of the application over MCP; it is not
part of `lakutata` ([MCP](../MCP.md)). The SDK's MCP client, `@modelcontextprotocol/client`, is only for the tests. The
server has no HTTP routes, so express and the example controller of the template are removed.

## 2. The input and the results

**`src/dtos/NoteDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A note
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
 * A note by its id (a number in the arguments of a tool, text in a URI, which strict(false) converts)
 */
export class NoteIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().strict(false).required().description('The id of the note'))
    public id: number
}

/**
 * A new note
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
 * A search of the notes
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
 * The notes found, the newest first
 */
export class SearchResultDTO extends DTO {
    @Expect(DTO.Number().integer().required().description('The number of the notes found'))
    public total: number

    @Expect(DTO.Array(NoteDTO.Schema()).required().description('The notes found, up to the limit'))
    public notes: NoteDTO[]
}

/**
 * The notes with a tag (the argument of a prompt, which is text)
 */
export class TagDTO extends DTO {
    @Expect(DTO.String().required().description('The tag of the notes'))
    public tag: string
}
```

The client receives the JSON schema of each tool's DTO, and the model calls the tool with arguments that follow it; the
DTO then validates them, as for every action ([DTOValidation](../DTOValidation.md)):

- `.description()` tells the model what an argument is; the defaults (`tags`, `query`, `limit`) are in the schema too;
- `NoteIdDTO` serves both a tool, whose arguments are JSON (the number `1`), and the resource, whose variables are text
  (`'1'` in `note://1`): `.strict(false)` converts the text;
- `NoteDTO` and `SearchResultDTO` describe the results of two tools (their `output`, section 5);
- `TagDTO` holds the argument of the prompt, which is text, like every argument of a prompt.

## 3. The exception

**`src/exceptions/NoteNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * The note does not exist
 */
export class NoteNotFoundException extends Exception {
    public errno: string = 'E_NOTE_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

An exception has an `errno` and a status ([Exceptions](../Exceptions.md)). When a tool throws it, the model receives a
result marked as an error, `E_NOTE_NOT_FOUND: The note 9 does not exist`, and can correct its call. When it is thrown
while a resource is read, its status 404 turns it into the protocol error `-32602` (invalid params).

## 4. The notes

**`src/components/NoteStore.ts`**

```typescript
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {type NoteDTO} from '../dtos/NoteDTO.js'
import {NoteNotFoundException} from '../exceptions/NoteNotFoundException.js'

/**
 * The notes, kept in a JSON file
 */
export class NoteStore extends Component {

    /**
     * The JSON file of the notes, created with the first note
     */
    @Configurable(DTO.String().required())
    protected readonly file: string

    /**
     * The notes in the file, read again at each call: the servers of several clients may share the file
     */
    protected read(): NoteDTO[] {
        return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : []
    }

    /**
     * Writes the notes to a temporary file, then renames it over the file, so the file is never half written
     * @param notes
     */
    protected write(notes: NoteDTO[]): void {
        const temporary: string = `${this.file}.${process.pid}.tmp`
        writeFileSync(temporary, JSON.stringify(notes, null, 2))
        renameSync(temporary, this.file)
    }

    /**
     * Saves a new note
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
     * A note
     * @param id
     */
    public get(id: number): NoteDTO {
        const note: NoteDTO | undefined = this.read().find((note: NoteDTO): boolean => note.id === id)
        if (!note) throw new NoteNotFoundException(`The note ${id} does not exist`)
        return note
    }

    /**
     * The notes that have the tag and whose title or text contains every word of the query, the newest first
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
     * Deletes a note
     * @param id
     */
    public remove(id: number): NoteDTO {
        const note: NoteDTO = this.get(id)
        this.write(this.read().filter((other: NoteDTO): boolean => other.id !== id))
        return note
    }
}
```

- `NoteStore` is a component: one instance for the whole application, while a controller is created for each request
  ([Objects](../Objects.md)).
- `@Configurable` makes `file` an option of the component: its value is given where the component is declared
  (section 6) and validated when the application launches ([Injection](../Injection.md)).
- Each client runs its own server: given the same file, Claude Code and Claude Desktop run two processes that share it.
  So the file is read at each call instead of being kept in memory, and the notes are written whole to a temporary file
  that is then renamed over it.

## 5. The controller

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
     * The notes (the component "notes" of the options)
     */
    @Inject('notes')
    protected readonly notes: NoteStore

    /**
     * The tool notes_add
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
     * The tool notes_search
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
     * The tool notes_delete
     * @param input
     */
    @MCPTool('delete', NoteIdDTO, {description: 'Delete a note', destructive: true})
    public async delete(input: NoteIdDTO): Promise<string> {
        const note: NoteDTO = this.notes.remove(input.id)
        return `The note ${note.id} (${note.title}) is deleted`
    }

    /**
     * The resource note://1: a note, in Markdown
     * @param input
     */
    @MCPResource('note://{id}', NoteIdDTO, {resourceName: 'note', mimeType: 'text/markdown', description: 'A note, in Markdown'})
    public async note(input: NoteIdDTO): Promise<string> {
        const note: NoteDTO = this.notes.get(input.id)
        return `# ${note.title}\n\n${note.text}\n\nTags: ${note.tags.join(', ') || 'none'}\n`
    }

    /**
     * The prompt notes_review: a summary of the notes with a tag
     * @param input
     */
    @MCPPrompt('review', TagDTO, {title: 'Review notes', description: 'Summarize the notes of a tag and list what is left to do'})
    public async review(input: TagDTO): Promise<string> {
        const notes: string[] = this.notes.search('', input.tag).map((note: NoteDTO): string => `## ${note.title}\n\n${note.text}`)
        return [`My notes tagged "${input.tag}":`, ...notes, 'Summarize them, then list what is left to do.'].join('\n\n')
    }
}
```

- `@Prefix({mcp: 'notes'})` prefixes the names of the tools and of the prompt: `add` becomes `notes_add`. The URIs of
  the resources are never prefixed.
- The `description` of a tool is what the model reads to decide when to call it: say what the tool does and when to use
  it.
- `readOnly` and `destructive` are hints for the client, which may ask the user before a call that deletes.
- With `output`, the result is sent both as JSON text and as structured content, which the client checks against the
  schema of the DTO. Such a tool must return an object: `search` returns `{total, notes}`, not an array of notes.
- `note://{id}` is a template: the client fills in the id and reads `note://1`. The string returned is the text of the
  resource, of type `text/markdown`.
- The prompt returns a string, which becomes a single user message, sent when the user picks the prompt in the client.

## 6. The options of the server

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
 * What the model is told about the server
 */
const instructions: string = 'The notes of the user. Search them before answering a question they may answer, and save a note when the user asks you to remember something.'

/**
 * Over HTTP, when MCP_TOKEN is set, the requests must carry "Authorization: Bearer <MCP_TOKEN>"; throwing answers 401
 * @param request
 */
function authenticate(request: IncomingMessage): MCPAuthInfo | undefined {
    const token: string | undefined = process.env.MCP_TOKEN
    if (!token) return undefined
    if (request.headers.authorization !== `Bearer ${token}`) throw new Error('Invalid token')
    return {token: token, clientId: 'assistant', scopes: []}
}

/**
 * The options of the server
 * @param file the JSON file of the notes, the NOTES_FILE environment variable or notes.json in the home directory by
 * default
 * @param port the port to serve over HTTP, the MCP_PORT environment variable; without it, the server speaks over stdio
 */
export function config(file: string = process.env.NOTES_FILE ?? path.join(os.homedir(), 'notes.json'), port: number | undefined = process.env.MCP_PORT ? Number(process.env.MCP_PORT) : undefined): ApplicationOptions {
    return {
        id: 'notes',
        name: 'notes',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The standard output belongs to the protocol over stdio: the logs go to the standard error
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

This is the `Config.ts` of the template, with:

- the `log` component, which writes to the standard error ([Logger](../Logger.md), section 5): over stdio, the standard
  output carries the messages of the protocol, and a log line there would break them. Nothing else may write there, not
  even `console.log()`. The `App.ts` of the template, unchanged, logs the startup through this component;
- the `notes` component and its file: `NOTES_FILE`, or `notes.json` in the home directory. The client starts the server
  in a directory of its choice, so the default path is absolute;
- the `mcp` adapter of the entrypoint ([Entrypoint](../Entrypoint.md)): `stdioMCPEntrypoint()` by default, and
  `httpMCPEntrypoint()` on `127.0.0.1` when `MCP_PORT` is set. When `MCP_TOKEN` is set too, `authenticate` requires it,
  and a request without it is answered with 401;
- `instructions` for the model, which the client receives when it connects.

## 7. Run it

```bash
npm run build
```

You can try the server without a client by writing the messages of the protocol to its standard input: the
initialization, then a call to `notes_add`.

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

The standard output holds only the responses, one message per line; the startup log went to the standard error, which is
discarded here. The server exits once its input is closed. A client must run `node build/App.js`, not `npm start`: npm
writes its own lines (`> notes@0.0.1 start`) to the standard output.

**In Claude Code.** Register the server once for all your projects (`--scope user`), with the path of the notes file:

```bash
claude mcp add --scope user notes -e NOTES_FILE=$HOME/notes.json -- node $PWD/build/App.js
claude mcp get notes
```

`claude mcp get notes` starts the server to check it, and shows `Status: ✔ Connected`. In a conversation, Claude can
then save what you ask it to remember and search your notes; the descriptions of the tools and the instructions of the
server tell it when. `/mcp__notes__notes_review home` sends the prompt, filled with the notes tagged `home`.

**In Claude Desktop and other clients.** A client that runs its servers over stdio lists their commands in its
configuration, under `mcpServers`. For Claude Desktop, this is the file `claude_desktop_config.json`
(Settings > Developer > Edit Config), read when the application starts:

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

The paths must be absolute. A client that cannot find `node` (installed with nvm, for example) needs its full path,
which `which node` prints.

**Over HTTP.** The server then runs on its own, and the clients connect to its URL:

```bash
MCP_PORT=3000 MCP_TOKEN=change-me node build/App.js
```

In another terminal:

```bash
curl -i -X POST localhost:3000/mcp -H 'Content-Type: application/json' -d '{}'
# HTTP/1.1 401 Unauthorized
# {"error":"unauthorized","error_description":"Invalid token"}

claude mcp add --transport http --scope user notes-http http://127.0.0.1:3000/mcp --header "Authorization: Bearer change-me"
```

A request without the token is refused; Claude Code sends the header given with `--header`. Over HTTP, the server speaks
the 2026-07-28 revision of the protocol, and serves the clients of the 2025 revisions without sessions
([MCP](../MCP.md), section 6).

## 8. Test it

The test of the template is replaced by a test of the server over its two transports. Over stdio, the SDK's MCP client
runs `build/App.js` as a child process, as Claude Code does; over HTTP, the server runs in the test process, on
port 18088:

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
        //The client runs the server as a child process, as Claude Code does, with its own notes file
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
        //The notes are in the file
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

- `env` adds `NOTES_FILE` to the variables that the SDK passes to the server (a few, such as `PATH`, not the whole
  environment of the test), so that the server uses its own file. `stderr: 'pipe'` collects the logs of the server.
- For a failed call, `callTool()` returns a result whose `isError` is true instead of throwing: the model reads the
  error like any other result.

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

## 9. Share it

```bash
npm install --save-dev @lakutata/builder
echo '/dist' >> .gitignore
npx lakutata package bundle
```

```
✔ dist/notes.cjs (0.9 MB): node dist/notes.cjs
```

- The bundle is a single file that runs without `node_modules` ([Packaging](../Packaging.md)); git ignores it. Copy it
  anywhere and give its path to the clients: `claude mcp add --scope user notes -- node /path/to/notes.cjs`.
- The notes are read and written whole at each call, which suits the notes of one person. For many notes, or for several
  clients that write at once, keep them in a database ([Database](../Database.md)).
- To serve other machines over HTTP, put a proxy with TLS in front of the server, and list in `allowedHosts` the host
  name that the clients connect to ([MCP](../MCP.md), section 6).

<!--
check:
  create: notes default
  remove: src/controllers/ExampleController.ts src/dtos/GreetDTO.ts
  run: npm test
  run: npx lakutata package bundle
-->
