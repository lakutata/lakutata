# Lakutata 概述

**Lakutata** 是一个面向 Node.js 和 TypeScript 的、基于 IoC 的应用框架：Web 服务、命令行工具、桌面（Electron）应用和嵌入式设备使用同一套编程模型。应用是一棵由容器创建的对象树（组件、提供者、模块、控制器），对象的选项和输入由 DTO 校验，控制器由各种传输方式对外提供：HTTP（Express、Fastify）、CLI（Commander）、服务调用（HTTP、Socket.IO、JSON-RPC 2.0、gRPC、NATS、Electron IPC）以及定时任务。同一个控制器方法可以同时通过所有这些方式调用。

`lakutata` 包通过各个子路径重新导出 `@lakutata/*` 系列包（见下表），并为每个应用预置两个组件：`log`（基于 pino 的 `Logger`）和 `entrypoint`（对外提供控制器的 `Entrypoint`）。

## 环境要求

- Node.js 22 或更高版本。
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

传输方式和各项集成依赖可选的 peer 依赖，用到时再安装：`express` 或 `fastify`、`commander`、`socket.io`、`ws`、数据库驱动（`pg`、`mysql2`、`sqlite3` 等）、缓存存储（`redis` 等）。

## 第一个应用

```typescript
import {Application, DTO, type ILogger} from 'lakutata'
import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {ExpressHTTPEntrypoint} from 'lakutata/adapter/express'

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
            entrypoint: BuildEntrypoints({
                controllers: [GreetController],
                http: ExpressHTTPEntrypoint({port: 8080})
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started', app.appName))
```

## 子路径

| 子路径 | 内容 |
|---|---|
| `lakutata` | `Application`、`Module`、`Component`、`Provider`、`BaseObject`、`Container`、`DTO`、`Exception`、`Time`、`IsPackaged`、`ResourcesPath`、校验消息 |
| `lakutata/decorator/di` | `@Inject`、`@Configurable`、`@Autoload`、`@Singleton`、`@Scoped`、`@Transient`、`@Lifetime` |
| `lakutata/decorator/dto` | `@Expect`、`@Accept`、`@Return`、`@IndexSignature` |
| `lakutata/decorator/asst` | `@Before`、`@After` |
| `lakutata/dtos` | `PaginationSearchDTO`、`PaginationResultDTO`、`Paginator`、`FlexibleDTO`、JSON Schema 转换 |
| `lakutata/com/entrypoint` | `Entrypoint`、`BuildEntrypoints`、`Controller`、各种上下文、`Result`、访问控制、中间件、`HTTPServiceEntrypoint`、`ScheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@HTTPAction`、`@GET`…`@OPTIONS`、`@CLIAction`、`@ServiceAction`、`@Schedule`、`@Prefix`、`@UseMiddlewares` |
| `lakutata/adapter/express`、`lakutata/adapter/fastify` | HTTP 传输 |
| `lakutata/adapter/commander` | CLI 传输 |
| `lakutata/adapter/socket.io`、`lakutata/adapter/jsonrpc`、`lakutata/adapter/electron` | 服务传输 |
| `lakutata/com/logger` | `Logger` 组件（pino），预置为 `log` |
| `lakutata/orm`、`lakutata/decorator/orm` | TypeORM 及其装饰器 |
| `lakutata/com/database`、`lakutata/provider/database` | `Database` 组件和提供者 |
| `lakutata/com/cacher` | `Cacher` 组件 |
| `lakutata/com/mutex` | `Mutex` 组件、`@Synchronized` |
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
| [Core](Core.md) | 应用、容器、生命周期类型、依赖注入、模块、应用的生命周期 |
| [DTOValidation](DTOValidation.md) | DTO、校验规则，以及选项、输入和返回值的校验 |
| [Decorator](Decorator.md) | 各子路径的装饰器 |
| [ActionPattern](ActionPattern.md) | 控制器、动作及其传输方式（HTTP、CLI、服务、定时任务） |
| [ORMIntegration](ORMIntegration.md) | `Database` 组件与 TypeORM |
| [I18n](I18n.md) | 多语言消息 |
| [Mutex](Mutex.md) | 实例与进程之间的锁 |
| [DockerIntegration](DockerIntegration.md) | `Docker` 组件 |
| [ContainerdIntegration](ContainerdIntegration.md) | `Containerd` 组件 |
| [Security](Security.md) | 哈希、加解密、签名、密码 |
| [Time](Time.md) | `Time` 类 |
| [HelperFunctions](HelperFunctions.md) | `lakutata/utils` 的辅助函数 |

每个 `@lakutata/*` 包都有自己的 README，各子路径的类型声明也为每个声明附带了说明和示例。
