# Lakutata 项目结构

本页介绍 `lakutata create` 创建的项目：`default` 模板的文件、其他模板的工作区、它们的脚本和可选功能，以及如何制作自己的模板。

## 1. 默认模板

```
my-app/
  package.json
  tsconfig.json
  README.md
  .gitignore
  src/
    App.ts                           启动应用
    config/Config.ts                 应用的选项：组件、入口、适配器
    controllers/ExampleController.ts 动作
    dtos/GreetDTO.ts                 动作的输入
    tests/App.spec.ts                测试（node --test）
  build/                             编译后的应用（npm run build）
```

`src/App.ts` 用 `src/config/Config.ts` 中的选项启动应用，并记录启动日志：

```typescript
import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

Application
    .run(config)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
```

`config()` 返回应用的选项：应用的 ID 和名称、运行模式（`NODE_ENV=production` 时为 `production`），以及 `entrypoint` 组件，它在环境变量 `PORT` 指定的端口（默认 8080）上通过 HTTP 提供 `ExampleController`。它写成函数，是为了让测试可以在自己的端口上启动应用：`src/tests/App.spec.ts` 运行 `Application.run(config(18080))`，请求 `/example?name=you`，最后销毁应用。

| 脚本 | 作用 |
|---|---|
| `dev` | 先 `build`，再启动应用 |
| `build` | 删除 `build/`（`lakutata clean`），再把 `src/` 编译到其中（`tsc`） |
| `start` | 启动编译好的应用（`node build/App.js`） |
| `test` | 先 `build`，再运行测试（`node --test "build/tests/**/*.spec.js"`） |
| `migration:generate`、`migration:create`、`migration:run`、`migration:revert`、`migration:show` | 数据库迁移（`lakutata migration`，见 [Migrations](Migrations.md)） |

这个模板在 `tsconfig.json` 中写了自己的编译选项（取 `lakutata/tsconfig.json` 中它需要的那些，并使用 `module: "NodeNext"` 和 source map）；项目也可以像 `cli` 以外的工作区模板那样继承 `lakutata/tsconfig.json`。

## 2. 工作区模板

其他模板都是 npm 工作区：应用是 `packages/app` 这个包，带界面或安装包的模板还会加上 `packages/ui`（网页，或 Electron 的渲染进程）和 `packages/resources`（图标）。`service` 模板：

```
shop/
  package.json                       工作区：workspaces ["packages/*"]，以及脚本
  Dockerfile                         服务的镜像
  packages/
    app/
      package.json
      tsconfig.json                  extends lakutata/tsconfig.json
      src/
        App.ts
        config/Config.ts             express 适配器、中间件、compression
        controllers/ExampleController.ts
        controllers/HealthController.ts    GET /health
        dtos/GreetDTO.ts
        middlewares/Authenticate.ts  设置了 API_TOKEN 时校验 Bearer 令牌
        tests/App.spec.ts
```

| 脚本（根目录） | 作用 |
|---|---|
| `npm run build` | 按依赖顺序构建每个包（`lakutata run rebuild`） |
| `npm test` | 运行每个包的测试（`lakutata run test`），不会先构建：请先运行 `npm run build` |
| `npm run dev` | 同时启动每个包的 `dev` 脚本（`lakutata run dev --parallel`）：应用，以及界面的开发服务器（如果有界面） |
| `npm start` | 启动编译好的应用（`npm start -w app`） |
| `npm run version:patch` | 给每个包设置下一个补丁版本（`lakutata version patch --yes`） |

其他模板在这个结构上增加了：

- `web-react` 和 `web-vue`：`packages/ui`，一个 Vite 应用。开发时，它的开发服务器（`http://localhost:5173`）把 `/api` 转发给应用；构建之后，由应用自己提供这些页面（动作都在 `/api` 之下）。应用的 `lakutata.resources` 会在打包时带上构建好的页面。
- `web-next` 和 `web-nuxt`：`packages/ui`，一个 Next.js 或 Nuxt 应用，由应用在同一个进程中渲染。
- `cli`：一个命令行工具（`commanderCLIEntrypoint`），带有 `package:bundle` 和 `package:exe` 脚本，把它打包到 `dist/`（[Packaging](Packaging.md)）。
- `electron-react` 和 `electron-vue`：`packages/app` 中是 Electron 的主进程（它的窗口，以及通过 IPC 提供的服务动作），`packages/ui` 中是渲染进程，还有制作安装包的脚本。

打包产物写到工作区根目录的 `dist/` 中；`.gitignore` 忽略 `build`、`dist` 以及界面的构建输出。

## 3. 可选功能

`lakutata create --with <features>`（或在终端里列出的选项）给模板加上可选功能：

| 功能 | 模板 | 加入的内容 |
|---|---|---|
| `i18n` | 全部 | `src/locales` 中各语言的消息（`en`、`zh-CN`）、`i18n` 组件、语言中间件，以及 `i18n:check` 和 `i18n:types` 脚本（[I18n](I18n.md)） |
| `installer` | `cli`、`service`、`web-*` | 应用的 `lakutata.installer`、制作安装包的脚本（在本机制作，以及在 Docker 中制作 Linux 的安装包），服务类模板还会注册系统服务（[Packaging](Packaging.md)） |

Electron 模板不需要这个功能也能制作安装包。

## 4. 自己的模板

`--template` 也可以指定不在官方列表中的模板：`npm:<package>[@<version>]`、`github:<owner>/<repo>[#<ref>]`，或者一个目录。没有 `template/` 子目录的目录会原样复制；模板包（和官方模板一样）包含：

- `template/`：项目的文件。npm 不会发布某些点文件，所以它们以 `_` 开头命名，创建时再改名（`_gitignore` 变成 `.gitignore`）。文本文件中的 `{$APP_NAME}`、`{$APP_ID}`、`{$APP_DESC}`、`{$APP_AUTHOR}`、`{$APP_LICENSE}` 和 `{$LAKUTATA_VERSION}` 会被替换。
- `features/<name>/`：每个功能的文件，在模板 `package.json` 的 `lakutata.features` 中声明并附上说明。这些文件会加入项目：项目中已有的 JSON 文件与之合并（数组整体替换），其他文件替换模板中的同名文件。
- 只对某个功能保留的代码块：位于 `//@if i18n` 和 `//@end` 之间的行（可以有 `//@else`，`@if !i18n` 表示相反的条件），写成该文件的注释形式（`#@if`、`<!--@if-->`、`/*@if*/`）。
