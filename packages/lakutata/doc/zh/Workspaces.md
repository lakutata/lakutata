# Lakutata 工作区

由多个包组成的项目（应用、其 Web 界面、共享库、原生插件）就是一个工作区。工作区是一个仓库，其根目录的 `package.json` 列出各个包所在的目录。包管理器（npm、pnpm 或 yarn）负责将这些包相互链接；`lakutata` 命令按依赖顺序运行这些包的脚本，为它们统一版本号，并添加新的包。这类项目所用到的 lerna 功能，该命令均已提供。除 `default` 外，其他模板创建的都是工作区（见[项目结构](ProjectStructure.md)第 2 节）。

## 1. 工作区

使用 `lakutata create --name shop --template web-react` 创建的项目，其根目录的 `package.json` 如下（省略了迁移和 Docker 相关的脚本）：

```json
{
  "name": "shop-workspace",
  "version": "0.0.1",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "lakutata run rebuild",
    "test": "npm run build && lakutata run test",
    "dev": "lakutata run dev --parallel",
    "start": "npm start -w app",
    "version:patch": "lakutata version patch --yes"
  },
  "devDependencies": {
    "@lakutata/cli": "^3.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^6.0.3"
  }
}
```

- **包**：指 `workspaces` 中的模式所匹配的目录，且该目录中有带 `name` 的 `package.json`。`*` 匹配单层目录名中的任意字符，`**` 匹配任意层级的目录，`!packages/old` 排除一个目录。`node_modules` 和以点开头的目录不会被搜索。pnpm 工作区将模式写在 `pnpm-workspace.yaml` 中，作为 `packages:` 下的列表（每行一项 `- 'packages/*'`，或写成 `['packages/*']`）。
- **在工作区的任何目录中都能运行这些命令**：命令会向上查找，使用最近的声明了工作区的目录。
- **包之间的依赖**：`dependencies`、`devDependencies`、`peerDependencies` 或 `optionalDependencies` 中的依赖，无论版本范围如何书写（`^0.0.1`、`*`、`workspace:*`、`file:`）。
- **构建工具**（`@lakutata/cli`、`typescript`、`@types/node`）是根目录的开发依赖，因此每个包的脚本都能使用这些工具。

`lakutata list` 显示各个包及其版本和目录，以及每个包所依赖的包。在本例中，`app`（服务器）依赖 `ui`（Web 界面），并提供 `ui` 构建好的页面：

```
2 packages, version 0.0.1
  app  0.0.1 (private)  packages/app  → ui
  ui   0.0.1 (private)  packages/ui
```

## 2. 运行脚本

`lakutata run <script>` 在每个含有该 npm 脚本的包中运行此脚本。一个包要等其（直接或间接）依赖的包全部执行完毕后才开始执行，互不依赖的包同时执行。每行输出都以所属包的名称开头：

```
lib   │ start lib
tools │ start tools
tools │ end tools
lib   │ end lib
app   │ start app
app   │ end app
✔ build ran in tools, lib, app
```

| 选项 | 含义 |
|---|---|
| `--parallel` | 所有包同时开始，不等待各自的依赖，适用于持续运行的脚本，例如开发服务器和监视进程（`lakutata run dev --parallel`） |
| `--scope <names...>` | 只运行指定的包，`*` 匹配任意字符（`--scope 'app' '@shop/*'`）。这些包所依赖的包既不运行，也不等待；没有任何包匹配时报错 |
| `--concurrency <n>` | 同时运行的包数（默认为处理器数量） |
| `--no-bail` | 失败后继续执行：依赖于失败包的包会被跳过，其他包照常运行 |

- **失败**：默认情况下，有包失败后不再启动新的包，已在运行的包会运行完毕。命令最后输出 `error: build failed in lib, not run in app`，退出码为 1。
- **没有任何包有该脚本**：命令输出 `No package has the script lint`，并正常结束。
- **包管理器**：脚本通过 `npm run`、`pnpm run` 或 `yarn run` 运行，具体根据根目录 `package.json` 的 `packageManager` 字段（`"pnpm@9.15.0"`）选择。没有该字段时，根据根目录中的文件（`pnpm-lock.yaml` 或 `pnpm-workspace.yaml`、`yarn.lock`、`package-lock.json`）判断；默认为 npm。
- **参数**：脚本不接受额外的参数（`lakutata run build -- --watch` 会被拒绝），请另行添加一个脚本。

## 3. 设置版本号

工作区中的所有包共用一个版本号。`lakutata version <bump>` 将新版本号设置给所有包，并更新包之间的依赖。以 1.2.3 为起点：

```bash
lakutata version patch                     # 1.2.4，在终端里会先请求确认
lakutata version minor --git --yes         # 1.3.0，提交修改并打上标签 v1.3.0
lakutata version preminor --preid beta     # 1.3.0-beta.0，之后 prerelease 得到 1.3.0-beta.1
lakutata version 2.0.0
```

在版本为 0.0.16 的工作区中，输出如下：

```
Version 0.0.16 → 0.0.17
  app    0.0.16 → 0.0.17
  lib    0.0.16 → 0.0.17
  tools  0.0.16 → 0.0.17
✔ Version 0.0.17 given (packages/app/package.json, packages/lib/package.json, packages/tools/package.json, package.json)
```

