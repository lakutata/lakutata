---
layout: home
titleTemplate: 所有 Node.js 应用，同一套编程模型

hero:
  name: Lakutata
  text: 所有 Node.js 应用，同一套编程模型
  tagline: 面向 TypeScript 的 IoC 框架。Web 服务、命令行工具、桌面和嵌入式应用共用同一套对象、校验和控制器。
  image:
    src: /logo.svg
    alt: Lakutata
  actions:
    - theme: brand
      text: 开始使用
      link: /zh/guide/GettingStarted
    - theme: alt
      text: API 参考
      link: /zh/api/
    - theme: alt
      text: GitHub
      link: https://github.com/lakutata/lakutata

features:
  - title: 依赖注入
    details: 容器负责创建组件、提供者、模块和控制器，管理它们的生命周期并校验选项。对象可以异步构造，在被使用之前先完成连接或加载。
  - title: 一个控制器，所有传输方式
    details: 同一个方法可以同时暴露为 HTTP 路由、CLI 命令、服务调用（Socket.IO、JSON-RPC、gRPC、NATS、Electron IPC、NW.js）、定时任务和队列消费者。无论走哪种方式，输入校验、访问控制和中间件都一样。
  - title: 处处校验
    details: DTO 校验选项、输入和返回值，可以转换为 JSON Schema，并给出带类型的错误。
  - title: 开箱即用
    details: 数据库（TypeORM）、缓存、锁、消息队列（Redis、NATS、RabbitMQ、Kafka）、多语言、日志、Docker 和 containerd、哈希与加密。
  - title: 从第一行代码到安装包
    details: lakutata 命令从模板创建项目、打包，并生成可执行文件和安装包。
  - title: 类型完整，文档齐全
    details: 提供 ESM 和 CommonJS 两种构建、完整的类型声明，每个公开 API 都有示例。
---

## 快速开始

```shell
npx @lakutata/cli create --name my-app
```

或者在已有项目中加入框架：

```shell
npm install lakutata express
```

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class HelloController extends Controller {
    @GET('/hello')
    public async hello(): Promise<string> {
        return 'Hello, Lakutata'
    }
}

Application.run(() => ({
    id: 'hello.app',
    name: 'Hello',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [HelloController],
            //GET http://127.0.0.1:3000/hello
            http: expressHTTPEntrypoint({port: 3000})
        })
    },
    bootstrap: ['entrypoint']
}))
```

[快速开始](/zh/guide/GettingStarted)带你创建第一个项目；[概述](/zh/guide/Overview)介绍框架的基本概念，之后每篇指南讲解框架的一个部分。
