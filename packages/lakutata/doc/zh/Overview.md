# Lakutata 概述

**Lakutata** 是一个基于 IoC 的 Node.js / TypeScript 应用框架，让 Web 服务、命令行工具、桌面（Electron）应用和嵌入式设备共用同一套编程模型。应用是一棵由容器创建的对象树（组件、提供者、控制器）：DTO 校验对象的选项和输入，各种传输方式把控制器暴露出去——HTTP（Express、Fastify）、CLI（Commander）、服务调用（HTTP、Socket.IO、JSON-RPC 2.0、gRPC、NATS、Electron IPC）、定时任务和消息队列。同一个控制器方法可以同时通过所有这些方式调用。

`lakutata` 包通过各个子路径重新导出 `@lakutata/*` 系列包（见下表），并为每个应用预置两个组件：`log`（`Logger`，输出与 pino 兼容的 JSON 日志行）和 `entrypoint`（对外提供控制器的 `Entrypoint`）。

## 环境要求

- Node.js 22.13 或更高版本（Node.js 24 需 24.11 或更高）。
- ESM（`"type": "module"`）；包里同时提供了 CommonJS 构建。
- TypeScript 需开启 `experimentalDecorators` 和 `emitDecoratorMetadata`。框架所需的编译选项以 `lakutata/tsconfig.json` 发布。

## 安装

