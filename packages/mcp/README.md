# @lakutata/mcp

The MCP channel of the [lakutata](https://github.com/lakutata/lakutata) framework. The
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) is the protocol through which the AI applications
(Claude Desktop, Claude Code, the IDEs, the agents) give a model access to the tools, data and prompts of other
programs. This package serves the application's controller actions as the tools, resources and prompts of an MCP
server, over stdio or Streamable HTTP, through the same entrypoint, middlewares, validation and access control as its
HTTP, CLI and service actions. The umbrella package `lakutata` does not re-export it: import it from `@lakutata/mcp`.

| | Used when | Declared with |
|---|---|---|
| tools | the model decides to call them | `@MCPTool(name, DTO?, options?)` |
| resources | the application or the user attaches them to the conversation | `@MCPResource(uri, DTO?, options?)` |
| prompts | the user picks them (the slash commands of the clients) | `@MCPPrompt(name, DTO?, options?)` |

## Installation

```shell
npm install lakutata @lakutata/mcp
```

It needs Node.js 22 or later. Its peer dependencies `@lakutata/core` and `@lakutata/entrypoint` come with `lakutata`;
the protocol is implemented by `@modelcontextprotocol/server`, a dependency.

## Usage

### An MCP server

`StdioMCPEntrypoint` and `HTTPMCPEntrypoint` are the `mcp` adapters of the entrypoint. An action is a tool only when it
is declared as one with `@MCPTool`: the tools are given to a model, so nothing is exposed by default. A method may also
be an HTTP, CLI or service action at the same time.

```typescript
import {Application, DTO} from 'lakutata'
import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Prefix} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {Logger} from 'lakutata/com/logger'
import {MCPTool, StdioMCPEntrypoint} from '@lakutata/mcp'

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
        entrypoint: BuildEntrypoints({
            controllers: [DeviceController],
            mcp: StdioMCPEntrypoint({instructions: 'Check the status of a device before rebooting it.'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

### Connecting an AI client

Over stdio, the client runs the application as its subprocess. Claude Code: `claude mcp add devices -- node
dist/app.js`; Claude Desktop and most clients, in their MCP configuration:

```text
{"mcpServers": {"devices": {"command": "node", "args": ["/path/to/dist/app.js"]}}}
```

Over HTTP, the client connects to the endpoint's URL, such as `http://127.0.0.1:3000/mcp` (Claude Code: `claude mcp add
--transport http devices http://127.0.0.1:3000/mcp`), with the headers `authenticate` expects.

### Tools

- The name of a tool is prefixed by the `mcp` prefix of its controller (`@Prefix({mcp})`), joined with `_`
  (`device_status`); the names are 1 to 128 letters, digits, `_`, `-` or `.`.
- The input schema of a tool is the JSON schema of its DTO (describe its properties with `.description()`); the input
  is validated by the DTO, after the middlewares, as in the other channels.
