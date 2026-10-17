# @lakutata/mcp

English | [中文](README.zh-CN.md)

The MCP channel for the [lakutata](https://github.com/lakutata/lakutata) framework. The
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) is how AI applications (Claude Desktop, Claude Code,
IDEs, agents) give a model access to the tools, data and prompts of other programs. This package serves an
application's controller actions as the tools, resources and prompts of an MCP server, over stdio or Streamable HTTP.
They go through the same entrypoint, middlewares, validation and access control as the application's HTTP, CLI and
service actions. The umbrella package `lakutata` does not re-export it: import it from `@lakutata/mcp`.

| | Used when | Declared with |
|---|---|---|
| tools | the model decides to call them | `@MCPTool(name, DTO?, options?)` |
| resources | the application or the user attaches them to the conversation | `@MCPResource(uri, DTO?, options?)` |
| prompts | the user picks one (the clients' slash commands) | `@MCPPrompt(name, DTO?, options?)` |

## Installation

```shell
npm install lakutata @lakutata/mcp
```

It needs Node.js `^22.13.0 || >=24.11.0`. Its peer dependencies `@lakutata/core` and `@lakutata/entrypoint` come with
`lakutata`; the protocol itself is implemented by its dependency `@modelcontextprotocol/server`.

## Usage

### An MCP server

`stdioMCPEntrypoint` and `httpMCPEntrypoint` are the entrypoint's `mcp` adapters. An action becomes a tool only when it
is declared with `@MCPTool`: tools are handed to a model, so nothing is exposed by default. A method can be an HTTP,
CLI or service action at the same time.

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Prefix} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {Logger} from 'lakutata/com/logger'
import {MCPTool, stdioMCPEntrypoint} from '@lakutata/mcp'

class DeviceSnDTO extends DTO {
    @Expect(DTO.String().required().description('The serial number of the device'))
    public sn: string
}

class StatusDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.Boolean().required())
    public online: boolean
}

@Prefix({mcp: 'device'})
class DeviceController extends Controller {
    //The tool device_status
    @MCPTool('status', DeviceSnDTO, {description: 'The online status of a device', readOnly: true, output: StatusDTO})
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true} as StatusDTO
    }

    //The tool device_reboot: the clients ask the user before calling it
    @MCPTool('reboot', DeviceSnDTO, {description: 'Reboot a device', destructive: true})
    public async reboot(input: DeviceSnDTO): Promise<string> {
        return `Rebooting ${input.sn}`
    }
}

