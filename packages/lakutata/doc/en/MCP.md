# Lakutata MCP

The Model Context Protocol (MCP) lets an AI assistant use an application: call its **tools**, read its **resources**
and fill its **prompts**. The `@lakutata/mcp` package serves controller methods as these, over a child process's
standard input and output or over HTTP. It is not part of `lakutata`:

```bash
npm install lakutata @lakutata/mcp
```

| Declared with | What it is | Who uses it |
|---|---|---|
| `@MCPTool(name)` | An action the model calls with arguments | The model, when it decides to |
| `@MCPResource(uri)` | Data read by its URI | The client, to provide it to the model |
| `@MCPPrompt(name)` | A message template filled with arguments | The user, by choosing it in the client |

## 1. A server over stdio

```typescript
import {Application, DTO, Exception} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Prefix} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {Logger} from 'lakutata/com/logger'
import {MCPPrompt, MCPResource, MCPTool, stdioMCPEntrypoint} from '@lakutata/mcp'

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

class OfflineException extends Exception {
    public errno: string = 'E_OFFLINE'
}

@Prefix({mcp: 'device'})
class DeviceController extends Controller {
    //The tool device_status
    @MCPTool('status', DeviceSnDTO, {description: 'The online status of a device', readOnly: true, output: StatusDTO})
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: input.sn !== 'off'} as StatusDTO
    }

    @MCPTool('reboot', DeviceSnDTO, {description: 'Reboot a device', destructive: true})
    public async reboot(input: DeviceSnDTO): Promise<string> {
        if (input.sn === 'off') throw new OfflineException('The device {sn} is offline', {sn: input.sn})
        return `Rebooting ${input.sn}`
    }

    //The resource of each device: device://A1/status
    @MCPResource('device://{sn}/status', DeviceSnDTO, {mimeType: 'application/json', description: 'The status of a device'})
    public async statusResource(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true} as StatusDTO
    }

    //The prompt device_diagnose
    @MCPPrompt('diagnose', DeviceSnDTO, {description: 'Diagnose the failures of a device'})
    public async diagnose(input: DeviceSnDTO): Promise<string> {
        return `Diagnose the device ${input.sn} from its status and its logs.`
    }
}

Application.run(() => ({
    id: 'devices.app',
    name: 'Devices',
    components: {
        //The standard output belongs to the protocol: the logs go to the standard error
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [DeviceController],
            mcp: stdioMCPEntrypoint({instructions: 'Check the status of a device before rebooting it.'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- The client runs the application as its child process, with a command such as `node build/App.js`, and communicates
  with it over its standard input and output. The application exits once the client closes its input
  (`exitOnClose: false` keeps it running).
- Standard output carries protocol messages: write logs to standard error, as above, and never call `console.log()`.
- `stdioMCPEntrypoint()` options: `serverName` (the application name by default), `serverVersion` (`'1.0.0'`),
  `instructions` for the model, `stdin` and `stdout`, `exitOnClose`, `name` and `middlewares`.
- Over stdio, the server speaks the protocol's 2025 revisions.

## 2. Tools

```text
@MCPTool(name, DTO?, options?)
```

| Option | Meaning |
|---|---|
| `description` | What the tool does, for the model; without it, the model sees `ControllerClass:method` |
| `title` | A name to display |
| `readOnly`, `destructive`, `idempotent`, `openWorld` | Hints for the client: the tool changes nothing, makes changes that cannot be undone, returns the same result when called again, or reaches outside systems |
| `output` | The result's DTO: its JSON Schema is sent, and the result is also returned as structured content |
| `acl`, `rule`, `middlewares`… | The options of every action (see [Controllers and Actions](Controllers.md), section 3) |

- A name has 1 to 128 letters, digits, `_`, `-` or `.`. `@Prefix({mcp: 'device'})` prefixes a controller's tool and
  prompt names: `status` becomes `device_status`.
- Arguments are described by the DTO's JSON Schema; `.description()` describes an argument to the model. The DTO
  validates them, as for every action.
- A tool declared by two controllers is served by the one registered last, as on other transports.

What a tool returns becomes its result:

| Returned | Result |
|---|---|
| A string | One text |
| An object | Its JSON as a text, and the object as structured content |
| `undefined` | No content |
| `Result.file(buffer, {contentType})` | An image or an audio for these types, otherwise an embedded resource |
| `Result.status(status, data)` | Its data |

- A class instance (a DTO) is returned as structured content only when the tool declares `output`. A tool that
  declares `output` and returns no object fails.
- The server does not check the structured content against `output`; the client does, and refuses a result that does
  not match.
- An error thrown by the tool, including its validation and its access control, reaches the model as a result marked
  as an error, whose text is `errno: message` (`E_OFFLINE: The device off is offline`). The model can then correct its
  call.

## 3. Resources

```text
@MCPResource(uri, DTO?, options?)
```

- A URI without variables (`device://catalog`) is a standalone resource; a URI with variables (`device://{sn}/status`)
  is a template, which the client fills. URIs are never prefixed.