- The description of a tool is the `description` option (the action's name without it): write what it does and when to
  use it.
- `title`, `readOnly`, `destructive`, `idempotent` and `openWorld` are given to the clients, which decide from them
  whether a call is confirmed by the user.
- `output` is the DTO of the result: its JSON schema is the output schema of the tool. The action must then return an
  object, a plain object or a DTO instance, the structured content of the result: any other value (a string, an array,
  nothing) is answered with an error result naming the action and the type it returned.
- The options of an action (`name`, `description`, `acl`, `rule`, `middlewares`…) are accepted as well.

| The action returns | The tool result |
|---|---|
| a string | a text |
| a plain object | its JSON as a text, and the object as the structured content |
| a DTO instance (a class instance) | its JSON as a text; with `output`, its JSON object as the structured content too |
| another value (an array, a number…) | its JSON as a text |
| `Result.file(...)` | an image, an audio clip or an embedded resource, by its content type |
| a `CallToolResult` (`{content: [...]}`) | the result as it is |
| `undefined` | an empty result |

An error is given to the model as a result with `isError: true` and the text `errno: errMsg`: the model may correct
its input and call the tool again.

### Resources

A resource is read-only data addressed by a URI. The variables of a URI template are merged into the input, as the
route parameters (they take precedence over it).

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

- A URI without variables is listed in `resources/list`, a URI template in `resources/templates/list`. A URI starts
  with a scheme (`device://`).
- The name of a resource is `resourceName`, the name of the action by default; `title`, `mimeType`, `audience` and
  `priority` describe it. The URIs are not prefixed by the controllers.
- A string is a text (`text/plain` unless `mimeType` is set), bytes and files are a text or a blob by their content
  type, the other values are JSON, and a `ReadResourceResult` (`{contents: [...]}`) is given as it is.
- An error is a protocol error: invalid parameters for the errors of the client (a 4xx `statusCode`), an internal error
  otherwise.

### Prompts

A prompt is a template of messages. Its arguments are the properties of the DTO (the clients give them as strings).

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

A string is a message of the user; an array gives the messages (strings for the user, or `{role, content}`); a
`GetPromptResult` (`{messages: [...]}`) is given as it is. The names of the prompts are prefixed as the tools. An error
is a protocol error, as for the resources.

### The context

The actions receive an `MCPContext`: `context.kind` (`tool`, `resource` or `prompt`), `context.name` (the name of the
tool or of the prompt, the URI template of the resource), `context.uri` (the URI read), `context.sessionId`,
`context.authInfo` (HTTP) and `context.progress(progress, total?, message?)`, which reports the progress of a long call
when the client asked for it. The calls cancelled by the client abort the signal of the action.

### Notifications

`MCPNotifier` tells the clients what changed in the application. Inject it in any object (`@Inject(MCPNotifier)`) or
get it (`getObject(MCPNotifier)`): it is autoloaded, one per application.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {MCPNotifier} from '@lakutata/mcp'

export class DeviceWatcher extends Component {
    @Inject(MCPNotifier)
    protected readonly notifier: MCPNotifier

    public statusChanged(sn: string): void {
        //The clients which subscribed to the resource read it again
        this.notifier.resourceUpdated(`device://${sn}/status`)
    }
}
```

`resourceUpdated(uri)`, `resourcesChanged()`, `toolsChanged()` and `promptsChanged()` reach the clients through the
running MCP adapters of the application (not those of another application of the same process):

- over stdio, the client subscribed to the resource (`resources/subscribe`) is notified;
- over HTTP, the clients of the revision 2026-07-28 listening for the change (`subscriptions/listen`) are notified. The
  clients of 2025 are served without sessions, the server cannot notify them. The subscriptions of one process are
  kept in its memory: the instances of an application behind a load balancer share a bus of notifications
  (`bus: ServerEventBus`, over Redis, NATS…) so that every client is notified, whatever instance it listens to.

### StdioMCPEntrypoint

The client runs the application as its subprocess and talks to it over its standard input and output. The application
exits when the client closes the input (`exitOnClose: false` to keep it running).

The standard output belongs to the protocol: **the logs of the application must be written to the standard error**,
such as `log: {class: Logger, destinations: [process.stderr]}`.

Options: `serverName` (the application's name by default), `serverVersion` (`'1.0.0'`), `instructions` (given to the
model), `stdin` and `stdout` (the process's by default), `exitOnClose` (`true`), `name` and `middlewares`.

### HTTPMCPEntrypoint

A Streamable HTTP endpoint (`path`, `/mcp` by default) serving the revision 2026-07-28 of the protocol, and the clients
of the revisions of 2025 without sessions (`legacy: 'reject'` to refuse them).

```typescript
import type {IncomingMessage} from 'node:http'
import {Application} from 'lakutata'
import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {HTTPMCPEntrypoint, MCPTool, StdioMCPEntrypoint, type MCPAuthInfo} from '@lakutata/mcp'

class ClockController extends Controller {
    @MCPTool('now', {description: 'The current time of the server', readOnly: true})
    public async now(): Promise<string> {
        return new Date().toISOString()
    }
}

//Throwing answers 401
function VerifyToken(request: IncomingMessage): MCPAuthInfo {
    const token: string = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (token !== process.env.MCP_TOKEN) throw new Error('Invalid token')
    return {token: token, clientId: 'assistant', scopes: []}
}

Application.run(() => ({
    id: 'clock.app',
    name: 'Clock',
    components: {
        entrypoint: BuildEntrypoints({
            controllers: [ClockController],
            //Both transports at once
            mcp: [
                StdioMCPEntrypoint(),
                HTTPMCPEntrypoint({port: 3000, authenticate: VerifyToken})
            ]
        })
    },
    bootstrap: ['entrypoint']
}))
```

- It listens on `127.0.0.1:3000` by default (`host`, `port`). On a loopback address, the `Host` and `Origin` headers
  are checked against the local host names (DNS rebinding, `403`); `allowedHosts` and `allowedOrigins` set other
  names, `false` disables a check.
- `authenticate(request)` returns the authentication of the client, given to the tools in `context.authInfo`; an error
  answers `401`. Returning `undefined` serves the request without authentication.
- `maxRequestBodySize` (4 MiB by default) answers `413` to larger bodies; `server` holds the options of the
  `node:http` server; `listening(server)` is called once it listens.
- It stops gracefully with the entrypoint: the calls in progress end (a second at most) before the server closes, then
  the streams of the subscriptions are closed.

#### Sharing the port of another HTTP server

With `listen: false`, the adapter opens no port: its `handler` is mounted on another server, such as the application
of `ExpressHTTPEntrypoint` (it also works with a Next.js custom server or `node:http`). The routes, the middlewares and
the port of that server apply; a body already parsed by it (`express.json()`) is used as it is.

```typescript
import {Application} from 'lakutata'
import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ExpressHTTPEntrypoint} from 'lakutata/adapter/express'
import {HTTPMCPEntrypoint, MCPTool} from '@lakutata/mcp'