- **当前版本**：`lerna.json` 中有 `version` 时取该值；否则取根目录 `package.json` 的版本；若仍没有，则取各包中最高的版本，预发布版本也计算在内（均没有时为 `0.0.0`）。新版本写回原处，同时写入每个包，私有包也不例外。
- **版本的递增方式**：`major`、`minor`、`patch`、`premajor`、`preminor`、`prepatch`、`prerelease`，或直接给出版本号。`--preid <id>` 为 `pre…` 系列递增方式指定预发布标识（`beta` 得到 `1.3.0-beta.0`；未指定时为 `1.3.0-0`）。
- **包之间的依赖随之更新**：`^0.0.16` 变为 `^0.0.17`，`~`、`>=`、`=` 和 `workspace:^` 范围同样如此。`*`、`workspace:*` 和 `file:` 依赖保持不变。在 `0.x` 版本中这一点很重要，因为 `^0.0.16` 不接受 `0.0.17`。
- **锁文件也随之更新**：更新 `package-lock.json` 或 `pnpm-lock.yaml`，使 `npm ci`（或 `pnpm install --frozen-lockfile`）仍能接受更新后的锁文件。`yarn.lock` 不会更新，命令会提示运行 `yarn install`。
- **`--git`** 只提交这些改动过的文件，提交信息为 `v1.3.0`，并为该提交打上标签 `v1.3.0`。不推送任何内容。命令在修改任何文件之前会先检查仓库和标签。
- **确认**：仅在终端中询问。在 CI 中，或输出被重定向到管道时，直接设置版本。`--yes` 在终端中同样跳过确认。

## 4. 添加包

`lakutata add <name>` 在工作区中创建一个 TypeScript 包，`--to <package>` 将新包加入另一个包的依赖。在第 1 节的 `web-react` 项目中，添加一个包，存放服务器和 Web 界面共用的代码：

```bash
lakutata add @shop/shared --to app
```

```
✔ Package @shop/shared 0.0.1 added: packages/shared (package.json, tsconfig.json, src/index.ts, src/tests/index.spec.ts, README.md), a dependency of app
Next: npm install (links the package), then npm run rebuild -w @shop/shared
```

`--to` 只能指定一个包，因此请在 `packages/ui/package.json` 中手动为 `ui` 添加依赖：

```json
{
  "dependencies": {
    "@shop/shared": "^0.0.1"
  }
}
```

然后运行 `npm install` 链接新包，之后即可在 `lakutata list` 中看到该包：

```
3 packages, version 0.0.1
  app           0.0.1 (private)  packages/app  → ui, @shop/shared
  @shop/shared  0.0.1 (private)  packages/shared
  ui            0.0.1 (private)  packages/ui  → @shop/shared
```

现在，`npm run build`（`lakutata run rebuild`）会先构建 `@shop/shared`，再构建 `ui`，最后构建 `app`。服务器和 Web 界面都像导入其他包一样导入该共享包：`import {greet} from '@shop/shared'`。

- **位置**：新包位于工作区存放包的目录中，目录名为去掉作用域的包名。存放包的目录取第一个形如 `apps/*` 的模式所对应的目录（存在 `packages/*` 时取其对应的目录）。如果工作区的模式中没有这样的目录（只逐个列出了包，或者使用 `packages/**`），命令会拒绝添加。
- **版本**：与工作区的版本相同（工作区没有版本，或使用 lerna 的独立版本时为 `0.0.1`），`--to` 加入的依赖为 `"@shop/shared": "^0.0.1"`。
- **文件**：`src/index.ts`（一个示例函数，请替换为实际的代码）、一个由 `node --test` 运行的测试，以及一个 `package.json`，其中的脚本为 `clean`、`build`（`tsc`）、`rebuild` 和 `test`。该包将 `src` 连同类型声明编译到 `build` 中，并通过 `exports` 提供给其他包。Web 界面也会用到的代码不能使用 Node.js 模块。
- **私有**：该包设置了 `"private": true`。如需发布该包，请删除这一行（`npm publish -w @shop/shared`）。
- **不安装任何内容**：之后请按命令的提示，运行工作区所用包管理器的安装命令（`pnpm install`、`yarn install`），这样其他包才能看到新包。

`lakutata add <name> --native gyp|cmake|rust` 则创建原生插件，见[原生插件](NativeAddons.md)。

## 5. 从 lerna 迁移

| lerna | `lakutata` |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna run dev --parallel` | `lakutata run dev --parallel` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git`（不推送标签） |

- 工作区可以保留 `lerna.json`，`lakutata` 只读写其中的 `version`。包列表来自根目录 `package.json` 的 `workspaces`（或 `pnpm-workspace.yaml`），而非 `lerna.json` 的 `packages`。
- `lakutata` 为所有包使用同一个版本号，因此对于 `"version": "independent"` 的 `lerna.json`，无法递增版本。
- 该命令不生成变更日志，不缓存构建结果，不挑选自上次发布以来有改动的包，也不负责发布；发布请使用 `npm publish -w <package>`。需要这些功能的工作区可以同时保留 lerna（或 nx、turborepo）。
