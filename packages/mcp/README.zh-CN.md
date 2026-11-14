# @lakutata/mcp

[English](README.md) | 中文

[Lakutata](https://github.com/lakutata/lakutata) 框架的 MCP 传输方式。AI 应用（Claude Desktop、Claude Code、IDE、智能体）通过[模型上下文协议](https://modelcontextprotocol.io)（MCP）使模型能够使用其他程序的工具、数据和提示词。本包通过 stdio 或 Streamable HTTP，将应用中控制器的动作作为 MCP 服务器的工具、资源和提示词对外提供。这些工具、资源和提示词与应用的 HTTP、CLI 及服务动作经过同一套入口、中间件、校验和访问控制。`lakutata` 包不会重新导出本包，请从 `@lakutata/mcp` 导入。

| | 何时使用 | 声明方式 |
|---|---|---|
| 工具 | 模型决定调用时 | `@MCPTool(name, DTO?, options?)` |
| 资源 | 应用或用户将资源附加到对话中时 | `@MCPResource(uri, DTO?, options?)` |
| 提示词 | 用户选择某个提示词时（客户端中的斜杠命令） | `@MCPPrompt(name, DTO?, options?)` |

## 安装

```shell
npm install lakutata @lakutata/mcp
```

本包需要 Node.js `>=18.10.0`。本包的 peer 依赖 `@lakutata/core` 和 `@lakutata/entrypoint` 随 `lakutata` 一并安装；协议本身由依赖 `@modelcontextprotocol/server` 实现。Node.js 18 没有全局的 `crypto`，而 SDK 需要该对象，因此本包会将其设为 `node:crypto` 的 `webcrypto`（Node.js 19 及以后版本设置的全局对象也是这一对象）。

## 用法

### MCP 服务器

`stdioMCPEntrypoint` 和 `httpMCPEntrypoint` 是入口的 `mcp` 适配器。只有用 `@MCPTool` 声明的动作才会成为工具。工具供模型使用，因此默认不暴露任何动作。同一个方法还可以同时是 HTTP、CLI 或服务动作。

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
    //工具 device_status
    @MCPTool('status', DeviceSnDTO, {description: 'The online status of a device', readOnly: true, output: StatusDTO})
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true} as StatusDTO
    }

    //工具 device_reboot：客户端会先征得用户同意，再调用它
    @MCPTool('reboot', DeviceSnDTO, {description: 'Reboot a device', destructive: true})
    public async reboot(input: DeviceSnDTO): Promise<string> {
        return `Rebooting ${input.sn}`
    }
}

