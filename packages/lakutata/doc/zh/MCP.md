# Lakutata MCP

模型上下文协议（MCP）让 AI 助手使用一个应用：调用它的**工具**，读取它的**资源**，填写它的**提示词**。`@lakutata/mcp` 包把控制器方法作为这些内容提供出来，可以通过子进程的标准输入输出，也可以通过 HTTP。它不属于 `lakutata`：

```bash
npm install lakutata @lakutata/mcp
```

| 声明方式 | 是什么 | 谁来使用 |
|---|---|---|
| `@MCPTool(name)` | 模型带着参数调用的动作 | 模型，在它决定调用时 |
| `@MCPResource(uri)` | 按 URI 读取的数据 | 客户端，把它交给模型 |
| `@MCPPrompt(name)` | 用参数填写的消息模板 | 用户，在客户端中选择它 |

## 1. 基于 stdio 的服务器

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
    //工具 device_status
    @MCPTool('status', DeviceSnDTO, {description: 'The online status of a device', readOnly: true, output: StatusDTO})
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: input.sn !== 'off'} as StatusDTO
    }

    @MCPTool('reboot', DeviceSnDTO, {description: 'Reboot a device', destructive: true})
    public async reboot(input: DeviceSnDTO): Promise<string> {
        if (input.sn === 'off') throw new OfflineException('The device {sn} is offline', {sn: input.sn})
        return `Rebooting ${input.sn}`
    }

    //每台设备的资源：device://A1/status
    @MCPResource('device://{sn}/status', DeviceSnDTO, {mimeType: 'application/json', description: 'The status of a device'})
    public async statusResource(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true} as StatusDTO
    }

    //提示词 device_diagnose
    @MCPPrompt('diagnose', DeviceSnDTO, {description: 'Diagnose the failures of a device'})
    public async diagnose(input: DeviceSnDTO): Promise<string> {
        return `Diagnose the device ${input.sn} from its status and its logs.`
    }
}

