# Lakutata 命令行工具

**`lakutata` 命令**（`@lakutata/cli` 包）可以基于模板创建项目，在工作区的各个包中运行脚本并统一版本号，添加包和原生插件，执行应用的数据库迁移，检查应用的翻译，并将应用打包为单文件包、可执行文件和安装包。全部选项见 `@lakutata/cli` 的 README。

## 1. 安装与运行

```bash
npx @lakutata/cli create --name my-app     # 不安装，直接运行
npm install --global @lakutata/cli         # 或者在本机安装一次，之后：lakutata create --name my-app
```

模板会将 `@lakutata/cli` 加入项目的 `devDependencies`，因此项目的脚本可以直接调用 `lakutata`，在项目中也可以使用 `npx lakutata`。该工具需要 Node.js 18.10 或更高版本（`>=18.10.0`）。

- `lakutata --help` 列出所有命令，`lakutata help <command>`（或 `lakutata <command> --help`）说明指定的命令，`lakutata --version` 输出工具的版本号。不带命令运行时，工具会输出帮助信息，并以退出码 1 退出。
- 选项名以短横线连接单词（`--package-manager`）。默认开启的布尔选项以 `--no-` 前缀关闭（`--no-git`、`--no-bail`）。
- 结果输出到标准输出，警告（`! …`）输出到标准错误。失败时，在标准错误中输出 `error: <消息>`，并以退出码 1 退出。仅在终端中使用颜色，设置 `NO_COLOR` 可以关闭颜色。
- **语言**：帮助、交互式提问和校验错误支持英文、简体中文和繁体中文，依次根据 `LAKUTATA_LANG`、`LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG` 和系统语言选择（`LAKUTATA_LANG=zh-CN lakutata --help`）。命令名、选项名以及工具的其他消息仍为英文。

## 2. 项目

### `lakutata create`

