# Lakutata 命令行工具

**`lakutata` 命令**（`@lakutata/cli` 包）用模板创建项目，在工作区的各个包中运行脚本并统一版本号，执行应用的数据库迁移，检查应用的翻译，并把应用打包成单个文件、可执行文件和安装包。全部选项见 `@lakutata/cli` 的 README。

## 1. 安装与运行

```bash
npx @lakutata/cli create --name my-app     # 不安装，直接运行
npm install --global @lakutata/cli         # 或者在本机安装一次，之后：lakutata create --name my-app
```

模板会把 `@lakutata/cli` 加入项目的 `devDependencies`，所以项目的脚本可以直接调用 `lakutata`，在项目里也可以用 `npx lakutata`。工具需要 Node.js `^22.13.0 || >=24.11.0`：22.13 及以后的 22.x，或 24.11 及以后的版本（不支持 23）。

- `lakutata --help` 列出所有命令，`lakutata help <command>`（或 `lakutata <command> --help`）说明某个命令，`lakutata --version` 输出工具的版本。不带命令运行时，工具输出帮助，并以退出码 1 退出。
- 选项名用短横线连接（`--package-manager`）。默认开启的布尔选项用 `--no-` 关闭（`--no-git`、`--no-bail`）。
- 结果输出到标准输出，警告（`! …`）输出到标准错误。失败时在标准错误输出 `error: <消息>`，并以退出码 1 退出。只有在终端里才使用颜色，设置 `NO_COLOR` 可以关闭颜色。
- **语言**：帮助、交互提问和校验错误支持英文、简体中文和繁体中文，依次根据 `LAKUTATA_LANG`、`LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG` 和系统语言选择（`LAKUTATA_LANG=zh-CN lakutata --help`）。命令名、选项名以及工具的其他消息仍是英文。

## 2. 项目

### `lakutata create`

