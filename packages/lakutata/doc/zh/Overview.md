# Lakutata 概述

**Lakutata** 是一个基于 IoC 的 Node.js / TypeScript 应用框架，让 Web 服务、命令行工具、桌面（Electron、NW.js）应用和嵌入式设备共用同一套编程模型。应用是一棵由容器创建的对象树（组件、提供者、控制器）：DTO 校验对象的选项和输入，各种传输方式把控制器暴露出去——HTTP（Express、Fastify）、CLI（Commander）、服务调用（HTTP、Socket.IO、JSON-RPC 2.0、gRPC、NATS、Electron IPC、NW.js、React Native）、定时任务和消息队列。同一个控制器方法可以同时通过所有这些方式调用。

`lakutata` 包通过各个子路径重新导出 `@lakutata/*` 系列包（见下表），并为每个应用预置两个组件：`log`（`Logger`，输出与 pino 兼容的 JSON 日志行）和 `entrypoint`（对外提供控制器的 `Entrypoint`）。

## 从哪里开始

[快速开始](GettingStarted.md)用模板创建第一个项目，并演示第一个应用；[核心概念](Concepts.md)阐述框架的对象模型，[应用设计](ApplicationDesign.md)说明如何基于这一模型组织应用；[项目结构](ProjectStructure.md)介绍项目中的文件；下面的各篇指南分别介绍框架的各个部分。[示例](examples/README.md)从模板出发构建完整的应用：REST API、命令行工具、Web 应用和桌面应用、服务之间的调用、后台任务、MCP 服务器，以及设备上的服务。

## 子路径

| 子路径 | 内容 |
|---|---|
| `lakutata` | `Application`、`Module`、`Component`、`Provider`、`BaseObject`、`Container`、`DTO`、`Exception`、`Time`、`isPackaged`、`resourcesPath`、校验消息 |
| `lakutata/decorator/di` | `@Inject`、`@Configurable`、`@Autoload`、`@Singleton`、`@Scoped`、`@Transient`、`@Lifetime` |
| `lakutata/decorator/dto` | `@Expect`、`@Accept`、`@Return`、`@IndexSignature` |
| `lakutata/decorator/asst` | `@Before`、`@After` |
| `lakutata/dtos` | `PaginationSearchDTO`、`PaginationResultDTO`、`paginator`、`FlexibleDTO`、JSON Schema 转换 |
| `lakutata/com/entrypoint` | `Entrypoint`、`buildEntrypoints`、`Controller`、各种上下文、`Result`、访问控制、中间件、`httpServiceEntrypoint`、`scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@HTTPAction`、`@GET`…`@OPTIONS`、`@CLIAction`、`@ServiceAction`、`@Schedule`、`@Prefix`、`@UseMiddlewares` |
| `lakutata/adapter/express`、`lakutata/adapter/fastify` | HTTP 传输 |
| `lakutata/adapter/commander` | CLI 传输 |
| `lakutata/adapter/socket.io`、`lakutata/adapter/jsonrpc`、`lakutata/adapter/electron`、`lakutata/adapter/nwjs`、`lakutata/adapter/react-native` | 服务传输 |
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

不在本包中的：`@lakutata/cli`（`lakutata` 命令：创建项目、执行迁移、打包应用，见[命令行工具](Command.md)）、`@lakutata/grpc`（gRPC 客户端、服务端和服务适配器）、`@lakutata/nats`（NATS 组件和服务适配器）、`@lakutata/dbus`（D-Bus）、`@lakutata/mcp`（Model Context Protocol）、`@lakutata/webrtc`（WebRTC：信令、TURN 服务器、媒体服务器、对等连接）、`@lakutata/ffi`（调用动态库中的 C 函数）、`@lakutata/math`（符号计算和数值计算，直接作为函数使用，不需要 Lakutata 应用）、`@lakutata/barcode`（条形码和二维码的生成和识别，由原生插件完成）、`@lakutata/netif`（服务器和 UDP 套接字按网口监听，无论网口的地址如何变化；本机的网口和它们的变化）、`@lakutata/mongo-embedded`（`mongo-embedded` 数据库所用的嵌入式 MongoDB，由原生插件完成）、`@lakutata/thermal` 和 `@lakutata/thermal-printer`（热敏打印机：用 HTML 编排小票和标签，管理器组件）、`@lakutata/serial`（串口和蓝牙设备），以及 `@lakutata/ldap` 和 `@lakutata/ldap-engine`（LDAP：用目录验证用户登录，应用自己提供目录服务）。