Application.run(() => ({
    id: 'devices.app',
    name: 'Devices',
    components: {
        //标准输出属于协议：日志写到标准错误
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [DeviceController],
            mcp: stdioMCPEntrypoint({instructions: 'Check the status of a device before rebooting it.'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- 客户端用 `node build/App.js` 这样的命令把应用作为子进程运行，通过它的标准输入输出与它通信。客户端关闭它的输入后，应用就会退出（`exitOnClose: false` 让它继续运行）。
- 标准输出承载协议的消息：日志要像上面那样写到标准错误，也不能调用 `console.log()`。
- `stdioMCPEntrypoint()` 的选项：`serverName`（默认为应用的名字）、`serverVersion`（`'1.0.0'`）、给模型的 `instructions`、`stdin` 和 `stdout`、`exitOnClose`、`name` 以及 `middlewares`。
- 在 stdio 上，服务器使用 2025 年的几个协议版本。

## 2. 工具

```text
@MCPTool(name, DTO?, options?)
```

| 选项 | 含义 |
|---|---|
| `description` | 工具做什么，写给模型看；没有它时，模型看到的是 `ControllerClass:method` |
| `title` | 用于显示的名字 |
| `readOnly`、`destructive`、`idempotent`、`openWorld` | 给客户端的提示：工具不做任何修改、会做出不可撤销的修改、再次调用结果相同、会访问外部系统 |
| `output` | 结果的 DTO：发送它的 JSON Schema，结果也会同时作为结构化内容给出 |
| `acl`、`rule`、`middlewares`…… | 所有动作共有的选项（见 [Controllers](Controllers.md) 第 3 节） |

- 名字由 1 到 128 个字母、数字、`_`、`-` 或 `.` 组成。`@Prefix({mcp: 'device'})` 给控制器中工具和提示词的名字加上前缀：`status` 变成 `device_status`。
- 参数由 DTO 的 JSON Schema 描述；`.description()` 向模型说明一个参数。DTO 校验参数，与所有动作一样。
- 两个控制器声明了同一个工具时，由后注册的那个提供，与其他传输方式相同。

工具的返回值成为它的结果：

| 返回 | 结果 |
|---|---|
| 字符串 | 一段文本 |
| 对象 | 它的 JSON 文本，同时把对象作为结构化内容 |
| `undefined` | 没有内容 |
| `Result.file(buffer, {contentType})` | 对应类型时是图片或音频，否则是嵌入的资源 |
| `Result.status(status, data)` | 它的数据 |

- 类的实例（DTO）只有在工具声明了 `output` 时才作为结构化内容给出。声明了 `output` 却没有返回对象的工具会失败。
- 服务器不按 `output` 检查结构化内容；由客户端检查，不符合的结果会被客户端拒绝。
- 工具抛出的错误，包括参数校验和访问控制的错误，会作为标记为错误的结果交给模型，文本是 `errno: message`（`E_OFFLINE: The device off is offline`）。模型可以据此修正它的调用。

## 3. 资源

```text
@MCPResource(uri, DTO?, options?)
```

- 没有变量的 URI（`device://catalog`）是一个独立的资源；带变量的 URI（`device://{sn}/status`）是一个模板，由客户端填写。URI 不会加前缀。
- 变量就是动作的输入。它们是字符串：把它们声明为字符串，或者像 HTTP 请求的查询参数那样，用 `.strict(false)` 转换。
- 选项：`resourceName`（列出的名字，默认是动作的名字）、`title`、`mimeType`、`audience`（`['user']`、`['assistant']`）、`priority`（0 到 1），以及所有动作共有的选项。

| 返回 | 内容 |
|---|---|
| 字符串 | 文本，类型为 `mimeType`（默认 `text/plain`） |
| 其他值 | 它的 JSON，类型为 `mimeType`（默认 `application/json`） |
| `Buffer`、`Result.file()` | 按类型给出文本或二进制数据 |

读取资源时抛出的错误以协议错误响应：`statusCode` 是客户端错误（400 到 499，包括输入无效）时为参数无效（`-32602`），否则为内部错误（`-32603`）。错误消息是 `errno: message`。

## 4. 提示词

```text
@MCPPrompt(name, DTO?, options?)
```

- DTO 的属性就是提示词的参数，会列给客户端。它们是字符串：把它们声明为字符串，或者用 `.strict(false)` 转换。
- 字符串成为一条用户消息；数组的每一项成为一条消息（字符串，或者 `{role, content}`）；对象 `{messages}` 按原样发送。
- 选项 `title`，以及所有动作共有的选项。错误的处理与资源相同。

## 5. 上下文

在 MCP 动作中，`this.context` 是一个 `MCPContext`：

| 属性 | 是什么 |
|---|---|
| `kind` | `'tool'`、`'resource'` 或 `'prompt'` |
| `name` | 工具或提示词的名字，包括前缀；对于资源，是声明时的 URI |
| `uri` | 读取的 URI，用于资源 |
| `data` | 校验之前的参数（资源的 `data` 为空，它的变量就是输入） |
| `authInfo` | `authenticate` 的返回值（第 6 节） |
| `progress(progress, total?, message?)` | 向客户端报告耗时调用的进度 |

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {MCPTool, type MCPContext} from '@lakutata/mcp'

class ImportController extends Controller {
    @MCPTool('import', {description: 'Import the devices'})
    public async import(): Promise<string> {
        const context: MCPContext = this.context as MCPContext
        for (let step: number = 1; step <= 3; step++) {
            //客户端取消了这次调用
            if (this.signal?.aborted) return 'cancelled'
            await context.progress(step, 3, `step ${step}`)
        }
        return 'imported'
    }
}
```

- 客户端取消调用时，`this.signal` 会被中止。
- 一个方法可以同时服务多种传输方式（`@GET` 和 `@MCPTool`）：对于 MCP 的请求，`this.context.type` 是 `'MCP'`（`MCP_CONTEXT_TYPE`）。
- 入口的访问规则适用于以 `acl: true` 声明的 MCP 动作，前提是规则的 `supportContextTypes()` 包含 `MCP_CONTEXT_TYPE`（见 [Middlewares](Middlewares.md)）。
- 服务器不会向客户端请求任何东西：没有采样（sampling）、征询（elicitation），也不向客户端发送日志。

**通知。** `MCPNotifier` 是一个可以注入的组件（`@Inject(MCPNotifier)`），用来告诉客户端有内容变化：`resourceUpdated(uri)`、`resourcesChanged()`、`toolsChanged()`、`promptsChanged()`。在 stdio 上，只有订阅了某个 URI 的客户端才会收到这个资源的更新。在 HTTP 上，只有使用 2026-07-28 协议版本、并且监听变化的客户端才会收到通知。

## 6. 基于 HTTP

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

//抛出错误时以 401 响应
function verifyToken(request: IncomingMessage): MCPAuthInfo {
    const token: string = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (token !== process.env.MCP_TOKEN) throw new Error('Invalid token')
    return {token: token, clientId: 'assistant', scopes: []}
}

//客户端连接 http://127.0.0.1:3000/mcp
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

| 选项 | 默认值 | 含义 |
|---|---|---|
| `port`、`host`、`path` | `3000`、`'127.0.0.1'`、`'/mcp'` | 监听的位置 |
| `authenticate` | | `(request) => MCPAuthInfo \| undefined`：客户端的身份认证；抛出错误时以 401 响应，返回 `undefined` 时不认证，照常处理请求 |
| `allowedHosts`、`allowedOrigins` | 在本机地址上时为本机的名字 | 接受的 `Host` 和 `Origin` 请求头（否则为 403）；`false` 表示不检查 |
| `legacy` | `'stateless'` | 2025 年协议版本的客户端：以无会话的方式服务，或者用 `'reject'` 拒绝 |
| `maxRequestBodySize` | 4 MiB | 更大的请求体以 413 响应 |
| `bus` | 内存中 | 通知的去向，用于在应用的多个实例之间共享 |
| `listen` | `true` | `false` 表示不打开端口：把 `handler` 挂到其他服务器上 |
| `serverName`、`serverVersion`、`instructions`、`server`、`listening`、`name`、`middlewares` | | 与 stdio 相同；`server` 是 `node:http` 服务器的选项 |

- 它通过 Streamable HTTP 提供协议：2026-07-28 版本，以及无会话方式的 2025 年版本。
- 在本机地址上，`Host` 和 `Origin` 请求头会与本机的名字比对，防止 DNS 重绑定攻击：在代理之后时，要列出客户端使用的名字。在其他地址上，除非列出名字，否则不做检查。
- 应用停止时，正在处理的调用会得到响应，然后端口关闭。

**与 HTTP 适配器共用端口。** 设置 `listen: false`，在 Express 应用的 `before` 钩子中挂载适配器的 `handler`：

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {httpMCPEntrypoint} from '@lakutata/mcp'

//客户端连接时使用的名字（http://localhost:8080/mcp）
const mcp = httpMCPEntrypoint({listen: false, allowedHosts: ['localhost', '127.0.0.1', 'mcp.example.com']})

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({port: 8080, before: (app): void => void app.all('/mcp', mcp.handler)}),
    mcp: mcp
})
```

挂载的 `handler` 只按给出的名字检查 `Host` 和 `Origin` 请求头；在适配器启动之前和停止之后，它以 503 响应。

## 7. 错误

| 情形 | 客户端收到 |
|---|---|
| 工具失败：异常、参数无效、访问被拒绝 | 标记为错误的结果：`errno: message` |
| 资源或提示词因客户端错误（400 到 499）失败 | 协议错误 `-32602`，消息为 `errno: message`，数据为 `{errno}` |
| 资源或提示词因其他原因失败 | 协议错误 `-32603` |
| 未知的工具、提示词或资源 | 协议错误 `-32602`（`Tool nope not found`） |
| 工具或提示词的名字无效，资源 URI 没有协议名 | 声明类时抛出 `TypeError` |
