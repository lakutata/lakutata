# @lakutata/cli

[English](README.md) | 中文

[Lakutata](https://github.com/lakutata/lakutata) 框架的命令行工具。

```bash
npx @lakutata/cli create --name my-app
# 或者先安装：npm install -g @lakutata/cli
lakutata create --name my-app
```

## 命令

### `lakutata create`

使用模板创建项目。选项在命令行中给出。在终端中运行时，工具会询问缺少的名称，列出模板的可选功能供选择，并在确认后再创建项目（`--yes` 会跳过可选功能的选择和确认）。

| 选项 | |
|---|---|
| `--name <name>` | 应用的名称（必填） |
| `--id <id>` | 应用的 ID（一个包名），默认为名称的小写形式 |
| `--bundle-id <id>` | 应用在手机系统上的标识（反向域名，例如 `com.acme.shop`），用于手机模板；默认为 `com.example.<名称>`，应用商店不接受该默认值 |
| `--template <template>` | 模板（不指定时为 `default`）：官方模板（由 `lakutata templates` 列出）、`npm:<package>[@<version>]`、`github:<owner>/<repo>[#<ref>]`，或一个目录 |
| `--path <directory>` | 创建项目目录的位置，默认为当前目录 |
| `--init` | 直接在 `--path` 目录中创建项目。该目录必须已经存在，其中可以有文件：已有的文件会保留（模板中也有的文件会在警告中列出，需要手动合并），只有新写入的文件会填入项目的信息 |
| `--description`、`--author`、`--license` | 应用的信息 |
| `--with <features>` | 要启用的模板可选功能，以逗号分隔（由 `lakutata templates` 列出）：`i18n`、`installer`、`win7`。在终端中，如果未给出 `--with` 或 `--yes`，工具会让用户从列表中选择 |
| `--package-manager <npm\|pnpm\|yarn\|none>` | 安装依赖所用的包管理器（`none` 表示不安装）；默认为 npm，由 pnpm 或 yarn 启动工具时使用相应的包管理器 |
| `--no-git` | 不初始化 git 仓库 |
| `--yes` | 直接创建项目，不询问可选功能，也不要求确认 |

```bash
lakutata create --name my-service --template service --package-manager pnpm --yes
lakutata create --name my-service --template service --with i18n --yes
```

每个官方模板都有 `i18n` 功能，即应用的多语言消息（`lakutata/com/i18n`），这些消息放在 `src/locales` 中（`en.json`、`zh-CN.json`），并随代码一起打包。应用按每个请求的语言回复，校验错误也是如此（命令行工具和桌面应用使用运行环境的语言）。该功能还会添加 `i18n:check` 和 `i18n:types` 脚本。`cli`、`service` 和 `web-*` 模板还有 `installer` 功能，即应用的 `lakutata.installer` 配置，以及制作安装包的脚本（在本机制作，以及在 Docker 中制作 Linux 的安装包）；在 `service` 和 `web-*` 模板中，该功能还包括一个系统服务。`nwjs-*` 模板有 `win7` 功能，即以 NW.js 0.72.0（最后一个能在 Windows 7、8 和 8.1 上运行的版本）代替模板发布时的版本，并添加制作 32 位 Windows 安装包的脚本。

### `lakutata templates`

列出官方模板。官方模板是 npm 包（`@lakutata/template-<name>`），由清单包 `@lakutata/templates` 列出，从用户所用的 npm 仓库下载（与下载依赖一样，可以使用 npmmirror 这样的镜像），因此无需访问 GitHub。清单缓存一天（`--refresh` 会重新获取）。

官方模板取与工具主版本号相同的最新正式版。下载过的模板会被缓存。无法连接仓库时，使用缓存中该主版本的最新版本；缓存中也没有时，命令失败。

模板包将文件放在其 `template/` 目录中。有些文件无法以真实的文件名放入 npm 包，因此 `_gitignore`、`_npmrc` 等文件会在创建项目时改名为 `.gitignore`、`.npmrc` 等。文本文件中会填入项目的信息：`{$APP_NAME}`、`{$APP_ID}`、`{$APP_DESC}`、`{$APP_AUTHOR}`、`{$APP_LICENSE}` 和 `{$LAKUTATA_VERSION}`（框架的次版本，例如框架为 3.1.2 时为 `3.1.0`；由于补丁版只发布改动过的包，写作 `^{$LAKUTATA_VERSION}` 才能找到 Lakutata 的每个包）。

模板可以有可选功能，由 `lakutata create --with <features>` 启用（或由用户在终端中选择）：

- 模板包的 `package.json` 声明这些功能，并给出各功能的名称和说明：`"lakutata": {"template": "default", "features": {"i18n": "The messages in several languages"}}`；
- 功能的文件放在 `features/<name>/` 中，与 `template/` 并列（也要与该目录一同发布，列在包的 `files` 中）。启用功能时，这些文件会加入项目：项目中已有的 JSON 文件会与之合并，例如 `package.json` 的脚本、`tsconfig.json` 的选项（对象按键合并，数组整体替换），其他文件则替换模板中的同名文件；
- 模板的文件中可以有只属于某个功能的代码块：`//@if <feature>` 与 `//@end`（或 `//@else`）之间的行，在启用该功能时保留，否则删除（`//@if !<feature>` 表示功能未启用时保留）；标记所在的行始终会被删除。标记写作该文件所用语言的注释：`//@if i18n`、`#@if i18n`、`<!--@if i18n-->`、`/*@if i18n*/`。

### `lakutata info`

显示工具和框架的版本（以及二者的最新版本）、Node.js 的版本，以及当前目录中的项目所用的框架版本。

### `lakutata clean [paths...]`

删除当前目录所在包中的路径，适用于任何平台（类似 `rm -rf`，无需 `shx` 或 `rimraf`），例如 `lakutata clean build dist`。未给出路径时，删除该包 `tsconfig.json` 中的输出目录（`outDir`，有 `declarationDir` 时也删除该目录；这两个选项也会在其继承的配置中查找），例如 `"clean": "lakutata clean"`。不存在的路径会被跳过。包以外的路径、包本身、`src`、`node_modules`、`.git` 和 `package.json` 永远不会被删除。在工作区中，`lakutata run clean` 会运行每个包的 `clean` 脚本。

## 工作区

由多个包（`app`、`ui`、`proxy` 等）组成的项目是 npm 工作区。一个目录所属的工作区，是从该目录向上查找到的最近一个满足以下条件的目录：其 `package.json` 有 `workspaces` 字段（模式的列表，或者 `{"packages": [...]}`），或者其 `package.json` 旁边有 `pnpm-workspace.yaml`（取其中的 `packages:` 列表）。模式匹配的是目录（`*` 匹配一层目录名中的字符，`**` 匹配任意层目录，`!` 排除一个目录）；在匹配到的目录中，`package.json` 带有名称的即为包。工具负责构建这些包并为其设置版本号；这类项目用到的 lerna 功能均由工具提供，无需 lerna。

### `lakutata run <script>`

按依赖顺序（`dependencies`、`devDependencies`、`peerDependencies` 和 `optionalDependencies` 中的依赖），在每个含有该脚本的包中运行此脚本。一个包要等其直接或间接依赖的包全部执行完毕后才开始执行，互不依赖的包同时执行。脚本由项目的包管理器运行：取根目录 `package.json` 的 `packageManager` 字段；没有该字段时，根据根目录中的文件判断（pnpm 对应 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`，此外还有 `yarn.lock`、`package-lock.json`）；默认为 npm。每行输出都以所属包的名称开头。脚本不接受额外的参数。所有包都没有该脚本时，命令会提示未找到，并正常结束。

| 选项 | |
|---|---|
| `--concurrency <n>` | 同时运行的包数，默认为处理器的数量 |
| `--parallel` | 所有包同时运行，不等待各自的依赖，适用于持续运行的脚本（`lakutata run dev --parallel`） |
| `--no-bail` | 失败后继续，不依赖失败包的包仍然正常运行（默认情况下，有包失败后不再启动新的包，已在运行的包会运行至结束） |
| `--scope <names...>` | 只运行这些名称的包（`*` 是通配符）；这些包所依赖的包既不运行，也不等待；没有任何包匹配时报错 |

### `lakutata version <bump>`

为每个包设置下一个版本号（`major`、`minor`、`patch`、`premajor`、`preminor`、`prepatch`、`prerelease`，或者直接给出版本号；`--preid <id>` 为 `pre…` 这几种递增方式指定预发布标识），私有包和没有版本号的包也包括在内，并在各个包和根目录的 `package.json` 中更新包之间的依赖（`^0.0.16` 变为 `^0.0.17`，`~`、`>=`、`=` 和 `workspace:^` 范围也是如此，而 `*`、`workspace:*` 和 `file:` 保持不变）。对于 `0.x` 版本，这一点很重要，因为 `^0.0.16` 只匹配 `0.0.16` 本身。命令还会更新 `package-lock.json` 或 `pnpm-lock.yaml`，否则 `npm ci` 会失败。`yarn.lock` 不会更新（命令会提醒运行 `yarn install`），锁文件更新失败也只产生一个警告。工作区的版本在 `lerna.json` 给出 `version` 时取该值，否则取根目录 `package.json` 的版本，再否则取各包中最高的版本，预发布版本也计算在内（都没有版本时为 `0.0.0`），新版本也写回该处。`--git` 只提交与本次版本有关的文件，提交信息为 `v<version>`，并为该提交打上标签 `v<version>`（轻量标签，不推送）；修改任何文件之前，命令会先检查仓库和标签。命令只在终端中请求确认，`--yes` 不询问，直接设置版本。

### `lakutata add <name>`

在工作区中添加一个包，放在工作区存放包的目录中，目录名为去掉作用域的包名。存放包的目录取工作区中第一个形如 `<directory>/*` 的模式（例如 `apps/*`）对应的目录；工作区含有 `packages/*` 模式时，则取 `packages` 目录，这样其他命令才能看到新包；工作区没有这样的模式时（只逐个列出了包，或者是 `packages/**`），命令会拒绝添加。包的版本即工作区的版本（`lerna.json`，否则为根目录的 `package.json`，再否则为各包中最高的版本；都没有时，或者使用 lerna 的独立版本时为 `0.0.1`）。新包是私有的（如需发布，请删掉 `"private": true`），带有 `clean`、`build`、`rebuild` 和 `test` 脚本以及一个测试；`--to <package>` 将新包以 `^<version>` 加入工作区中另一个包的依赖。命令不安装任何内容，之后请按其输出的提示，运行项目所用包管理器的安装命令，以链接新包。

- `lakutata add greeting`：一个 TypeScript 包（`src/index.ts` 连同类型声明编译到 `build` 中）。
- `lakutata add @acme/capture --native [gyp|cmake|rust]`：一个原生插件，使用以下构建系统之一：
  - `gyp`（默认）：C++，使用 [node-addon-api](https://github.com/nodejs/node-addon-api)，由 node-gyp 根据 `binding.gyp` 构建；
  - `cmake`：C++，使用 node-addon-api，由 [cmake-js](https://github.com/cmake-js/cmake-js) 根据 `CMakeLists.txt` 构建；
  - `rust`：Rust，使用 [napi-rs](https://napi.rs)，由 cargo 构建（`Cargo.toml`、`build.rs`、`rust/lib.rs`）。

  Node-API 在各个 Node.js 和 Electron 版本之间保持稳定，因此同一个插件无需重新构建即可在两者中运行。插件构建到 `build/Release` 中（由 `npm run build:native` 构建，安装该包时也由其 `install` 脚本构建），由 `src/index.ts` 通过 node-gyp-build 加载，`src/index.ts` 编译到 `dist` 中。C++ 插件构建为一个同时支持 Intel 和 Apple 芯片 Mac 的文件，Rust 插件只为本机的架构构建。`lakutata native` 负责为插件链接库。`binding.gyp` 和 `CMakeLists.txt` 中的注释还说明了如何指定库和构建选项：系统的库、pkg-config、包中的静态库、随插件一起发布的动态库（复制到插件旁边，运行时通过插件的 rpath 在该位置找到），以及 `binding.gyp` 中的 C++ 标准和各平台的选项（`CMakeLists.txt` 设置为 C++20）。自带 Makefile 的库，由一个脚本在插件之前构建，包的 README 中有示例（`build:deps`）。`lakutata package bundle` 和 `lakutata package exe` 会将插件及其动态库与应用一起发布。构建插件需要 C++ 工具链（`cmake` 还需要 CMake），`rust` 则需要 Rust。

### `lakutata native <action> <value>`

修改当前目录中原生插件的构建，工具根据构建文件（`binding.gyp`、`CMakeLists.txt` 或 `Cargo.toml`）找到该插件。构建文件就地修改，其中的注释和格式保持不变，插件的源码不受影响。重复执行同一修改不会改变任何内容。

- `lakutata native link <library>`：链接一个库：
  - 系统的库：`lakutata native link pcap`（Windows 的 `ws2_32` 要加上 `--platform win`）；
  - `--pkg-config`：由 pkg-config 查找的库（`lakutata native link libpcap --pkg-config`；不适用于 Windows）；
  - `--framework`：macOS 的框架（`lakutata native link CoreFoundation --framework`）；
  - 包中的文件：静态库（`deps/lib/libfoo.a`；Windows 上为 `foo.lib`）链接进插件；动态库（`deps/lib/libfoo.dylib`、`libfoo.so`，或者 `foo.dll` 及其导入库 `foo.lib`）复制到插件旁边，运行时通过插件的 rpath（macOS 上为 `@loader_path`，Linux 上为 `$ORIGIN`）在该位置找到。在 macOS 上，库的安装名称（install name）必须为 `@rpath/libfoo.dylib`（使用 `install_name_tool -id` 设置），否则命令会给出提醒；
  - `--crate`：一个 crate，用于 Rust 插件（`cargo add`）。
- `lakutata native include <directory>`：头文件目录（C++），可以是包中的目录，也可以是系统中的绝对路径。
- `lakutata native define <NAME[=value]>`：预处理器的宏定义（C++）。

`--platform mac|linux|win` 使修改只针对一个平台（库文件自身决定其平台：`.dylib` 对应 macOS，`.so` 对应 Linux，`.dll` 和 `.lib` 对应 Windows，`.a` 与 pkg-config 相同，对应除 Windows 以外的所有平台）。构建文件有多个目标时，`--target <name>` 指定要修改的目标。各构建系统中写入的内容如下：

| | gyp | CMake | Rust |
|---|---|---|---|
| 文件 | `binding.gyp`，或其所包含的、声明该目标的 `.gypi` | `CMakeLists.txt` | `.cargo/config.toml`（`[env]`），由 `build.rs` 读取 |
| 库 | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | `-sys` crate |
| 框架 | `xcode_settings.OTHER_LDFLAGS` | `if(APPLE)` 中的 `-framework` | `rustc-link-lib=framework=` |
| 动态库 | `copies`、rpath | `INSTALL_RPATH`（`BUILD_WITH_INSTALL_RPATH`）、一个 `POST_BUILD` 复制命令 | `rustc-cdylib-link-arg`、`build:native` 中的复制命令 |
| 头文件、宏定义 | `include_dirs`、`defines` | `target_include_directories`、`target_compile_definitions` | 无（使用 crate） |
| 平台 | `conditions`（`OS=="mac"`、`OS!="win"`） | `if(APPLE)`、`if(WIN32)`、`if(NOT WIN32)`、`if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`、`_LINUX`、`_WINDOWS`、`_UNIX` |

对于 Rust 插件，库会传给 `build.rs`（由 `lakutata add --native rust` 生成），再由该脚本只针对此插件传给 cargo，因为直接传给 rustc 的参数会作用于 rustc 构建的每一个 crate。

### `lakutata list`

列出各个包。第一行给出包的数量和工作区的版本，之后为每个包列出版本、` (private)`（仅私有包有此标记）、目录，以及该包所依赖的工作区中的包。

### 从 lerna 迁移

| lerna | `lakutata` |
|---|---|
| `lerna run rebuild` | `lakutata run rebuild` |
| `lerna version patch --no-git-tag-version --no-push -y` | `lakutata version patch --yes` |
| `lerna version patch` | `lakutata version patch --git`（不推送标签） |

包仍然使用 `npm publish -w <package>` 发布（`lakutata add` 创建的包是私有的，请先删掉 `"private": true`）。工具只读写 `lerna.json` 中的 `version`，包则来自根目录 `package.json` 的 `workspaces`，或者 `pnpm-workspace.yaml`。工具不支持为各个包分别设置版本号（`"version": "independent"` 的 `lerna.json` 无法递增版本），不根据提交生成变更日志，也不缓存构建结果。需要这些功能的工作区可以同时保留 lerna（或 nx、turborepo）。

## 原生库

### `lakutata ffi generate <header>`

根据 C 头文件生成 `@lakutata/ffi` 原生库的类。生成的类包含：库的声明、每个函数对应的一个带 TypeScript 类型的属性、每个结构体和联合对应的一个接口，以及作为常量的整数宏。头文件先经过 C 编译器的预处理器处理（`cc -E`；在 Windows 上为 `cl /P`，请在 Visual Studio 的开发者命令提示符中运行），然后保留库自身的声明（头文件中的声明，以及头文件所在目录中其他头文件的声明，该目录为系统目录时除外），以及这些声明用到的系统类型。之后使用库检查这些函数，库中未导出的函数和无法调用的函数（参数为 `va_list`）会被移除。命令会列出被移除的声明及其原因。工具从项目中加载 `@lakutata/ffi`，因此请在项目中安装该包。

| 选项 | |
|---|---|
| `--library <name or file>` | 用于检查函数的库：`@Library` 接受的库名，或一个文件；默认与头文件同名（`sqlite3.h` 对应 `sqlite3`；zlib 需要指定 `--library z`）。库无法加载时，仍会生成类，但不做检查，并给出警告 |
| `--class-name <name>` | 类的名称，默认为头文件名的 PascalCase 形式 |
| `--out <file>` | 要写入的文件，默认为当前目录下的 `<类名>.ts` |
| `--force` | 文件已存在时覆盖该文件 |
| `--include <directories...>` | 头文件引用的其他头文件所在的目录（`-I`） |
| `--define <macros...>` | 在头文件之前定义的宏：`NAME` 或 `NAME=value`（`-D`） |
| `--own <directories...>` | 属于该库的其他头文件所在的目录 |
| `--compiler <compiler>` | 用于预处理头文件的 C 编译器：`cc`、`gcc`、`clang`、`cl`（默认取 `CC` 环境变量；未设置时，在 Windows 上为 `cl`，在其他系统上为 `cc`） |
| `--no-check` | 不使用库检查函数 |

类是针对运行命令的平台生成的。从头文件无法看出哪些指针是输出参数，也无法看出哪些函数会阻塞，因此请在生成的文件中自行标出（`_Out_`、`{async: true}`）。详见原生库的指南（[FFI](https://lakutata.com/zh/guide/FFI) 第 9 节）。

## 单文件包和可执行文件

这些命令打包当前目录中的应用，应用必须先编译好（使用 `tsc` 编译，这一编译器会生成装饰器的元数据）。实际工作由 `@lakutata/builder` 完成：优先使用项目中安装的副本（`npm install --save-dev @lakutata/builder`，需要打包应用的模板均已如此配置），否则使用随工具一起安装的副本（全局安装工具时不会附带该包，因为它只是工具的可选 peer 依赖）。脚本也可以调用该包的函数（`bundleProject`、`buildExecutable`）来打包应用。

### `lakutata package bundle`

使用 esbuild 将应用及其依赖打包为一个 CommonJS 文件，即 `dist/<name>.cjs`，node 无需 `node_modules` 即可运行该文件。文件名中的名称取 `package.json` 中的第一个 `bin`，没有时取去掉作用域的包名。入口为 `package.json` 的 `main`，没有时为 `build/App.js`（可以通过 `--entry` 修改）。单文件包会被压缩，但保留类名（`--no-minify` 关闭压缩），`import.meta.url` 为单文件包的 URL。

| 选项 | |
|---|---|
| `--entry <file>` | 编译后的入口，默认为 `package.json` 的 `main`，没有时为 `build/App.js` |
| `--outfile <file>` | 单文件包的路径，默认 `dist/<name>.cjs` |
| `--no-minify` | 不压缩单文件包 |
| `--external <modules...>` | 不打包进单文件包的模块，运行时从单文件包旁边的 `node_modules` 加载 |

单文件包是 CommonJS 模块，因为 Node.js 的可执行文件要运行这些模块。应用的 ES 模块会被转换，因此无法使用顶层 `await`，请在异步函数中使用 await。

原生插件（`.node` 文件）无法打进单文件包。打包时，工具会找出含有插件的包，以及通过计算出的路径加载插件的包（例如 sharp）。工具将这些包连同其在运行时加载的内容（这些包 require 的 JavaScript，以及插件所链接共享库的所在包，例如 libvips）排除在单文件包之外，按 `node_modules` 的结构放在 `dist/<name>.native/` 中，该目录随单文件包一起发布。目录中是运行时加载的文件：插件和共享库所在包的全部文件；对于其他包，则是其加载的 JavaScript（逐个跟踪得出）和其他文件（其读取的数据）；以及通过无法跟踪的路径加载自身文件的包（`require(path.join(__dirname, name))`）的全部文件。这些包的类型声明、source map、TypeScript 源码和文档会被排除；插件的 C 和 C++ 源码与目标文件（better-sqlite3 带有 SQLite 的源码），以及构建插件时产生的文件也会被排除，即 `build/` 中 node-gyp 和 CMake 的文件、cargo 的 `target` 目录、静态库和导入库。应用自身的插件（`require('./x.node')`、`createRequire(import.meta.url)('./x.node')`）也放入这一目录。框架的包以及基于框架的包，无论依赖什么、自身是否带有插件，始终与应用一起打进单文件包，这样框架、框架的类和容器都只有一份。这些包的原生依赖放入该目录；这些包自身的插件也放入其中，前提是插件通过直接 `require` 插件文件、从模块位置构造的路径（`path.join(__dirname, 'prebuilds', ...)`）或包自身的目录（`node-gyp-build`）加载，以其他方式加载的插件会列在警告中。未安装的可选依赖（应用未使用的存储驱动，即 `peerDependenciesMeta` 中标为 optional 的依赖，以及 `optionalDependencies`）会被排除，运行时加载这类依赖会抛出异常，与不打包时相同。

打包器不会跟踪应用按路径读取的文件，即应用单独运行的脚本（worker：`new Worker()`、传入文件的 worker 池；子进程：`fork()`；按路径加载的模块：`require(path.join(__dirname, 'x.js'))`），以及应用的数据（`fs.readFileSync(path.join(__dirname, 'defaults.json'))`、存放 schema 的目录）。此外，单文件包并不位于原先各模块所在的位置：对于 `build/config/` 中的模块，`path.resolve(__dirname, '../../schema')` 指向项目的 `schema/` 目录，但打包到 `dist/` 之后则不再如此。工具会在应用的模块及其所用包的模块中，找出所有由模块位置构造的文件路径（无论写在何处），并改写这些表达式，使其指向 `.native` 目录中的文件（`dist/<name>.native/.lakutata/files/`，目录结构与项目中相同，从项目外部链接进来的包放在 `node_modules/` 下）：

| 路径指向 | |
|---|---|
| 脚本（`.js`、`.cjs`） | 连同其加载的内容单独打包（打包为 CommonJS 文件，无论项目的模块类型是什么） |
| 其他文件 | 复制（`package.json` 的类型会设为 CommonJS，与其旁边的脚本一致） |
| 存放数据的目录 | 复制其中的文件 |
| 包含该模块的目录（`path.join(__dirname, '..')`：应用、模块所在的包） | 不发布，并发出警告：请将其中的文件声明为资源（`lakutata.resources`，见下文） |
| 包含脚本或包的目录（`package.json`、`node_modules`） | 不发布，并发出警告：其中的脚本在运行时需要各自的包 |
| 尚不存在的路径（应用运行时创建的目录） | 保持原样 |

会被跟踪的路径写法如下：

| 路径 | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | 模块的 URL（与 Vite 中相同）；也包括 `pathToFileURL(__filename)` |
| `import.meta.url + '/../worker.js'` | 字符串形式的模块 URL |
| `path.join(__dirname, 'worker.js')`、`path.resolve(__dirname, …)` | 也包括使用 `import.meta.dirname` 或 `path.dirname(fileURLToPath(import.meta.url))` 的写法 |
| `__dirname + '/worker.js'`、`` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')`、`require.resolve(path.resolve(__dirname, '../lib/worker'))` | 扩展名按 node 的方式查找 |
| `` path.join(__dirname, 'locales', `${lang}.json`) ``、`` new URL(`./jobs/${name}.js`, import.meta.url) `` | 部分已知：取模式匹配到的所有文件和目录（其中的表达式匹配名称的一部分），表达式保留不变 |

tsc 生成的代码（`(0, node_path_1.join)(__dirname, 'worker.js')`）也会被跟踪。如果应用还直接导入了此类脚本，工具会发出警告，因为该脚本会被打包两次，每次都带有一份独立的模块副本（各自的状态和类）。Node.js worker（`worker_threads`）的脚本无法跟踪时，工具只对应用的模块发出警告（包中的 worker 按使用者给出的路径启动）。无法跟踪的情况有两种：路径只在运行时才能确定（`new Worker(file)`；保存上述某种路径的变量或类属性可以跟踪），或者路径相对于进程的当前目录（`new Worker('./worker.js')`，node 从当前目录而非模块所在位置解析该路径）。请从模块所在的目录构造这些脚本的路径，或者将脚本作为资源发布。运行源码的 worker（`eval: true`）无需处理。警告只指出应用中的模块，并给出文件和行号。

应用的资源，即应用在运行时读取的文件（Web 应用构建好的页面、模板、数据），在应用 `package.json` 的 `lakutata.resources` 中声明，形式为 `{from, to}` 对象的列表（类似 electron-builder 的 `extraResources`，但不支持其字符串、glob 和过滤器写法）：

```json
"lakutata": {"resources": [{"from": "../ui/dist", "to": "ui"}]}
```

`from` 是项目中的文件或目录，`to` 是其在资源中的路径；资源放在 `dist/<name>.resources/` 中，随单文件包一起发布。应用通过 `lakutata` 的 `resourcesPath()` 定位资源（应用未以打包形式运行时返回 `undefined`，可以通过 `isPackaged()` 判断）。

### `lakutata package exe`

为当前平台制作应用的可执行文件，即 `dist/<name>`（Windows 上为 `dist/<name>.exe`），该文件无需安装 Node.js 即可运行。单文件包连同其 V8 代码缓存，嵌入运行工具的 Node.js 程序的副本中（Node.js 的单可执行文件应用），因此嵌入的 Node.js 即为运行工具的版本。在可执行文件中，`import.meta.url` 为可执行文件本身的 URL。

使用 `--runtime bun` 时，改由 Bun 编译单文件包（`bun build --compile --bytecode`，代码编译为字节码，启动时无需解析），优先使用项目中的 Bun（npm 上的 `bun` 包，`npm install --save-dev bun`），否则使用系统中的 Bun。这样的可执行文件更小，启动更快，占用的内存也更少；运行时也随之变为 Bun（JavaScriptCore，以及 Bun 自身实现的 Node.js API）。原生插件仍是 Node.js 的插件，不会为 Bun 重新构建。Bun 能够加载 Node-API 插件，但不一定能加载基于 Node.js V8 API 的插件，工具会对这些插件发出警告（以 better-sqlite3 为例，可执行文件能够构建，但加载该包时会失败）。与 Node.js 的可执行文件一样，Bun 的可执行文件不会加载所在目录的 `.env` 或 `bunfig.toml`（需要这些文件的应用请自行加载，或者使用 `LAKUTATA_ENV_FILE`），运行模式取决于每次运行的环境。Bun 原本会将 `process.env.NODE_ENV` 替换为构建时的模式，但单文件包在运行时才读取该变量。

其他平台的可执行文件需要在相应平台上制作，因为应用的原生插件需要在该平台上构建，可执行文件也能在该平台上测试。CI 可以提供这些机器（由 Linux、macOS 和 Windows runner 组成的矩阵）；Linux 的各种架构也可以在对应架构的容器中构建（`docker run --platform linux/arm64`，模板的交叉构建即采用这种方式）。

| 选项 | |
|---|---|
| `--outdir <directory>` | 可执行文件的输出目录，默认 `dist` |
| `--runtime <node\|bun>` | 嵌入的运行时：`node`（默认）或 `bun` |
| `--layout <file\|directory>` | 单个文件（默认），或者一个目录，即 `dist/<name>/` 中包含可执行文件、其原生插件（`native/`）和资源（`resources/`），直接从该目录加载，无需解压（用于安装包和镜像） |
| `--entry`、`--no-minify`、`--external` | 与 `lakutata package bundle` 相同，外部模块从可执行文件旁边的 `node_modules` 加载 |

使用 `--layout file` 时，原生插件、按路径读取的文件和资源都嵌入可执行文件中。首次运行时，可执行文件将这些内容解压到缓存目录下的 `native/<hash>` 中，该目录以内容命名。缓存目录在 macOS 上为 `~/Library/Caches/<name>`，在 Windows 上为 `%LOCALAPPDATA%\<name>\Cache`，在 Linux 上为 `$XDG_CACHE_HOME/<name>`，否则为 `~/.cache/<name>`，也可以通过 `LAKUTATA_NATIVE_DIR` 指定目录。缓存目录不可写时，可执行文件改用临时目录中的 `<name>`（指定了 `LAKUTATA_NATIVE_DIR` 时则不会改用）。之后的运行都从该目录加载，不同版本的程序不会共用该目录。插件需要其构建时所针对的系统库（Linux 预编译插件所需的 glibc 版本）。

可执行文件的子进程运行的是可执行文件本身（`process.execPath`）。在两种布局下，如果启动可执行文件是为了运行其中的某个脚本（`fork(path.join(__dirname, 'child.js'))`、`spawn(process.execPath, [script])`），可执行文件会带着参数运行该脚本，而不是运行应用。以 Node.js 制作时，`require.main` 即为该脚本，与 node 相同；以 Bun 制作时则不然。

macOS 的可执行文件使用临时签名（ad hoc）。用 Node.js 制作的 Windows 可执行文件保留了 `node.exe` 的签名，而该签名已不再匹配，因此发布前请重新签名。

### `lakutata package installer`

为当前平台制作应用的安装包（与 electron-builder 的做法相同）。安装包会安装目录布局的可执行文件（`lakutata package exe --layout directory`）及其原生插件和资源，将程序加入 PATH，并注册应用的服务。其他平台的安装包需要在相应平台上制作（Linux 的安装包可以在容器中制作）。安装包由 `package.json` 中的 `lakutata.installer` 配置：

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
| `appId` | 应用的标识（反向 DNS，`com.acme.app`），默认为其名称：在 macOS 上是软件包的标识和服务的标签；在 Windows 上是卸载程序和升级所用的键 |
| `productName` | 显示给用户的名称（在安装程序中，以及 Windows 的程序列表中），默认取 `package.json` 的 `productName`，没有时取名称 |
| `description`、`maintainer`、`homepage`、`license` | 默认取自 `package.json`（维护者为其作者） |
| `vendor` | 供应商，默认无（在 Windows 上，发布者为供应商，未设置时为维护者） |
| `runtime` | 可执行文件的运行时：`node`（默认）或 `bun`；Electron 应用使用 `electron`，NW.js 应用使用 `nwjs`（见下文） |
| `addToPath` | 将程序加入 PATH（`/usr/bin/<program>`，macOS 上为 `/usr/local/bin/<program>`；Windows 上为机器的 PATH），默认 `true`（NW.js 应用默认 `false`） |
| `service` | `true` 或服务的选项（见下文），默认无 |
| `linux.targets` | glibc 系统上可以是 `deb`、`rpm`、`archlinux`、`tar.gz`（默认 `deb`、`rpm`、`tar.gz`）；Alpine（musl）上为 `apk`、`tar.gz` |
| `linux.depends`、`linux.recommends`、`linux.section`、`linux.priority` | 依赖和推荐的系统软件包、分类和优先级（deb） |
| `mac.targets` | `pkg`、`tar.gz`（默认两种都制作）；NW.js 应用还可以使用 `dmg` |
| `win.targets` | `nsis`、`msi`、`zip`（默认全部制作） |
| `electron` | Electron 应用的 electron-builder 配置，合并到由这些选项生成的配置之上 |

开始构建之前会先检查配置，本次不制作的安装包的选项也会检查。

Linux 软件包由 nFPM 制作，输出到 `dist/installer`（`--outdir`）。nFPM 只下载一次，保存在 Lakutata 的缓存中，提供 x64 和 arm64 两种架构；`LAKUTATA_NFPM` 可以指定另一份副本，其他架构也需通过该变量指定。软件包将应用安装在 `/opt/<name>`，并将 C++ 运行库作为依赖。可执行文件链接的是制作该文件的系统的 C 库，因此面向 glibc 系统的软件包需要在 glibc 系统上制作，`apk` 软件包需要在 Alpine 上制作；应用有原生插件时需要使用 Bun 制作（`"runtime": "bun"`），因为 Node.js 的可执行文件在 musl 上无法加载原生插件。

macOS 的安装包使用 macOS 自带的工具（`pkgbuild`、`productbuild`）制作。`pkg` 软件包将应用安装在 `/usr/local/lib/<name>`，将程序放在 `/usr/local/bin`，只能安装在与程序架构相同的 Mac 上。macOS 没有卸载软件包的功能，因此由 `sudo /usr/local/lib/<name>/uninstall` 删除应用（保留应用的数据、环境变量文件、用户和日志）。`pkg` 软件包没有签名，其安装的可执行文件也只有临时签名（在组织以外的机器上分发需要 Developer ID 签名和公证，目前尚不支持）。

Windows 的安装包在 Windows 上制作。NSIS 安装程序（`<name>-<version>-<arch>-setup.exe`）和 Windows Installer 安装包（`.msi`，由 WiX 制作，用于在组织中部署）将应用安装在 `C:\Program Files\<name>`，将数据放在 `C:\ProgramData\<name>`；卸载方式与其他 Windows 程序相同。制作工具只下载一次，保存在 Lakutata 的缓存中（NSIS 3、WiX 3、WinSW；`LAKUTATA_NSIS`、`LAKUTATA_WIX` 和 `LAKUTATA_WINSW` 可以指定其他副本）。用 Node.js 制作的可执行文件（`"runtime": "node"`）保留了 Node.js 的签名，而该签名已不再匹配，因此发布前请用 signtool 签名。

服务使应用随系统启动。服务由 systemd（`/usr/lib/systemd/system/<service>.service`）、Alpine 上的 OpenRC（`/etc/init.d/<service>`）或 macOS 上的 launchd（`/Library/LaunchDaemons/<appId>.plist`）运行，在 Windows 上则由 WinSW 运行（应用旁边的 `<name>-service.exe`，注册为 Windows 服务：`Restart-Service <service>`）。安装时启动服务，升级时重启服务，卸载前先停止并禁用服务。

| 服务选项 | |
|---|---|
| `name`、`description` | 默认取软件包的名称和描述 |
| `args` | 应用的参数 |
| `env` | 应用的环境变量（默认 `MODE=production`），写入 `/etc/<name>/<name>.env`（macOS 上为 `/usr/local/etc/<name>/<name>.env`，Windows 上为 `C:\ProgramData\<name>\<name>.env`），管理员可以修改该文件（升级时会保留） |
| `user` | 运行服务的用户：默认为安装时创建的、以软件包命名的系统用户（macOS 上为隐藏的 `_<name>`），也可以是 `root`；在 Windows 上默认为服务的虚拟账户（`NT SERVICE\<service>`），也可以是 `LocalService`、`NetworkService` 或 `LocalSystem` |
| `restart` | `on-failure`（默认）、`always` 或 `no`（在 Windows 上和 OpenRC 下，`on-failure` 和 `always` 的效果相同） |
| `autoStart` | 安装时启用并启动服务，默认 `true`；否则由管理员启用并启动服务（`systemctl enable --now <service>`；在 macOS 上先执行 `launchctl enable system/<appId>`，再执行 `launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`） |

服务的工作目录存放服务的数据，归服务的用户所有，位置为 `/var/lib/<name>`（macOS 上为 `/usr/local/var/lib/<name>`，日志位于 `/usr/local/var/log/<name>.log`；Windows 上为 `C:\ProgramData\<name>`，日志位于其中的 `logs` 目录）。`SIGTERM` 使服务优雅退出（在 Windows 上，停止服务会发送 Ctrl+C，Node.js 将其视为 `SIGINT`）。

所有单文件包和可执行文件，因而所有已安装的应用，都会在应用启动前加载环境变量 `LAKUTATA_ENV_FILE` 指定的环境文件（Windows 服务即通过这种方式获得环境变量，因为其包装程序没有环境文件）。文件中每行为 `NAME=value` 或 `NAME="value"`，也可以是注释（`#`）。文件中的值会覆盖已设置的变量。

与 electron-builder 一样，安装包可以执行应用的脚本（项目中的文件）。针对一个平台的脚本，该平台的所有安装包都会执行；某一种安装包专用的脚本，会替换该平台在同一时机执行的脚本；此外还有 Linux 软件包的原生脚本，以及由 NSIS 安装程序包含的 NSIS 文件：

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
| `preinstall` | 安装应用的文件之前（使用 Windows Installer 升级时，被替换的版本此时已被删除） |
| `postinstall` | 文件安装之后、服务启动之前（升级期间，被替换版本的服务可能仍在运行） |
| `preremove` | 卸载之前，此时服务已经停止 |
| `postremove` | 文件删除之后 |

脚本的第一个参数（`$1`，PowerShell 中为 `$args[0]`）说明安装包正在执行的操作：`install` 或 `upgrade`（`preinstall`、`postinstall`），或者 `remove`（`preremove`、`postremove`；升级时不执行卸载脚本）。`LAKUTATA_INSTALL_DIR` 为应用所在的目录。脚本以 root 身份执行（在 Windows 上，NSIS 以管理员身份执行，Windows Installer 以系统账户身份执行）。脚本失败时，安装（或卸载）也会失败。各个包管理器表示升级的方式各不相同（dpkg 使用 `configure <version>`，rpm 使用已安装版本的数量，apk 和 pacman 使用各自的升级脚本），安装包会将这些方式转换为上述参数。

- Linux（`linux.scripts`、`linux.<deb|rpm|apk|archlinux>.scripts`）：脚本由第一行指定的解释器执行（默认 `#!/bin/sh`），嵌入软件包的脚本中。`linux.<package>.nativeScripts` 按包管理器执行软件包脚本的方式执行，接收包管理器自身的参数（`preinstall`、`postinstall`、`preremove`、`postremove`；apk 和 archlinux 还有 `preupgrade`、`postupgrade`）。
- macOS（`mac.scripts`、`mac.pkg.scripts`）：sh 脚本，与 Linux 相同；卸载脚本由应用的 `uninstall` 脚本执行（macOS 没有卸载软件包的功能）。
- Windows（`win.scripts`、`win.<nsis|msi>.scripts`）：PowerShell 脚本（`.ps1`，由 Windows PowerShell 执行；Windows Installer 通过命令行执行脚本，因此每个脚本都不能超出命令行的长度限制，即约 23 KB）。`win.nsis.include` 是由 NSIS 安装程序包含的 NSIS 文件（`.nsh`），安装程序会插入其中的宏：`customHeader`、`customInit`、`customInstall`（在安装的最后）、`customUnInit`、`customUnInstall`（在卸载的开始）。
- 压缩包（`tar.gz`、`zip`）不执行任何脚本。

Electron 应用（`"runtime": "electron"`）的安装包由 electron-builder 制作，electron-builder 是项目的依赖。应用的主进程连同其依赖（不含 Electron）打包进应用的归档文件，应用的原生插件和资源（`lakutata.resources`：渲染进程和预加载脚本，通过 `resourcesPath()` 读取）放在归档旁边，即 Electron 的资源目录中。应用的安装包由 electron-builder 的目标（target）决定，目标通过 `linux.targets`、`mac.targets`、`win.targets` 设置（默认在 Linux 上为 `deb`，在 macOS 上为 `dmg`，在 Windows 上为 `nsis`）。`name`、`appId`、`productName`、描述、维护者、主页和许可证会传给 electron-builder，其余配置由 `electron` 给出（图标、文件关联、签名、更新等）；`addToPath` 以及 `linux` 中除 `targets` 和脚本以外的选项均不使用，`vendor` 只在 Linux 上使用。原生插件按安装时的原样复制（electron-builder 不会重新构建这些插件）：基于 Node-API 的插件可以直接在 Electron 中运行；对于其他插件，请在打包前安装其为 Electron 构建的版本（`electron-rebuild`）。Electron 应用不是服务。各种安装包执行的脚本如下：

| 安装包 | 脚本 |
|---|---|
| `deb`、`rpm`（由 fpm 制作的软件包） | 全部（`postinstall` 和 `postremove` 在 electron-builder 的脚本之后执行） |
| `pkg`（macOS） | `preinstall`、`postinstall`（macOS 应用由用户自行删除） |
| `nsis`（Windows） | `preinstall`、`postinstall`、`preremove`（其卸载程序最后会删除文件）；`win.nsis.include` 的 NSIS 文件定义其他宏 |
| 其他（`AppImage`、`dmg`、`portable`、`msi` 等） | 无 |

在 Linux arm64 上，fpm 软件包需要系统中的 fpm（`gem install fpm`、`USE_SYSTEM_FPM=true`），因为 electron-builder 下载的 fpm 是为 x64 构建的。在 Windows arm64 上，NSIS 安装程序使用 BCJ 过滤器压缩可执行文件（`ELECTRON_BUILDER_7Z_FILTER`），因为 7-Zip 默认会选用 ARM64 过滤器，而 NSIS 安装程序无法解压用该过滤器压缩的文件。

NW.js 应用（`"runtime": "nwjs"`）的安装包中是应用所用 NW.js（`lakutata nwjs use`，见下文）的 normal 版本，以应用的名称命名，应用放在其中：为该 NW.js 的 Node.js 打包的代码、处理成能在其中加载的原生插件、资源和 NW.js 的清单。Windows 上的可执行文件为 `<name>.exe`，带有应用的图标和版本信息；macOS 上的应用包为 `<productName>.app`，其 `Info.plist` 给出应用的名称、`appId`、版本和图标（并以临时签名重新签署应用包）。NW.js 应用的安装包为桌面应用的安装包，默认在 Linux 上为 `deb`，在 macOS 上为 `dmg`，在 Windows 上为 `nsis`。Windows 的安装程序（`nsis`、`msi`）将应用添加到开始菜单和桌面；`dmg` 磁盘映像中包含应用和一个指向 /Applications 的链接；`pkg` 安装包将应用安装到 /Applications；Linux 的软件包（`deb`、`rpm`）添加应用的桌面入口和图标，并依赖 Chromium 所需的库。`--arch` 为本机以外的架构制作安装包（`ia32` 表示 32 位 Windows）。NW.js 应用不是服务；该应用的脚本与其他应用一样执行（macOS 上的应用直接删除，没有卸载脚本）。

| 命令选项 | |
|---|---|
| `--target <targets...>` | 要制作的安装包，默认为配置中指定的安装包 |
| `--outdir <directory>` | 安装包的输出目录，默认 `dist/installer` |
| `--entry`、`--no-minify`、`--external` | 与 `lakutata package exe` 相同 |
| `--arch <arch>` | NW.js 应用的架构（`x64`、`ia32`、`arm64`），默认为本机的架构 |

## NW.js

NW.js 应用（`nwjs-react` 和 `nwjs-vue` 模板）运行在其 `package.json` 所指定的 NW.js 版本中，例如 `"lakutata": {"nwjs": {"version": "0.119.2"}}`。NW.js 的运行时只下载一次到 Lakutata 的缓存目录（从 `https://dl.nwjs.io` 下载，或者从 `LAKUTATA_NWJS_MIRROR` 指定的镜像下载），并按其发布版本的校验和核对。Lakutata 支持内置 Node.js 为 18.10 或更高版本的 NW.js。

### `lakutata nwjs versions`

从新到旧列出 Lakutata 支持的 NW.js 版本，每个版本给出发布日期、内置的 Node.js 和 Chromium、提供的构建，并标出最新版本和最后一个能在 Windows 7 上运行的版本（`win7`，0.72.0）。默认列出最新的十个版本和该 Windows 7 版本，`--all` 列出全部版本。版本列表（`https://nwjs.io/versions.json`，或者 `LAKUTATA_NWJS_VERSIONS` 指定的列表）缓存一天。

### `lakutata nwjs use <version>`

为当前目录的应用设置 NW.js 版本，可以是某个版本（`0.119.2`）、`latest` 或 `win7`，以具体的版本号写入 `package.json` 的 `lakutata.nwjs`。命令同时写入 `nwjs.json`，即该版本及其内置的 Node.js 和 Chromium；模板中用户界面的构建会读取此文件，以其中的 Chromium 为目标。命令还会给出该版本能够运行的系统。`--download` 立即为本机下载所设版本的 sdk 版本。

### `lakutata nwjs run [args...]`

在 NW.js 中运行当前目录下编译好的应用。应用先被打包到 `.nwjs/app`，以该 NW.js 的 Node.js 为目标，并带上资源和处理成能在其中加载的原生插件，然后带着 `--` 之后的参数运行（`lakutata nwjs run -- --ui=http://localhost:5173`）。NW.js 退出时命令结束；命令被终止时，NW.js 也会随之结束。

| 选项 | |
|---|---|
| `--release <version>` | 运行的 NW.js 版本（某个版本、`latest`、`win7`），默认为 `lakutata.nwjs` 中的版本 |
| `--flavor <sdk\|normal>` | `sdk`（默认，带 DevTools）或 `normal`（安装包中的版本） |

## 手机应用

按 `mobile-react` 模板布局的 React Native 手机应用（Android、iOS、鸿蒙）在 libnode 中运行 `packages/app` 中的应用，libnode 是应用的原生模块（`packages/ipc/native`）所内嵌的 Node.js 库；各系统的原生工程位于项目根目录，界面位于 `packages/ui` 中。下面的命令可以在项目的任何目录中执行，用于下载 libnode、生成应用的 Node.js 项目、运行应用，以及在开发时部署该项目。

### `lakutata mobile node <platform>`

从 [lakutata/libnode](https://github.com/lakutata/libnode) 的 Release 下载指定系统（`android`、`ios` 或 `harmony`）的 libnode，放到 `packages/ipc/native/node/out/<platform>`，原生工程基于该 libnode 编译；鸿蒙的 `libnode.so` 还会放入 HAP 的库目录（`harmony/entry/libs/arm64-v8a`）。libnode 的压缩包（`libnode_<platform>_<arch>.tar.gz`，每种架构一个）会使用 Release 的 `SHA256SUMS` 校验，并保存在 Lakutata 的缓存目录中（`~/.cache/lakutata/mobile`），因此只下载一次。项目中还没有某个系统的 libnode 时，`lakutata mobile stage` 会先下载该 libnode。

- `LAKUTATA_LIBNODE_MIRROR` 指定 Release 的镜像，文件布局与 GitHub 上相同（`<镜像>/v<版本>/libnode_android_arm64.tar.gz`、`<镜像>/v<版本>/SHA256SUMS`）。
- `LAKUTATA_MOBILE_NODE_DIR` 指定自行编译的 libnode（使用 lakutata/libnode 仓库编译），每个系统一个目录（`android`、`ios`、`harmony`），结构与该仓库导出的结构相同。

| 选项 | |
|---|---|
| `--abis <列表>` | Android 的架构，以逗号分隔（`arm64-v8a,armeabi-v7a,x86_64`），默认为 `arm64-v8a,x86_64` |

### `lakutata mobile stage <platform>`

将应用的 Node.js 项目生成到该平台原生工程读取它的位置：`android/app/src/main/assets/nodejs`（应用首次启动时复制到应用的文件目录）、`ios/nodejs`（构建应用时放入应用包）或 `harmony/entry/src/main/resources/resfile/nodejs`（直接从 HAP 的资源中运行）。项目包含面向 libnode 中 Node.js 版本的应用单文件包、资源、`package.json` 和入口；在没有 WebAssembly 的环境中（鸿蒙），入口会移除 `fetch()`。

依赖中的原生插件会从各自包的源码（`binding.gyp`）为目标系统编译，编译使用 libnode 的头文件和库。在 Android 上，libnode 的每种架构各有一棵原生树，使用 node-gyp 和 NDK 编译（Android SDK 中最新的 NDK，或 `ANDROID_NDK_HOME`）；自带 Android 预编译插件（`prebuilds/android-<arch>`）的包直接使用这些预编译插件。在 iOS 上（在 macOS 中），每个插件分别为真机和模拟器编译为一个 framework，由 Xcode 编译到 `ios/NodeAddons` 中，并在构建应用时嵌入应用。编译时使用的是插件所在包为 macOS 编写的设置（其 `binding.gyp` 以及 node-addon-api 的 gyp 文件中 `OS=="mac"` 的部分），SDK、架构和部署版本则采用 iOS 的设置。在鸿蒙上，每个插件编译为 HAP 中的一个库（`harmony/entry/libs/arm64-v8a` 中的 `libaddon-<包>-<文件>.so`），使用 DevEco Studio 的原生 SDK 编译（或 `OHOS_NDK_HOME`）。编译结果保存在 Lakutata 的缓存目录中。

| 选项 | |
|---|---|
| `--abis <列表>` | 要为其编译插件的 Android 架构，默认为 libnode 所含的架构 |
| `--no-minify` | 不压缩单文件包 |

### `lakutata mobile run <platform>`

构建并运行指定系统的调试版应用，界面从 Metro（`npm start`）加载。已安装应用中的 Node.js 项目会替换此前部署到其中的副本。

- Android：在正在运行（或指定）的模拟器或设备上，使用 Gradle 按设备的架构构建并安装应用，使设备能够访问 Metro（`adb reverse`），然后启动应用。adb 从 Android SDK（`ANDROID_HOME`）中查找，未找到时使用 `PATH` 中的 adb。
- iOS：在模拟器上（指定的模拟器；未指定时为正在运行的模拟器；都没有时为最新的 iPhone，必要时先启动该模拟器），`Podfile` 有变化时先安装 pods，再使用 `xcodebuild` 构建，使用 `xcrun simctl` 安装、启动，并在 Simulator 或 Device Hub 中显示。
- 鸿蒙：在已连接（或指定）的模拟器或设备上，先将界面打包进 HAP（`react-native bundle-harmony`），并链接移植到鸿蒙的 React Native 库（`react-native link-harmony`，该命令将这些库的包加入 `harmony/oh-package.json5`）；然后使用 ohpm 安装依赖（`ohpm install --all`），再使用 DevEco Studio 的 hvigor 构建（`DEVECO_STUDIO_HOME`，SDK 为 `DEVECO_SDK_HOME`）；最后使用 hdc 安装，使设备能够访问 Metro（`hdc rport`），并启动应用。

| 选项 | |
|---|---|
| `--device <id>` | Android 的模拟器或设备（序列号，见 `adb devices`）、鸿蒙的模拟器或设备（见 `hdc list targets`）、iOS 的模拟器（UDID 或名称，见 `xcrun simctl list devices`） |

### `lakutata mobile deploy <platform>`

生成项目，放入设备上已安装的调试版应用，然后重新启动应用，因此 Node.js 一侧的改动无需重新安装应用。在 Android 上，项目写入应用的文件目录（`adb shell run-as`），并加上标记，使应用持续使用该项目，直到重新安装为止；在 iOS 上，项目连同插件的 framework 写入模拟器中的应用；在鸿蒙上，项目写入应用的文件目录（`hdc file send`），原生模块会优先运行该项目，而不是资源中的项目。原生插件只为当前设备编译（Android 只编译设备所用的架构，iOS 只编译模拟器版本）；鸿蒙的插件是 HAP 中的库，由 `lakutata mobile run harmony` 安装。

| 选项 | |
|---|---|
| `--device <id>` | 与 `lakutata mobile run` 相同 |
| `--watch` | 监视应用的文件（不包括依赖和编译产物），有变化时执行应用的 `build` 脚本并重新部署，直到按下 Ctrl+C 为止 |

## 迁移

### `lakutata migration <action>`

管理应用数据库（应用的 Database 组件和提供者）的迁移。`generate`、`run`、`revert` 和 `show` 会带着一个环境变量（`MIGRATION_GENERATE`、`MIGRATION_RUN`、`MIGRATION_REVERT`、`MIGRATION_SHOW`）运行用于构建并启动应用的包脚本（默认为 `dev`，由项目的包管理器运行）。应用随后使用各数据库的选项连接数据库，但不同步表结构，也不执行迁移；应用执行命令，报告执行结果，然后退出，不会启动其组件和入口。`create` 只写入一个文件。

| 操作 | |
|---|---|
| `generate` | 根据实体的变化生成迁移：应用比较实体与其数据库，将迁移写入目录，每个有变化的数据库一个文件 `<timestamp>-<database name>.ts`（相当于 Lakutata 2.x 中的 `cross-env MIGRATION_GENERATE=./src/migrations npm run dev`）；没有任何变化时，不生成任何内容，命令正常结束（退出码 0） |
| `create <name>` | 一个空迁移，`up` 和 `down` 由使用者手动编写：`<timestamp>-<name>.ts`，类名为 `<Name><timestamp>` |
| `show` | 列出数据库选项中的迁移：已执行（`[X]`）或待执行（`[ ]`） |
| `run` | 执行待执行的迁移（`up`） |
| `revert` | 撤销最后执行的迁移（`down`），每次一个；应用有多个数据库时必须指定 `--database` |

| 选项 | |
|---|---|
| `--dir <directory>` | 迁移所在的目录，相对于包，默认 `src/migrations`（`generate`、`create`） |
| `--script <script>` | 构建并启动应用的脚本，默认 `dev` |
| `--package <name>` | 工作区中应用所在的包，用于在工作区的其他位置运行命令（默认为当前目录中的包） |
| `--database <name>` | 数据库，即其 Database 组件或提供者的名称；默认为所有数据库（`MIGRATION_DATABASE`） |
| `--transaction <mode>` | 执行或撤销迁移时使用的事务：`all`（所有迁移共用一个）、`each` 或 `none`；默认取数据库的 `migrationsTransactionMode`，未设置时为 `all`（`MIGRATION_TRANSACTION`） |
| `--fake` | 只将迁移标记为已执行或已撤销，不真正执行（`MIGRATION_FAKE`） |

迁移随应用一起编译，并列在所属数据库的选项中（`migrations: [...]`；设置了 `migrationsRun: true` 时，数据库连接时即会执行这些迁移）。应用没有数据库时（`generate` 除外，此时该操作不生成任何内容，以退出码 0 结束，表结构没有变化时也是如此）、指定的数据库不属于应用时，以及迁移失败时，命令都会失败（退出码 1）。

## 多语言

### `lakutata i18n <action> [locale]`

管理应用各语言的消息（`lakutata/com/i18n`）。消息保存在一个目录中（`--dir`，默认 `locales`；多个目录以逗号分隔），每种语言一个文件（`zh-CN.json`）或一个目录（`zh-CN/`）。

- `lakutata i18n check`：以默认语言（`--default`，默认 `en`）的消息为准，检查每种语言的消息，有错误时失败：
  - 错误：ICU MessageFormat 语法错误、默认语言没有的键、默认消息没有的参数（格式化消息时会缺少该参数）、错误码未知或使用了其他错误码变量的校验消息；
  - 警告：缺少的消息（会改用回退语言的消息）、默认消息中未用到的参数、与默认消息相同的消息（尚未翻译）。`--strict` 在有警告时也失败，适用于 CI。
- `lakutata i18n types`：声明默认语言的消息键名及其参数（`--out`，默认 `src/i18n.d.ts`），这样在键名写错或遗漏参数时，编译会报错。应用从 `@lakutata/i18n` 而非 `lakutata/com/i18n` 导入时，使用 `--module @lakutata/i18n` 生成声明。
- `lakutata i18n add <locale>`：添加一种语言，内容为默认语言消息的副本，与默认语言一样放在文件或目录中（不复制默认语言的校验消息，因为新语言有内置的校验消息）。之后请翻译这些消息；`check` 会报告尚未翻译的消息。

## 工具的语言

工具的帮助（命令和选项的说明）、交互提问、选项的校验错误和少数结果（`lakutata version` 的变更计划、拒绝确认后的提示）支持英文、简体中文（`zh-CN`）和繁体中文（`zh-TW`）。语言依次取自 `LAKUTATA_LANG`（`LAKUTATA_LANG=zh-CN`）、环境变量（`LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG`）和系统；均不匹配时使用英文。命令名、选项名，以及其他结果和错误，均为英文。

## 环境变量

| 变量 | |
|---|---|
| `LAKUTATA_NPM_REGISTRY` | 下载模板所用的 npm 仓库（未设置时取 `npm_config_registry`，两者均未设置时为 `https://registry.npmjs.org`） |
| `LAKUTATA_GITHUB_DOWNLOAD` | 下载 `github:` 模板所用的 GitHub 镜像（默认 `https://github.com`） |
| `LAKUTATA_CACHE_DIR` | 缓存目录（默认 `$XDG_CACHE_HOME/lakutata`，否则为 `~/.cache/lakutata`） |
| `LAKUTATA_NWJS_MIRROR` | NW.js 运行时的下载地址（默认 `https://dl.nwjs.io`） |
| `LAKUTATA_NWJS_VERSIONS` | NW.js 的发布版本列表（默认 `https://nwjs.io/versions.json`） |
| `LAKUTATA_LANG` | 工具的语言（`zh-CN`、`zh-TW`、`en`），默认取环境的语言 |

本工具自身也是一个 Lakutata 应用，工具的命令即其控制器的命令行动作，由入口的 commander 适配器提供。

## 另见

- 网站上的指南：[命令行工具](https://lakutata.com/zh/guide/Command)、[工作区](https://lakutata.com/zh/guide/Workspaces)。
