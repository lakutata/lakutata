# Lakutata 入口

`entrypoint` 组件将控制器与各种传输方式连接起来。该组件持有控制器和各传输方式的适配器（HTTP、命令行、服务调用、定时任务、消息队列……）。每个适配器接收其传输方式的请求，入口则执行对应的动作，包括动作的中间件、校验和访问控制。

## 1. 声明入口

`lakutata` 包已声明了一个名为 `entrypoint` 的组件。应用通过 `buildEntrypoints` 以同一名称为该组件提供选项，并将其列入 `bootstrap`：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}

Application.run(() => ({
    id: 'api.app',
    name: 'API',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [HealthController],
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

组件在首次被需要时才会创建。由于没有其他对象需要入口，如果缺少 `bootstrap: ['entrypoint']`，入口将永远不会被创建。此时服务不会监听，命令不会执行，定时任务也不会开始。

## 2. 选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `controllers` | `[]` | 控制器类 |
| `http`、`cli`、`service`、`schedule`、`queue`、`mcp`、`dbus` | | 各传输方式的适配器（见下表），可以是一个适配器或适配器数组 |
| `middlewares` | `[]` | 所有动作的中间件（见[中间件与访问控制](Middlewares.md)） |
| `rules` | `[]` | 声明了 `acl: true` 的动作使用的访问规则（见[中间件与访问控制](Middlewares.md)） |
| `shutdownTimeout` | `30000` | 应用停止时，留给正在处理的请求的毫秒数（第 4 节） |
| `httpActionGroups`、`cliActionGroups`、`serviceActionGroups` | `{}` | 动作可以使用的分组及其名称（第 5 节） |

适配器：

| 选项 | 适配器 | 导入自 | 需要安装 | 指南 |
|---|---|---|---|---|
| `http` | `expressHTTPEntrypoint()` | `lakutata/adapter/express` | `express` | [HTTP](HTTP.md) |
| `http` | `fastifyHTTPEntrypoint()` | `lakutata/adapter/fastify` | `fastify` | [HTTP](HTTP.md) |
| `cli` | `commanderCLIEntrypoint()` | `lakutata/adapter/commander` | `commander` | [命令行](CLI.md) |
| `service` | `httpServiceEntrypoint()` | `lakutata/com/entrypoint` | | [服务调用](ServiceCalls.md) |
| `service` | `socketIOServiceEntrypoint()` | `lakutata/adapter/socket.io` | `socket.io` | [服务调用](ServiceCalls.md) |
| `service` | `jsonRPCServiceEntrypoint()` | `lakutata/adapter/jsonrpc` | `ws`（使用 WebSocket 时） | [服务调用](ServiceCalls.md) |
| `service` | `electronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | （Electron） | [服务调用](ServiceCalls.md) |
| `service` | `nwjsServiceEntrypoint()` | `lakutata/adapter/nwjs` | （NW.js） | [服务调用](ServiceCalls.md) |
| `service` | `reactNativeServiceEntrypoint()` | `lakutata/adapter/react-native` | | [服务调用](ServiceCalls.md) |
| `service` | `grpcServiceEntrypoint()` | `@lakutata/grpc/service` | `@lakutata/grpc` | [gRPC](GRPC.md) |
| `service` | `natsServiceEntrypoint()` | `@lakutata/nats` | `@lakutata/nats` | [NATS](NATS.md) |
| `schedule` | `scheduleEntrypoint()` | `lakutata/com/entrypoint` | | [定时任务](Schedules.md) |
| `queue` | `queueEntrypoint()` | `lakutata/com/queue` | 队列服务器的客户端 | [消息队列](Queue.md) |
| `mcp` | `httpMCPEntrypoint()`、`stdioMCPEntrypoint()` | `@lakutata/mcp` | `@lakutata/mcp` | [MCP](MCP.md) |
| `dbus` | `dbusEntrypoint()` | `@lakutata/dbus` | `@lakutata/dbus` | [D-Bus](DBus.md) |

## 3. 多个适配器

每个选项都可以是数组，以多种方式提供同一种传输方式。例如，服务动作同时通过 Socket.IO 提供给浏览器、通过 JSON-RPC 提供给脚本，或者 HTTP 动作同时监听两个端口：

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: [
        expressHTTPEntrypoint({name: 'public', port: 8080}),
        expressHTTPEntrypoint({name: 'internal', host: '127.0.0.1', port: 9090})
    ],
    service: [
        socketIOServiceEntrypoint({port: 3000}),
        jsonRPCServiceEntrypoint({port: 4000, path: '/rpc'})
    ]
})
```

同一传输方式的每个适配器都提供该传输方式的全部动作，`name` 选项用于区分这些适配器。

## 4. 启动与停止

**应用启动时**，入口首先检查控制器。出现以下任何一种错误都会导致启动失败，并抛出对应的异常：

- 同一传输方式中有两个同名的动作（`DuplicateActionNameException`）；
- 动作使用的分组未在对应的 `*ActionGroups` 选项中声明（`InvalidActionGroupException`）；
- 前缀与某个动作的模式冲突（`InvalidPrefixException`）；
- 中间件既不是函数，也不是 `Middleware` 类（`InvalidMiddlewareException`）；
- 适配器位于另一种传输方式的键下，或者某个选项既不是入口的选项，也不是传输方式（`InvalidEntrypointAdapterException`）。

随后按选项的顺序依次启动各个适配器。任一适配器启动失败（例如端口已被占用）时，应用启动失败。命令行和定时任务在整个应用启动完成之后才开始。

**应用停止时**（收到 `SIGTERM` 或 `SIGINT`，或调用 `app.exit()` 之后），适配器按相反的顺序停止：

1. 不再接受新请求。视传输方式而定，此后到达的请求会以 `EntrypointStoppedException` 被拒绝（HTTP 上为状态码 503）；
2. 正在处理的请求有 `shutdownTimeout`（默认 30 秒）的时间完成处理；
3. 仍在执行的请求被中止，其 `this.signal` 被触发，并以 `EntrypointStoppedException` 作为答复；
4. 适配器关闭各自的服务器和连接。

## 5. 分组与动作列表

动作的 `groups` 选项将动作归入分组。访问规则可以使用分组（见[中间件与访问控制](Middlewares.md)），入口也可以按分组列出动作，用于生成 API 目录或权限列表。HTTP、命令行和服务动作的分组必须连同名称一起声明：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, type Entrypoint} from 'lakutata/com/entrypoint'
import {DELETE, GET} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class UserController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @GET('/users', {description: 'List the users'})
    public async list(): Promise<string[]> {
        return []
    }

    @DELETE('/users/:id', {description: 'Delete a user', groups: ['admin']})
    public async remove(): Promise<void> {
    }

    //每个分组的动作：[{"group":"Administration","actions":["Delete a user"]}]
    @GET('/permissions')
    public async permissions(): Promise<{ group: string, actions: string[] }[]> {
        return this.entrypoint.getHttpActions().groups.map((group) => ({
            group: group.name,
            actions: group.actions.map((action): string => action.description)
        }))
    }
}

Application.run(() => ({
    id: 'users.app',
    name: 'Users',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [UserController],
            httpActionGroups: {admin: 'Administration'}
        })
    },
    bootstrap: ['entrypoint']
}))
```

`getHttpActions()`、`getCliActions()` 和 `getServiceActions()` 返回 `{groups, actions}`，其中 `groups` 是已声明的分组（`id`、`name` 及其 `actions`），`actions` 是该传输方式的全部动作。其他传输方式的动作通过 `getActions(channel)` 列出（例如 `getActions('schedule')`）。每个动作由以下属性描述：

| 属性 | 含义 |
|---|---|
| `id` | 由控制器、方法和地址计算出的固定 ID |
| `name`、`description`、`groups`、`acl` | 动作的选项 |
| `controller`、`method` | 控制器类名和方法名 |
| `route` / `command` / `pattern` | 动作的地址，包含前缀 |
| `jsonSchema` | 动作 DTO 的 JSON Schema |

## 6. 向客户端推送事件

通过保持客户端连接的服务传输方式，客户端可以接收应用推送的事件。这类传输方式有 Socket.IO、Electron、NW.js、HTTP 服务的事件流、WebSocket 或 stdio 上的 JSON-RPC，以及 gRPC。`entrypoint.notify(clientId, event, ...args)` 将事件发送给一个客户端，即某个动作从 `this.context.clientId` 读取到的客户端，并返回该客户端是否收到。`entrypoint.broadcast(event, ...args)` 将事件发送给所有已连接的客户端，并返回客户端的数量。见 [gRPC](GRPC.md) 和[服务调用](ServiceCalls.md)。

## 7. 定制入口

`Entrypoint` 的子类可以替换组件的类。声明时用 `class` 指定该子类，其他选项照常与之并列。

```typescript
import {AccessControl, Entrypoint} from 'lakutata/com/entrypoint'

//记录访问控制的每一次判断
class AuditedAccessControl extends AccessControl {
    protected async match(): Promise<boolean> {
        const allowed: boolean = await super.match()
        console.log(`${this.target.name}: ${allowed ? 'allowed' : 'denied'}`)
        return allowed
    }
}

export class AuditedEntrypoint extends Entrypoint {
    protected readonly accessControl: typeof AccessControl = AuditedAccessControl
}

//components: {entrypoint: {class: AuditedEntrypoint, controllers: [...], http: ...}}, bootstrap: ['entrypoint']
```

其他传输方式的适配器需实现 `@lakutata/entrypoint/channel` 中的 `EntrypointAdapter` 接口。Lakutata 2.x 的入口函数（`buildHTTPEntrypoint`、`buildCLIEntrypoint`、`buildServiceEntrypoint`）仍可用于 `http`、`cli` 和 `service` 选项。