Application.run(() => ({
    id: 'devices.app',
    name: 'Devices',
    components: {
        //Over stdio, the standard output belongs to the protocol
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [DeviceController],
            mcp: stdioMCPEntrypoint({instructions: 'Check the status of a device before rebooting it.'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

### Connecting an AI client

Over stdio, the client runs the application as a subprocess. With Claude Code, run
`claude mcp add devices -- node build/App.js`; with Claude Desktop and most other clients, add the server to their MCP
configuration:

```text
{"mcpServers": {"devices": {"command": "node", "args": ["/path/to/dist/app.js"]}}}
```

Over HTTP, the client connects to the endpoint URL, such as `http://127.0.0.1:3000/mcp` (with Claude Code:
`claude mcp add --transport http devices http://127.0.0.1:3000/mcp`), and sends the headers that `authenticate`
expects.

### Tools

- A tool's name is prefixed with the `mcp` prefix of its controller (`@Prefix({mcp})`), joined by `_`
  (`device_status`). Names are 1 to 128 letters, digits, `_`, `-` or `.`.
- A tool's input schema is the JSON schema of its DTO (describe the properties with `.description()`). The DTO
  validates the input after the middlewares, as on the other channels.
- A tool's description is the `description` option; without it, the model sees the action's name
  (`ControllerClass:method` by default). Write what the tool does and when to use it.
- `title`, `readOnly`, `destructive`, `idempotent` and `openWorld` are passed to the clients, which use them to decide
  whether the user must confirm a call.
- `output` is the DTO of the result, and its JSON schema becomes the tool's output schema. The action must then return
  an object (a plain object or a DTO instance), which becomes the structured content of the result. Any other value (a
  string, an array, nothing) is answered with an error result that names the action and the type it returned.
- The action options (`name`, `description`, `acl`, `rule`, `middlewares`…) are accepted as well.

| The action returns | The tool result |
|---|---|
| a string | one text |
| a plain object | its JSON as text, and the object as the structured content |
| a DTO instance (a class instance) | its JSON as text; with `output`, also its JSON object as the structured content |
| another value (an array, a number…) | its JSON as text |
| `Result.file(...)` | an image, an audio clip or an embedded resource, depending on its content type |
| a `CallToolResult` (`{content: [...]}`) | the result as is |
| `undefined` | an empty result |

An error reaches the model as a result with `isError: true` and the text `errno: message`, so the model can correct its
input and call the tool again.

### Resources

A resource is read-only data addressed by a URI. The variables of a URI template are merged into the input, like route
parameters (they take precedence over it).

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {Expect} from 'lakutata/decorator/dto'
import {MCPResource} from '@lakutata/mcp'

class DeviceSnDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string
}

export class DeviceResourceController extends Controller {
    //Listed by resources/templates/list: device://A1/status reads the device A1
    @MCPResource('device://{sn}/status', DeviceSnDTO, {mimeType: 'application/json', description: 'The status of a device'})
    public async status(input: DeviceSnDTO): Promise<{sn: string, online: boolean}> {
        return {sn: input.sn, online: true}
    }

    //Listed by resources/list
    @MCPResource('device://catalog', {resourceName: 'catalog', title: 'The device catalog'})
    public async catalog(): Promise<string> {
        return 'A1, B2'
    }
}
```

- A URI without variables is listed by `resources/list`, a URI template by `resources/templates/list`. A URI starts
  with a scheme (`device://`).
- A resource's name is `resourceName`, or the action's name by default; `title`, `mimeType`, `audience` and
  `priority` describe it. Controllers do not prefix the URIs.
- A string becomes text (`text/plain` unless `mimeType` is set); bytes and files become text or a blob, depending on
  their content type; other values become JSON; a `ReadResourceResult` (`{contents: [...]}`) is returned as is.
- An error becomes a protocol error: invalid params for client errors (a 4xx `statusCode`), an internal error
  otherwise.

### Prompts

A prompt is a message template. Its arguments are the properties of the DTO (clients send them as strings).

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {Prefix} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {MCPPrompt} from '@lakutata/mcp'

class DeviceSnDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string
}

@Prefix({mcp: 'device'})
export class DevicePromptController extends Controller {
    //The prompt device_diagnose
    @MCPPrompt('diagnose', DeviceSnDTO, {title: 'Diagnose a device', description: 'Diagnose the failures of a device'})
    public async diagnose(input: DeviceSnDTO): Promise<string> {
        return `Diagnose the device ${input.sn} from its status and its logs.`
    }
}
```

A string becomes a user message; an array gives the messages (strings for the user, or `{role, content}`); a
`GetPromptResult` (`{messages: [...]}`) is returned as is. Prompt names are prefixed like tool names. An error becomes a
protocol error, as for resources.

### The context

Actions receive an `MCPContext` with `context.kind` (`tool`, `resource` or `prompt`), `context.name` (the tool or
prompt name, or the resource's URI template), `context.uri` (the URI read), `context.authInfo` (over HTTP) and
`context.progress(progress, total?, message?)`, which reports the progress of a long call when the client asked for
it. `context.sessionId` is set only by a transport with sessions: it is `undefined` with the built-in adapters. When
the client cancels a call, the action's signal (`this.signal`) is aborted.

### Notifications

`MCPNotifier` tells clients what has changed in the application. Inject it into any object (`@Inject(MCPNotifier)`) or
get it with `getObject(MCPNotifier)`: it is autoloaded, one per application.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {MCPNotifier} from '@lakutata/mcp'

export class DeviceWatcher extends Component {
    @Inject(MCPNotifier)
    protected readonly notifier: MCPNotifier

    public statusChanged(sn: string): void {
        //The clients subscribed to the resource read it again
        this.notifier.resourceUpdated(`device://${sn}/status`)
    }
}
```

`resourceUpdated(uri)`, `resourcesChanged()`, `toolsChanged()` and `promptsChanged()` reach clients through the
application's running MCP adapters (not those of another application in the same process):

- over stdio, `resourceUpdated()` reaches the client only if it subscribed to that resource (`resources/subscribe`);
- over HTTP, clients of the 2026-07-28 revision that listen for changes (`subscriptions/listen`) are notified. Clients
  of the 2025 revisions are served without sessions, so the server cannot notify them. Each process keeps its
  subscriptions in memory: when several instances of an application run behind a load balancer, they share a
  notification bus (`bus: ServerEventBus`, over Redis, NATS…) so that every client is notified, whichever instance it
  listens to.

### stdioMCPEntrypoint

The client runs the application as a subprocess and talks to it over its standard input and output. The application
exits when the client closes its input (`exitOnClose: false` keeps it running).

The standard output belongs to the protocol: **the application must write its logs to standard error**, for example with
`log: {class: Logger, destinations: [process.stderr]}`.

Options: `serverName` (the application's name by default), `serverVersion` (`'1.0.0'`), `instructions` (for the
model), `stdin` and `stdout` (the process's by default), `exitOnClose` (`true`), `name` and `middlewares`.

### httpMCPEntrypoint

A Streamable HTTP endpoint (`path`, `/mcp` by default) that serves the 2026-07-28 revision of the protocol, and clients
of the 2025 revisions without sessions (`legacy: 'reject'` refuses them).

```typescript
import type {IncomingMessage} from 'node:http'
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Logger} from 'lakutata/com/logger'
import {httpMCPEntrypoint, MCPTool, stdioMCPEntrypoint, type MCPAuthInfo} from '@lakutata/mcp'

class ClockController extends Controller {
    @MCPTool('now', {description: 'The current time of the server', readOnly: true})
    public async now(): Promise<string> {
        return new Date().toISOString()
    }
}

//Throwing answers 401
function verifyToken(request: IncomingMessage): MCPAuthInfo {
    const token: string = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (token !== process.env.MCP_TOKEN) throw new Error('Invalid token')
    return {token: token, clientId: 'assistant', scopes: []}
}

Application.run(() => ({
    id: 'clock.app',
    name: 'Clock',
    components: {
        //With stdio among the transports, the logs go to the standard error
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [ClockController],
            //Both transports at once
            mcp: [
                stdioMCPEntrypoint(),
                httpMCPEntrypoint({port: 3000, authenticate: verifyToken})
            ]
        })
    },
    bootstrap: ['entrypoint']
}))
```

- By default it listens on `127.0.0.1:3000` (`host`, `port`). On a loopback address, it checks the `Host` and `Origin`
  headers against the local host names to block DNS rebinding (`403`); `allowedHosts` and `allowedOrigins` set other
  names, and `false` disables a check.
- `authenticate(request)` returns the client's authentication, which the actions receive in `context.authInfo`; when
  it throws, the adapter answers `401`. Returning `undefined` serves the request without authentication.
- Bodies larger than `maxRequestBodySize` (4 MiB by default) get a `413`; `server` holds the `node:http` server options;
  `listening(server)` is called once the server listens.
- It stops gracefully with the entrypoint: it stops accepting requests, the calls in progress are answered (the
  entrypoint waits for them, then the adapter gives their responses up to a second), and then the subscription streams
  and the remaining connections are closed, including connections the application took over with an upgrade.

#### Sharing the port of another HTTP server

With `listen: false`, the adapter opens no port: its `handler` is mounted on another server, such as the application
of `expressHTTPEntrypoint` (a Next.js custom server or `node:http` work too). That server's routes, middlewares and
port apply; a body it has already parsed (`express.json()`) is used as is.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {httpMCPEntrypoint, MCPTool} from '@lakutata/mcp'

class ClockController extends Controller {
    @MCPTool('now', {description: 'The current time of the server', readOnly: true})
    public async now(): Promise<string> {
        return new Date().toISOString()
    }
}

const mcp = httpMCPEntrypoint({listen: false, allowedHosts: ['localhost', '127.0.0.1', 'mcp.example.com']})

Application.run(() => ({
    id: 'clock.app',
    name: 'Clock',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [ClockController],
            http: expressHTTPEntrypoint({
                port: 8080,
                before: (app): void => {
                    app.all('/mcp', mcp.handler)
                }
            }),
            mcp: mcp
        })
    },
    bootstrap: ['entrypoint']
}))
```

