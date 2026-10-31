# @lakutata/builder

[English](README.md) | 中文

lakutata 应用的打包工具。`@lakutata/cli` 的 `package bundle`、`package exe` 和 `package installer` 命令都靠它完成工作，项目的脚本也可以直接调用它：

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

打包工具处理的是编译后的应用：请先用 `tsc` 构建项目，因为装饰器的元数据是由 `tsc` 生成的。单文件包是一个 CommonJS 文件，由 esbuild 生成。原生插件不能打进单文件包，所以它们连同运行时加载的内容会一起收集到一个 native 目录树中。打包器跟踪不到应用按路径读取的文件，这些文件也放在这个目录树中：单独运行的脚本（worker、worker 池、`fork()`、`require(path.join(__dirname, 'x.js'))`）会各自打包，数据文件和目录则直接复制。打包工具会找出由模块位置构造的路径，并改写它们；无法一起发布的内容会列在结果的 `warnings` 中。运行时，lakutata 的 `resourcesPath()` 负责找到应用的资源，这些资源在应用 `package.json` 的 `lakutata.resources` 中声明。安装包则由同一个文件中的 `lakutata.installer` 配置。详见 `@lakutata/cli` 文档中的 `lakutata package bundle`、`lakutata package exe` 和 `lakutata package installer`。

NW.js 应用运行在它 `lakutata.nwjs` 中指定的 NW.js 版本里。`nwjsReleases()` 列出 NW.js 的发布版本，`downloadNwjs()` 把一个运行时下载到缓存目录（按其发布版本的校验和核对），`stageNwjsApp()` 为 NW.js 准备应用：为这个 NW.js 的 Node.js 打包的代码、处理成能在其中加载的原生插件（为它的架构重新构建，使用 V8 API 的插件用它的头文件重新构建；在 Windows 上让插件加载 NW.js 的 Node.js）、资源和 NW.js 的清单。`buildNwjsApp()` 把应用放进以应用命名的 NW.js normal 版本中，`buildInstaller()` 在 `"runtime": "nwjs"` 时制作它的安装包（桌面应用的安装包：默认 macOS 上是 dmg，Windows 上是 nsis，Linux 上是 deb）。

Linux 安装包在容器（Docker）中测试：`npm run test:installer` 先在 Debian 和 Alpine 上制作安装包，再在 Debian、Fedora（systemd）和 Alpine（OpenRC）上安装、升级和卸载它们。macOS 安装包在 macOS 虚拟机中测试安装（`npm run test:installer:mac`，使用 tart），Windows 安装包则在 Windows 上以管理员身份测试安装（`LAKUTATA_WINDOWS_INSTALL=1 npm run test:installer:windows`）。

## 另见

- 网站上的指南：[打包](https://lakutata.com/zh/guide/Packaging)、[安装包](https://lakutata.com/zh/guide/Installers)。
