# Lakutata 概述

**Lakutata** 是一个基于 IoC 的 Node.js / TypeScript 应用框架，让 Web 服务、命令行工具、桌面（Electron）应用和嵌入式设备共用同一套编程模型。应用是一棵由容器创建的对象树（组件、提供者、控制器）：DTO 校验对象的选项和输入，各种传输方式把控制器暴露出去——HTTP（Express、Fastify）、CLI（Commander）、服务调用（HTTP、Socket.IO、JSON-RPC 2.0、gRPC、NATS、Electron IPC）、定时任务和消息队列。同一个控制器方法可以同时通过所有这些方式调用。

`lakutata` 包通过各个子路径重新导出 `@lakutata/*` 系列包（见下表），并为每个应用预置两个组件：`log`（`Logger`，输出与 pino 兼容的 JSON 日志行）和 `entrypoint`（对外提供控制器的 `Entrypoint`）。

## 从哪里开始

[GettingStarted](GettingStarted.md) 用模板创建第一个项目，并演示第一个应用；[ProjectStructure](ProjectStructure.md) 介绍项目中的文件；下面的各篇指南分别介绍框架的各个部分。

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

不在本包中的：`@lakutata/cli`（`lakutata` 命令：创建项目、执行迁移、打包应用，见 [Command](Command.md)）、`@lakutata/grpc`（gRPC 客户端、服务端和服务传输）、`@lakutata/nats`（NATS 组件和服务传输）、`@lakutata/dbus`（D-Bus）和 `@lakutata/mcp`（Model Context Protocol）。

## 指南

| 指南 | 主题 |
|---|---|
| [GettingStarted](GettingStarted.md) | 环境要求、创建项目、在已有项目中加入 Lakutata、第一个应用 |
| [ProjectStructure](ProjectStructure.md) | 用模板创建的项目中的文件、脚本和可选功能，以及自己的模板 |
| [Application](Application.md) | 应用：选项、链式 API、生命周期、运行模式、打包后的应用 |
| [Objects](Objects.md) | 组件、提供者及其容器：生命周期类型、作用域、创建与销毁、不使用应用的容器 |
| [Injection](Injection.md) | 依赖注入、对象的选项、在多个应用之间共享功能 |
| [DTOValidation](DTOValidation.md) | DTO、校验规则，以及选项、输入和返回值的校验 |
| [Exceptions](Exceptions.md) | 声明异常、异常的消息、客户端收到的内容、框架的异常 |
| [Logger](Logger.md) | `log` 组件：写日志、可读的行或 JSON、输出目标、换用其他日志记录器 |
| [Decorator](Decorator.md) | 各子路径的装饰器 |
| [Time](Time.md) | `Time` 类 |
| [HelperFunctions](HelperFunctions.md) | `lakutata/utils` 的辅助函数 |
| [Controllers](Controllers.md) | 控制器与动作：地址、输入与结果、前缀、继承 |
| [Entrypoint](Entrypoint.md) | 入口组件：选项与适配器、启动与停止、动作列表 |
| [Middlewares](Middlewares.md) | 动作的中间件与访问控制 |
| [HTTP](HTTP.md) | HTTP 适配器：路由、输入、响应、错误，以及 Express 和 Fastify 的功能 |
| [CLI](CLI.md) | 命令行工具：命令、选项、提示输入、输出与退出码 |
| [ServiceCalls](ServiceCalls.md) | 通过 HTTP、Socket.IO、JSON-RPC 2.0 和 Electron 调用服务动作：模式、响应、客户端及其事件 |
| [GRPC](GRPC.md) | 通过 gRPC 提供服务动作（`@lakutata/grpc`），以及从其他应用和其他语言调用它们 |
| [NATS](NATS.md) | NATS 组件、通过 NATS 提供服务动作（`@lakutata/nats`）、服务代理及其事件 |
| [Schedules](Schedules.md) | 定时任务：间隔、cron 表达式、只在一个实例中执行的任务 |
| [Queue](Queue.md) | 消息队列：生产者、`@QueueAction` 消费者、重试、死信、结果 |
| [Database](Database.md) | `Database` 组件与提供者、连接选项、多个数据库 |
| [DatabaseDrivers](DatabaseDrivers.md) | 逐个介绍数据库驱动：需要安装什么、选项、限制 |
| [MongoEmbedded](MongoEmbedded.md) | 应用内的 MongoDB，文档保存在文件中 |
| [Entities](Entities.md) | 实体、查询、事务与错误 |
| [Migrations](Migrations.md) | 编写、生成和执行迁移 |
| [Cache](Cache.md) | `Cacher` 组件：`wrap()`、各种存储及其分层、存储保存的值 |
| [Mutex](Mutex.md) | 实例与进程之间的锁 |
| [I18n](I18n.md) | 多语言消息 |
| [DockerIntegration](DockerIntegration.md) | `Docker` 组件 |
| [ContainerdIntegration](ContainerdIntegration.md) | `Containerd` 组件 |
| [Monitor](Monitor.md) | CPU、内存、事件循环和 HTTP 请求的监控器 |
| [Security](Security.md) | 哈希、加解密、签名、密码 |
| [DBus](DBus.md) | D-Bus 服务和客户端（`@lakutata/dbus`）：方法、对象、属性、信号 |
| [MCP](MCP.md) | 模型上下文协议（`@lakutata/mcp`）的工具、资源和提示词，基于 stdio 和 HTTP |
| [Command](Command.md) | `lakutata` 命令：创建项目、迁移、翻译、环境变量 |
| [Workspaces](Workspaces.md) | 由多个包组成的项目：运行各个包的脚本、统一版本号、添加包 |
| [NativeAddons](NativeAddons.md) | 用 C++ 或 Rust 编写的原生插件：创建、链接库、发布 |
| [Packaging](Packaging.md) | 单文件包和可执行文件，以及打包后的应用在运行时读取什么 |
| [Installers](Installers.md) | 各平台的安装包、服务、安装脚本、签名 |

每个 `@lakutata/*` 包都有自己的 README，各子路径的类型声明中，每一项也都附有说明和示例。
