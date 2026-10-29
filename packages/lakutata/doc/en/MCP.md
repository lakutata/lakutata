# Lakutata MCP

The Model Context Protocol (MCP) lets an AI assistant use an application: call its **tools**, read its **resources**
and fill its **prompts**. The package `@lakutata/mcp` serves controller methods as these, over the standard input and
output of a child process or over HTTP. It is not part of `lakutata`:

```bash
npm install lakutata @lakutata/mcp
```

| Declared with | What it is | Who uses it |
|---|---|---|
| `@MCPTool(name)` | An action the model calls with arguments | The model, when it decides to |
| `@MCPResource(uri)` | Data read by its URI | The client, to give it to the model |
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

- The client runs the application as its child process, with a command such as `node build/App.js`, and speaks to it
  on its standard input and output. The application exits once the client closes its input (`exitOnClose: false`
  keeps it running).
- The standard output carries the messages of the protocol: write the logs to the standard error, as above, and never
  call `console.log()`.
- The options of `stdioMCPEntrypoint()`: `serverName` (the name of the application by default), `serverVersion`
  (`'1.0.0'`), `instructions` for the model, `stdin` and `stdout`, `exitOnClose`, `name` and `middlewares`.
- Over stdio, the server speaks the revisions of 2025 of the protocol.

## 2. Tools

```text
@MCPTool(name, DTO?, options?)
```

| Option | Meaning |
|---|---|
| `description` | What the tool does, for the model; without it, the model sees `ControllerClass:method` |
| `title` | A name to display |
| `readOnly`, `destructive`, `idempotent`, `openWorld` | Hints for the client: the tool changes nothing, makes changes that cannot be undone, gives the same result when called again, or reaches outside systems |
| `output` | The DTO of the result: its JSON schema is sent, and the result is given as structured content too |
| `acl`, `rule`, `middlewares`… | The options of every action (see [Controllers](Controllers.md), section 3) |

- A name has 1 to 128 letters, digits, `_`, `-` or `.`. `@Prefix({mcp: 'device'})` prefixes the names of the tools and
  of the prompts of a controller: `status` becomes `device_status`.
- The arguments are described by the JSON schema of the DTO; `.description()` describes an argument to the model. The
  DTO validates them, as for every action.
- A tool declared by two controllers is served by the one registered last, as on the other transports.

What a tool returns becomes its result:

| Returned | Result |
|---|---|
| A string | One text |
| An object | Its JSON as a text, and the object as structured content |
| `undefined` | No content |
| `Result.file(buffer, {contentType})` | An image or an audio for these types, otherwise an embedded resource |
| `Result.status(status, data)` | Its data |

- A class instance (a DTO) is given as structured content only when the tool declares `output`. A tool that declares
  `output` and returns no object fails.
- The server does not check the structured content against `output`; the client does, and refuses a result that does
  not match.
- An error thrown by the tool, its validation or its access control included, is given to the model as a result
  marked as an error, whose text is `errno: message` (`E_OFFLINE: The device off is offline`). The model can then
  correct its call.

## 3. Resources

```text
@MCPResource(uri, DTO?, options?)
```

- A URI without variables (`device://catalog`) is a resource of its own; a URI with variables
  (`device://{sn}/status`) is a template, which the client fills. The URIs are never prefixed.
- The variables are the input of the action. They are strings: declare them as strings, or convert them with
  `.strict(false)`, as the query of an HTTP request.
- The options: `resourceName` (the name listed; the name of the action by default), `title`, `mimeType`, `audience`
  (`['user']`, `['assistant']`), `priority` (from 0 to 1), and the options of every action.

| Returned | Content |
|---|---|
| A string | A text, of the `mimeType` (`text/plain` by default) |
| Another value | Its JSON, of the `mimeType` (`application/json` by default) |
| A `Buffer`, `Result.file()` | A text or a binary, by its type |

An error thrown when a resource is read is answered as an error of the protocol: invalid params (`-32602`) when its
`statusCode` is a client error (400 to 499, an invalid input among them), internal error (`-32603`) otherwise. Its
message is `errno: message`.

## 4. Prompts

```text
@MCPPrompt(name, DTO?, options?)
```