The handler checks the `Host` and `Origin` headers only against the `allowedHosts` and `allowedOrigins` given, because
the adapter does not know the host of the mounting server. Before the adapter starts and once it stops, the handler
answers `503`.

### Other transports

`buildMCPServer(runtime, info)` builds an MCP server for the actions of a channel runtime, which a custom adapter
connects to another transport; `toToolResult`, `toErrorResult`, `toResourceResult` and `toPromptResult` convert results
the way the built-in adapters do.

## API

| Export | What it is |
|---|---|
| `MCPTool`, `MCPToolOptions` | Method decorator: serves an action as a tool; `title`, the hints, `output` |
| `MCPResource`, `MCPResourceOptions` | Method decorator: serves an action as a resource at a URI or URI template; `resourceName`, `title`, `mimeType`, `audience`, `priority` |
| `MCPPrompt`, `MCPPromptOptions` | Method decorator: serves an action as a prompt; `title` |
| `stdioMCPEntrypoint`, `StdioMCPEntrypointOptions` | The stdio adapter, for clients that run the application as a subprocess |
| `httpMCPEntrypoint`, `HTTPMCPEntrypointOptions`, `HTTPMCPEntrypointAdapter` | The Streamable HTTP adapter, and its `handler` for mounting on another server |
| `MCPNotifier` | Notifies clients: `resourceUpdated`, `resourcesChanged`, `toolsChanged`, `promptsChanged` |
| `MCPContext`, `MCPContextParams`, `MCP_CONTEXT_TYPE`, `MCPRequestKind`, `MCPAuthInfo` | The request context: `kind`, `name`, `uri`, `sessionId`, `authInfo`, `progress()` |
| `buildMCPServer`, `MCPServerInfo` | Builds the MCP server of a channel runtime, for custom adapters; the server's name, version and instructions |
| `toToolResult`, `toErrorResult`, `toResourceResult`, `toPromptResult` | Convert action results and errors |
| `MCPMetadata` | An action's MCP metadata, read by the adapters |
| `MCPChannel` | The definition of the `mcp` channel, for custom adapters |
| `ServerEventBus`, `ServerEvent` | Re-exported from `@modelcontextprotocol/server`: the notification bus (`bus` option) |

