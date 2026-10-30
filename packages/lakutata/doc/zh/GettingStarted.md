# 快速开始

本页先用模板创建第一个 Lakutata 项目，然后介绍如何在已有项目中加入框架，并手写一个应用。

## 1. 环境要求

- Node.js 18.10 或更高版本（`>=18.10.0`）。少数功能需要较新的 Node.js：
  - Fastify 适配器：Fastify 5 需要 Node.js 18.19、19.9、20 或更高版本（Express 适配器没有这个要求）；
  - `@lakutata/queue` 的 Kafka 传输：需要 Node.js 22.22、24.6 或更高版本，这是 `@platformatic/kafka` 的要求；
  - Node.js 的可执行文件（`lakutata package exe` 和安装包）：要用 Node.js 20.12、21.7 或更高版本来生成，或者用 `--node-program` 指定这样一个 Node.js；
  - 对框架的对象使用 `await using`：需要 Node.js 18.18、20.4 或更高版本。

  `lakutata create` 生成的项目声明的是 Node.js `^22.13.0 || >=24.11.0`，Web 模板和 Electron 模板用到的工具需要它。
- TypeScript，开启它的装饰器（`experimentalDecorators`）及其元数据（`emitDecoratorMetadata`）。框架所需的编译选项以 `lakutata/tsconfig.json` 发布；模板使用 TypeScript 6。
- ES 模块（`"type": "module"`），和模板一样；包里同时也提供了 CommonJS 构建。

## 2. 创建项目

```bash
npx @lakutata/cli create --name my-app
cd my-app
npm run dev
```

`npm run dev` 编译项目并启动它；日志中会出现 `my-app started in development mode`，应用在 8080 端口上响应：

```bash
curl 'http://localhost:8080/example?name=you'
# {"message":"Hello, you!"}
```

`default` 模板是一个小型 HTTP 应用。其他模板从另一类应用开始：

| 模板 | 应用 |
|---|---|
| `default` | 提供 HTTP 动作的最小应用 |
| `cli` | 命令行工具，构建为不需要 Node.js 就能运行的可执行文件 |
| `service` | 以 Docker 镜像部署的 HTTP API |
| `web-react`、`web-vue` | 提供 React 或 Vue 单页应用（Vite）的 HTTP API |
| `web-next`、`web-nuxt` | 在同一个进程中提供 Next.js 或 Nuxt 应用的 HTTP API |
| `electron-react`、`electron-vue` | 桌面应用：Electron，主进程通过 IPC 为 React 或 Vue 渲染进程提供服务 |

```bash
npx @lakutata/cli create --name shop --template service --with i18n,installer
```

`--with` 加入可选功能：所有模板都有 `i18n`（多语言消息），`cli`、`service` 和 `web-*` 模板还有 `installer`（安装包和系统服务）。在终端里没有给出 `--with` 时，工具会列出这些功能供选择。模板中的文件见 [ProjectStructure](ProjectStructure.md)，`lakutata create` 的选项见 [Command](Command.md)。

`default` 模板的脚本：

| 脚本 | 作用 |
|---|---|
| `npm run dev` | 把项目编译到 `build/` 并启动 |
| `npm run build` | 把项目编译到 `build/` |
| `npm start` | 启动编译好的应用 |
| `npm test` | 编译项目并运行测试（`node --test`） |

其他模板是包含多个包的工作区，它们的脚本作用于每个包，`npm test` 也会先构建各个包再运行测试（见 [ProjectStructure](ProjectStructure.md) 第 2 节）。

## 3. 在已有项目中加入 Lakutata

```bash
npm install lakutata express
npm install --save-dev typescript @types/node @types/express @lakutata/cli
```

`express` 是下面用到的 HTTP 适配器所基于的库。适配器和驱动都是可选依赖，用到时才安装：`fastify`，`commander` 和 `@inquirer/prompts`（命令行工具），`socket.io`，`ws`，数据库驱动（`pg`、`mysql2`、`better-sqlite3` 等），缓存存储（`redis` 等）。

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

请保留 `include`：发布的编译选项也会编译 JavaScript 文件（`allowJs`），没有它的话，项目根目录下的配置文件（`eslint.config.js`、`vite.config.ts`）会让构建失败。在 `package.json` 中设置 `"type": "module"`，并参照模板加上脚本：

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

源码中的相对导入以 `.js` 结尾（`import {config} from './config/Config.js'`），因为 Node.js 在编译后的代码中按这个路径解析。

## 4. 第一个应用

`src/App.ts`：

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

```bash
npm run build && npm start
curl 'http://localhost:8080/greet?name=you'
# {"message":"Hello, you!"}
```

- `GreetDTO` 校验输入：`name` 可选，默认为 `world`（[DTOValidation](DTOValidation.md)）。
- `GreetController` 声明一个动作，这里通过 HTTP 提供；同一个方法也可以同时作为命令行工具的命令或服务动作（[Controllers](Controllers.md)）。
- `Application.run()` 声明应用的组件：`entrypoint` 组件通过它的适配器对外提供控制器，`bootstrap` 在启动时创建它（[Application](Application.md)、[Entrypoint](Entrypoint.md)）。

## 5. 接下来

- [示例](examples/README.md)：一步步从模板构建完整的应用。
- [ProjectStructure](ProjectStructure.md)：项目中的文件和脚本。
- [Application](Application.md)、[Objects](Objects.md) 和 [Injection](Injection.md)：怎样声明应用，以及应用中的对象如何创建、如何获取彼此。
- [Controllers](Controllers.md) 和 [HTTP](HTTP.md)：动作、它们的输入和响应。
- [Command](Command.md)、[Workspaces](Workspaces.md)、[NativeAddons](NativeAddons.md)、[Packaging](Packaging.md) 和 [Installers](Installers.md)：`lakutata` 命令、项目中的各个包，以及打包后的应用。