```bash
lakutata create --name my-app                                    # 默认模板，创建在 ./my-app
lakutata create --name shop --template service --with i18n,installer --yes
lakutata create --name tool --template cli --package-manager none --no-git
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `--name` | 在终端里会询问 | 应用的名称，也是项目目录的名称 |
| `--id` | 名称的小写形式 | 应用的 ID，也是包名 |
| `--template` | `default` | 官方模板（见 `lakutata templates`）、`npm:<package>[@<version>]`、`github:<owner>/<repo>[#<ref>]`，或一个目录 |
| `--path` | `.` | 在哪里创建项目目录（`<path>/<name>`） |
| `--init` | | 直接在 `--path` 这个已有目录中创建项目 |
| `--description`、`--author`、`--license` | 许可证为 `UNLICENSED` | 包的信息 |
| `--with` | | 模板的可选功能，用逗号分隔（`i18n`、`installer`） |
| `--package-manager` | `npm`；由 pnpm 或 yarn 启动工具时为对应的包管理器 | `npm`、`pnpm`、`yarn`，或 `none` 表示不安装依赖 |
| `--no-git` | | 不创建 git 仓库 |
| `--yes` | | 不询问可选功能，也不要求确认 |

在终端里运行时，工具会询问缺少的名称，列出模板的可选功能供选择，展示将要创建的内容并请求确认。之后它复制模板，填入名称、ID 和包的其他信息，安装依赖（`<包管理器> install`），再执行 `git init`（不提交）。官方模板取与工具主版本号相同的最新正式版，从 npm 仓库下载，并保存在工具的缓存中；没有网络时，如果以前下载过，就使用缓存中的模板。

使用 `--init` 时，目录中已有的文件会保留：模板中同名的文件不会复制过去，工具会发出警告列出这些文件，需要的内容请手动合并（`package.json` 主要是其中的脚本和依赖）。

### `lakutata templates`、`info` 和 `clean`

- `lakutata templates` 列出官方模板及其可选功能。列表来自 npm 仓库，缓存一天（`--refresh` 会重新获取）。模板里有什么见 [ProjectStructure](ProjectStructure.md)。
- `lakutata info` 显示工具、框架（能访问仓库时还显示最新版本）和 Node.js 的版本，以及当前目录的项目所用的框架版本。
- `lakutata clean [paths...]` 在任何平台上删除当前目录所在包中的路径；不给路径时，删除其 `tsconfig.json` 的 `outDir`。它拒绝删除包以外的路径，以及 `src`、`node_modules`、`package.json` 和 `.git`。模板在 `build` 或 `rebuild` 脚本中调用它。

## 3. 工作区

工作区是一个包含多个包的仓库：根目录 `package.json` 的 `workspaces` 字段（或 `pnpm-workspace.yaml`）列出各个包的目录。除 `default` 以外的模板创建的都是工作区（`packages/app`，有 Web 界面时还有 `packages/ui`）。以下命令可以在工作区的任意目录中运行。

`lakutata list` 显示各个包、它们的版本和目录，以及每个包依赖的工作区内的包。

### `lakutata run`

`lakutata run <script>` 在每个有该 npm 脚本的包中运行它，并按依赖顺序执行：一个包要等它依赖的包都执行完才开始，互不依赖的包同时执行。每行输出都以所属包的名称开头。

| 选项 | 含义 |
|---|---|
| `--scope <names...>` | 只运行这些包（`*` 匹配任意字符）；不会自动加入它们依赖的包 |
| `--parallel` | 所有包同时运行，不等待依赖：用于一直运行的脚本，例如开发服务器和监视进程 |
| `--concurrency <n>` | 同时运行的包数（默认为处理器数量） |
| `--no-bail` | 失败后继续运行（依赖失败包的那些包会被跳过） |

脚本通过项目所用的包管理器运行（根目录 `package.json` 的 `packageManager` 字段，没有时看锁文件：pnpm、yarn 或 npm），并且不能传入额外的参数。有脚本失败时，命令失败（退出码 1）；没有任何包有这个脚本时，命令给出提示并正常结束。

### `lakutata version`

`lakutata version <bump>` 给工作区的所有包设置下一个版本，并更新它们之间的依赖：

```bash
lakutata version patch                     # 1.2.3 → 1.2.4，在终端里会先请求确认
lakutata version minor --git --yes         # 同时提交修改，并打上标签 v1.3.0
lakutata version prerelease --preid beta   # 1.3.0 → 1.3.1-beta.0，再执行一次是 1.3.1-beta.1
lakutata version 2.0.0
```

所有包共用一个版本：有 `lerna.json` 时取其 `version`，否则取根目录 `package.json` 的版本，再否则取各包中最高的版本。命令把新版本写回原处和每个包，保留 `workspace:*` 这类范围以及其他范围的运算符，并更新 `package-lock.json` 或 `pnpm-lock.yaml`（`yarn.lock` 需要自己运行 `yarn install` 更新）。它不推送任何内容。用 lerna 管理的工作区可以保留 `lerna.json`：lakutata 只读写其中的 `version`。

### `lakutata add` 和 `native`

`lakutata add <name>` 在工作区的包目录中创建一个 TypeScript 包（加上 `--native gyp|cmake|rust` 则创建原生插件），例如 `packages/<name>`，工作区的模式是 `apps/*` 时则是 `apps/<name>`；它的版本就是工作区的版本，`--to <package>` 把它加入另一个包的依赖。命令不安装任何东西：之后请按它的提示，用你的包管理器安装依赖。`lakutata native <link|include|define> <value>` 修改当前目录中原生插件的构建文件（链接一个库、添加头文件目录或定义宏），选项见它的帮助。

## 4. 迁移与翻译

`lakutata migration <action>` 生成、创建、执行、回滚和查看应用的数据库迁移。它用应用的 `dev` 脚本构建并启动应用，此时应用只连接数据库。见 [Migrations](Migrations.md) 第 2 节。

`lakutata i18n <action>` 检查应用各语言的消息，生成键名的类型声明，以及添加新语言。见 [I18n](I18n.md) 的“命令行工具”一节。

## 5. 打包

`lakutata package bundle`、`package exe` 和 `package installer` 把编译好的应用打包成单个 JavaScript 文件、不需要安装 Node.js 就能运行的可执行文件，或者安装包。见 [Packaging](Packaging.md)。

## 6. 环境变量

| 变量 | 含义 |
|---|---|
| `LAKUTATA_LANG` | 工具的语言（`en`、`zh-CN`、`zh-TW`） |
| `LAKUTATA_NPM_REGISTRY` | 下载模板的仓库（否则取 `npm_config_registry`，再否则为 `https://registry.npmjs.org`） |
| `LAKUTATA_GITHUB_DOWNLOAD` | 下载 `github:` 模板的地址（默认 `https://github.com`） |
| `LAKUTATA_CACHE_DIR` | 工具的缓存目录：模板，以及制作安装包所用的工具（默认 `$XDG_CACHE_HOME/lakutata`，否则 `~/.cache/lakutata`） |
| `NO_COLOR` | 关闭颜色 |

工具运行的脚本和应用，拿到的是工具启动时的环境变量。打包后的应用所用的环境变量见 [Packaging](Packaging.md)。