```bash
lakutata create --name my-app                                    # 默认模板，创建在 ./my-app
lakutata create --name shop --template service --with i18n,installer --yes
lakutata create --name tool --template cli --package-manager none --no-git
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `--name` | 在终端中会询问 | 应用的名称，也是项目目录的名称 |
| `--id` | 名称的小写形式 | 应用的 ID，也是包名 |
| `--bundle-id` | `com.example.<名称>` | 应用在手机系统上的标识（反向域名），用于手机模板；应用商店不接受 `com.example` |
| `--template` | `default` | 官方模板（见 `lakutata templates`）、`npm:<package>[@<version>]`、`github:<owner>/<repo>[#<ref>]`，或一个目录 |
| `--path` | `.` | 创建项目目录的位置（`<path>/<name>`） |
| `--init` | | 直接在 `--path` 指定的已有目录中创建项目 |
| `--description`、`--author`、`--license` | 许可证为 `UNLICENSED` | 包的信息 |
| `--with` | | 模板的可选功能，用逗号分隔（`i18n`、`installer`、`win7`） |
| `--package-manager` | `npm`；由 pnpm 或 yarn 启动工具时为对应的包管理器 | `npm`、`pnpm`、`yarn`，或 `none` 表示不安装依赖 |
| `--no-git` | | 不创建 git 仓库 |
| `--yes` | | 不询问可选功能，也不要求确认 |

在终端中运行时，工具会询问缺少的名称，列出模板的可选功能供选择，展示将要创建的内容并请求确认。随后，工具复制模板，填入名称、ID 和包的其他信息，安装依赖（`<包管理器> install`），再执行 `git init`（不提交）。官方模板取与工具主版本号相同的最新正式版，从 npm 仓库下载，并保存在工具的缓存中；没有网络时，如果此前下载过该模板，则使用缓存中的模板。

使用 `--init` 时，目录中已有的文件会被保留，模板中的同名文件不会被复制。工具会发出警告并列出这些文件，所需的内容请手动合并（对于 `package.json`，主要是其中的脚本和依赖）。

### `lakutata templates`、`info` 和 `clean`

- `lakutata templates` 列出官方模板及其可选功能。列表来自 npm 仓库，缓存时间为一天（`--refresh` 会重新获取）。模板包含的内容见[项目结构](ProjectStructure.md)。
- `lakutata info` 显示工具、框架（能访问仓库时还显示最新版本）和 Node.js 的版本，以及当前目录中项目所使用的框架版本。
- `lakutata clean [paths...]` 在任何平台上删除当前目录所在包中的路径；未指定路径时，删除该包 `tsconfig.json` 中的 `outDir` 和 `declarationDir`。该命令拒绝删除包以外的路径，以及 `src`、`node_modules`、`package.json` 和 `.git`。模板在 `build` 或 `rebuild` 脚本中调用该命令。

## 3. 工作区与原生插件

`lakutata list`、`run`、`version` 和 `add` 作用于工作区，即包含多个包的仓库。这些命令分别列出工作区的包、按依赖顺序在每个包中运行脚本、为所有包统一版本号，以及添加新的包。见[工作区](Workspaces.md)。

`lakutata add <name> --native gyp|cmake|rust` 添加一个以 C++ 或 Rust 编写的原生插件，`lakutata native <link|include|define> <value>` 为该插件链接库。见[原生插件](NativeAddons.md)。

`lakutata ffi generate <header>` 根据原生库的 C 头文件，为其生成 `@lakutata/ffi` 类。见 [FFI](FFI.md) 第 9 节。

## 4. 迁移与翻译

`lakutata migration <action>` 生成、创建、执行、回滚和查看应用的数据库迁移。该命令使用应用的 `dev` 脚本构建并启动应用，在此模式下应用只连接数据库。见[迁移](Migrations.md)第 2 节。

`lakutata i18n <action>` 检查应用各语言的消息，生成键名的类型声明，并添加新语言。见[国际化（i18n）](I18n.md#命令行工具)的“命令行工具”一节。

## 5. 打包

`lakutata package bundle` 和 `package exe` 将编译好的应用打包为单个 JavaScript 文件，或者无需安装 Node.js 即可运行的可执行文件，见[打包](Packaging.md)。`lakutata package installer` 制作应用的安装包，安装包还可以将应用注册为服务，见[安装包](Installers.md)。

NW.js 应用所用的 NW.js 版本由 `lakutata nwjs use <版本>` 设置（`latest`、`win7` 或 `lakutata nwjs versions --all` 列出的任一版本），该版本会写入应用的 `package.json`。`lakutata nwjs run [args...]` 在该 NW.js 的 sdk 版本（带 DevTools）中运行编译好的应用，同时处理应用的原生插件，使其能在该版本中加载，并将参数传给应用。应用的安装包中包含的是 normal 版本（见[安装包](Installers.md)第 9 节）。

按 `mobile-react` 模板布局的 React Native 手机应用运行在其原生模块所内嵌的 libnode 中。`lakutata mobile node <android|ios|harmony>` 从 lakutata/libnode 的 Release 下载指定系统的 libnode。`lakutata mobile stage <platform>` 将应用的 Node.js 项目生成到该平台原生工程读取它的位置。`lakutata mobile run <platform>` 构建应用，并在模拟器或设备上运行。`lakutata mobile deploy <platform>` 将 Node.js 项目放入模拟器或设备上已安装的应用，然后重新启动应用。

## 6. 环境变量

| 变量 | 含义 |
|---|---|
| `LAKUTATA_LANG` | 工具的语言（`en`、`zh-CN`、`zh-TW`） |
| `LAKUTATA_NPM_REGISTRY` | 下载模板所用的仓库（未设置时取 `npm_config_registry`，两者均未设置时为 `https://registry.npmjs.org`） |
| `LAKUTATA_GITHUB_DOWNLOAD` | 下载 `github:` 模板的地址（默认 `https://github.com`） |
| `LAKUTATA_CACHE_DIR` | 工具的缓存目录，存放模板、制作安装包所用的工具、NW.js 的运行时，以及手机应用的 libnode 和它们的原生插件（默认为 `$XDG_CACHE_HOME/lakutata`，否则为 `~/.cache/lakutata`） |
| `LAKUTATA_NWJS_MIRROR` | NW.js 运行时的下载地址（默认 `https://dl.nwjs.io`） |
| `LAKUTATA_NWJS_VERSIONS` | NW.js 的发布版本列表（默认 `https://nwjs.io/versions.json`） |
| `LAKUTATA_LIBNODE_MIRROR` | lakutata/libnode Release 的镜像地址，手机应用的 libnode 从该镜像下载（`<镜像>/v<版本>/libnode_<platform>_<arch>.tar.gz`） |
| `LAKUTATA_MOBILE_NODE_DIR` | 供手机应用使用的自定义 libnode（使用 lakutata/libnode 仓库编译，每个系统一个目录：`android`、`ios`、`harmony`），用于代替 Release 中的 libnode |
| `NO_COLOR` | 关闭颜色 |

工具所运行的脚本和应用获得的是工具启动时的环境变量。打包后的应用所用的环境变量见[打包](Packaging.md)第 6 节。
