# @lakutata/entrypoint

[English](README.md) | 中文

lakutata 框架的入口：控制器及其动作，通过各种传输方式对外提供。一个控制器方法可以同时是 HTTP 路由、命令行命令、服务动作（通过 HTTP、Socket.IO、JSON-RPC、gRPC、NATS 或 Electron IPC 调用）和定时任务。无论通过哪种传输方式，请求都经过相同的中间件，输入由相同的 DTO 校验，适用的访问控制也相同。

`lakutata` 包把它重新导出为 `lakutata/com/entrypoint`（组件、控制器、上下文和结果）、`lakutata/decorator/ctrl`（动作装饰器）和 `lakutata/adapter/*`（各种传输方式），并在每个应用中预置 `entrypoint` 组件。

## 安装

```shell
npm install lakutata
```

各传输方式所需的包都是可选的 peer 依赖，用到时才需要安装：

| 传输方式 | 子路径 | 需要安装 |
|---|---|---|
| 基于 Express 4/5 的 HTTP | `lakutata/adapter/express` | `express` |
| 基于 Fastify 5 的 HTTP（Node.js 18.19、19.9、20 或更高版本） | `lakutata/adapter/fastify` | `fastify` |
| 基于 Commander 的命令行 | `lakutata/adapter/commander` | `commander`（提示输入还需要 `@inquirer/prompts`） |
| 基于 Socket.IO 的服务调用 | `lakutata/adapter/socket.io` | `socket.io` |
| 基于 JSON-RPC 2.0 的服务调用（HTTP、WebSocket、stdio） | `lakutata/adapter/jsonrpc` | 使用 WebSocket 时需要 `ws` |
| 基于 Electron IPC 的服务调用 | `lakutata/adapter/electron` | （Electron） |
| 基于 HTTP 的服务调用（`POST /`，事件通过 SSE 推送） | `lakutata/com/entrypoint` | 无 |
| 定时任务（`@Schedule`） | `lakutata/com/entrypoint` | 无 |
| 基于 gRPC / NATS 的服务调用 | `@lakutata/grpc/service` / `@lakutata/nats` | 它们各自的包 |
| 按网口监听，而不是按地址监听（HTTP 和服务适配器的 `interface` 选项） | | `@lakutata/netif` |

## 用法

### 控制器与传输方式

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, Schedule, ServiceAction} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {Expect} from 'lakutata/decorator/dto'

class GetOrderDTO extends DTO {
    //路由参数和查询参数都是字符串：strict(false) 会转换它们
    @Expect(DTO.Number().integer().strict(false).required())
    public id: number
}

class CreateOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string

    @Expect(DTO.Number().integer().min(1).default(1))
    public quantity: number
}

class OrderController extends Controller {
    //GET /orders/42、命令 "order --id 42"、服务请求 {cmd: 'order.get', id: 42}
    @GET('/orders/:id', GetOrderDTO)
    @CLIAction('order', GetOrderDTO)
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{id: number}> {
        return {id: input.id}
    }

    //带 JSON 请求体的 POST /orders；返回值就是响应（JSON）
    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<{product: string, quantity: number}> {
        return input
    }

    //每 5 分钟执行一次（使用 {every: '5m', exclusive: true} 并配置锁组件时，同一时间只在一个实例中执行）
    @Schedule('5m')
    public async report(): Promise<void> {
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            http: expressHTTPEntrypoint({port: 8080}),
            cli: commanderCLIEntrypoint(),
            service: socketIOServiceEntrypoint({port: 8081}),
            schedule: scheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

### 在动作中

- `this.context` 是请求的上下文：`HTTPContext`（带有 `request`、`response`、`route`、`method`）、`CLIContext`（带有 `command`）、`ServiceContext`（带有 `clientId`）或 `ScheduleContext`。
- 请求被中止时，`this.signal` 也会被中止：客户端离开、截止时间已过，或者入口停止。
- 每个请求都会创建一个控制器（`@Scoped`），它注入的请求作用域对象在这个请求内共享。
- 返回值就是响应。`Result.status(201, data, headers)`、`Result.file(path)` 和 `Result.events()`（Server-Sent Events）用来控制 HTTP 响应。
- 通过 HTTP（Express、Fastify）调用时，抛出的异常会以它的 `statusCode` 和 JSON `{errno, errMsg}` 返回，输入不合法时返回 400。

### 中间件与访问控制

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, type ActionInvocation, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

//在动作前后运行，早于输入校验和访问控制
async function timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const started: number = Date.now()
    try {
        return await next()
    } finally {
        console.log(`${invocation.context.type} took ${Date.now() - started} ms`)
    }
}

//作用于这个控制器的动作（写在 buildEntrypoints({middlewares: [timing]}) 中则作用于所有动作）
@UseMiddlewares(timing)
class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}