```bash
npx @lakutata/cli create --name my-app   # 从模板创建新项目（Web、服务、CLI、Electron 等）
npm install lakutata                      # 或在已有项目中安装框架
```

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {"rootDir": "src", "outDir": "dist"}
}
```

传输方式和各项集成所需的客户端都是可选的 peer 依赖，用到时再安装：`express` 或 `fastify`、`commander`、`socket.io`、`ws`、数据库驱动（`pg`、`mysql2`、`better-sqlite3` 等）、缓存存储（`redis` 等）。

## 第一个应用

```typescript
import {Application, DTO, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class GreetDTO extends DTO {
    @Expect(DTO.String().optional().default('world'))
    public name: string
}

class GreetController extends Controller {
    //GET /greet?name=you，以及服务动作 {cmd: 'greet', name: 'you'}
    @GET('/greet', GreetDTO)
    @ServiceAction({cmd: 'greet'}, GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        return {message: `Hello, ${input.name}!`}
    }
}

Application
    .run(() => ({
        id: 'com.example.greeter',
        name: 'Greeter',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [GreetController],
                http: expressHTTPEntrypoint({port: 8080})
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started', app.appName))
```

## 子路径

| 子路径 | 内容 |
|---|---|
| `lakutata` | `Application`、`Component`、`Provider`、`BaseObject`、`Container`、`DTO`、`Exception`、`Time`、`isPackaged`、`resourcesPath`、校验消息 |
| `lakutata/decorator/di` | `@Inject`、`@Configurable`、`@Autoload`、`@Singleton`、`@Scoped`、`@Transient`、`@Lifetime` |
| `lakutata/decorator/dto` | `@Expect`、`@Accept`、`@Return`、`@IndexSignature` |
| `lakutata/decorator/asst` | `@Before`、`@After` |
| `lakutata/dtos` | `PaginationSearchDTO`、`PaginationResultDTO`、`paginator`、`FlexibleDTO`、JSON Schema 转换 |
| `lakutata/com/entrypoint` | `Entrypoint`、`buildEntrypoints`、`Controller`、各种上下文、`Result`、访问控制、中间件、`httpServiceEntrypoint`、`scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@HTTPAction`、`@GET`…`@OPTIONS`、`@CLIAction`、`@ServiceAction`、`@Schedule`、`@Prefix`、`@UseMiddlewares` |
| `lakutata/adapter/express`、`lakutata/adapter/fastify` | HTTP 传输 |
| `lakutata/adapter/commander` | CLI 传输 |
| `lakutata/adapter/socket.io`、`lakutata/adapter/jsonrpc`、`lakutata/adapter/electron` | 服务传输 |
| `lakutata/com/logger` | `Logger` 组件，预置为 `log`（输出与 pino 兼容的 JSON 行） |
| `lakutata/orm`、`lakutata/decorator/orm` | TypeORM 及其装饰器 |
| `lakutata/com/database`、`lakutata/provider/database` | `Database` 组件和提供者 |
| `lakutata/com/cacher` | `Cacher` 组件 |
| `lakutata/com/mutex` | `Mutex` 组件、`@Synchronized` |
| `lakutata/com/queue` | `Queue` 组件、`@QueueAction`、`queueEntrypoint` |
| `lakutata/com/i18n` | `I18n` 组件、`Translator`、语言中间件 |
| `lakutata/com/docker` | `Docker` 组件 |
| `lakutata/com/containerd` | `Containerd` 组件 |
| `lakutata/com/monitor` | CPU、内存、事件循环和 HTTP 监控 |
| `lakutata/security`、`lakutata/provider/passwordHash` | 哈希、加解密、签名、`PasswordHash` 提供者 |
| `lakutata/utils` | 辅助函数 |

不在本包中的：`@lakutata/cli`（`lakutata` 命令：项目、打包、可执行文件、迁移）、`@lakutata/grpc`（gRPC 客户端、服务端和服务传输）、`@lakutata/nats`（NATS 组件和服务传输）、`@lakutata/dbus`（D-Bus）和 `@lakutata/mcp`（Model Context Protocol）。

## 指南

| 指南 | 主题 |
|---|---|
| [Core](Core.md) | 应用、容器、生命周期类型、依赖注入、在多个应用之间共享功能、应用的生命周期 |
| [DTOValidation](DTOValidation.md) | DTO、校验规则，以及选项、输入和返回值的校验 |
| [Decorator](Decorator.md) | 各子路径的装饰器 |
| [Controllers](Controllers.md) | 控制器与动作：地址、输入与结果、前缀、继承 |
| [Entrypoint](Entrypoint.md) | 入口组件：选项与适配器、启动与停止、动作列表 |
| [Middlewares](Middlewares.md) | 动作的中间件与访问控制 |
| [HTTP](HTTP.md) | HTTP 适配器：路由、输入、响应、错误，以及 Express 和 Fastify 的功能 |
| [CLI](CLI.md) | 命令行工具：命令、选项、提示输入、输出与退出码 |
| [ServiceCalls](ServiceCalls.md) | 通过 HTTP、Socket.IO、JSON-RPC 2.0 和 Electron 调用服务动作：模式、响应、客户端及其事件 |
| [GRPC](GRPC.md) | 通过 gRPC 提供服务动作（`@lakutata/grpc`），以及从其他应用和其他语言调用它们 |
| [NATS](NATS.md) | NATS 组件、通过 NATS 提供服务动作（`@lakutata/nats`）、服务代理及其事件 |
| [Schedules](Schedules.md) | 定时任务：间隔、cron 表达式、只在一个实例中执行的任务 |
| [Database](Database.md) | `Database` 组件与提供者、连接选项、多个数据库 |
| [DatabaseDrivers](DatabaseDrivers.md) | 逐个介绍数据库驱动：需要安装什么、选项、限制 |
| [MongoEmbedded](MongoEmbedded.md) | 应用内的 MongoDB，文档保存在文件中 |
| [Entities](Entities.md) | 实体、查询、事务与错误 |
| [Migrations](Migrations.md) | 编写、生成和执行迁移 |
| [Cache](Cache.md) | `Cacher` 组件：`wrap()`、各种存储及其分层、存储保存的值 |
| [I18n](I18n.md) | 多语言消息 |
| [Mutex](Mutex.md) | 实例与进程之间的锁 |
| [Queue](Queue.md) | 消息队列：生产者、`@QueueAction` 消费者、重试、死信、结果 |
| [DockerIntegration](DockerIntegration.md) | `Docker` 组件 |
| [ContainerdIntegration](ContainerdIntegration.md) | `Containerd` 组件 |
| [Security](Security.md) | 哈希、加解密、签名、密码 |
| [Time](Time.md) | `Time` 类 |
| [HelperFunctions](HelperFunctions.md) | `lakutata/utils` 的辅助函数 |

每个 `@lakutata/*` 包都有自己的 README，各子路径的类型声明也为每个声明附带了说明和示例。