## 指南

| 指南 | 主题 |
|---|---|
| [快速开始](GettingStarted.md) | 环境要求、创建项目、在已有项目中加入 Lakutata、第一个应用 |
| [核心概念](Concepts.md) | 框架的对象模型：作为对象树的应用、基础类及其设计用意、生命周期类型、选项、动作与传输方式、术语 |
| [项目结构](ProjectStructure.md) | 用模板创建的项目中的文件、脚本和可选功能，以及自己的模板 |
| [应用设计](ApplicationDesign.md) | 组织应用的结构：各部分应使用的类、逻辑与状态的归属、配置、创建顺序、测试 |
| [从 Lakutata 2.x 升级](UpgradingFrom2.md) | 把项目从 Lakutata 2.x（`lakutata` 包的 2.x 版本）升级 |
| [从 Lakutata 1.x 升级](UpgradingFrom1.md) | 把项目从 Lakutata 1.x（1.x 版本的 `@lakutata/core` 以及 `@lakutata-module/*`、`@lakutata-component/*` 包）移植过来 |
| [应用](Application.md) | 应用：选项、链式 API、生命周期、运行模式、打包后的应用 |
| [对象与生命周期](Objects.md) | 组件、提供者及其容器：生命周期类型、作用域、创建与销毁、不使用应用的容器 |
| [依赖注入](Injection.md) | 依赖注入、对象的选项、在多个应用之间共享功能 |
| [模块](Modules.md) | 模块：拥有自身组件和提供者的功能单元、其对象的解析方式、从应用中配置模块 |
| [DTO 与数据校验](DTOValidation.md) | DTO、校验规则，以及选项、输入和返回值的校验 |
| [异常](Exceptions.md) | 声明异常、异常的消息、客户端收到的内容、框架的异常 |
| [日志](Logger.md) | `log` 组件：写日志、可读的行或 JSON、输出目标、换用其他日志记录器 |
| [装饰器](Decorator.md) | 各子路径的装饰器 |
| [时间（Time）](Time.md) | `Time` 类 |
| [辅助函数](HelperFunctions.md) | `lakutata/utils` 的辅助函数 |
| [控制器与动作](Controllers.md) | 控制器与动作：地址、输入与结果、前缀、继承 |
| [入口](Entrypoint.md) | 入口组件：选项与适配器、启动与停止、动作列表 |
| [中间件与访问控制](Middlewares.md) | 动作的中间件与访问控制 |
| [HTTP](HTTP.md) | HTTP 适配器：路由、输入、响应、错误，以及 Express 和 Fastify 的功能 |
| [命令行](CLI.md) | 命令行工具：命令、选项、提示输入、输出与退出码 |
| [服务调用](ServiceCalls.md) | 通过 HTTP、Socket.IO、JSON-RPC 2.0、Electron 和 NW.js 调用服务动作：模式、响应、客户端及其事件 |
| [gRPC](GRPC.md) | 通过 gRPC 提供服务动作（`@lakutata/grpc`），以及从其他应用和其他语言调用它们 |
| [NATS](NATS.md) | NATS 组件、通过 NATS 提供服务动作（`@lakutata/nats`）、服务代理及其事件 |
| [定时任务](Schedules.md) | 定时任务：间隔、cron 表达式、只在一个实例中执行的任务 |
| [消息队列](Queue.md) | 消息队列：生产者、`@QueueAction` 消费者、重试、死信、结果 |
| [数据库](Database.md) | `Database` 组件与提供者、连接选项、多个数据库 |
| [数据库驱动](DatabaseDrivers.md) | 逐个介绍数据库驱动：需要安装什么、选项、限制 |
| [嵌入式 MongoDB](MongoEmbedded.md) | 应用内的 MongoDB（`@lakutata/mongo-embedded`），文档保存在一个文件中 |
| [实体、查询与事务](Entities.md) | 实体、查询、事务与错误 |
| [迁移](Migrations.md) | 编写、生成和执行迁移 |
| [缓存](Cache.md) | `Cacher` 组件：`wrap()`、各种存储及其分层、存储保存的值 |
| [互斥锁](Mutex.md) | 实例与进程之间的锁 |
| [国际化（i18n）](I18n.md) | 多语言消息 |
| [Docker 集成](DockerIntegration.md) | `Docker` 组件 |
| [Containerd 集成](ContainerdIntegration.md) | `Containerd` 组件 |
| [监控](Monitor.md) | CPU、内存、事件循环和 HTTP 请求的监控器 |
| [安全](Security.md) | 哈希、加解密、签名、密码 |
| [D-Bus](DBus.md) | D-Bus 服务和客户端（`@lakutata/dbus`）：方法、对象、属性、信号 |
| [MCP](MCP.md) | 模型上下文协议（`@lakutata/mcp`）的工具、资源和提示词，基于 stdio 和 HTTP |
| [WebRTC](WebRTC.md) | 点对点连接和媒体服务器（`@lakutata/webrtc`）：信令、TURN 服务器、浏览器和应用、通过数据通道调用应用的动作、WHIP 和 WHEP |
| [FFI](FFI.md) | 调用动态库中的 C 函数（`@lakutata/ffi`）：从头文件复制的声明、结构体、回调、内存、打包 |
| [条形码](Barcode.md) | 条形码和二维码（`@lakutata/barcode`）：生成 PNG、SVG 或像素，打印尺寸，EAN、UPC 和 GS1，从图片识别 |
| [热敏打印机](Thermal.md) | 热敏打印机（`@lakutata/thermal`、`@lakutata/thermal-printer`、`@lakutata/serial`）：用 HTML 编排小票、标签和腕带，选择并保存打印机，切纸，连接方式，串口和蓝牙 |
| [LDAP](LDAP.md) | LDAP 组件（`@lakutata/ldap`）：在控制器里用目录验证用户登录，读写目录，用应用的数据库提供目录服务，它的 schema、访问控制和密码策略，自己的插件，接入 SSSD、Keycloak 和 Gitea |
| [数学计算](Math.md) | 数学计算（`@lakutata/math`）：公式和精确结果、方程、任意精度的十进制数、矩阵、统计、数值解法、单位 |
| [网口](Netif.md) | 网口（`@lakutata/netif`）：服务器按网口监听，无论网口的地址如何变化；拒绝其他网口的连接；网口和它们的变化；单个网口上的 UDP |
| [串口](Serial.md) | 串口（`@lakutata/serial`）：把串口作为流打开，线路参数和信号线，按 USB 转接器的 ID 找到串口，设备拔掉后的处理，经典蓝牙设备 |
| [LDAP 引擎](LDAPEngine.md) | 不依赖应用的 LDAP（`@lakutata/ldap-engine`）：客户端和连接池，用户登录，Active Directory，过滤器，DN，schema，LDIF，带自己后端的服务器，插件，协议 |
| [命令行工具](Command.md) | `lakutata` 命令：创建项目、迁移、翻译、环境变量 |
| [工作区](Workspaces.md) | 由多个包组成的项目：运行各个包的脚本、统一版本号、添加包 |
| [原生插件](NativeAddons.md) | 用 C++ 或 Rust 编写的原生插件：创建、链接库、发布 |
| [打包](Packaging.md) | 单文件包和可执行文件，以及打包后的应用在运行时读取什么 |
| [安装包](Installers.md) | 各平台的安装包、服务、安装脚本、签名 |

每个 `@lakutata/*` 包都有自己的 README，各子路径的类型声明中，每一项也都附有说明和示例。
