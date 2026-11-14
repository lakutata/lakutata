# 快速开始

本指南首先介绍如何用模板创建第一个 Lakutata 项目，然后介绍如何在已有项目中加入框架并手动编写一个应用。

## 1. 环境要求

- Node.js 18.10 或更高版本（`>=18.10.0`）。少数功能需要较新的 Node.js：
  - Fastify 适配器：Fastify 5 需要 Node.js 18.19、19.9、20 或更高版本（Express 适配器无此要求）；
  - `@lakutata/queue` 的 Kafka 驱动：需要 Node.js 22.22、24.6 或更高版本，这是 `@platformatic/kafka` 的要求；
  - Node.js 可执行文件（`lakutata package exe` 和安装包）：需要用 Node.js 20.12、21.7 或更高版本生成，或通过 `--node-program` 指定符合要求的 Node.js；
  - 对框架对象使用 `await using`：需要 Node.js 18.18、20.4 或更高版本。

  在 Node.js 18 和 19 上，应用需要使用 commander 13、@inquirer/prompts 7 和 better-sqlite3 11，因为它们的后续主版本需要 Node.js 20 或更高版本。

  `lakutata create` 生成的项目声明 Node.js `>=22.13.0`，这是 Web 模板和桌面应用模板所用工具的要求。
- TypeScript，并开启装饰器（`experimentalDecorators`）及其元数据（`emitDecoratorMetadata`）。框架所需的编译选项以 `lakutata/tsconfig.json` 发布；模板使用 TypeScript 6。
- ES 模块（`"type": "module"`），与模板相同；包中同时提供 CommonJS 构建。

## 2. 创建项目

```bash
npx @lakutata/cli create --name my-app
cd my-app
npm run dev
```

`npm run dev` 编译项目并启动应用。日志中会出现 `my-app started in development mode`，应用在 8080 端口上响应：

```bash
curl 'http://localhost:8080/example?name=you'
# {"message":"Hello, you!"}
```

`default` 模板是一个小型 HTTP 应用。其他模板创建其他类型的应用：

| 模板 | 应用 |
|---|---|
| `default` | 提供 HTTP 动作的最小应用 |
| `cli` | 命令行工具，构建为无需 Node.js 即可运行的可执行文件 |
| `service` | 以 Docker 镜像部署的 HTTP API |
| `web-react`、`web-vue` | 提供 React 或 Vue 单页应用（Vite）的 HTTP API |
| `web-next`、`web-nuxt` | 在同一个进程中提供 Next.js 或 Nuxt 应用的 HTTP API |
| `electron-react`、`electron-vue` | Electron 桌面应用，其主进程通过 IPC 为 React 或 Vue 渲染进程提供服务 |
| `nwjs-react`、`nwjs-vue` | NW.js 桌面应用，其后台脚本为隔离在 webview 中的 React 或 Vue 用户界面提供服务 |
| `mobile-react` | 面向 Android、iOS 和鸿蒙的 React Native 手机应用，其内嵌的 Node.js 为用户界面提供服务 |

```bash
npx @lakutata/cli create --name shop --template service --with i18n,installer
```

`--with` 用于加入可选功能：所有模板都提供 `i18n`（多语言消息），`cli`、`service` 和 `web-*` 模板另有 `installer`（安装包和系统服务），`nwjs-*` 模板另有 `win7`（可在 Windows 7 上运行的 NW.js 0.72）。在终端中未指定 `--with` 时，工具会列出这些功能供选择。模板中的文件见[项目结构](ProjectStructure.md)，`lakutata create` 的选项见[命令行工具](Command.md)。

`default` 模板定义了以下脚本：

| 脚本 | 作用 |
|---|---|
| `npm run dev` | 将项目编译到 `build/` 并启动应用 |
| `npm run build` | 将项目编译到 `build/` |
| `npm start` | 启动编译好的应用 |
| `npm test` | 编译项目并运行测试（`node --test`） |

其他模板是包含多个包的工作区：其脚本作用于每个包，`npm test` 也会先构建各个包，再运行测试（见[项目结构](ProjectStructure.md)第 2 节）。

## 3. 在已有项目中加入 Lakutata

```bash
npm install lakutata express
npm install --save-dev typescript @types/node @types/express @lakutata/cli
```

`express` 是下文所用 HTTP 适配器的底层库。适配器和驱动都是可选依赖，仅在使用时安装：`fastify`，`commander` 和 `@inquirer/prompts`（命令行工具），`socket.io`，`ws`，数据库驱动（`pg`、`mysql2`、`better-sqlite3` 等），以及缓存存储（`redis` 等）。

`tsconfig.json`：

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

请保留 `include`：发布的编译选项也会编译 JavaScript 文件（`allowJs`），因此缺少 `include` 时，项目根目录下的配置文件（`eslint.config.js`、`vite.config.ts`）会导致构建失败。在 `package.json` 中设置 `"type": "module"`，并参照模板添加脚本：

```json
{
  "type": "module",
  "main": "build/App.js",
  "scripts": {
    "clean": "lakutata clean",
    "build": "npm run clean && tsc",
    "start": "node build/App.js"
  }
}
```

源文件中的相对导入以 `.js` 结尾（`import {config} from './config/Config.js'`），因为 Node.js 在编译后的代码中按此路径解析。

## 4. 第一个应用

`src/App.ts`：

```typescript
import {Application, DTO, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class GreetDTO extends DTO {
    @Expect(DTO.String().optional().default('world'))
    public name: string
}

class GreetController extends Controller {
    //GET /greet?name=you
    @GET('/greet', GreetDTO)
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

```bash
npm run build && npm start
curl 'http://localhost:8080/greet?name=you'
# {"message":"Hello, you!"}
```

- `GreetDTO` 校验输入：`name` 可选，默认为 `world`（[DTO 与数据校验](DTOValidation.md)）。
- `GreetController` 声明一个动作，此处通过 HTTP 提供；同一个方法也可以同时作为命令行工具的命令或服务动作（[控制器与动作](Controllers.md)）。
- `Application.run()` 声明应用的组件：`entrypoint` 组件通过其适配器对外提供控制器，`bootstrap` 在启动时创建该组件（[应用](Application.md)、[入口](Entrypoint.md)）。

## 5. 接下来

- [示例](examples/README.md)：从模板出发，逐步构建完整的应用。
- [核心概念](Concepts.md)和[应用设计](ApplicationDesign.md)：框架的对象模型，以及如何基于这一模型组织应用。
- [项目结构](ProjectStructure.md)：项目中的文件和脚本。
- [应用](Application.md)、[对象与生命周期](Objects.md)和[依赖注入](Injection.md)：如何声明应用，以及应用中的对象如何创建、如何相互获取。
- [控制器与动作](Controllers.md)和 [HTTP](HTTP.md)：动作及其输入和响应。
- [命令行工具](Command.md)、[工作区](Workspaces.md)、[原生插件](NativeAddons.md)、[打包](Packaging.md)和[安装包](Installers.md)：`lakutata` 命令、项目中的各个包，以及打包后的应用。
