# @lakutata/mcp

The MCP channel of the [lakutata](https://github.com/lakutata/lakutata) framework: the actions of the controllers are
served as the tools, the resources and the prompts of a [Model Context Protocol](https://modelcontextprotocol.io) server,
over stdio or Streamable HTTP.

| | Used when | Declared with |
|---|---|---|
| tools | the model decides to call them | `@MCPTool(name, DTO?, options?)` |
| resources | the application or the user attaches them to the conversation | `@MCPResource(uri, DTO?, options?)` |
| prompts | the user picks them (the slash commands of the clients) | `@MCPPrompt(name, DTO?, options?)` |

```bash
npm install @lakutata/mcp
```

## Tools

An action is a tool only when it is declared as one with `@MCPTool`: the tools are given to a model, so nothing is
exposed by default. A method may also be an HTTP, CLI or service action at the same time.

```ts
import {Controller} from 'lakutata/com/entrypoint'
import {GET, Prefix} from 'lakutata/decorator/ctrl'
import {MCPTool} from '@lakutata/mcp'

@Prefix({route: '/device', mcp: 'device'})
class DeviceController extends Controller {

    @GET('/status/:sn', DeviceSnDTO)
    @MCPTool('status', DeviceSnDTO, {description: 'The online status of a device', readOnly: true, output: StatusDTO})
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        //...
    }

    @MCPTool('reboot', DeviceSnDTO, {description: 'Reboot a device', destructive: true})
    public async reboot(input: DeviceSnDTO): Promise<string> {
        //...
    }
}
```

- The name of a tool is prefixed by the `mcp` prefix of its controller, joined with `_` (`device_status`).
- The input schema of a tool is the JSON schema of its DTO; the input is validated by the DTO, after the middlewares,
  as in the other channels.
- `title`, `readOnly`, `destructive`, `idempotent` and `openWorld` are given to the clients, which decide from them
  whether a call is confirmed by the user.
- `output` is the DTO of the result: its JSON schema is the output schema of the tool.
- The options of an action (`name`, `description`, `acl`, `middlewares`…) are accepted as well.

### Results

| The action returns | The tool result |
|---|---|
| a string | a text |
| a plain object | its JSON as a text, and the object as the structured content |
| another value | its JSON as a text |
| `Result.file(...)` | an image, an audio clip or an embedded resource, by its content type |
| a `CallToolResult` (`{content: [...]}`) | the result as it is |
| `undefined` | an empty result |

An error is given to the model as a result with `isError: true` and the text `errno: errMsg`: the model may correct
its input and call the tool again.

## Resources

A resource is read-only data addressed by a URI. The variables of a URI template are merged into the input, as the
route parameters (they take precedence over it):

```ts
@MCPResource('device://{sn}/status', DeviceSnDTO, {mimeType: 'application/json', description: 'The status of a device'})
public async statusResource(input: DeviceSnDTO): Promise<StatusDTO> { ... }

@MCPResource('device://catalog', {resourceName: 'catalog', title: 'The device catalog'})
public async catalog(): Promise<string> { ... }
```

- A URI without variables is listed in `resources/list`, a URI template in `resources/templates/list`.
- The name of a resource is `resourceName`, the name of the action by default; `title`, `mimeType`, `audience` and
  `priority` describe it. The URIs are not prefixed by the controllers.
- A string is a text (`text/plain` unless `mimeType` is set), bytes and files are a text or a blob by their content type,
  the other values are JSON, and a `ReadResourceResult` (`{contents: [...]}`) is given as it is.
- An error is a protocol error: invalid parameters for the errors of the client (a 4xx `statusCode`), an internal error
  otherwise.

## Prompts

A prompt is a template of messages. Its arguments are the properties of the DTO (the clients give them as strings):

```ts
@MCPPrompt('diagnose', DeviceSnDTO, {title: 'Diagnose a device', description: 'Diagnose the failures of a device'})
public async diagnose(input: DeviceSnDTO): Promise<string> {
    return `Diagnose the device ${input.sn} from its status and its logs.`
}
```

A string is a message of the user; an array gives the messages (strings for the user, or `{role, content}`); a
`GetPromptResult` (`{messages: [...]}`) is given as it is. The names of the prompts are prefixed as the tools.

## The context

The actions receive an `MCPContext`: `context.kind` (`tool`, `resource` or `prompt`), `context.name` (the name of the
tool or of the prompt, the URI template of the resource), `context.uri` (the URI read), `context.sessionId`, `context.authInfo` (HTTP) and
`context.progress(progress, total?, message?)`, which reports the progress of a long call when the client asked for it.
The calls cancelled by the client abort the signal of the action.

## Adapters

```ts
import {StdioMCPEntrypoint, HTTPMCPEntrypoint} from '@lakutata/mcp'

entrypoint: BuildEntrypoints({
    controllers: [DeviceController],
    http: ExpressHTTPEntrypoint({port: 8080}),
    mcp: [
        StdioMCPEntrypoint(),
        HTTPMCPEntrypoint({port: 3000, authenticate: VerifyToken})
    ]
})
```

### StdioMCPEntrypoint

The client runs the application as its subprocess and talks to it over its standard input and output. The application
exits when the client closes the input (`exitOnClose: false` to keep it running).

The standard output belongs to the protocol: **the logs of the application must be written to the standard error**,
such as `log: {class: Logger, destinations: [process.stderr]}`.

### HTTPMCPEntrypoint

A Streamable HTTP endpoint (`path`, `/mcp` by default) serving the revision 2026-07-28 of the protocol, and the clients
of the revisions of 2025 without sessions (`legacy: 'reject'` to refuse them).

- It listens on `127.0.0.1` by default. On a loopback address, the `Host` and `Origin` headers are checked against the
  local host names (DNS rebinding); `allowedHosts` and `allowedOrigins` set other names, `false` disables a check.
- `authenticate(request)` returns the authentication of the client, given to the tools in `context.authInfo`; an error
  answers `401`.
- It stops gracefully with the entrypoint: the calls in progress end before the server closes.

#### Sharing the port of another HTTP server

With `listen: false`, the adapter opens no port: its `handler` is mounted on another server, such as the application
of `ExpressHTTPEntrypoint` (it also works with a Next.js custom server or `node:http`). The routes, the middlewares and
the port of that server apply; a body already parsed by it (`express.json()`) is used as it is.

```ts
const mcp = HTTPMCPEntrypoint({listen: false, authenticate: VerifyToken})

entrypoint: BuildEntrypoints({
    controllers: [DeviceController],
    http: ExpressHTTPEntrypoint({port: 8080, before: (app) => app.all('/mcp', mcp.handler)}),
    mcp: mcp
})
```

The `Host` and `Origin` headers are checked only against the `allowedHosts` and `allowedOrigins` given, since the host
of the mounting server is not known to the adapter. Until the adapter started, and once it stops, the handler answers
`503`.

## Other transports

`BuildMCPServer(runtime, info)` builds the MCP server of the actions of a channel runtime, to be connected to another
transport by a custom adapter.
