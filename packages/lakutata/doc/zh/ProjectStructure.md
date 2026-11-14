# Lakutata 项目结构

本指南介绍 `lakutata create` 创建的项目：`default` 模板的文件、其他模板的工作区、各模板的脚本和可选功能，以及如何制作自定义模板。

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

`config()` 返回应用的选项：应用的 ID 和名称、运行模式（`NODE_ENV=production` 时为 `production`），以及 `entrypoint` 组件。该组件在环境变量 `PORT` 指定的端口（默认 8080）上通过 HTTP 提供 `ExampleController`。选项以函数形式提供，是为了使测试能够在专用的端口上启动应用：`src/tests/App.spec.ts` 运行 `Application.run(config(18080))`，请求 `/example?name=you`，最后销毁应用。

| 脚本 | 作用 |
|---|---|
| `dev` | 先 `build`，再启动应用 |
| `build` | 删除 `build/`（`lakutata clean`），再将 `src/` 编译到其中（`tsc`） |
| `start` | 启动编译好的应用（`node build/App.js`） |
| `test` | 先 `build`，再运行测试（`node --test "build/tests/**/*.spec.js"`） |
| `migration:generate`、`migration:create`、`migration:run`、`migration:revert`、`migration:show` | 数据库迁移（`lakutata migration`，见[迁移](Migrations.md)） |

该模板在 `tsconfig.json` 中定义了自身的编译选项（即从 `lakutata/tsconfig.json` 中选取的所需选项，并使用 `module: "NodeNext"` 和 source map）；项目也可以改为继承 `lakutata/tsconfig.json`，`cli` 以外的工作区模板即是如此。

## 2. 工作区模板

其他模板都是 npm 工作区：应用即 `packages/app` 包，带界面或安装包的模板还会加入 `packages/ui`（网页、Electron 的渲染进程，或 NW.js 的用户界面）和 `packages/resources`（图标）。以 `service` 模板为例：

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
| `npm test` | 先构建每个包，再运行它们的测试（`npm run build && lakutata run test`） |
| `npm run dev` | 同时启动每个包的 `dev` 脚本（`lakutata run dev --parallel`）：应用，以及界面的开发服务器（如有界面） |
| `npm start` | 启动编译好的应用（`npm start -w app`） |
| `npm run version:patch` | 为每个包设置下一个补丁版本（`lakutata version patch --yes`） |

其他模板在此结构上增加了以下内容：

- `web-react` 和 `web-vue`：`packages/ui`，即一个 Vite 应用。开发时，其开发服务器（`http://localhost:5173`）将 `/api` 转发给应用；构建之后，由应用自身提供这些页面（动作都位于 `/api` 之下）。应用的 `lakutata.resources` 使打包产物包含构建好的页面。
- `web-next` 和 `web-nuxt`：`packages/ui`，即一个由应用在同一进程中渲染的 Next.js 或 Nuxt 应用。
- `cli`：一个命令行工具（`commanderCLIEntrypoint`），以及将其打包到 `dist/` 的 `package:bundle` 和 `package:exe` 脚本（[打包](Packaging.md)）。
- `electron-react` 和 `electron-vue`：`packages/app` 中是 Electron 的主进程（其窗口，以及通过 IPC 提供的服务动作），`packages/ui` 中是渲染进程，此外还有制作安装包的脚本。
- `nwjs-react` 和 `nwjs-vue`：`packages/app` 中是 NW.js 的后台脚本，包括其窗口和服务动作，窗口的宿主页面位于 `packages/app/host`，用 webview 承载用户界面；`packages/ui` 中是用户界面；NW.js 的版本记录在 `packages/app/nwjs.json` 中（由 `npm run nwjs:use -- <版本>` 写入）；此外还有制作安装包的脚本。
- `mobile-react`：`packages/app` 中是应用，它运行在手机应用内嵌的 Node.js 中，为 React Native 界面提供服务动作。`packages/ui` 中是界面（`src/App.tsx`），由三个系统共用。`packages/ipc` 连接界面和 Node.js，其中包含内嵌 Node.js 的原生模块（`native`）和界面导入的 `ipc`。Electron 和 NW.js 自带这样的通道，React Native 则没有，因此模板以一个包的形式提供该通道。根目录即 React Native 应用本身，包括入口 `index.js`（登记 `packages/ui` 的组件）、`app.json`、Metro 和 Babel 的配置，以及原生工程（`android`、`ios`、`harmony`）。应用的 ID（`lakutata create --bundle-id`）写在这些原生工程中。此外还有下载 libnode、在模拟器或设备上运行应用、部署 Node.js 一侧的脚本（`npm run node:android`、`npm run android`、`npm run deploy:android`，`ios` 和 `harmony` 同理）。

打包产物写入工作区根目录的 `dist/`；`.gitignore` 忽略 `build`、`dist` 以及界面的构建输出。

## 3. 可选功能

`lakutata create --with <features>`（或终端中列出的选项）为模板加入可选功能：

| 功能 | 模板 | 加入的内容 |
|---|---|---|
| `i18n` | 全部 | `src/locales` 中各语言的消息（`en`、`zh-CN`）、`i18n` 组件、语言中间件，以及 `i18n:check` 和 `i18n:types` 脚本（[国际化（i18n）](I18n.md)） |
| `installer` | `cli`、`service`、`web-*` | 应用的 `lakutata.installer`、制作安装包的脚本（在本机制作，以及在 Docker 中制作 Linux 安装包），服务类模板还会注册系统服务（[安装包](Installers.md)） |
| `win7` | `nwjs-*` | 以 NW.js 0.72.0（最后一个可在 Windows 7、8 和 8.1 上运行的版本）代替模板发布时所用的版本，并加入制作 32 位 Windows 安装包的 `package:ia32` 脚本 |

Electron 和 NW.js 模板无需 `installer` 功能即可制作安装包。

## 4. 自己的模板

`--template` 也可以指定不在官方列表中的模板：`npm:<package>[@<version>]`、`github:<owner>/<repo>[#<ref>]`，或一个目录。不含 `template/` 子目录的目录本身即作为模板，没有可选功能；模板包（与官方模板相同）包含以下内容：

- `template/`：项目的文件。npm 不会发布某些点文件，因此这些文件以 `_` 开头命名，在创建项目时再重命名（`_gitignore` 变为 `.gitignore`）。文本文件中的 `{$APP_NAME}`、`{$APP_ID}`、`{$APP_DESC}`、`{$APP_AUTHOR}`、`{$APP_LICENSE}` 和 `{$LAKUTATA_VERSION}` 会被替换。
- `features/<name>/`：每个功能的文件；各功能连同其说明在模板 `package.json` 的 `lakutata.features` 中声明。这些文件会加入项目：项目中已有的 JSON 文件会与之合并（数组整体替换），其他文件则替换模板中的同名文件。
- 仅在某个功能下保留的代码块：位于 `//@if i18n` 和 `//@end` 之间的行（可以包含 `//@else`，`@if !i18n` 表示相反的条件），按该文件的注释语法书写（`#@if`、`<!--@if-->`、`/*@if*/`）。