The typings document each declaration, with examples.

## Errors

| Error | When |
|---|---|
| `TypeError` | When a class is declared: a tool or prompt name that is not 1 to 128 letters, digits, `_`, `-` or `.`, or a resource URI without a scheme. When a result is converted: an event stream (`Result.events()`), or a file returned by a prompt |
| `Error` (`EADDRINUSE`…) | `httpMCPEntrypoint` starts and its server cannot listen: the entrypoint fails to start |
| An error thrown by a tool | A result with `isError: true` and the text `errno: message`, returned to the model |
| An error thrown by a resource or a prompt | A protocol error: invalid params (`-32602`) for a 4xx `statusCode`, an internal error (`-32603`) otherwise; its message is `errno: message` |
| The protocol error `-32602` (`Tool nope not found`) | A request for a tool, resource or prompt that no action serves, answered by the MCP SDK |
| `ControllerActionNotFoundException` (from `lakutata/com/entrypoint`) | A custom adapter dispatches a request that no action serves (`runtime.dispatch()`) |

Over HTTP, the adapter answers `401` when `authenticate` throws, `403` for a refused `Host` or `Origin`, `404` for any
other path (on its own server) and `413` for a body over `maxRequestBodySize`. A mounted handler answers `503` before
the adapter starts and once it stops; the adapter's own server closes its port when it stops (a request on a
connection still open by then gets `503`).

## See also

- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the entrypoint, controllers, `@Prefix`, middlewares and access
  control (`doc/en/Controllers.md`, `Entrypoint.md` and `Middlewares.md` in the `lakutata` package, Chinese versions in
  `doc/zh`).
- [The Model Context Protocol](https://modelcontextprotocol.io): the specification and the clients.
- `@lakutata/core` (`lakutata`): components, `Application`, DTOs and dependency injection.
