# Lakutata MCP

模型上下文协议（MCP）使 AI 助手能够使用应用，即调用应用的**工具**、读取其**资源**、填写其**提示词**。`@lakutata/mcp` 包将控制器方法作为上述内容提供，传输方式可以是子进程的标准输入输出，也可以是 HTTP。该包不属于 `lakutata`，需要单独安装：

```bash
npm install lakutata @lakutata/mcp
```

| 声明方式 | 含义 | 使用者 |
|---|---|---|
| `@MCPTool(name)` | 模型携带参数调用的动作 | 模型（由模型决定何时调用） |
| `@MCPResource(uri)` | 按 URI 读取的数据 | 客户端（将数据提供给模型） |
| `@MCPPrompt(name)` | 以参数填写的消息模板 | 用户（在客户端中选择） |

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

- 客户端使用 `node build/App.js` 这样的命令将应用作为子进程运行，并通过子进程的标准输入输出与应用通信。客户端关闭应用的输入后，应用随即退出（设置 `exitOnClose: false` 可使应用继续运行）。
- 标准输出承载协议消息，因此日志必须像上例那样写入标准错误，并且不得调用 `console.log()`。
- `stdioMCPEntrypoint()` 的选项为：`serverName`（默认为应用的名称）、`serverVersion`（`'1.0.0'`）、提供给模型的 `instructions`、`stdin` 和 `stdout`、`exitOnClose`、`name` 以及 `middlewares`。
- 在 stdio 上，服务器使用 2025 年的各个协议版本。

## 2. 工具

```text
@MCPTool(name, DTO?, options?)
```

| 选项 | 含义 |
|---|---|
| `description` | 工具的用途说明，供模型阅读；未设置时，模型看到的是 `ControllerClass:method` |
| `title` | 用于显示的名称 |
| `readOnly`、`destructive`、`idempotent`、`openWorld` | 提供给客户端的提示，分别表示：工具不做任何修改、会做出不可撤销的修改、再次调用时结果相同、会访问外部系统 |
| `output` | 结果的 DTO：服务器发送其 JSON Schema，结果也会同时作为结构化内容返回 |
| `acl`、`rule`、`middlewares`…… | 所有动作共有的选项（见[控制器与动作](Controllers.md)第 3 节） |

- 名称由 1 到 128 个字母、数字、`_`、`-` 或 `.` 组成。`@Prefix({mcp: 'device'})` 为控制器中工具和提示词的名称添加前缀，例如 `status` 变为 `device_status`。
- 参数由 DTO 的 JSON Schema 描述；`.description()` 用于向模型说明某个参数。与所有动作相同，参数由 DTO 校验。
- 两个控制器声明同一个工具时，由后注册的控制器提供该工具，这与其他传输方式相同。

工具的返回值即为其结果：

| 返回值 | 结果 |
|---|---|
| 字符串 | 一段文本 |
| 对象 | 对象的 JSON 文本，同时将对象作为结构化内容 |
| `undefined` | 没有内容 |
| `Result.file(buffer, {contentType})` | 图片或音频类型时为图片或音频，否则为嵌入的资源 |
| `Result.status(status, data)` | 其中的数据 |

- 只有在工具声明了 `output` 时，类的实例（DTO）才会作为结构化内容返回。声明了 `output` 却未返回对象的工具会失败。
- 服务器不会按 `output` 检查结构化内容；该检查由客户端执行，不符合的结果会被客户端拒绝。
- 工具抛出的错误（包括参数校验和访问控制产生的错误）会作为标记为错误的结果返回给模型，其文本为 `errno: message`（`E_OFFLINE: The device off is offline`）。模型可以据此修正调用。

## 3. 资源

```text
@MCPResource(uri, DTO?, options?)
```

- 没有变量的 URI（`device://catalog`）是一个独立的资源；带变量的 URI（`device://{sn}/status`）是一个模板，由客户端填写。URI 不会被添加前缀。
- 变量即动作的输入。变量均为字符串，因此请将其声明为字符串，或者像 HTTP 请求的查询参数那样，使用 `.strict(false)` 转换。
- 选项为：`resourceName`（列表中显示的名称，默认为动作的名称）、`title`、`mimeType`、`audience`（`['user']`、`['assistant']`）、`priority`（0 到 1），以及所有动作共有的选项。

| 返回值 | 内容 |
|---|---|
| 字符串 | 文本，类型为 `mimeType`（默认 `text/plain`） |
| 其他值 | 该值的 JSON，类型为 `mimeType`（默认 `application/json`） |
| `Buffer`、`Result.file()` | 按类型返回文本或二进制数据 |

读取资源时抛出的错误会以协议错误响应：如果错误的 `statusCode` 属于客户端错误（400 到 499，包括输入无效），则为参数无效（`-32602`），否则为内部错误（`-32603`）。错误消息为 `errno: message`。