class ClockController extends Controller {
    @MCPTool('now', {description: 'The current time of the server', readOnly: true})
    public async now(): Promise<string> {
        return new Date().toISOString()
    }
}

const mcp = HTTPMCPEntrypoint({listen: false, allowedHosts: ['localhost', 'mcp.example.com']})

Application.run(() => ({
    id: 'clock.app',
    name: 'Clock',
    components: {
        entrypoint: BuildEntrypoints({
            controllers: [ClockController],
            http: ExpressHTTPEntrypoint({
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

The `Host` and `Origin` headers are checked only against the `allowedHosts` and `allowedOrigins` given, since the host
of the mounting server is not known to the adapter. Until the adapter started, and once it stops, the handler answers
`503`.

### Other transports

`BuildMCPServer(runtime, info)` builds the MCP server of the actions of a channel runtime, to be connected to another
transport by a custom adapter; `ToToolResult`, `ToErrorResult`, `ToResourceResult` and `ToPromptResult` convert the
results as the adapters do.

## API

| Export | What it is |
|---|---|
| `MCPTool`, `MCPToolOptions` | Method decorator: an action served as a tool; `title`, the hints, `output` |
| `MCPResource`, `MCPResourceOptions` | Method decorator: an action served as a resource at a URI or URI template; `resourceName`, `title`, `mimeType`, `audience`, `priority` |
| `MCPPrompt`, `MCPPromptOptions` | Method decorator: an action served as a prompt; `title` |
| `StdioMCPEntrypoint`, `StdioMCPEntrypointOptions` | The stdio adapter, for the clients running the application as their subprocess |
| `HTTPMCPEntrypoint`, `HTTPMCPEntrypointOptions`, `HTTPMCPEntrypointAdapter` | The Streamable HTTP adapter, and its `handler` for another server |
| `MCPNotifier` | Notifies the clients: `resourceUpdated`, `resourcesChanged`, `toolsChanged`, `promptsChanged` |
| `MCPContext`, `MCPContextParams`, `MCP_CONTEXT_TYPE`, `MCPRequestKind`, `MCPAuthInfo` | The context of the requests: `kind`, `name`, `uri`, `sessionId`, `authInfo`, `progress()` |
| `BuildMCPServer`, `MCPServerInfo` | The MCP server of a channel runtime, for the custom adapters; the server's name, version and instructions |
| `ToToolResult`, `ToErrorResult`, `ToResourceResult`, `ToPromptResult` | The conversions of the actions' results and errors |
| `MCPMetadata` | The MCP metadata of an action, read by the adapters |
| `MCPChannel` | The definition of the `mcp` channel, for the custom adapters |
| `ServerEventBus`, `ServerEvent` | Re-exported from `@modelcontextprotocol/server`: the bus of the notifications (`bus` option) |

The typings document each declaration with examples.

## Errors

| Error | When |
|---|---|
| `TypeError` | When a class is declared: a tool or prompt name which is not 1 to 128 letters, digits, `_`, `-` or `.`, a resource URI without a scheme; when converting a result: an event stream (`Result.events()`), or a file returned by a prompt |
| `Error` (`EADDRINUSE`…) | The start of `HTTPMCPEntrypoint`, when its server cannot listen: the entrypoint fails to start |
| An error thrown by a tool | A result with `isError: true` and the text `errno: message`, given to the model |
| An error thrown by a resource or a prompt | A protocol error: invalid parameters (`-32602`) for a 4xx `statusCode`, an internal error (`-32603`) otherwise; its message `errno: message` |
| `ControllerActionNotFoundException` (from `lakutata/com/entrypoint`) | A request for a tool, resource or prompt no action serves |

Over HTTP, the adapter answers `401` when `authenticate` throws, `403` for a refused `Host` or `Origin`, `404` for
another path (on its own server), `413` for a body over `maxRequestBodySize`, and `503` before its start and once it
stops.

## See also

- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the entrypoint, the controllers, `@Prefix`, the middlewares and
  the access control (`doc/en/ActionPattern.md` of the package `lakutata`, Chinese in `doc/zh`).
- [The Model Context Protocol](https://modelcontextprotocol.io): the specification and the clients.
- `@lakutata/core` (`lakutata`): the components, `Application`, the DTOs and the dependency injection.
