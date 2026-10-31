# @lakutata/cli

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的命令行工具。

```bash
npx @lakutata/cli create --name my-app
# 或者先安装：npm install -g @lakutata/cli
lakutata create --name my-app
```

## 命令

### `lakutata create`

用模板创建项目。选项在命令行中给出。在终端里运行时，工具会询问缺少的名称，列出模板的可选功能供你选择，等你确认后再创建项目（`--yes` 会跳过可选功能的选择和确认）。

| 选项 | |
|---|---|
| `--name <name>` | 应用的名称（必填） |
| `--id <id>` | 应用的 ID（一个包名），默认是名称的小写形式 |
| `--template <template>` | 模板（不指定时为 `default`）：官方模板（`lakutata templates` 会列出）、`npm:<package>[@<version>]`、`github:<owner>/<repo>[#<ref>]`，或者一个目录 |
| `--path <directory>` | 在哪个目录中创建项目目录，默认是当前目录 |
| `--init` | 直接在 `--path` 目录中创建项目。这个目录必须已经存在，里面可以有文件：已有的文件会保留（模板中也有的那些会在警告中列出，需要手动合并），只有新写入的文件会填入项目的信息 |
| `--description`、`--author`、`--license` | 应用的信息 |
| `--with <features>` | 要启用的模板可选功能，用逗号分隔（`lakutata templates` 会列出）：`i18n`、`installer`、`win7`。在终端里，如果没有给出 `--with` 或 `--yes`，会让你从列表中选择 |
| `--package-manager <npm\|pnpm\|yarn\|none>` | 安装依赖所用的包管理器（`none` 表示不安装）：默认是 npm，由 pnpm 或 yarn 启动工具时用对应的那个 |
| `--no-git` | 不初始化 git 仓库 |
| `--yes` | 直接创建项目，不询问可选功能，也不要求确认 |

```bash
lakutata create --name my-service --template service --package-manager pnpm --yes
lakutata create --name my-service --template service --with i18n --yes
```

每个官方模板都有 `i18n` 功能：应用的多语言消息（`lakutata/com/i18n`），放在 `src/locales` 中（`en.json`、`zh-CN.json`），并随代码一起打包。应用按每个请求的语言回复，校验错误也一样（命令行工具和桌面应用使用运行环境的语言）。这个功能还会加上 `i18n:check` 和 `i18n:types` 脚本。`cli`、`service` 和 `web-*` 模板还有 `installer` 功能：应用的 `lakutata.installer` 配置，以及制作安装包的脚本（在本机制作，以及在 Docker 中制作 Linux 的安装包）；在 `service` 和 `web-*` 模板中，这个功能还包括一个系统服务。`nwjs-*` 模板有 `win7` 功能：用 NW.js 0.72.0（最后一个能在 Windows 7、8 和 8.1 上运行的版本）代替模板发布时的版本，并加上制作 32 位 Windows 安装包的脚本。

### `lakutata templates`

列出官方模板。官方模板是 npm 包（`@lakutata/template-<name>`），由清单包 `@lakutata/templates` 列出，从用户所用的 npm 仓库下载（和下载依赖一样，可以用 npmmirror 这样的镜像），所以不需要访问 GitHub。清单缓存一天（`--refresh` 会重新获取）。

官方模板取与工具主版本号相同的最新正式版。下载过的模板会缓存起来：连不上仓库时，使用缓存中这个主版本的最新版本；缓存中也没有时，命令失败。

模板包把文件放在它的 `template/` 目录中。有些文件无法以真实的文件名放进 npm 包，所以 `_gitignore`、`_npmrc` 等文件会在创建项目时改名为 `.gitignore`、`.npmrc` 等。文本文件中会填入项目的信息：`{$APP_NAME}`、`{$APP_ID}`、`{$APP_DESC}`、`{$APP_AUTHOR}`、`{$APP_LICENSE}` 和 `{$LAKUTATA_VERSION}`（框架的次版本，比如框架是 3.1.2 时为 `3.1.0`：补丁版只发布改动过的包，写成 `^{$LAKUTATA_VERSION}` 才能找到 lakutata 的每个包）。

模板可以有可选功能，由 `lakutata create --with <features>` 启用（或者由用户在终端里选择）：

- 模板包的 `package.json` 声明这些功能，并给出它们的名称和说明：`"lakutata": {"template": "default", "features": {"i18n": "The messages in several languages"}}`；
- 功能的文件放在 `features/<name>/` 中，与 `template/` 并列（也要和它一起发布，列在包的 `files` 中）。启用功能时，这些文件会加入项目：项目中已有的 JSON 文件会与之合并，例如 `package.json` 的脚本、`tsconfig.json` 的选项（对象按键合并，数组整体替换），其他文件则替换模板中的同名文件；
- 模板的文件中可以有只属于某个功能的代码块：`//@if <feature>` 与 `//@end`（或 `//@else`）之间的行，在启用该功能时保留，否则删除（`//@if !<feature>` 表示功能未启用时保留）；标记所在的行总会被删除。标记写成该文件所用语言的注释：`//@if i18n`、`#@if i18n`、`<!--@if i18n-->`、`/*@if i18n*/`。

### `lakutata info`

显示工具和框架的版本（以及它们的最新版本）、Node.js 的版本，以及当前目录中的项目所用的框架版本。

### `lakutata clean [paths...]`

删除当前目录所在包中的路径，在任何平台上都能用（类似 `rm -rf`，不需要 `shx` 或 `rimraf`）：`lakutata clean build dist`。不给路径时，删除这个包的 `tsconfig.json` 中的输出目录（`outDir`，有 `declarationDir` 时也删除它；这两个选项也会在它所继承的配置中查找）：`"clean": "lakutata clean"`。不存在的路径会跳过。包以外的路径、包本身、`src`、`node_modules`、`.git` 和 `package.json` 永远不会被删除。在工作区中，`lakutata run clean` 会运行每个包的 `clean` 脚本。

## 工作区

由多个包（`app`、`ui`、`proxy` 等）组成的项目是 npm 工作区。一个目录所属的工作区，是从这个目录往上找到的最近的一个目录：它的 `package.json` 有 `workspaces` 字段（模式的列表，或者 `{"packages": [...]}`），或者它的 `package.json` 旁边有 `pnpm-workspace.yaml`（取其中的 `packages:` 列表）。模式匹配的是目录（`*` 匹配一层目录名中的字符，`**` 匹配任意层目录，`!` 排除一个目录），匹配到的目录中，`package.json` 带有名称的就是包。工具负责构建这些包并给它们设置版本号：lerna 中这类项目用得到的那部分功能，它都提供了，不需要 lerna。