## 4. 提示词

```text
@MCPPrompt(name, DTO?, options?)
```

- DTO 的属性即提示词的参数，会列出给客户端。参数均为字符串，因此请将其声明为字符串，或者使用 `.strict(false)` 转换。
- 字符串生成一条用户消息；数组的每一项生成一条消息（字符串或 `{role, content}`）；对象 `{messages}` 按原样发送。
- 选项为 `title` 以及所有动作共有的选项。错误的处理方式与资源相同。

## 5. 上下文

在 MCP 动作中，`this.context` 是一个 `MCPContext`：

| 属性 | 含义 |
|---|---|
| `kind` | `'tool'`、`'resource'` 或 `'prompt'` |
| `name` | 工具或提示词的名称，包括前缀；对于资源，为声明时的 URI |
| `uri` | 所读取的 URI（用于资源） |
| `data` | 校验之前的参数（对于资源，`data` 为空，其变量即为输入） |
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
- 一个方法可以同时服务于多种传输方式（`@GET` 和 `@MCPTool`），此时对于 MCP 请求，`this.context.type` 为 `'MCP'`（`MCP_CONTEXT_TYPE`）。
- 入口的访问规则适用于以 `acl: true` 声明的 MCP 动作，前提是规则的 `supportContextTypes()` 包含 `MCP_CONTEXT_TYPE`（见[中间件与访问控制](Middlewares.md)）。
- 服务器不会向客户端请求任何内容：不支持采样（sampling）和征询（elicitation），也不向客户端发送日志。

**通知。** `MCPNotifier` 是一个可注入的组件（`@Inject(MCPNotifier)`），用于通知客户端内容发生了变化：`resourceUpdated(uri)`、`resourcesChanged()`、`toolsChanged()`、`promptsChanged()`。在 stdio 上，只有订阅了某个 URI 的客户端才会收到该资源的更新。在 HTTP 上，只有使用 2026-07-28 协议版本并监听变化的客户端才会收到通知。

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
| `authenticate` | | `(request) => MCPAuthInfo \| undefined`：用于客户端的身份认证；抛出错误时以 401 响应；返回 `undefined` 时不认证，请求仍按正常流程处理 |
| `allowedHosts`、`allowedOrigins` | 监听本机地址或回环网口时为本机的名称 | 接受的 `Host` 和 `Origin` 请求头（否则为 403）；`false` 表示不检查 |
| `interface`、`family`、`strict`、`onError` | | 按网口监听（替代 `host`），需要安装 `@lakutata/netif` 包（见 [HTTP](HTTP.md) 第 2 节） |
| `legacy` | `'stateless'` | 使用 2025 年协议版本的客户端：以无会话方式提供服务，或设为 `'reject'` 时拒绝 |
| `maxRequestBodySize` | 4 MiB | 超过此大小的请求体以 413 响应 |
| `bus` | 内存中 | 通知的发送目标，用于在应用的多个实例之间共享通知 |
| `listen` | `true` | `false` 表示不打开端口，此时需由应用将 `handler` 挂载到其他服务器上 |
| `serverName`、`serverVersion`、`instructions`、`server`、`listening`、`name`、`middlewares` | | 与 stdio 相同；`server` 是 `node:http` 服务器的选项 |

- 该适配器通过 Streamable HTTP 提供协议，支持 2026-07-28 版本，以及以无会话方式提供的 2025 年各版本。
- 在本机地址上，`Host` 和 `Origin` 请求头会与本机的名称比对，以防范 DNS 重绑定攻击；位于代理之后时，请列出客户端使用的名称。在其他地址上，除非列出名称，否则不做检查。设置 `interface` 时同样如此：在回环网口上与本机的名称比对；在其他网口上，网络中的所有客户端都能访问该服务器，因此请设置 `allowedHosts` 和 `authenticate`。
- 应用停止时，服务器先响应正在处理的调用，然后关闭端口。

**与 HTTP 适配器共用端口。** 设置 `listen: false`，并在 Express 应用的 `before` 钩子中挂载适配器的 `handler`：

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

挂载的 `handler` 仅按指定的名称检查 `Host` 和 `Origin` 请求头；在适配器启动之前和停止之后，以 503 响应。

## 7. 错误

| 情形 | 客户端收到的内容 |
|---|---|
| 工具失败：异常、参数无效、访问被拒绝 | 标记为错误的结果：`errno: message` |
| 资源或提示词因客户端错误（400 到 499）失败 | 协议错误 `-32602`，消息为 `errno: message`，数据为 `{errno}` |
| 资源或提示词因其他原因失败 | 协议错误 `-32603` |
| 未知的工具、提示词或资源 | 协议错误 `-32602`（`Tool nope not found`） |

工具或提示词的名称无效、资源 URI 没有协议名，这些错误不会到达客户端：声明类时，装饰器即抛出 `TypeError`。