Application.run(() => ({
    id: 'health.app',
    name: 'Health',
    components: {
        entrypoint: buildEntrypoints({controllers: [HealthController], http: expressHTTPEntrypoint({port: 3000})})
    },
    bootstrap: ['entrypoint']
}))
```

访问控制：以 `{acl: true}` 声明的动作，由传给 `buildEntrypoints({rules})` 的规则检查（`AccessControlRule` 的子类，每个请求创建一次）。某条规则的结果为 `false` 时，请求被拒绝，抛出 `AccessDeniedException`（HTTP 403）。

## API

| 导出 | 子路径 | 说明 |
|---|---|---|
| `Entrypoint`、`buildEntrypoints` | `lakutata/com/entrypoint` | 组件及其选项：控制器、传输方式、中间件、规则、分组 |
| `Controller` | `lakutata/com/entrypoint` | 控制器的基类（`context`、`signal`） |
| `HTTPContext`、`CLIContext`、`ServiceContext`、`ScheduleContext`、`BaseContext`、`ContextType` | `lakutata/com/entrypoint` | 请求的上下文 |
| `Result`、`StatusResult`、`FileResult`、`EventsResult` | `lakutata/com/entrypoint` | 控制 HTTP 响应的结果 |
| `AccessControlRule`、`AccessControl` | `lakutata/com/entrypoint` | 访问控制 |
| `Middleware`、`ActionInvocation`、`Next` | `lakutata/com/entrypoint` | 中间件 |
| `httpServiceEntrypoint`、`scheduleEntrypoint` | `lakutata/com/entrypoint` | 基于 HTTP 的服务调用；定时任务 |
| `HTTPServiceProxy`、`buildHTTPServiceProxy` | `lakutata/com/entrypoint` | 基于 HTTP 的服务的客户端：调用它的动作，接收它推送的事件 |
| `Cron`、`parseDuration` | `lakutata/com/entrypoint` | cron 表达式和时长 |
| `InterfaceListeningOptions` | `lakutata/com/entrypoint` | 按网口监听的适配器的选项：`interface`、`family`、`strict`、`onError`、`interfaceListening`（默认用 `@lakutata/netif`） |
| `HTTPAction`、`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS` | `lakutata/decorator/ctrl` | HTTP 路由 |
| `CLIAction`、`ServiceAction`、`Schedule` | `lakutata/decorator/ctrl` | 命令、服务动作、定时任务 |
| `Prefix`、`UseMiddlewares` | `lakutata/decorator/ctrl` | 为控制器的路由、命令和模式加上前缀；控制器的中间件 |
| `expressHTTPEntrypoint`、`fastifyHTTPEntrypoint` | `lakutata/adapter/express`、`lakutata/adapter/fastify` | HTTP 传输方式（Express 支持 `staticUI`） |
| `commanderCLIEntrypoint` | `lakutata/adapter/commander` | 命令行传输方式 |
| `socketIOServiceEntrypoint`、`jsonRPCServiceEntrypoint`、`electronIPCServiceEntrypoint` | `lakutata/adapter/*` | 服务调用的传输方式 |
| `EntrypointAdapter`、`ChannelRuntime` | `@lakutata/entrypoint/channel` | 编写适配器或新的传输方式 |

类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候抛出 |
|---|---|
| `InvalidValueException`（来自 `lakutata`） | 输入不符合动作的 DTO（HTTP 400） |
| `AccessDeniedException` | 规则拒绝了请求（HTTP 403） |
| `ControllerActionNotFoundException`、`RouteNotFoundException` | 没有与请求匹配的动作（HTTP 404） |
| `EntrypointStoppedException` | 入口正在停止（HTTP 503） |
| `DuplicateActionNameException` | 同一传输方式中有两个同名的动作 |
| `InvalidActionGroupException`、`InvalidPrefixException`、`InvalidMiddlewareException`、`InvalidChannelException`、`InvalidEntrypointAdapterException` | 控制器的声明或选项不合法 |
| `ServiceInvokeException` | 远程服务动作失败（带有原错误的各个属性） |
| `ServiceUnavailableException` | `HTTPServiceProxy` 调用的服务没有给出响应（HTTP 503） |

## 另见

- 网站上的指南：[控制器与动作](https://lakutata.com/zh/guide/Controllers)、[Entrypoint](https://lakutata.com/zh/guide/Entrypoint)。
- `lakutata` 包中的指南（`doc/zh`）：`Controllers.md`、`Entrypoint.md`、`Middlewares.md`、`HTTP.md`（HTTP 适配器）、`ServiceCalls.md`（服务调用的传输方式）、`CLI.md`、`Schedules.md`。
- `@lakutata/core`：DTO、依赖注入和应用。
- `@lakutata/mutex`：`@Synchronized` 动作和 `exclusive` 定时任务。
- `@lakutata/grpc`、`@lakutata/nats`：基于 gRPC 和 NATS 的服务调用传输方式。