Application.run(() => ({
    id: 'devices.app',
    name: 'Devices',
    components: {
        //基于 stdio 时，标准输出留给协议使用
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [DeviceController],
            mcp: stdioMCPEntrypoint({instructions: 'Check the status of a device before rebooting it.'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

### 连接 AI 客户端

基于 stdio 时，客户端将应用作为子进程运行。在 Claude Code 中，请运行 `claude mcp add devices -- node build/App.js`；在 Claude Desktop 和大多数其他客户端中，请将服务器添加到客户端的 MCP 配置中：

```text
{"mcpServers": {"devices": {"command": "node", "args": ["/path/to/dist/app.js"]}}}
```

基于 HTTP 时，客户端连接端点的 URL，例如 `http://127.0.0.1:3000/mcp`（在 Claude Code 中：`claude mcp add --transport http devices http://127.0.0.1:3000/mcp`），并发送 `authenticate` 所要求的请求头。

### 工具

- 工具名会加上所在控制器的 `mcp` 前缀（`@Prefix({mcp})`），以 `_` 连接（`device_status`）。名称由 1 到 128 个字母、数字、`_`、`-` 或 `.` 组成。
- 工具的输入 schema 即 DTO 的 JSON Schema（用 `.description()` 描述各个属性）。与其他传输方式相同，DTO 在中间件之后校验输入。
- 工具的描述即 `description` 选项；未设置该选项时，模型看到的是动作的名称（默认为 `ControllerClass:method`）。请写清楚工具的用途和适用时机。
- `title`、`readOnly`、`destructive`、`idempotent` 和 `openWorld` 会传给客户端，客户端据此决定调用前是否需要用户确认。
- `output` 是结果的 DTO，其 JSON Schema 即工具的输出 schema。此时动作必须返回一个对象（普通对象或 DTO 实例），该对象成为结果的结构化内容。返回其他值（字符串、数组或不返回任何值）时，得到的是一个错误结果，其中写明了动作名及其返回值的类型。
- 所有动作共有的选项（`name`、`description`、`acl`、`rule`、`middlewares`……）也可以使用。

| 动作返回 | 工具结果 |
|---|---|
| 字符串 | 一段文本 |
| 普通对象 | 对象的 JSON 文本，同时将对象作为结构化内容 |
| DTO 实例（类的实例） | 实例的 JSON 文本；声明了 `output` 时，实例的 JSON 对象还会作为结构化内容 |
| 其他值（数组、数字……） | 值的 JSON 文本 |
| `Result.file(...)` | 按内容类型给出图片、音频或嵌入的资源 |
| `CallToolResult`（`{content: [...]}`） | 原样作为结果 |
| `undefined` | 空结果 |

错误会以 `isError: true` 的结果返回给模型，其文本为 `errno: message`，模型可以据此修正输入并再次调用工具。

### 资源

资源是按 URI 访问的只读数据。URI 模板中的变量会合并到输入中，与路由参数相同（变量优先于输入中的同名值）。

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
    //由 resources/templates/list 列出：device://A1/status 读取设备 A1
    @MCPResource('device://{sn}/status', DeviceSnDTO, {mimeType: 'application/json', description: 'The status of a device'})
    public async status(input: DeviceSnDTO): Promise<{sn: string, online: boolean}> {
        return {sn: input.sn, online: true}
    }

    //由 resources/list 列出
    @MCPResource('device://catalog', {resourceName: 'catalog', title: 'The device catalog'})
    public async catalog(): Promise<string> {
        return 'A1, B2'
    }
}
```

- 没有变量的 URI 由 `resources/list` 列出，URI 模板由 `resources/templates/list` 列出。URI 以协议名开头（`device://`）。
- 资源的名称为 `resourceName`，默认为动作的名称；`title`、`mimeType`、`audience` 和 `priority` 用于描述资源。控制器不会为 URI 添加前缀。
- 字符串成为文本（没有设置 `mimeType` 时为 `text/plain`）；字节和文件按内容类型成为文本或二进制数据（blob）；其他值成为 JSON；`ReadResourceResult`（`{contents: [...]}`）按原样返回。
- 错误会成为协议错误：客户端错误（`statusCode` 为 4xx）对应“参数无效”，其他错误对应“内部错误”。

### 提示词

提示词是一个消息模板，其参数即 DTO 的属性（客户端以字符串形式发送这些参数）。

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
    //提示词 device_diagnose
    @MCPPrompt('diagnose', DeviceSnDTO, {title: 'Diagnose a device', description: 'Diagnose the failures of a device'})
    public async diagnose(input: DeviceSnDTO): Promise<string> {
        return `Diagnose the device ${input.sn} from its status and its logs.`
    }
}
```

字符串成为一条用户消息；数组给出各条消息（字符串表示用户的消息，或为 `{role, content}`）；`GetPromptResult`（`{messages: [...]}`）按原样返回。提示词的名称与工具名一样会加上前缀。错误会成为协议错误，与资源相同。

### 上下文

动作收到的上下文是一个 `MCPContext`，其中有 `context.kind`（`tool`、`resource` 或 `prompt`）、`context.name`（工具或提示词的名称，或资源的 URI 模板）、`context.uri`（读取的 URI）、`context.authInfo`（基于 HTTP 时），以及 `context.progress(progress, total?, message?)`，后者用于在客户端要求时报告耗时调用的进度。只有带会话的传输方式才会设置 `context.sessionId`，因此使用内置的适配器时，该值为 `undefined`。客户端取消调用时，动作的信号（`this.signal`）会被中止。

### 通知

`MCPNotifier` 用于通知客户端应用中发生了哪些变化。可以将其注入任何对象（`@Inject(MCPNotifier)`），或通过 `getObject(MCPNotifier)` 获取。该组件会自动加载，每个应用一个实例。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {MCPNotifier} from '@lakutata/mcp'

export class DeviceWatcher extends Component {
    @Inject(MCPNotifier)
    protected readonly notifier: MCPNotifier

    public statusChanged(sn: string): void {
        //订阅了这个资源的客户端会重新读取它
        this.notifier.resourceUpdated(`device://${sn}/status`)
    }
}
```

`resourceUpdated(uri)`、`resourcesChanged()`、`toolsChanged()` 和 `promptsChanged()` 通过应用正在运行的 MCP 适配器发送给客户端（不会经过同一进程中其他应用的适配器）：

- 基于 stdio 时，只有订阅了该资源（`resources/subscribe`）的客户端才会收到 `resourceUpdated()`；
- 基于 HTTP 时，使用 2026-07-28 协议版本并监听变化（`subscriptions/listen`）的客户端会收到通知。服务器以无会话的方式为 2025 年各协议版本的客户端提供服务，因此无法通知这些客户端。每个进程都将订阅保存在内存中。应用的多个实例运行在负载均衡器之后时，这些实例需要共用一条通知总线（`bus: ServerEventBus`，基于 Redis、NATS 等），这样无论客户端监听的是哪个实例，都能收到通知。

### stdioMCPEntrypoint

客户端将应用作为子进程运行，并通过子进程的标准输入输出与应用通信。客户端关闭应用的标准输入后，应用随即退出（设置 `exitOnClose: false` 可使应用继续运行）。

标准输出留给协议使用，因此**应用必须将日志写入标准错误**，例如使用 `log: {class: Logger, destinations: [process.stderr]}`。

选项为：`serverName`（默认为应用的名称）、`serverVersion`（`'1.0.0'`）、`instructions`（提供给模型）、`stdin` 和 `stdout`（默认为进程的标准输入输出）、`exitOnClose`（`true`）、`name` 以及 `middlewares`。

### httpMCPEntrypoint

一个 Streamable HTTP 端点（`path`，默认 `/mcp`），提供 2026-07-28 版本的协议，并以无会话的方式为 2025 年各协议版本的客户端提供服务（设置 `legacy: 'reject'` 则拒绝这些客户端）。

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

//抛出错误时以 401 响应
function verifyToken(request: IncomingMessage): MCPAuthInfo {
    const token: string = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (token !== process.env.MCP_TOKEN) throw new Error('Invalid token')
    return {token: token, clientId: 'assistant', scopes: []}
}

Application.run(() => ({
    id: 'clock.app',
    name: 'Clock',
    components: {
        //传输方式中有 stdio 时，日志写到标准错误
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [ClockController],
            //同时使用两种传输方式
            mcp: [
                stdioMCPEntrypoint(),
                httpMCPEntrypoint({port: 3000, authenticate: verifyToken})
            ]
        })
    },
    bootstrap: ['entrypoint']
}))
```

- 默认监听 `127.0.0.1:3000`（`host`、`port`）。监听回环地址时，适配器会将 `Host` 和 `Origin` 请求头与本机的主机名比对，并拒绝不匹配的请求（`403`），以防范 DNS 重绑定攻击；`allowedHosts` 和 `allowedOrigins` 可以设置其他名称，`false` 表示关闭对应的检查。
- `interface` 使适配器按网口监听（代替 `host`），无论网口当前的地址是什么（可以再配合 `family`、`strict` 和 `onError` 使用），需要另外安装 `@lakutata/netif` 包。在回环网口上，请求头的检查与回环地址上相同；在其他网口上，请设置 `allowedHosts` 和 `authenticate`。
- `authenticate(request)` 返回客户端的认证信息，动作从 `context.authInfo` 中获取该信息；该函数抛出错误时，适配器以 `401` 响应。返回 `undefined` 时，请求不经认证，仍照常处理。
- 超过 `maxRequestBodySize`（默认 4 MiB）的请求体以 `413` 响应；`server` 是 `node:http` 服务器的选项；服务器开始监听后，会调用 `listening(server, listeners)`（设置了 `interface` 时，`listeners` 是网口的监听器）。
- 适配器随入口一起优雅停止：不再接受请求，正在处理的调用会得到响应（入口等待这些调用完成，之后适配器最多再用一秒将响应发出），然后关闭订阅流和其余连接，包括应用通过协议升级（upgrade）接管的连接。

#### 与其他 HTTP 服务器共用端口

设置 `listen: false` 后，适配器不打开端口，其 `handler` 挂载到其他服务器上，例如 `expressHTTPEntrypoint` 的 Express 应用（也可以是 Next.js 的自定义服务器或 `node:http`）。此时生效的是该服务器的路由、中间件和端口；该服务器已经解析过的请求体（`express.json()`）会被直接使用。

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

该处理函数只按给出的 `allowedHosts` 和 `allowedOrigins` 检查 `Host` 和 `Origin` 请求头，因为适配器不知道挂载该函数的服务器的主机名。在适配器启动之前和停止之后，处理函数以 `503` 响应。

### 其他传输方式

`buildMCPServer(runtime, info)` 为某个传输方式运行时（channel runtime）中的动作构建 MCP 服务器，再由自定义适配器将该服务器接入其他传输方式；`toToolResult`、`toErrorResult`、`toResourceResult` 和 `toPromptResult` 按内置适配器的方式转换结果。

## API

| 导出 | 说明 |
|---|---|
| `MCPTool`、`MCPToolOptions` | 方法装饰器：将动作作为工具提供；`title`、提供给客户端的提示、`output` |
| `MCPResource`、`MCPResourceOptions` | 方法装饰器：将动作作为某个 URI 或 URI 模板上的资源提供；`resourceName`、`title`、`mimeType`、`audience`、`priority` |
| `MCPPrompt`、`MCPPromptOptions` | 方法装饰器：将动作作为提示词提供；`title` |
| `stdioMCPEntrypoint`、`StdioMCPEntrypointOptions` | stdio 适配器，用于将应用作为子进程运行的客户端 |
| `httpMCPEntrypoint`、`HTTPMCPEntrypointOptions`、`HTTPMCPEntrypointAdapter` | Streamable HTTP 适配器，以及用于挂载到其他服务器上的 `handler` |
| `MCPNotifier` | 通知客户端：`resourceUpdated`、`resourcesChanged`、`toolsChanged`、`promptsChanged` |
| `MCPContext`、`MCPContextParams`、`MCP_CONTEXT_TYPE`、`MCPRequestKind`、`MCPAuthInfo` | 请求的上下文：`kind`、`name`、`uri`、`sessionId`、`authInfo`、`progress()` |
| `buildMCPServer`、`MCPServerInfo` | 为传输方式运行时构建 MCP 服务器，供自定义适配器使用；服务器的名称、版本和说明 |
| `toToolResult`、`toErrorResult`、`toResourceResult`、`toPromptResult` | 转换动作的结果和错误 |
| `MCPMetadata` | 动作的 MCP 元数据，由适配器读取 |
| `MCPChannel` | `mcp` 传输方式的定义，供自定义适配器使用 |
| `ServerEventBus`、`ServerEvent` | 从 `@modelcontextprotocol/server` 重新导出：通知总线（`bus` 选项） |

类型声明中的每一项都附有说明和示例。

## 错误

| 错误 | 何时出现 |
|---|---|
| `TypeError` | 声明类时：工具或提示词的名称不是由 1 到 128 个字母、数字、`_`、`-` 或 `.` 组成，或资源 URI 没有协议名。转换结果时：结果是事件流（`Result.events()`），或提示词返回了文件 |
| `Error`（`EADDRINUSE`……） | `httpMCPEntrypoint` 启动时其服务器无法监听，入口启动失败 |
| 工具抛出的错误 | 一个 `isError: true`、文本为 `errno: message` 的结果，返回给模型 |
| 资源或提示词抛出的错误 | 协议错误：`statusCode` 为 4xx 时是参数无效（`-32602`），否则是内部错误（`-32603`）；错误消息是 `errno: message` |
| 协议错误 `-32602`（`Tool nope not found`） | 请求的工具、资源或提示词没有对应的动作，由 MCP SDK 响应 |
| `ControllerActionNotFoundException`（来自 `lakutata/com/entrypoint`） | 自定义适配器分派了一个没有动作处理的请求（`runtime.dispatch()`） |

基于 HTTP 时，如果 `authenticate` 抛出错误，适配器以 `401` 响应；`Host` 或 `Origin` 被拒绝时为 `403`；其他路径（在适配器自身的服务器上）为 `404`；请求体超过 `maxRequestBodySize` 时为 `413`。挂载的处理函数在适配器启动之前和停止之后以 `503` 响应；适配器自身的服务器在停止时关闭端口（此时仍打开的连接上如有请求，会得到 `503`）。

## 另见

- 网站上的指南：[MCP](https://lakutata.com/zh/guide/MCP)。
- `@lakutata/entrypoint`（`lakutata/com/entrypoint`）：入口、控制器、`@Prefix`、中间件和访问控制（见 `lakutata` 包中的 `doc/zh/Controllers.md`、`Entrypoint.md` 和 `Middlewares.md`）。
- [模型上下文协议](https://modelcontextprotocol.io)：规范和客户端。
- `@lakutata/core`（`lakutata`）：组件、`Application`、DTO 和依赖注入。
