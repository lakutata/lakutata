# Lakutata 工作区

由多个包组成的项目（应用、它的 Web 界面、共享库、原生插件）就是一个工作区：一个仓库，根目录的 `package.json` 列出各个包所在的目录。包管理器（npm、pnpm 或 yarn）负责把这些包互相链接起来；`lakutata` 命令按依赖顺序运行它们的脚本，给它们统一版本号，并添加新的包。lerna 中这类项目用得到的那部分功能，它都提供了。除 `default` 以外的模板创建的都是工作区（见 [ProjectStructure](ProjectStructure.md) 第 2 节）。

## 1. 工作区

用 `lakutata create --name shop --template web-react` 创建的项目，根目录的 `package.json` 如下（省略了迁移和 Docker 相关的脚本）：

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

- **包**：`workspaces` 中的模式所匹配、并且含有带 `name` 的 `package.json` 的目录。`*` 匹配一层目录名中的任意字符，`**` 匹配任意层目录，`!packages/old` 排除一个目录。`node_modules` 和以点开头的目录不会被搜索。pnpm 工作区把模式写在 `pnpm-workspace.yaml` 中，作为 `packages:` 下的列表（每行一个 `- 'packages/*'`）。
- **在工作区的任何目录中都能运行这些命令**：它们使用向上最近的一个声明了工作区的目录。
- **包之间的依赖**：`dependencies`、`devDependencies`、`peerDependencies` 或 `optionalDependencies` 中的依赖，不论范围怎么写（`^0.0.1`、`*`、`workspace:*`、`file:`）。
- **构建工具**（`@lakutata/cli`、`typescript`、`@types/node`）是根目录的开发依赖，所以每个包的脚本都能使用它们。

`lakutata list` 显示各个包、它们的版本和目录，以及每个包依赖的包。这里 `app`（服务器）依赖 `ui`（Web 界面），并提供 `ui` 构建好的页面：

```
2 packages, version 0.0.1
  app  0.0.1 (private)  packages/app  → ui
  ui   0.0.1 (private)  packages/ui
```

## 2. 运行脚本

`lakutata run <script>` 在每个有该 npm 脚本的包中运行它。一个包要等它（直接或间接）依赖的包都执行完才开始，互不依赖的包同时执行。每行输出都以所属包的名称开头：

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
| `--parallel` | 所有包同时开始，不等待它们的依赖：用于一直运行的脚本，例如开发服务器和监视进程（`lakutata run dev --parallel`） |
| `--scope <names...>` | 只运行这些包，`*` 匹配任意字符（`--scope 'app' '@shop/*'`）。它们依赖的包既不运行，也不等待 |
| `--concurrency <n>` | 同时运行的包数（默认为处理器数量） |
| `--no-bail` | 失败后继续：依赖失败包的那些包被跳过，其他包照常运行 |

- **失败**：默认情况下，有包失败后不再启动新的包，已经在运行的包会运行完。命令最后输出 `error: build failed in lib, not run in app`，退出码为 1。
- **没有任何包有这个脚本**：命令输出 `No package has the script lint`，并正常结束。
- **包管理器**：脚本用 `npm run`、`pnpm run` 或 `yarn run` 运行，根据根目录 `package.json` 的 `packageManager` 字段（`"pnpm@9.15.0"`）选择，没有这个字段时看根目录中的文件（`pnpm-lock.yaml` 或 `pnpm-workspace.yaml`、`yarn.lock`、`package-lock.json`），默认是 npm。
- **参数**：脚本不接受额外的参数（`lakutata run build -- --watch` 会被拒绝），请另加一个脚本。

## 3. 设置版本号

工作区的所有包共用一个版本号。`lakutata version <bump>` 把新版本设置给所有包，并更新它们之间的依赖。从 1.2.3 开始：

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

