# @lakutata/builder

[English](README.md) | 中文

Lakutata 应用的打包工具。`@lakutata/cli` 的 `package bundle`、`package exe` 和 `package installer` 命令均借助本工具完成工作，项目的脚本也可以直接调用本工具：

```js
import {buildExecutable, buildInstaller, buildNwjsApp, bundleProject} from '@lakutata/builder'

//dist/<name>.cjs，由 node 运行，原生插件和资源放在它旁边
await bundleProject({project: process.cwd()})
//不需要安装 Node.js 就能运行的可执行文件，内嵌 Node.js（默认）或 Bun。
//layout 为 'directory' 时：dist/<name>/<name>，原生插件和资源放在它旁边；为 'file'（默认）时：dist/<name>
await buildExecutable({project: process.cwd(), runtime: 'node', layout: 'directory'})
//dist/installer：当前平台的安装包（Linux 上是 deb、rpm、apk、archlinux、tar.gz；macOS 上是 pkg、tar.gz；
//Windows 上是 nsis、msi、zip），应用声明了服务时，安装包还会注册这个服务
await buildInstaller({project: process.cwd()})
//NW.js 应用（版本在 lakutata.nwjs 中）：dist/nwjs/<name>-<build>，以应用命名的 NW.js 运行时
await buildNwjsApp({project: process.cwd()})
```

打包工具处理的是编译后的应用，请先使用 `tsc` 构建项目，因为装饰器的元数据由 `tsc` 生成。单文件包是一个 CommonJS 文件，由 esbuild 生成。原生插件无法打进单文件包，因此原生插件连同其在运行时加载的内容会一起收集到一个 native 目录树中。打包器无法跟踪应用按路径读取的文件，这些文件也放在该目录树中：单独运行的脚本（worker、worker 池、`fork()`、`require(path.join(__dirname, 'x.js'))`）会各自打包，数据文件和目录则直接复制。打包工具会找出由模块位置构造的路径并将其改写；无法一同发布的内容会列在结果的 `warnings` 中。运行时，`lakutata` 的 `resourcesPath()` 负责定位应用的资源，这些资源在应用 `package.json` 的 `lakutata.resources` 中声明。安装包则由同一文件中的 `lakutata.installer` 配置。详见 `@lakutata/cli` 文档中的 `lakutata package bundle`、`lakutata package exe` 和 `lakutata package installer`。

NW.js 应用运行在其 `lakutata.nwjs` 所指定的 NW.js 版本中。`nwjsReleases()` 列出 NW.js 的发布版本，`downloadNwjs()` 将一个运行时下载到缓存目录（按其发布版本的校验和核对）。`stageNwjsApp()` 为 NW.js 准备应用：为该 NW.js 的 Node.js 打包的代码、处理成能在其中加载的原生插件、资源和 NW.js 的清单。处理原生插件时，插件针对 NW.js 的架构重新构建，使用 V8 API 的插件则使用 NW.js 的头文件重新构建；在 Windows 上还让插件加载 NW.js 的 Node.js。`buildNwjsApp()` 将应用放入以应用命名的 NW.js normal 版本中，`buildInstaller()` 在 `"runtime": "nwjs"` 时制作该应用的安装包（桌面应用的安装包，默认在 macOS 上为 dmg，在 Windows 上为 nsis，在 Linux 上为 deb）。

React Native 手机应用（Android、iOS、鸿蒙）运行在 libnode 中，libnode 由 lakutata/libnode 从 Node.js 源码编译而成。`downloadMobileNode()` 从 lakutata/libnode 的 Release 下载指定系统的 libnode，只下载一次（`LAKUTATA_LIBNODE_MIRROR` 指定镜像），使用 Release 的校验和验证后保存在缓存中（设置 `LAKUTATA_MOBILE_NODE_DIR` 时改用自行编译的 libnode）。`stageMobileApp()` 生成应用的 Node.js 项目：面向 libnode 中 Node.js 的单文件包（没有 libnode 时面向 Node.js 24.20.0，即 `MOBILE_NODE_VERSION`）、资源、清单，以及一个入口。没有 WebAssembly 时（鸿蒙），该入口移除 `fetch()`。该函数还会使用 libnode 的头文件和库，从源码为目标系统编译原生插件：Android 上每种架构生成一棵原生树（node-gyp 和 NDK）；iOS 上每个插件针对每个 SDK 编译为一个 framework（Xcode），放在 `frameworks` 指定的目录中；鸿蒙上每个插件编译为一个库（DevEco Studio 的原生 SDK），放在 `libraries` 指定的 HAP 库目录中。鸿蒙的 HAP 会从资源中去掉名称以点开头的文件，因此在鸿蒙上原生树打包进项目（`native.gz`、`native.json`），并在首次运行时解压到 `LAKUTATA_NATIVE_DIR` 指定的目录。

## 另见

- 网站上的指南：[打包](https://lakutata.com/zh/guide/Packaging)、[安装包](https://lakutata.com/zh/guide/Installers)。