- The properties of the DTO are the arguments of the prompt, listed to the client. They are strings: declare them as
  strings, or convert them with `.strict(false)`.
- A string becomes one message of the user; an array, one message per item (a string, or `{role, content}`); an object
  `{messages}` is sent as it is.
- The option `title`, and the options of every action. The errors are answered as for the resources.

## 5. The context

In an MCP action, `this.context` is an `MCPContext`:

| Property | What it is |
|---|---|
| `kind` | `'tool'`, `'resource'` or `'prompt'` |
| `name` | The name of the tool or of the prompt, prefix included; for a resource, its URI as declared |
| `uri` | The URI read, for a resource |
| `data` | The arguments, before the validation (empty for a resource, whose variables are its input) |
| `authInfo` | What `authenticate` returned (section 6) |
| `progress(progress, total?, message?)` | Reports the progress of a long call to the client |

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
- A method may serve several transports at once (`@GET` and `@MCPTool`): `this.context.type` is then `'MCP'`
  (`MCP_CONTEXT_TYPE`) for the MCP requests.
- The access rules of the entrypoint apply to the MCP actions declared with `acl: true` when their
  `supportContextTypes()` include `MCP_CONTEXT_TYPE` (see [Middlewares](Middlewares.md)).
- The server does not ask the client for anything: there is no sampling, elicitation or logging to the client.

**Notifications.** `MCPNotifier`, a component to inject (`@Inject(MCPNotifier)`), tells the clients that something
changed: `resourceUpdated(uri)`, `resourcesChanged()`, `toolsChanged()`, `promptsChanged()`. Over stdio, a resource
update reaches the client only if it subscribed to that URI. Over HTTP, only the clients of the revision 2026-07-28
that listen to the changes are notified.

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
| `authenticate` | | `(request) => MCPAuthInfo \| undefined`: the authentication of the client; throwing answers 401, returning `undefined` serves the request without one |
| `allowedHosts`, `allowedOrigins` | the local names, on a local address or the loopback interface | The `Host` and `Origin` headers accepted (403 otherwise); `false` checks none |
| `interface`, `family`, `strict`, `onError` | | Listen on a network interface instead of `host`, with the package `@lakutata/netif` (see [HTTP](HTTP.md), section 2) |
| `legacy` | `'stateless'` | The clients of the revisions of 2025: served without sessions, or refused with `'reject'` |
| `maxRequestBodySize` | 4 MiB | A larger body is answered with 413 |
| `bus` | in memory | Where the notifications go, to share them between the instances of the application |
| `listen` | `true` | `false` opens no port: the `handler` is mounted on another server |
| `serverName`, `serverVersion`, `instructions`, `server`, `listening`, `name`, `middlewares` | | As for stdio; `server` holds the options of the `node:http` server |

- It serves the protocol over Streamable HTTP: the revision 2026-07-28, and the revisions of 2025 without sessions.
- On a local address, the `Host` and `Origin` headers are checked against the local names, which protects the server
  from DNS rebinding: behind a proxy, list the names the clients use. On another address, nothing is checked unless you
  list names. The same goes for `interface`: the loopback interface is checked against the local names, and on another
  interface the clients of the network reach the server, so set `allowedHosts` and `authenticate`.
- When the application stops, the calls in progress are answered, then the port closes.

**Sharing the port of the HTTP adapter.** With `listen: false`, mount the `handler` of the adapter on the Express
application, in its `before` hook:

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

A mounted handler checks the `Host` and `Origin` headers only against the names given, and answers 503 before the
adapter starts and once it stops.

## 7. Errors

| Situation | The client receives |
|---|---|
| A tool fails: an exception, an invalid argument, a refused access | A result marked as an error: `errno: message` |
| A resource or a prompt fails with a client error (400 to 499) | The protocol error `-32602`, its message `errno: message`, its data `{errno}` |
| A resource or a prompt fails otherwise | The protocol error `-32603` |
| An unknown tool, prompt or resource | The protocol error `-32602` (`Tool nope not found`) |
| An invalid name of a tool or a prompt, a resource URI without scheme | A `TypeError` when the class is declared |