- **当前版本**：有 `lerna.json` 时取其 `version`，否则取根目录 `package.json` 的版本，再否则取各包中最高的正式版本（都没有时为 `0.0.0`）。新版本写回原处，也写入每个包，私有包也一样。
- **版本的递增方式**：`major`、`minor`、`patch`、`premajor`、`preminor`、`prepatch`、`prerelease`，或者直接给出版本号。`--preid <id>` 给 `pre…` 这几种递增方式指定预发布标识（`beta` 得到 `1.3.0-beta.0`；不指定时是 `1.3.0-0`）。
- **包之间的依赖随之更新**：`^0.0.16` 变成 `^0.0.17`，`~`、`>=`、`=` 和 `workspace:^` 范围也一样。`*`、`workspace:*` 和 `file:` 依赖保持不变。在 `0.x` 版本中这一点很重要，因为 `^0.0.16` 不接受 `0.0.17`。
- **锁文件也随之更新**：更新 `package-lock.json` 或 `pnpm-lock.yaml`，使 `npm ci`（或 `pnpm install --frozen-lockfile`）仍然接受它。`yarn.lock` 不会更新：命令会提醒你运行 `yarn install`。
- **`--git`** 提交改动的文件（连同已经暂存的文件），提交信息为 `v1.3.0`，并给这个提交打上标签 `v1.3.0`。不推送任何内容。文件在运行 git 之前就已修改，所以 git 失败时，这些修改仍然保留。
- **确认**：只在终端里询问。在 CI 中，或者输出被管道接走时，直接设置版本。`--yes` 在终端里也跳过确认。

## 4. 添加包

`lakutata add <name>` 在工作区中创建一个 TypeScript 包，`--to <package>` 把它加入另一个包的依赖。在第 1 节的 `web-react` 项目中，添加一个由服务器和 Web 界面共用代码的包：

```bash
lakutata add @shop/shared --to app
```

```
✔ Package @shop/shared 0.0.1 added: packages/shared (package.json, tsconfig.json, src/index.ts, src/tests/index.spec.ts, README.md), a dependency of app
Next: npm install (links the package), then npm run rebuild -w @shop/shared
```

`--to` 只能指定一个包，`ui` 的依赖请在 `packages/ui/package.json` 中手动添加：

```json
{
  "dependencies": {
    "@shop/shared": "^0.0.1"
  }
}
```

然后 `npm install` 链接新的包，`lakutata list` 中就能看到它：

```
3 packages, version 0.0.1
  app           0.0.1 (private)  packages/app  → ui, @shop/shared
  @shop/shared  0.0.1 (private)  packages/shared
  ui            0.0.1 (private)  packages/ui  → @shop/shared
```

现在 `npm run build`（`lakutata run rebuild`）先构建 `@shop/shared`，再构建 `ui`，最后构建 `app`。两者都像导入其他包一样导入它：`import {Greet} from '@shop/shared'`。

- **位置**：在工作区存放包的目录中，目录名是去掉作用域的包名。存放包的目录取第一个形如 `apps/*` 的模式的目录（有 `packages/*` 时取它）。如果工作区的模式中没有这样的目录（只逐个列出了包，或者是 `packages/**`），命令会拒绝添加。
- **版本**：就是工作区的版本，`--to` 加入的依赖是 `"@shop/shared": "^0.0.1"`。
- **文件**：`src/index.ts`（一个示例函数，请换成你的代码）、一个由 `node --test` 运行的测试，以及一个 `package.json`，其中的脚本是 `clean`、`build`（`tsc`）、`rebuild` 和 `test`。它把 `src` 连同类型声明编译到 `build` 中，并通过 `exports` 提供给其他包。Web 界面也要用到的代码，不能使用 Node.js 的模块。
- **私有**：这个包是 `"private": true`。要发布它，请删掉这一行（`npm publish -w @shop/shared`）。
- **不安装任何东西**：之后请按命令的提示，运行工作区所用包管理器的安装命令（`pnpm install`、`yarn install`），其他包才能看到新的包。

`lakutata add <name> --native gyp|cmake|rust` 则创建原生插件，见 [NativeAddons](NativeAddons.md)。

## 5. 从 lerna 迁移

| lerna | lakutata |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna run dev --parallel` | `lakutata run dev --parallel` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git`（不推送标签） |

- 工作区可以保留 `lerna.json`：lakutata 只读写其中的 `version`。包来自根目录 `package.json` 的 `workspaces`（或 `pnpm-workspace.yaml`），而不是 `lerna.json` 的 `packages`。
- lakutata 给所有包用同一个版本号：`"version": "independent"` 的 `lerna.json` 无法递增版本。
- 它不生成变更日志，不缓存构建结果，不挑选自上次发布以来有改动的包，也不发布：发布请用 `npm publish -w <package>`。需要这些功能的工作区可以同时保留 lerna（或 nx、turborepo）。
