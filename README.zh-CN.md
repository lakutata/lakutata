<div align="center">

<img src="packages/lakutata/assets/logo.svg" alt="Lakutata" width="128">

# Lakutata

面向 Node.js 和 TypeScript 的 IoC 应用框架

[网站](https://lakutata.com/zh/) · [快速开始](https://lakutata.com/zh/guide/GettingStarted) · [API 参考](https://lakutata.com/api/) · [English](README.md)

![npm](https://img.shields.io/npm/v/lakutata?logo=npm)
![node](https://img.shields.io/node/v/lakutata?logo=nodedotjs)
![license](https://img.shields.io/npm/l/lakutata)

</div>

Lakutata 让 Web 服务、命令行工具、桌面（Electron）应用和嵌入式设备共用同一套编程模型。应用是一棵由容器创建的对象树（组件、提供者、控制器）；DTO 校验对象的选项和动作的输入；各种传输方式把控制器暴露出去：HTTP（Express、Fastify）、命令行（Commander）、服务调用（HTTP、Socket.IO、JSON-RPC 2.0、gRPC、NATS、Electron IPC）、MCP、D-Bus、定时任务和消息队列。同一个控制器方法可以同时通过其中几种方式调用。

## 快速开始

```bash
npx @lakutata/cli create --name my-app
cd my-app
npm run dev
# 在另一个终端里
curl 'http://localhost:8080/example?name=you'     # {"message":"Hello, you!"}
```

Lakutata 需要 Node.js `^22.13.0 || >=24.11.0`。`lakutata create` 的模板可以生成 Web 服务、命令行工具、带 React、Vue、Next.js 或 Nuxt 界面的 HTTP API，或者 Electron 应用。手写的应用是这样的：

```typescript
import {Application, DTO} from 'lakutata'
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

Application.run(() => ({
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
```

## 包

`lakutata` 就是框架本身：它通过子路径（`lakutata/com/database`、`lakutata/adapter/express` 等）重新导出下表中的大部分包，所以应用通常只需要安装它，再加上用到的驱动和适配器。

| 包 | 提供什么 | 包含在 `lakutata` 中 |
|---|---|---|
| [`lakutata`](packages/lakutata) | 框架本身，预置 `log` 和 `entrypoint` 组件 | |
| [`@lakutata/core`](packages/core) | 应用、对象、依赖注入、DTO 校验 | 是 |
| [`@lakutata/entrypoint`](packages/entrypoint) | 控制器及其传输方式：HTTP、命令行、服务调用、定时任务 | 是 |
| [`@lakutata/logger`](packages/logger) | 日志（与 pino 兼容的 JSON 行） | 是 |
| [`@lakutata/utils`](packages/utils) | `Time` 和辅助函数 | 是 |
| [`@lakutata/orm`](packages/orm) | 基于 TypeORM 的数据库、内嵌的 MongoDB、迁移 | 是 |
| [`@lakutata/cache`](packages/cache) | 缓存，存储可以是内存、文件、Redis、Memcache、MongoDB、SQLite、PostgreSQL 或 MySQL | 是 |
| [`@lakutata/mutex`](packages/mutex) | 在进程和实例之间共享的锁 | 是 |
| [`@lakutata/queue`](packages/queue) | 消息队列，基于内存、Redis、NATS、RabbitMQ 或 Kafka | 是 |
| [`@lakutata/i18n`](packages/i18n) | 多语言消息（ICU MessageFormat） | 是 |
| [`@lakutata/security`](packages/security) | 密码哈希、签名、加密 | 是 |
| [`@lakutata/monitor`](packages/monitor) | CPU、内存、事件循环和 HTTP 请求的监控 | 是 |
| [`@lakutata/docker`](packages/docker) | Docker 的镜像、容器和网络 | 是 |
| [`@lakutata/containerd`](packages/containerd) | 不依赖 Docker 的 containerd，用于嵌入式 Linux 设备 | 是 |
| [`@lakutata/nats`](packages/nats) | NATS 消息，以及基于 NATS 的服务调用 | 否 |
| [`@lakutata/grpc`](packages/grpc) | gRPC 客户端和服务端，以及基于 gRPC 的服务调用 | 否 |
| [`@lakutata/dbus`](packages/dbus) | D-Bus 服务和客户端 | 否 |
| [`@lakutata/mcp`](packages/mcp) | 模型上下文协议（MCP）的工具、资源和提示词 | 否 |
| [`@lakutata/cli`](packages/cli) | `lakutata` 命令：项目、工作区、迁移、打包 | 否 |
| [`@lakutata/builder`](packages/builder) | 单文件包、可执行文件和安装包，由 `lakutata package` 使用 | 否 |

`lakutata create` 用的模板是各个 `@lakutata/template-*` 包，由 `@lakutata/templates` 列出。

## 文档

- [lakutata.com](https://lakutata.com/zh/)：中英文指南和 API 参考。指南的源文件在 [`packages/lakutata/doc`](packages/lakutata/doc)（`en`、`zh`），API 参考来自各个包的类型声明。
- 每个包都有自己的 README，说明它的选项、API 和错误。

## 开发

```bash
npm install
npm run build        # 按依赖顺序编译所有包
npm run test:unit    # 各个包的单元测试
npm run lint         # ESLint，以及公共 API 文档的检查

cd website && npm ci && npm run dev    # 网站（需要先构建各个包）
```

仓库里有各个包和模板（`packages/`）、网站（`website/`），以及构建和文档检查用的脚本（`scripts/`）。命名规则和公共 API 的文档写法见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Lakutata 2.x

Lakutata 3 把框架和它的各个包都放进了这个仓库。`lakutata` 的 2.x 版本在这里有标签（`2.0.x`）。`@lakutata/cli`、`@lakutata/dbus` 和 `@lakutata/nats` 的 2.x 版本来自 [lakutata-packages](https://github.com/lakutata/lakutata-packages)，2.x 的模板来自各个 `lakutata-template-*` 仓库。

## 许可证

[MIT](packages/lakutata/LICENSE)