- The variables are the action's input. They are strings: declare them as strings, or convert them with
  `.strict(false)`, as for an HTTP request's query.
- Options: `resourceName` (the listed name; the action's name by default), `title`, `mimeType`, `audience`
  (`['user']`, `['assistant']`), `priority` (from 0 to 1), and the options of every action.

| Returned | Content |
|---|---|
| A string | A text, of the `mimeType` (`text/plain` by default) |
| Another value | Its JSON, of the `mimeType` (`application/json` by default) |
| A `Buffer`, `Result.file()` | A text or a binary, by its type |

An error thrown while a resource is read is returned as a protocol error: invalid params (`-32602`) when its
`statusCode` is a client error (400 to 499, including invalid input), internal error (`-32603`) otherwise. Its message
is `errno: message`.

## 4. Prompts

```text
@MCPPrompt(name, DTO?, options?)
```

- The DTO's properties are the prompt's arguments, listed to the client. They are strings: declare them as strings, or
  convert them with `.strict(false)`.
- A string becomes one user message; an array, one message per item (a string, or `{role, content}`); an object
  `{messages}` is sent unchanged.
- Options: `title`, and the options of every action. Errors are returned as for resources.

## 5. The context

In an MCP action, `this.context` is an `MCPContext`:

| Property | What it is |
|---|---|
| `kind` | `'tool'`, `'resource'` or `'prompt'` |
| `name` | The tool or prompt name, including its prefix; for a resource, its URI as declared |
| `uri` | The URI read, for a resource |
| `data` | The arguments, before validation (empty for a resource, whose variables are its input) |
| `authInfo` | What `authenticate` returned (section 6) |
| `progress(progress, total?, message?)` | Reports a long call's progress to the client |

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {MCPTool, type MCPContext} from '@lakutata/mcp'

class ImportController extends Controller {
    @MCPTool('import', {description: 'Import the devices'})
    public async import(): Promise<string> {
        const context: MCPContext = this.context as MCPContext
        for (let step: number = 1; step <= 3; step++) {
            //The client cancelled the call
            if (this.signal?.aborted) return 'cancelled'
            await context.progress(step, 3, `step ${step}`)
        }
        return 'imported'
    }
}
```

- When the client cancels a call, `this.signal` is aborted.
- A method may serve several transports at the same time (`@GET` and `@MCPTool`): `this.context.type` is then `'MCP'`
  (`MCP_CONTEXT_TYPE`) for MCP requests.
- The entrypoint's access rules apply to MCP actions declared with `acl: true` when their `supportContextTypes()`
  include `MCP_CONTEXT_TYPE` (see [Middlewares and Access Control](Middlewares.md)).
- The server does not ask the client for anything: there is no sampling, elicitation or logging to the client.

**Notifications.** `MCPNotifier`, a component to inject (`@Inject(MCPNotifier)`), tells clients that something
changed: `resourceUpdated(uri)`, `resourcesChanged()`, `toolsChanged()`, `promptsChanged()`. Over stdio, a resource
update reaches the client only if it subscribed to that URI. Over HTTP, only clients of revision 2026-07-28 that listen
for changes are notified.

## 6. Over HTTP

```typescript
import type {IncomingMessage} from 'node:http'
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {httpMCPEntrypoint, MCPTool, type MCPAuthInfo} from '@lakutata/mcp'

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

//The clients connect to http://127.0.0.1:3000/mcp
Application.run(() => ({
    id: 'clock.app',
    name: 'Clock',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [ClockController],
            mcp: httpMCPEntrypoint({port: 3000, authenticate: verifyToken})
        })
    },
    bootstrap: ['entrypoint']
}))
```

| Option | Default | Meaning |
|---|---|---|
| `port`, `host`, `path` | `3000`, `'127.0.0.1'`, `'/mcp'` | Where it listens |
| `authenticate` | | `(request) => MCPAuthInfo \| undefined`: the client's authentication; if it throws, the server responds with 401, and if it returns `undefined`, the request is served without one |
| `allowedHosts`, `allowedOrigins` | the local names, on a local address or the loopback interface | The `Host` and `Origin` headers accepted (403 otherwise); `false` checks none |
| `interface`, `family`, `strict`, `onError` | | Listen on a network interface instead of `host`, with the `@lakutata/netif` package (see [HTTP](HTTP.md), section 2) |
| `legacy` | `'stateless'` | Clients of the 2025 revisions: served without sessions, or refused with `'reject'` |
| `maxRequestBodySize` | 4 MiB | A larger body receives a 413 response |
| `bus` | in memory | Where notifications go, to share them between application instances |
| `listen` | `true` | `false` opens no port: the `handler` is mounted on another server |
| `serverName`, `serverVersion`, `instructions`, `server`, `listening`, `name`, `middlewares` | | As for stdio; `server` holds the `node:http` server options |

- It serves the protocol over Streamable HTTP: revision 2026-07-28, and the 2025 revisions without sessions.
- On a local address, the `Host` and `Origin` headers are checked against the local names, which protects the server
  from DNS rebinding: behind a proxy, list the names clients use. On another address, nothing is checked unless you
  list names. The same applies to `interface`: the loopback interface is checked against the local names, and on
  another interface, clients on the network reach the server, so set `allowedHosts` and `authenticate`.
- When the application stops, the server responds to calls in progress, then the port closes.

**Sharing the HTTP adapter's port.** With `listen: false`, mount the adapter's `handler` on the Express application, in
its `before` hook:

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {httpMCPEntrypoint} from '@lakutata/mcp'

//The names the clients connect with (http://localhost:8080/mcp)
const mcp = httpMCPEntrypoint({listen: false, allowedHosts: ['localhost', '127.0.0.1', 'mcp.example.com']})

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({port: 8080, before: (app): void => void app.all('/mcp', mcp.handler)}),
    mcp: mcp
})
```

A mounted handler checks the `Host` and `Origin` headers only against the specified names, and responds with 503
before the adapter starts and after it stops.

## 7. Errors

| Situation | The client receives |
|---|---|
| A tool fails: an exception, an invalid argument, a refused access | A result marked as an error: `errno: message` |
| A resource or a prompt fails with a client error (400 to 499) | The protocol error `-32602`, its message `errno: message`, its data `{errno}` |
| A resource or a prompt fails otherwise | The protocol error `-32603` |
| An unknown tool, prompt or resource | The protocol error `-32602` (`Tool nope not found`) |

An invalid tool or prompt name, or a resource URI without a scheme, makes the decorator throw a `TypeError` when the
class is declared; no client receives it.