### `lakutata run <script>`

按依赖顺序（`dependencies`、`devDependencies`、`peerDependencies` 和 `optionalDependencies` 中的依赖），在每个有这个脚本的包中运行它：一个包要等它直接或间接依赖的包都执行完才开始，互不依赖的包同时运行。脚本用项目的包管理器运行：取根目录 `package.json` 的 `packageManager` 字段，没有时看根目录中的文件（pnpm 对应 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`，还有 `yarn.lock`、`package-lock.json`）；默认是 npm。每行输出都以所属包的名称开头。脚本不接受额外的参数。没有任何包有这个脚本时，命令会提示没有找到，并正常结束。

| 选项 | |
|---|---|
| `--concurrency <n>` | 同时运行的包数，默认是处理器的数量 |
| `--parallel` | 所有包同时运行，不等待它们的依赖：用于一直运行的脚本（`lakutata run dev --parallel`） |
| `--no-bail` | 失败后继续：不依赖失败包的那些包照常运行（默认情况下，有包失败后不再启动新的包，已经在运行的包会运行完） |
| `--scope <names...>` | 只运行这些名称的包（`*` 是通配符）；它们依赖的包既不运行，也不等待；没有任何包匹配时报错 |

### `lakutata version <bump>`

给每个包设置下一个版本号（`major`、`minor`、`patch`、`premajor`、`preminor`、`prepatch`、`prerelease`，或者直接给出版本号；`--preid <id>` 给 `pre…` 这几种递增方式指定预发布标识），私有包和没有版本号的包也包括在内，并在各个包和根目录的 `package.json` 中更新它们之间的依赖（`^0.0.16` 变成 `^0.0.17`，`~`、`>=`、`=` 和 `workspace:^` 范围也一样，而 `*`、`workspace:*` 和 `file:` 保持不变）。对 `0.x` 版本来说这一点很重要：`^0.0.16` 只匹配 `0.0.16` 本身。命令还会更新 `package-lock.json` 或 `pnpm-lock.yaml`，否则 `npm ci` 会失败。`yarn.lock` 不会更新（命令会提醒你运行 `yarn install`），锁文件更新失败也只是一个警告。工作区的版本在 `lerna.json` 给出 `version` 时取它，否则取根目录 `package.json` 的版本，再否则取各包中最高的版本，预发布版本也算在内（都没有版本时为 `0.0.0`），新版本也写回那里。`--git` 只提交与这次版本有关的文件，提交信息为 `v<version>`，并给这个提交打上标签 `v<version>`（轻量标签，不推送）；修改任何文件之前，会先检查仓库和标签。命令只在终端里请求确认，`--yes` 不询问，直接设置版本。

### `lakutata add <name>`

在工作区中添加一个包，放在工作区存放包的目录中，目录名是去掉作用域的包名。存放包的目录取工作区中第一个形如 `<directory>/*` 的模式（例如 `apps/*`）的目录，有 `packages/*` 时取它，这样其他命令才能看到这个包；工作区没有这样的模式时（只逐个列出了包，或者是 `packages/**`），命令会拒绝添加。包的版本就是工作区的版本（`lerna.json`，否则根目录的 `package.json`，再否则各包中最高的版本；都没有时，或者使用 lerna 的独立版本时为 `0.0.1`）。这个包是私有的（要发布它，请删掉 `"private": true`），带有 `clean`、`build`、`rebuild` 和 `test` 脚本以及一个测试；`--to <package>` 把它以 `^<version>` 加入工作区中另一个包的依赖。命令不安装任何东西：之后请按它的输出提示，运行项目所用包管理器的安装命令，链接这个包。

- `lakutata add greeting`：一个 TypeScript 包（`src/index.ts` 连同类型声明编译到 `build` 中）。
- `lakutata add @acme/capture --native [gyp|cmake|rust]`：一个原生插件，使用以下构建系统之一：
  - `gyp`（默认）：C++，使用 [node-addon-api](https://github.com/nodejs/node-addon-api)，由 node-gyp 根据 `binding.gyp` 构建；
  - `cmake`：C++，使用 node-addon-api，由 [cmake-js](https://github.com/cmake-js/cmake-js) 根据 `CMakeLists.txt` 构建；
  - `rust`：Rust，使用 [napi-rs](https://napi.rs)，由 cargo 构建（`Cargo.toml`、`build.rs`、`rust/lib.rs`）。

  Node-API 在各个 Node.js 和 Electron 版本之间保持稳定，所以同一个插件不需要重新构建就能在两者中运行。插件构建到 `build/Release` 中（由 `npm run build:native` 构建，安装这个包时也由它的 `install` 脚本构建），由 `src/index.ts` 通过 node-gyp-build 加载，`src/index.ts` 编译到 `dist` 中。C++ 插件构建成一个同时支持 Intel 和 Apple 芯片 Mac 的文件，Rust 插件只为本机的架构构建。`lakutata native` 负责给它们链接库。`binding.gyp` 和 `CMakeLists.txt` 中的注释还说明了如何指定库和构建选项：系统的库、pkg-config、包中的静态库、随插件一起发布的动态库（复制到插件旁边，运行时通过插件的 rpath 在那里找到），以及 `binding.gyp` 中的 C++ 标准和各平台的选项（`CMakeLists.txt` 设置为 C++20）。有自己 Makefile 的库，由一个脚本在插件之前构建，包的 README 中有示例（`build:deps`）。`lakutata package bundle` 和 `lakutata package exe` 会把插件及其动态库和应用一起发布。构建插件需要 C++ 工具链（`cmake` 还需要 CMake），`rust` 则需要 Rust。

### `lakutata native <action> <value>`

修改当前目录中原生插件的构建，工具根据构建文件（`binding.gyp`、`CMakeLists.txt` 或 `Cargo.toml`）找到这个插件。文件就地修改，保留其中的注释和格式；插件的源码不受影响。同样的修改再执行一次不会改变任何内容。

- `lakutata native link <library>`：链接一个库：
  - 系统的库：`lakutata native link pcap`（Windows 的 `ws2_32` 要加上 `--platform win`）；
  - `--pkg-config`：由 pkg-config 查找的库（`lakutata native link libpcap --pkg-config`；不用于 Windows）；
  - `--framework`：macOS 的框架（`lakutata native link CoreFoundation --framework`）；
  - 包中的文件：静态库（`deps/lib/libfoo.a`；Windows 上是 `foo.lib`）链接进插件；动态库（`deps/lib/libfoo.dylib`、`libfoo.so`，或者 `foo.dll` 加上它的导入库 `foo.lib`）复制到插件旁边，运行时通过插件的 rpath（macOS 上是 `@loader_path`，Linux 上是 `$ORIGIN`）在那里找到。在 macOS 上，库的安装名称（install name）必须是 `@rpath/libfoo.dylib`（用 `install_name_tool -id` 设置），不是时命令会提醒你；
  - `--crate`：一个 crate，用于 Rust 插件（`cargo add`）。
- `lakutata native include <directory>`：头文件目录（C++），可以是包中的目录，也可以是系统中的绝对路径。
- `lakutata native define <NAME[=value]>`：预处理器的宏定义（C++）。

`--platform mac|linux|win` 让修改只针对一个平台（库文件决定它自己的平台：`.dylib` 是 macOS，`.so` 是 Linux，`.dll` 和 `.lib` 是 Windows，`.a` 和 pkg-config 一样，是除 Windows 以外的所有平台）。构建文件有多个目标时，`--target <name>` 指定要修改的目标。各构建系统中写入的内容：

| | gyp | CMake | Rust |
|---|---|---|---|
| 文件 | `binding.gyp`，或它所包含的、声明该目标的 `.gypi` | `CMakeLists.txt` | `.cargo/config.toml`（`[env]`），由 `build.rs` 读取 |
| 库 | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | `-sys` crate |
| 框架 | `xcode_settings.OTHER_LDFLAGS` | `if(APPLE)` 中的 `-framework` | `rustc-link-lib=framework=` |
| 动态库 | `copies`、rpath | `INSTALL_RPATH`（`BUILD_WITH_INSTALL_RPATH`）、一个 `POST_BUILD` 复制命令 | `rustc-cdylib-link-arg`、`build:native` 中的复制命令 |
| 头文件、宏定义 | `include_dirs`、`defines` | `target_include_directories`、`target_compile_definitions` | 无（用 crate） |
| 平台 | `conditions`（`OS=="mac"`、`OS!="win"`） | `if(APPLE)`、`if(WIN32)`、`if(NOT WIN32)`、`if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`、`_LINUX`、`_WINDOWS`、`_UNIX` |

对于 Rust 插件，库会传给 `build.rs`（由 `lakutata add --native rust` 生成），再由它只针对这个插件传给 cargo：直接传给 rustc 的参数会作用于它构建的每一个 crate。

### `lakutata list`

列出各个包：第一行给出包的数量和工作区的版本，之后每个包列出它的版本、` (private)`（私有包才有）、它的目录，以及它依赖的工作区中的包。

### 从 lerna 迁移

| lerna | lakutata |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git`（不推送标签） |

包仍然用 `npm publish -w <package>` 发布（`lakutata add` 创建的包是私有的：请先删掉 `"private": true`）。工具只读写 `lerna.json` 中的 `version`：包来自根目录 `package.json` 的 `workspaces`，或者 `pnpm-workspace.yaml`。它不支持给各个包分别设置版本号（`"version": "independent"` 的 `lerna.json` 无法递增版本），不根据提交生成变更日志，也不缓存构建结果：需要这些功能的工作区可以同时保留 lerna（或 nx、turborepo）。

## 原生库

### `lakutata ffi generate <header>`

根据 C 头文件生成 `@lakutata/ffi` 原生库的类：包括它的声明、每个函数一个带 TypeScript 类型的属性、每个结构体和联合一个接口，整数宏作为常量。头文件先经过 C 编译器的预处理器（`cc -E`；在 Windows 上是 `cl /P`，请在 Visual Studio 的开发者命令提示符里运行）；保留库自己的声明（头文件里的，以及它所在目录里其他头文件的，这个目录是系统目录时除外），以及这些声明用到的系统类型。然后用库检查这些函数：库里没有导出的函数和不能调用的函数（参数是 `va_list`）会被去掉。命令会列出去掉了哪些声明，以及原因。工具从项目里加载 `@lakutata/ffi`：请把它装在项目里。

| 选项 | |
|---|---|
| `--library <name or file>` | 用来检查函数的库：`@Library` 接受的库名，或一个文件；默认和头文件同名（`sqlite3.h` 对应 `sqlite3`；zlib 要写 `--library z`）。库加载不了时，照样生成类，只是不做检查，并给出警告 |
| `--class-name <name>` | 类的名称，默认是头文件名的 PascalCase 形式 |
| `--out <file>` | 要写入的文件，默认是当前目录下的 `<类名>.ts` |
| `--force` | 文件已存在时覆盖它 |
| `--include <directories...>` | 头文件引用的其他头文件所在的目录（`-I`） |
| `--define <macros...>` | 在头文件之前定义的宏：`NAME` 或 `NAME=value`（`-D`） |
| `--own <directories...>` | 其他属于这个库的头文件的目录 |
| `--compiler <compiler>` | 用来预处理头文件的 C 编译器：`cc`、`gcc`、`clang`、`cl`（默认取 `CC` 环境变量，没有时在 Windows 上是 `cl`，其他系统上是 `cc`） |
| `--no-check` | 不用库检查函数 |

类是针对运行命令的平台生成的。头文件看不出哪些指针是输出参数，也看不出哪些函数会阻塞：请在生成的文件里自己标出来（`_Out_`、`{async: true}`）。见原生库的指南（[FFI](https://lakutata.com/zh/guide/FFI) 第 9 节）。

## 单文件包和可执行文件

这些命令打包当前目录中的应用，应用必须先编译好（用 `tsc`，它会生成装饰器的元数据）。实际的工作由 `@lakutata/builder` 完成：优先用项目中安装的那份（`npm install --save-dev @lakutata/builder`，需要打包应用的模板都是这样做的），否则用随工具一起安装的那份（全局安装工具时不会带上它，因为它只是工具的可选 peer 依赖）。脚本也可以调用它的函数（`bundleProject`、`buildExecutable`）来打包应用。

### `lakutata package bundle`

用 esbuild 把应用及其依赖打包成一个 CommonJS 文件，node 不需要 `node_modules` 就能运行它：`dist/<name>.cjs`，其中的名称取 `package.json` 中第一个 `bin`，没有时取去掉作用域的包名。入口是 `package.json` 的 `main`，没有时为 `build/App.js`（可以用 `--entry` 修改）。单文件包会被压缩，但保留类名（`--no-minify` 关闭压缩），`import.meta.url` 是单文件包的 URL。

| 选项 | |
|---|---|
| `--entry <file>` | 编译后的入口，默认是 `package.json` 的 `main`，没有时为 `build/App.js` |
| `--outfile <file>` | 单文件包的路径，默认 `dist/<name>.cjs` |
| `--no-minify` | 不压缩单文件包 |
| `--external <modules...>` | 不打进包里的模块，运行时从单文件包旁边的 `node_modules` 加载 |

单文件包是 CommonJS 模块，因为 Node.js 的可执行文件要运行它们。应用的 ES 模块会被转换，所以不能使用顶层 `await`：请在异步函数里 await。

原生插件（`.node` 文件）无法打进单文件包。打包时，工具会找出含有插件的包，以及通过计算出的路径加载插件的包（例如 sharp），把它们连同运行时加载的内容（它们 require 的 JavaScript，以及插件所链接的共享库所在的包，例如 libvips）排除在单文件包之外，按 `node_modules` 的结构放在 `dist/<name>.native/` 中，这个目录随单文件包一起发布。其中是运行时加载的文件：插件和共享库所在包的全部文件；其他包则是它们加载的 JavaScript（逐个跟踪得出）和其他文件（它们读取的数据）；以及通过无法跟踪的路径加载自身文件的包（`require(path.join(__dirname, name))`）的全部文件。这些包的类型声明、source map、TypeScript 源码和文档会被排除，插件的 C 和 C++ 源码和目标文件（better-sqlite3 带有 SQLite 的源码），以及构建它们时产生的文件也会被排除：`build/` 中 node-gyp 和 CMake 的文件、cargo 的 `target` 目录、静态库和导入库。应用自己的插件（`require('./x.node')`、`createRequire(import.meta.url)('./x.node')`）也放进这个目录。框架的包以及基于框架的包，不论依赖什么、自己是否带有插件，总是和应用一起打进单文件包，这样框架、它的类和它的容器都只有一份。它们的原生依赖放进这个目录；它们自己的插件也放进这个目录，前提是插件通过直接 `require` 插件文件、从模块位置构造的路径（`path.join(__dirname, 'prebuilds', ...)`）或包自身的目录（`node-gyp-build`）加载，用其他方式加载的插件会列在警告中。没有安装的可选依赖（应用没有用到的存储驱动：`peerDependenciesMeta` 中标为 optional 的依赖，以及 `optionalDependencies`）会被排除：运行时加载它会抛出异常，和不打包时一样。

打包器不会跟踪应用按路径读取的文件：它单独运行的脚本（worker：`new Worker()`、传入文件的 worker 池；子进程：`fork()`；按路径加载的模块：`require(path.join(__dirname, 'x.js'))`），以及它的数据（`fs.readFileSync(path.join(__dirname, 'defaults.json'))`、存放 schema 的目录）。而且单文件包并不在原来各个模块所在的位置：在 `build/config/` 中的模块里，`path.resolve(__dirname, '../../schema')` 是项目的 `schema/` 目录，但打包到 `dist/` 之后就不是了。工具会在应用的模块和它所用包的模块中，找出所有由模块位置构造出的文件路径，不论写在哪里，并改写这些表达式，让它们指向 `.native` 目录中的文件（`dist/<name>.native/.lakutata/files/`，目录结构与项目中相同，从项目外部链接进来的包放在 `node_modules/` 下）：

| 路径指向 | |
|---|---|
| 脚本（`.js`、`.cjs`） | 连同它加载的内容单独打包（打包成 CommonJS 文件，不论项目的模块类型是什么） |
| 其他文件 | 复制（`package.json` 的类型会设为 CommonJS，与它旁边的脚本一致） |
| 存放数据的目录 | 复制其中的文件 |
| 包含该模块的目录（`path.join(__dirname, '..')`：应用、它所在的包） | 不发布，并发出警告：请把其中的文件声明为资源（`lakutata.resources`，见下文） |
| 包含脚本或包的目录（`package.json`、`node_modules`） | 不发布，并发出警告：其中的脚本运行时需要它们的包 |
| 还不存在的路径（应用运行时创建的目录） | 保持原样 |

会跟踪的路径写法：

| 路径 | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | 模块的 URL（和 Vite 中一样）；也包括 `pathToFileURL(__filename)` |
| `import.meta.url + '/../worker.js'` | 字符串形式的模块 URL |
| `path.join(__dirname, 'worker.js')`、`path.resolve(__dirname, …)` | 也包括用 `import.meta.dirname` 或 `path.dirname(fileURLToPath(import.meta.url))` 的写法 |
| `__dirname + '/worker.js'`、`` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')`、`require.resolve(path.resolve(__dirname, '../lib/worker'))` | 扩展名按 node 的方式查找 |
| `` path.join(__dirname, 'locales', `${lang}.json`) ``、`` new URL(`./jobs/${name}.js`, import.meta.url) `` | 部分已知：取模式匹配到的所有文件和目录（其中的表达式匹配名称的一部分），表达式保留不变 |

tsc 生成的代码（`(0, node_path_1.join)(__dirname, 'worker.js')`）也会跟踪。如果应用还直接导入了这样的脚本，工具会发出警告：这个脚本会被打包两次，每次都带着一份独立的模块副本（各自的状态和类）。Node.js worker（`worker_threads`）的脚本无法跟踪时，工具只对应用的模块发出警告（包里的 worker 是按使用者给出的路径启动的）：路径只在运行时才知道（`new Worker(file)`；保存上述某种路径的变量或类属性是可以跟踪的），或者路径相对于进程的当前目录（`new Worker('./worker.js')`，node 从当前目录而不是从模块所在位置解析它）。请从模块所在的目录构造这些脚本的路径，或者把脚本作为资源发布。运行源码的 worker（`eval: true`）不需要处理。警告只指出应用中的模块，并给出文件和行号。

应用的资源，即它在运行时读取的文件（Web 应用构建好的页面、模板、数据），在它 `package.json` 的 `lakutata.resources` 中声明，是一个 `{from, to}` 对象的列表（类似 electron-builder 的 `extraResources`，但不支持它的字符串、glob 和过滤器写法）：

```json
"lakutata": {"resources": [{"from": "../ui/dist", "to": "ui"}]}
```

`from` 是项目中的文件或目录，`to` 是它在资源中的路径；资源放在 `dist/<name>.resources/` 中，随单文件包一起发布。应用通过 lakutata 的 `resourcesPath()` 找到它们（应用没有打包运行时返回 `undefined`，可以用 `isPackaged()` 判断）。

### `lakutata package exe`

为当前平台制作应用的可执行文件，不需要安装 Node.js 就能运行：`dist/<name>`（Windows 上是 `dist/<name>.exe`）。单文件包连同它的 V8 代码缓存，嵌入运行工具的那个 Node.js 程序的副本中（Node.js 的单可执行文件应用），所以嵌入的 Node.js 就是运行工具的那个版本。在可执行文件中，`import.meta.url` 是可执行文件本身的 URL。

使用 `--runtime bun` 时，改由 Bun 编译单文件包（`bun build --compile --bytecode`：代码编译成字节码，启动时不需要解析），优先用项目中的 Bun（npm 上的 `bun` 包，`npm install --save-dev bun`），否则用系统中的。这样的可执行文件更小，启动更快，占用的内存也更少；运行时也就成了 Bun（JavaScriptCore，以及 Bun 自己实现的 Node.js API）。原生插件还是 Node.js 的那些，不会为 Bun 重新构建。Bun 能加载 Node-API 的插件，但不一定能加载基于 Node.js V8 API 的插件：工具会对这些插件发出警告（以 better-sqlite3 为例，可执行文件能构建出来，但加载这个包时会失败）。和 Node.js 的可执行文件一样，Bun 的可执行文件不会加载所在目录的 `.env` 或 `bunfig.toml`（需要的应用请自己加载，或者使用 `LAKUTATA_ENV_FILE`），运行模式取决于每次运行的环境：Bun 原本会把 `process.env.NODE_ENV` 替换成构建时的模式，但单文件包在运行时才读取它。

其他平台的可执行文件要在那些平台上制作：应用的原生插件要在那里为它们构建，可执行文件也能在那里测试。CI 可以提供这些机器（由 Linux、macOS 和 Windows runner 组成的矩阵）；Linux 的各种架构也可以在对应架构的容器中构建（`docker run --platform linux/arm64`，模板的交叉构建就是这样做的）。

| 选项 | |
|---|---|
| `--outdir <directory>` | 可执行文件的输出目录，默认 `dist` |
| `--runtime <node\|bun>` | 嵌入的运行时：`node`（默认）或 `bun` |
| `--layout <file\|directory>` | 单个文件（默认），或者一个目录：`dist/<name>/` 中包含可执行文件、它的原生插件（`native/`）和资源（`resources/`），直接从那里加载，不需要解压（用于安装包和镜像） |
| `--entry`、`--no-minify`、`--external` | 与 `lakutata package bundle` 相同：外部模块从可执行文件旁边的 `node_modules` 加载 |

使用 `--layout file` 时，原生插件、按路径读取的文件和资源都嵌入可执行文件中。第一次运行时，可执行文件把它们解压到缓存目录下的 `native/<hash>` 中，这个目录以内容命名。缓存目录在 macOS 上是 `~/Library/Caches/<name>`，Windows 上是 `%LOCALAPPDATA%\<name>\Cache`，Linux 上是 `$XDG_CACHE_HOME/<name>`，否则是 `~/.cache/<name>`，也可以用 `LAKUTATA_NATIVE_DIR` 指定目录。缓存目录不可写时，改用临时目录中的 `<name>`（指定了 `LAKUTATA_NATIVE_DIR` 时不会这样）。之后的运行都从那里加载，不同版本的程序不会共用这个目录。插件需要它们构建时所针对的系统库（Linux 预编译插件所需的 glibc 版本）。

可执行文件的子进程运行的是可执行文件本身（`process.execPath`）。两种布局下，如果启动可执行文件是为了运行它的某个脚本（`fork(path.join(__dirname, 'child.js'))`、`spawn(process.execPath, [script])`），它会带着参数运行这个脚本，而不是运行应用：用 Node.js 制作时，`require.main` 就是这个脚本，和 node 一样；用 Bun 制作时则不是。

macOS 的可执行文件使用临时签名（ad hoc）。用 Node.js 制作的 Windows 可执行文件保留着 `node.exe` 的签名，而这个签名已经不再匹配：发布前请重新签名。

### `lakutata package installer`

为当前平台制作应用的安装包（和 electron-builder 的做法一样）。安装包会安装目录布局的可执行文件（`lakutata package exe --layout directory`）及其原生插件和资源，把程序加入 PATH，并注册应用的服务。其他平台的安装包要在那些平台上制作（Linux 的安装包可以在容器中制作）。安装包由 `package.json` 中的 `lakutata.installer` 配置：

```json
"lakutata": {
  "installer": {
    "service": {"env": {"PORT": "8080"}},
    "linux": {"targets": ["deb", "rpm", "tar.gz"], "depends": []}
  }
}
```

| 选项 | |
|---|---|
| `name` | 软件包的名称（小写），默认取程序名（Electron 应用取去掉作用域的包名） |
| `appId` | 应用的标识（反向 DNS，`com.acme.app`），默认是它的名称：在 macOS 上是软件包的标识和服务的标签；在 Windows 上是卸载程序和升级所用的键 |
| `productName` | 显示给用户的名称（在安装程序中，以及 Windows 的程序列表中），默认取 `package.json` 的 `productName`，没有时取名称 |
| `description`、`maintainer`、`homepage`、`license` | 默认取自 `package.json`（维护者是它的作者） |
| `vendor` | 供应商，默认没有（在 Windows 上，发布者是供应商，没有时是维护者） |
| `runtime` | 可执行文件的运行时：`node`（默认）或 `bun`；Electron 应用用 `electron`，NW.js 应用用 `nwjs`（见下文） |
| `addToPath` | 把程序加入 PATH（`/usr/bin/<program>`，macOS 上是 `/usr/local/bin/<program>`；Windows 上是机器的 PATH），默认 `true`（NW.js 应用默认 `false`） |
| `service` | `true` 或服务的选项（见下文），默认没有 |
| `linux.targets` | glibc 系统上可以是 `deb`、`rpm`、`archlinux`、`tar.gz`（默认 `deb`、`rpm`、`tar.gz`）；Alpine（musl）上是 `apk`、`tar.gz` |
| `linux.depends`、`linux.recommends`、`linux.section`、`linux.priority` | 依赖和推荐的系统软件包、分类和优先级（deb） |
| `mac.targets` | `pkg`、`tar.gz`（默认两种都制作）；NW.js 应用还可以用 `dmg` |
| `win.targets` | `nsis`、`msi`、`zip`（默认全部制作） |
| `electron` | Electron 应用的 electron-builder 配置，合并到由这些选项生成的配置之上 |

开始构建之前会先检查配置，这次不制作的安装包的选项也会检查。

Linux 软件包由 nFPM 制作，输出到 `dist/installer`（`--outdir`）。nFPM 只下载一次，保存在 lakutata 的缓存中，有 x64 和 arm64 两种；`LAKUTATA_NFPM` 可以指定另一份副本，其他架构也要用它指定。软件包把应用安装在 `/opt/<name>`，并把 C++ 运行库作为依赖。可执行文件链接的是制作它的系统的 C 库，所以面向 glibc 系统的软件包要在 glibc 系统上制作，`apk` 软件包要在 Alpine 上制作；应用有原生插件时要用 Bun 制作（`"runtime": "bun"`），因为 Node.js 的可执行文件在 musl 上不能加载原生插件。

macOS 的安装包用 macOS 自带的工具（`pkgbuild`、`productbuild`）制作。`pkg` 软件包把应用安装在 `/usr/local/lib/<name>`，把程序放在 `/usr/local/bin`，只能安装在与程序架构相同的 Mac 上。macOS 没有卸载软件包的功能：`sudo /usr/local/lib/<name>/uninstall` 删除应用（保留它的数据、环境变量文件、用户和日志）。`pkg` 软件包没有签名，它安装的可执行文件也只有临时签名（在组织以外的机器上分发需要 Developer ID 签名和公证，目前还不支持）。

Windows 的安装包在 Windows 上制作：NSIS 安装程序（`<name>-<version>-<arch>-setup.exe`）和 Windows Installer 安装包（`.msi`，由 WiX 制作，用于在组织中部署）把应用安装在 `C:\Program Files\<name>`，把数据放在 `C:\ProgramData\<name>`；它们和其他 Windows 程序一样卸载。制作工具只下载一次，保存在 lakutata 的缓存中（NSIS 3、WiX 3、WinSW；`LAKUTATA_NSIS`、`LAKUTATA_WIX` 和 `LAKUTATA_WINSW` 可以指定其他副本）。用 Node.js 制作的可执行文件（`"runtime": "node"`）保留着 Node.js 的签名，而这个签名已经不再匹配：发布前请用 signtool 签名。

服务让应用随系统启动：由 systemd（`/usr/lib/systemd/system/<service>.service`）、Alpine 上的 OpenRC（`/etc/init.d/<service>`）或 macOS 上的 launchd（`/Library/LaunchDaemons/<appId>.plist`）运行，在 Windows 上则由 WinSW 运行（应用旁边的 `<name>-service.exe`，注册为 Windows 服务：`Restart-Service <service>`）。安装时启动服务，升级时重启它，卸载前先停止并禁用它。

| 服务选项 | |
|---|---|
| `name`、`description` | 默认取软件包的名称和描述 |
| `args` | 应用的参数 |
| `env` | 应用的环境变量（默认 `MODE=production`），写入 `/etc/<name>/<name>.env`（macOS 上是 `/usr/local/etc/<name>/<name>.env`，Windows 上是 `C:\ProgramData\<name>\<name>.env`），管理员可以修改这个文件（升级时会保留） |
| `user` | 运行服务的用户：默认是安装时创建的、以软件包命名的系统用户（macOS 上是隐藏的 `_<name>`），也可以是 `root`；在 Windows 上默认是服务的虚拟账户（`NT SERVICE\<service>`），也可以是 `LocalService`、`NetworkService` 或 `LocalSystem` |
| `restart` | `on-failure`（默认）、`always` 或 `no`（在 Windows 上和 OpenRC 下，`on-failure` 和 `always` 的效果相同） |
| `autoStart` | 安装时启用并启动服务，默认 `true`；否则由管理员启用并启动它（`systemctl enable --now <service>`；在 macOS 上先 `launchctl enable system/<appId>`，再 `launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`） |

服务的工作目录存放服务的数据，归服务的用户所有，位置是 `/var/lib/<name>`（macOS 上是 `/usr/local/var/lib/<name>`，日志在 `/usr/local/var/log/<name>.log`；Windows 上是 `C:\ProgramData\<name>`，日志在其中的 `logs` 目录）。`SIGTERM` 让它优雅退出（在 Windows 上，停止服务会发送 Ctrl+C，Node.js 把它当作 `SIGINT`）。

所有单文件包和可执行文件，因而所有安装好的应用，都会在应用启动前加载环境变量 `LAKUTATA_ENV_FILE` 指定的环境文件（Windows 服务就是这样获得环境变量的，因为它的包装程序没有环境文件）：每行是 `NAME=value` 或 `NAME="value"`，也可以是注释（`#`）。文件中的值会覆盖已经设置的变量。

和 electron-builder 一样，安装包可以执行应用的脚本（项目中的文件）：针对一个平台的脚本，该平台的所有安装包都会执行；某一种安装包专用的脚本，会替换平台在同一时机执行的脚本；Linux 软件包的原生脚本；以及由 NSIS 安装程序包含的 NSIS 文件：

```json
"installer": {
  "linux": {
    "scripts": {"preinstall": "build/linux/preinstall.sh", "postinstall": "build/linux/postinstall.sh", "preremove": "build/linux/preremove.sh", "postremove": "build/linux/postremove.sh"},
    "rpm": {"scripts": {"postinstall": "build/linux/rpm-postinstall.sh"}},
    "deb": {"nativeScripts": {"postinstall": "build/linux/postinst.sh"}}
  },
  "mac": {"scripts": {"postinstall": "build/mac/postinstall.sh"}},
  "win": {"scripts": {"postinstall": "build/win/postinstall.ps1"}, "nsis": {"include": "build/win/installer.nsh"}}
}
```

| 脚本 | |
|---|---|
| `preinstall` | 安装应用的文件之前（使用 Windows Installer 升级时，被替换的版本此时已经删除） |
| `postinstall` | 文件安装之后、服务启动之前（升级期间，被替换版本的服务可能仍在运行） |
| `preremove` | 卸载之前，此时服务已经停止 |
| `postremove` | 文件删除之后 |

脚本的第一个参数（`$1`，PowerShell 中是 `$args[0]`）说明安装包在做什么：`install` 或 `upgrade`（`preinstall`、`postinstall`），或者 `remove`（`preremove`、`postremove`；升级不执行卸载脚本）。`LAKUTATA_INSTALL_DIR` 是应用所在的目录。脚本以 root 身份执行（在 Windows 上，NSIS 以管理员身份执行，Windows Installer 以系统账户执行）。脚本失败时，安装（或卸载）也会失败。各个包管理器表示升级的方式各不相同（dpkg 用 `configure <version>`，rpm 用已安装版本的数量，apk 和 pacman 用它们的升级脚本），安装包会把它们转换成这些参数。

- Linux（`linux.scripts`、`linux.<deb|rpm|apk|archlinux>.scripts`）：脚本由第一行指定的解释器执行（默认 `#!/bin/sh`），嵌入在软件包的脚本中。`linux.<package>.nativeScripts` 按包管理器执行软件包脚本的方式执行，接收包管理器自己的参数（`preinstall`、`postinstall`、`preremove`、`postremove`；apk 和 archlinux 还有 `preupgrade`、`postupgrade`）。
- macOS（`mac.scripts`、`mac.pkg.scripts`）：sh 脚本，和 Linux 一样；卸载脚本由应用的 `uninstall` 脚本执行（macOS 没有卸载软件包的功能）。
- Windows（`win.scripts`、`win.<nsis|msi>.scripts`）：PowerShell 脚本（`.ps1`，由 Windows PowerShell 执行；Windows Installer 通过命令行执行脚本，所以每个脚本都不能超出命令行的长度限制：大约 23 KB）。`win.nsis.include` 是由 NSIS 安装程序包含的 NSIS 文件（`.nsh`），安装程序会插入其中的宏：`customHeader`、`customInit`、`customInstall`（在安装的最后）、`customUnInit`、`customUnInstall`（在卸载的开始）。
- 压缩包（`tar.gz`、`zip`）不执行任何脚本。

Electron 应用（`"runtime": "electron"`）的安装包由 electron-builder 制作，它是项目的依赖。应用的主进程连同它的依赖（不含 Electron）打包进应用的归档文件，它的原生插件和资源（`lakutata.resources`：渲染进程和预加载脚本，通过 `resourcesPath()` 读取）放在归档旁边，即 Electron 的资源目录中。它的安装包由 electron-builder 的目标（target）决定（默认在 Linux 上是 `deb`，macOS 上是 `dmg`，Windows 上是 `nsis`：`linux.targets`、`mac.targets`、`win.targets`）。`name`、`appId`、`productName`、描述、维护者、主页和许可证会传给 electron-builder，其余的由 `electron` 给出（图标、文件关联、签名、更新等）；`addToPath`，以及 `linux` 中除 `targets` 和脚本以外的选项都不使用，`vendor` 只在 Linux 上使用。原生插件按安装时的样子复制（electron-builder 不会重新构建它们）：Node-API 的插件可以直接在 Electron 中运行；其他插件请在打包前安装它们为 Electron 构建的版本（`electron-rebuild`）。Electron 应用不是服务。各种安装包执行的脚本如下：

| 安装包 | 脚本 |
|---|---|
| `deb`、`rpm`（由 fpm 制作的软件包） | 全部（`postinstall` 和 `postremove` 在 electron-builder 的脚本之后执行） |
| `pkg`（macOS） | `preinstall`、`postinstall`（macOS 应用由用户自己删除） |
| `nsis`（Windows） | `preinstall`、`postinstall`、`preremove`（它的卸载程序最后会删除文件）；`win.nsis.include` 的 NSIS 文件定义其他的宏 |
| 其他（`AppImage`、`dmg`、`portable`、`msi` 等） | 无 |

在 Linux arm64 上，fpm 软件包需要系统中的 fpm（`gem install fpm`、`USE_SYSTEM_FPM=true`），因为 electron-builder 下载的那个是为 x64 构建的。在 Windows arm64 上，NSIS 安装程序用 BCJ 过滤器压缩可执行文件（`ELECTRON_BUILDER_7Z_FILTER`），因为 7-Zip 默认会选用 ARM64 过滤器，而 NSIS 安装程序无法解压用它压缩的文件。

NW.js 应用（`"runtime": "nwjs"`）的安装包里是它所用 NW.js（`lakutata nwjs use`，见下文）的 normal 版本，以应用的名字命名，应用放在其中：为这个 NW.js 的 Node.js 打包的代码、处理成能在其中加载的原生插件、资源和 NW.js 的清单。Windows 上的可执行文件是 `<name>.exe`，带有应用的图标和版本信息；macOS 上的应用包是 `<productName>.app`，它的 `Info.plist` 给出应用的名称、`appId`、版本和图标（并重新做临时签名）。它的安装包是桌面应用的安装包，默认 Linux 上是 `deb`，macOS 上是 `dmg`，Windows 上是 `nsis`：Windows 的安装程序（`nsis`、`msi`）把应用加到开始菜单和桌面，`dmg` 磁盘映像里是应用和一个指向 /Applications 的链接，`pkg` 安装包把应用装到那里，Linux 的软件包（`deb`、`rpm`）添加应用的桌面入口和图标，并依赖 Chromium 所需的库。`--arch` 为本机以外的架构制作安装包（`ia32`：32 位 Windows）。NW.js 应用不是服务；它的脚本和其他应用一样执行（macOS 上的应用是直接删除的，没有卸载脚本）。

| 命令选项 | |
|---|---|
| `--target <targets...>` | 要制作的安装包，默认是配置中的那些 |
| `--outdir <directory>` | 安装包的输出目录，默认 `dist/installer` |
| `--entry`、`--no-minify`、`--external` | 与 `lakutata package exe` 相同 |
| `--arch <arch>` | NW.js 应用的架构（`x64`、`ia32`、`arm64`），默认是本机的架构 |

## NW.js

NW.js 应用（`nwjs-react` 和 `nwjs-vue` 模板）运行在它 `package.json` 中指定的 NW.js 版本里：`"lakutata": {"nwjs": {"version": "0.119.2"}}`。NW.js 的运行时只下载一次到 lakutata 的缓存目录（从 `https://dl.nwjs.io` 下载，或者从 `LAKUTATA_NWJS_MIRROR` 指定的镜像下载），并按其发布版本的校验和核对。lakutata 支持内置 Node.js 为 18.10 或更高版本的 NW.js。

### `lakutata nwjs versions`

列出 lakutata 支持的 NW.js 版本，从新到旧：发布日期、内置的 Node.js 和 Chromium、提供的构建，并标出最新版本和最后一个能在 Windows 7 上运行的版本（`win7`，0.72.0）。默认列出最新的十个版本和 Windows 7 的那个版本，`--all` 列出全部。版本列表（`https://nwjs.io/versions.json`，或者 `LAKUTATA_NWJS_VERSIONS` 指定的列表）缓存一天。

### `lakutata nwjs use <version>`

为当前目录的应用设置 NW.js 版本：某个版本（`0.119.2`）、`latest` 或 `win7`，以具体的版本号写进 `package.json` 的 `lakutata.nwjs`。它同时写入 `nwjs.json`，即这个版本及其内置的 Node.js 和 Chromium，模板里用户界面的构建会读取它，以这个 Chromium 为目标；命令还会给出这个版本能运行的系统。`--download` 立即为本机下载它的 sdk 版本。

### `lakutata nwjs run [args...]`

在 NW.js 中运行当前目录下编译好的应用：应用先被打包到 `.nwjs/app`，以这个 NW.js 的 Node.js 为目标，带上资源和处理成能在其中加载的原生插件，然后带着 `--` 之后的参数运行（`lakutata nwjs run -- --ui=http://localhost:5173`）。NW.js 退出时命令结束；命令被终止时，NW.js 也会随之结束。

| 选项 | |
|---|---|
| `--release <version>` | 运行的 NW.js 版本（某个版本、`latest`、`win7`），默认是 `lakutata.nwjs` 中的版本 |
| `--flavor <sdk\|normal>` | `sdk`（默认：带 DevTools）或 `normal`（安装包中的版本） |

## 迁移

### `lakutata migration <action>`

管理应用数据库（它的 Database 组件和提供者）的迁移。`generate`、`run`、`revert` 和 `show` 会带着一个环境变量（`MIGRATION_GENERATE`、`MIGRATION_RUN`、`MIGRATION_REVERT`、`MIGRATION_SHOW`）运行构建并启动应用的那个包脚本（默认是 `dev`，由项目的包管理器运行）。应用随后用各数据库的选项连接数据库，但不同步表结构，也不执行迁移；它执行命令，报告做了什么，然后退出，不会启动它的组件和入口。`create` 只写一个文件。

| 操作 | |
|---|---|
| `generate` | 根据实体的变化生成迁移：应用比较实体和它的数据库，把迁移写入目录，每个有变化的数据库一个文件 `<timestamp>-<database name>.ts`（相当于 lakutata 2.x 中的 `cross-env MIGRATION_GENERATE=./src/migrations npm run dev`）；没有任何变化时，不生成任何内容，命令失败 |
| `create <name>` | 一个空迁移，由你手写 `up` 和 `down`：`<timestamp>-<name>.ts`，类名为 `<Name><timestamp>` |
| `show` | 列出数据库选项中的迁移：已执行（`[X]`）或待执行（`[ ]`） |
| `run` | 执行待执行的迁移（`up`） |
| `revert` | 撤销最后执行的迁移（`down`），每次一个；应用有多个数据库时必须指定 `--database` |

| 选项 | |
|---|---|
| `--dir <directory>` | 迁移所在的目录，相对于包，默认 `src/migrations`（`generate`、`create`） |
| `--script <script>` | 构建并启动应用的脚本，默认 `dev` |
| `--package <name>` | 工作区中应用所在的包，用于在工作区的其他位置运行命令（默认是当前目录中的包） |
| `--database <name>` | 数据库：它的 Database 组件或提供者的名称，默认所有数据库（`MIGRATION_DATABASE`） |
| `--transaction <mode>` | 执行或撤销迁移时使用的事务：`all`（所有迁移共用一个）、`each` 或 `none`；默认取数据库的 `migrationsTransactionMode`，没有时为 `all`（`MIGRATION_TRANSACTION`） |
| `--fake` | 只把迁移标记为已执行或已撤销，不真正执行（`MIGRATION_FAKE`） |

迁移随应用一起编译，并列在所属数据库的选项中（`migrations: [...]`；设置了 `migrationsRun: true` 时，数据库连接时就会执行它们）。应用没有数据库时（`generate` 除外，这时它什么都不生成）、指定的数据库不属于应用时，以及迁移失败时，命令都会失败（退出码 1）。

## 多语言

### `lakutata i18n <action> [locale]`

管理应用各语言的消息（`lakutata/com/i18n`）。消息保存在一个目录中（`--dir`，默认 `locales`；多个目录用逗号分隔），每种语言一个文件（`zh-CN.json`）或一个目录（`zh-CN/`）。

- `lakutata i18n check`：以默认语言（`--default`，默认 `en`）的消息为准，检查每种语言的消息，有错误时失败：
  - 错误：ICU MessageFormat 语法错误、默认语言没有的键、默认消息没有的参数（格式化消息时会缺少这个参数）、错误码未知或用了其他错误码变量的校验消息；
  - 警告：缺少的消息（会改用回退语言的消息）、默认消息中没有用到的参数、与默认消息相同的消息（还没翻译）。`--strict` 在有警告时也失败，适合 CI。
- `lakutata i18n types`：声明默认语言的消息键名及其参数（`--out`，默认 `src/i18n.d.ts`），这样写错键名或漏掉参数时，编译就会报错。应用从 `@lakutata/i18n` 而不是 `lakutata/com/i18n` 导入时，用 `--module @lakutata/i18n` 生成声明。
- `lakutata i18n add <locale>`：添加一种语言，内容是默认语言消息的副本，和默认语言一样放在文件或目录中（不复制默认语言的校验消息：新语言有内置的校验消息）。之后翻译这些消息；`check` 会报告还没翻译的消息。

## 工具的语言

工具的帮助（命令和选项的说明）、交互提问、选项的校验错误和少数结果（`lakutata version` 的变更计划、拒绝确认后的提示）支持英文、简体中文（`zh-CN`）和繁体中文（`zh-TW`）。语言依次取自 `LAKUTATA_LANG`（`LAKUTATA_LANG=zh-CN`）、环境变量（`LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG`）和系统；都不匹配时使用英文。命令名、选项名，以及其他结果和错误，都是英文。

## 环境变量

| 变量 | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | 下载模板的 npm 仓库（默认取 `npm_config_registry`，否则为 `https://registry.npmjs.org`） |
| `LAKUTATA_GITHUB_DOWNLOAD` | 下载 `github:` 模板所用的 GitHub 镜像（默认 `https://github.com`） |
| `LAKUTATA_CACHE_DIR` | 缓存目录（默认 `$XDG_CACHE_HOME/lakutata`，否则为 `~/.cache/lakutata`） |
| `LAKUTATA_NWJS_MIRROR` | NW.js 运行时的下载地址（默认 `https://dl.nwjs.io`） |
| `LAKUTATA_NWJS_VERSIONS` | NW.js 的发布版本列表（默认 `https://nwjs.io/versions.json`） |
| `LAKUTATA_LANG` | 工具的语言（`zh-CN`、`zh-TW`、`en`），默认取环境的语言 |

这个工具本身也是一个 lakutata 应用：它的命令就是其控制器的命令行动作，由入口的 commander 适配器提供。

## 另见

- 网站上的指南：[命令行工具](https://lakutata.com/zh/guide/Command)、[工作区](https://lakutata.com/zh/guide/Workspaces)。
