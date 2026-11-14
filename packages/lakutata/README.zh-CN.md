<div align="center">

![lakutata](https://socialify.git.ci/lakutata/lakutata/image?description=1&descriptionEditable=An%20IoC%20application%20framework%20for%20Node.js%20and%20TypeScript&font=Source%20Code%20Pro&forks=1&language=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2Flakutata%2Flakutata%2Fmain%2Fpackages%2Flakutata%2Fassets%2Flogo.svg&name=1&pattern=Circuit%20Board&stargazers=1&theme=Auto)

</div>

<div align="center">

![node-lts](https://img.shields.io/node/v-lts/lakutata?style=for-the-badge&logo=nodedotjs&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/v/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/dm/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![NPM](https://img.shields.io/npm/l/lakutata?style=for-the-badge&logo=github&color=rgb(128%2C189%2C65))
![Codacy grade](https://img.shields.io/codacy/grade/0f16d1c355494415ad7733f8f22f7d36?style=for-the-badge&logo=codacy)

</div>

[English](README.md) | 中文

# lakutata

一个基于 IoC 的 Node.js 和 TypeScript 应用框架，为 Web 服务、命令行工具、桌面（Electron、NW.js）应用和嵌入式设备提供同一套编程模型。在这一模型中，应用是一棵由容器创建的对象树（组件、提供者、控制器）。DTO 校验这些对象的选项和输入，各种传输方式则对外提供控制器：HTTP（Express、Fastify）、CLI（Commander）、服务调用（HTTP、Socket.IO、JSON-RPC 2.0、gRPC、NATS、Electron IPC、NW.js、React Native）、定时任务和消息队列。同一个控制器方法可以同时通过所有这些传输方式调用。

本包即框架本身。本包通过下面列出的子路径重新导出各个 `@lakutata/*` 包，并为每个应用预置两个组件：`log` 和 `entrypoint`。各子路径的类型声明中，每一项都附有说明和示例；每个 `@lakutata/*` 包也有各自的 README。

## 安装

```shell
npx @lakutata/cli create --name my-app   # 用模板创建新项目（Web、服务、CLI、Electron、NW.js……）
npm install lakutata                      # 或者在已有项目中安装框架
```

框架需要 Node.js 18.10 或更高版本（`>=18.10.0`），少数功能需要较新的版本（见快速开始）。项目使用 ES 模块（`"type": "module"`），模板也是如此；本包同时提供 CommonJS 版本。框架所需的 TypeScript 选项以 `lakutata/tsconfig.json` 发布：

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "build"
  },
  "include": ["src"]
}
```

请保留 `include`：发布的选项也会编译 JavaScript 文件（`allowJs`），因此缺少该字段时，项目根目录下的配置文件（`eslint.config.js`、`vite.config.ts`）会导致构建失败。

传输方式和各项集成所需的 peer 依赖均为可选，仅在使用时才需要安装：`express` 或 `fastify`、`commander`、`socket.io`、`ws`、数据库驱动（`pg`、`mysql2`、`better-sqlite3`……）以及缓存存储（`redis`……）。各个包的 README 列出了各自所需的依赖。

## 用法

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

## API

| 子路径 | 包 | 内容 |
|---|---|---|
| `lakutata` | `@lakutata/core` | `Application`、`Component`、`Provider`、`BaseObject`、`Container`、`DTO`、`Exception`、`Time`、`isPackaged`、`resourcesPath`、校验规则和校验消息 |
| `lakutata/decorator/di` | `@lakutata/core` | `@Inject`、`@Configurable`、`@Autoload`、`@Lifetime`、`@Singleton`、`@Scoped`、`@Transient` |
| `lakutata/decorator/dto` | `@lakutata/core` | `@Expect`、`@Accept`、`@Return`、`@IndexSignature` |
| `lakutata/decorator/asst` | `@lakutata/core` | `@Before`、`@After` |
| `lakutata/dtos` | `@lakutata/core` | `PaginationSearchDTO`、`PaginationResultDTO`、`paginator`、`FlexibleDTO`、JSON Schema 转换 |
| `lakutata/com/entrypoint` | `@lakutata/entrypoint` | `Entrypoint`、`buildEntrypoints`、`Controller`、各种上下文、各种结果、访问控制、中间件、`httpServiceEntrypoint`、`scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@lakutata/entrypoint` | `@HTTPAction`、`@GET`…`@OPTIONS`、`@CLIAction`、`@ServiceAction`、`@Schedule`、`@Prefix`、`@UseMiddlewares` |
| `lakutata/adapter/express`、`lakutata/adapter/fastify` | `@lakutata/entrypoint` | HTTP 适配器、`staticUI`（仅 Express） |
| `lakutata/adapter/commander` | `@lakutata/entrypoint` | CLI 适配器 |
| `lakutata/adapter/socket.io`、`lakutata/adapter/jsonrpc`、`lakutata/adapter/electron`、`lakutata/adapter/nwjs`、`lakutata/adapter/react-native` | `@lakutata/entrypoint` | 服务适配器 |
| `lakutata/com/logger` | `@lakutata/logger` | `Logger` 组件，预置为 `log`（输出与 pino 兼容的 JSON 行） |
| `lakutata/orm`、`lakutata/decorator/orm` | `@lakutata/orm` | TypeORM 及其装饰器 |
| `lakutata/com/database`、`lakutata/provider/database` | `@lakutata/orm` | `Database` 组件和提供者、迁移命令 |
| `lakutata/com/cacher` | `@lakutata/cache` | `Cacher` 组件：存储可以是内存、文件、Redis、Memcached、MongoDB、SQLite、PostgreSQL、MySQL |
| `lakutata/com/mutex` | `@lakutata/mutex` | `Mutex` 组件、`@Synchronized` |
| `lakutata/com/queue` | `@lakutata/queue` | `Queue` 组件、`@QueueAction`、`queueEntrypoint`：基于内存、Redis（BullMQ）、NATS JetStream、RabbitMQ 或 Kafka 的消息队列 |
| `lakutata/com/i18n` | `@lakutata/i18n` | `I18n` 组件、`Translator`、语言中间件 |
| `lakutata/com/docker` | `@lakutata/docker` | `Docker` 组件 |
| `lakutata/com/containerd` | `@lakutata/containerd` | `Containerd` 组件（不依赖 Docker 的 containerd，使用 BuildKit 构建镜像） |
| `lakutata/com/monitor` | `@lakutata/monitor` | CPU、内存、事件循环和 HTTP 监控器 |
| `lakutata/security`、`lakutata/provider/passwordHash` | `@lakutata/security` | 哈希、加解密、签名、`PasswordHash` 提供者 |
| `lakutata/utils` | `@lakutata/utils` | 辅助函数（字符串、对象、数组、时间、文件、glob、编码、类型守卫） |
| `lakutata/tsconfig.json` | | 应用的编译选项 |

以下包不包含在本包中：`@lakutata/cli`（`lakutata` 命令，用于创建项目，制作单文件包、可执行文件和安装包，以及执行迁移）、`@lakutata/grpc`（gRPC 客户端、服务端和服务适配器）、`@lakutata/nats`（NATS 组件和服务适配器）、`@lakutata/dbus`（D-Bus）和 `@lakutata/mcp`（模型上下文协议）。

## 错误

框架的异常均继承自 `Exception`（来自 `lakutata`）。每个异常都包含 `errno`（`E_…`）、`message`、应用的 ID 和名称，以及 `statusCode`。HTTP 适配器以该值作为响应的状态码：默认为 500，输入无效时为 400，访问被拒绝时为 403，路由或动作不存在时为 404，未获得锁时为 409，等等。各个包的 README 列出了各自的异常。

## 另见

- 网站 <https://lakutata.com/zh/>：提供中英文的指南、示例和 API 参考。
- 指南位于本包的 `doc/zh`（中文）和 `doc/en`（英文）中：`Overview.md`、`GettingStarted.md`、`Concepts.md`、`ProjectStructure.md`、`ApplicationDesign.md`、`UpgradingFrom2.md`、`UpgradingFrom1.md`、`Application.md`、`Objects.md`、`Injection.md`、`Modules.md`、`DTOValidation.md`、`Exceptions.md`、`Logger.md`、`Decorator.md`、`Time.md`、`HelperFunctions.md`、`Controllers.md`、`Entrypoint.md`、`Middlewares.md`、`HTTP.md`、`CLI.md`、`ServiceCalls.md`、`GRPC.md`、`NATS.md`、`Schedules.md`、`Queue.md`、`Database.md`、`DatabaseDrivers.md`、`MongoEmbedded.md`、`Entities.md`、`Migrations.md`、`Cache.md`、`Mutex.md`、`I18n.md`、`DockerIntegration.md`、`ContainerdIntegration.md`、`Monitor.md`、`Security.md`、`DBus.md`、`MCP.md`、`WebRTC.md`、`FFI.md`、`Barcode.md`、`Thermal.md`、`LDAP.md`、`Math.md`、`Netif.md`、`Serial.md`、`LDAPEngine.md`、`Command.md`、`Workspaces.md`、`NativeAddons.md`、`Packaging.md`、`Installers.md`。示例位于 `doc/zh/examples` 和 `doc/en/examples` 中，是从模板构建的完整应用。
- `@lakutata/cli`：创建、构建和打包应用。
- 官方 Agent Skill（智能体技能），供 AI 编程助手在 Lakutata 项目中使用：<https://lakutata.com/zh/skill/>。

## 许可证

Lakutata 使用 [MIT 许可证](LICENSE)。
