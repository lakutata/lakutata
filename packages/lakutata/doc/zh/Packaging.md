# Lakutata 打包

编译好的应用可以不带 `node_modules` 发布，有三种形式：

- **单文件包**（bundle）：一个由 Node.js 运行的 JavaScript 文件；
- **可执行文件**：一个程序，不需要安装 Node.js 就能运行；
- **安装包**：系统的软件包（deb、rpm、pkg、msi 等），它安装可执行文件，把程序加入 PATH，还可以把它注册为服务。

`lakutata package bundle`、`package exe` 和 `package installer` 借助 `@lakutata/builder` 生成它们，项目需要安装它（`npm install --save-dev @lakutata/builder`；需要打包的模板已经带上了）。全部规则见 `@lakutata/cli` 的 README。

## 1. 打包的内容

- **编译后的应用**：打包的是 `tsc` 的输出（`tsc` 会生成装饰器的元数据），而不是 TypeScript 源码，所以要先构建。入口依次是 `--entry`、`package.json` 的 `main`、`build/App.js`。
- **CommonJS**：单文件包是 CommonJS 文件，所以应用不能使用顶层 `await`，请在异步函数里 await。
- **原生插件**：含有 `.node` 文件的包（better-sqlite3、sharp 等）不能打进单文件包。它们连同运行时加载的代码和库一起被排除在外，按 `node_modules` 的结构放在一个随单文件包发布的目录中。
- **未安装的可选依赖**（应用没有用到的存储驱动）会被排除：运行时加载它会抛出异常，和不打包时一样。
- **按路径读取的文件**：由模块位置构造的路径（`path.join(import.meta.dirname, 'child.js')`、`new URL('./defaults.json', import.meta.url)`）会被找到并改写。路径指向脚本时，单独打包这个脚本；指向其他文件时，复制该文件。能识别哪些路径写法，见 `@lakutata/cli` 的 README。
- **资源**：应用运行时读取的其他文件（Web 界面构建好的页面、模板、数据）在 `package.json` 中声明（第 6 节）。

## 2. 单文件包

```bash
npm run build
npx lakutata package bundle      # dist/<name>.cjs
node dist/my-app.cjs
```

文件名取 `package.json` 中第一个 `bin` 的名称，没有时取去掉作用域的包名。需要时，单文件包旁边还会生成两个目录，必须和它一起发布：`dist/<name>.native/`（原生插件、单独运行的脚本、按路径读取的文件）和 `dist/<name>.resources/`（资源）。

| 选项 | 含义 |
|---|---|
| `--entry <file>` | 编译后的入口 |
| `--outfile <file>` | 单文件包的路径，默认 `dist/<name>.cjs` |
| `--no-minify` | 不压缩（无论是否压缩，类名都会保留） |
| `--external <modules...>` | 不打进包里的模块，运行时从单文件包旁边的 `node_modules` 加载 |

## 3. 可执行文件

```bash
npx lakutata package exe                   # dist/<name>（Windows 上是 dist/<name>.exe），使用 Node.js
npx lakutata package exe --runtime bun     # 使用 Bun
```

可执行文件只能为生成它的平台制作。其他平台的可执行文件要在那些平台上制作，因为它们的原生插件要在那里构建：可以用 CI 的矩阵（Linux、macOS、Windows 的机器），Linux 也可以用对应架构的容器（`docker run --platform linux/arm64`）。

| 选项 | 含义 |
|---|---|
| `--runtime node`（默认） | 把单文件包嵌入运行工具的那个 Node.js 的副本中（Node.js 的单可执行文件应用）：在 macOS arm64 上约 110 MB |
| `--runtime bun` | 由 Bun 编译单文件包（优先用项目中的 `bun` 包，否则用系统的 `bun`）：在 macOS arm64 上约 70 MB，启动更快；运行时也就是 Bun |
| `--layout file`（默认） | 单个文件：原生插件、按路径读取的文件和资源都嵌入其中，启动时解压 |
| `--layout directory` | `dist/<name>/` 中包含可执行文件、`native/` 和 `resources/`，直接从那里加载，不解压（安装包用的就是这种布局） |
| `--outdir <directory>` | 可执行文件的输出目录，默认 `dist` |
| `--entry`、`--no-minify`、`--external` | 与单文件包相同 |

- **解压**：单文件布局的可执行文件把嵌入的内容解压到缓存目录中一个以内容命名的子目录，所以每个版本只解压一次：macOS 上是 `~/Library/Caches/<name>`，Windows 上是 `%LOCALAPPDATA%\<name>\Cache`，Linux 上是 `$XDG_CACHE_HOME/<name>` 或 `~/.cache/<name>`，也可以用 `LAKUTATA_NATIVE_DIR` 指定目录。
- **原生插件**：原生插件需要它构建时所针对的系统库。Bun 不能加载 Node.js 的所有原生插件：带 better-sqlite3 的 Bun 可执行文件能构建成功，但启动时会失败。在 Alpine（musl）上，Node.js 的可执行文件不能加载原生插件，请用 Bun 制作。
- **外部模块**：只有 Bun 的可执行文件会从旁边的 `node_modules` 加载 `--external` 指定的模块；Node.js 的可执行文件加载不了它们。
- **子进程**：在单文件布局中，可执行文件被启动来运行它的某个脚本时（`fork(path.join(import.meta.dirname, 'child.js'))`），会像 Node.js 一样运行这个脚本。在目录布局中，它会把应用重新启动一遍。
- **图标与签名**：`package.json` 中的 `lakutata.icon`（256 像素或更大的正方形 PNG）会成为 Windows 可执行文件的图标。macOS 的可执行文件使用临时签名（ad hoc）。用 Node.js 制作的 Windows 可执行文件保留着 `node.exe` 的签名，而这个签名已经不再匹配：发布前请用 signtool 重新签名。

## 4. 安装包

```bash
npx lakutata package installer     # dist/installer/
```

安装包由 `package.json` 中的 `lakutata.installer` 配置：

```json
{
  "lakutata": {
    "installer": {
      "service": {"env": {"PORT": "8080"}},
      "linux": {"targets": ["deb", "rpm", "tar.gz"]}
    }
  }
}
```

| 平台 | 安装包（默认） | 应用的安装位置 | 制作工具 |
|---|---|---|---|
| Linux（glibc） | `deb`、`rpm`、`tar.gz`（还支持 `archlinux`） | `/opt/<name>` | nFPM |
| Linux（musl、Alpine） | `apk`、`tar.gz` | `/opt/<name>` | nFPM |
| macOS | `pkg`、`tar.gz` | `/usr/local/lib/<name>` | `pkgbuild`、`productbuild` |
| Windows | `nsis`、`msi`、`zip` | `C:\Program Files\<name>` | NSIS、WiX |

- 安装包里是目录布局的可执行文件（在 `lakutata.installer` 中设置 `runtime: "bun"` 则用 Bun 制作）。和可执行文件一样，某个平台的安装包要在那个平台上制作；`--target` 可以只制作其中几种。
- nFPM、NSIS、WiX 和 WinSW 只下载一次，保存在工具的缓存中（`LAKUTATA_NFPM`、`LAKUTATA_NSIS`、`LAKUTATA_WIX` 和 `LAKUTATA_WINSW` 可以指定其他副本）。
- 其他字段：`name`（软件包名，默认是程序名）、`appId`、`productName`、`description`、`maintainer`、`homepage`、`license`、`vendor`（默认取自 `package.json`）、`addToPath`（默认 `true`），以及安装包执行的脚本（`preinstall`、`postinstall`、`preremove`、`postremove`），这些脚本见 `@lakutata/cli` 的 README。
- 签名：macOS 的 `pkg` 安装包没有签名，里面的可执行文件也只有临时签名；不会做 Developer ID 签名和公证。在 Windows 上，用 Node.js 制作的可执行文件保留着 `node.exe` 的签名，而这个签名已经不再匹配：发布前请用 signtool 重新签名。

**服务**（`service: true`，或服务的选项）让应用在系统启动时运行：systemd、Alpine 上的 OpenRC、macOS 上的 launchd、Windows 上的 WinSW。安装时启动服务，升级时重启，卸载前先停止。停止服务时应用会优雅退出（发送 `SIGTERM`；Windows 上是 Ctrl+C，Node.js 收到的是 `SIGINT`）。

| 服务选项 | 含义 |
|---|---|
| `name`、`description` | 默认取软件包的名称和描述 |
| `args` | 应用的参数 |
| `env` | 应用的环境变量（默认 `MODE=production`），写入一个环境文件，管理员可以修改，升级时保留：Linux 上是 `/etc/<name>/<name>.env` |
| `user` | 运行服务的用户：默认是安装时创建的、以软件包命名的系统用户（Windows 上是服务的虚拟账户） |
| `restart` | `on-failure`（默认）、`always` 或 `no` |
| `autoStart` | 随系统启动（默认 `true`） |

服务的工作目录在 Linux 上是 `/var/lib/<name>`，macOS 上是 `/usr/local/var/lib/<name>`，Windows 上是 `C:\ProgramData\<name>`。

## 5. Electron 应用

设置 `"runtime": "electron"` 后，`package installer` 交给 electron-builder 制作安装包，项目需要安装它和 `electron`。主进程会被打包（不含 Electron 本身），原生插件和资源放进 Electron 的资源目录。默认的安装包在 Linux 上是 `deb`，macOS 上是 `dmg`，Windows 上是 `nsis`（`linux.targets`、`mac.targets`、`win.targets`），`lakutata.installer.electron` 会合并到 electron-builder 的配置中（图标、签名、更新等）。Electron 应用不是服务。原生插件按安装时的样子复制（electron-builder 不会重新构建它们）：打包前请安装为 Electron 构建的版本（`electron-rebuild`，或 `prebuild-install --runtime electron`）；基于 Node-API 的插件（例如 sqlite3）在两者中都能运行。`electron-react` 和 `electron-vue` 模板就是这样配置的。

## 6. 运行时

资源在 `lakutata.resources` 中声明为 `{from, to}` 对象的列表：`from` 是项目中的文件或目录（可以在包以外，例如 `../ui/dist`），`to` 是它在资源中的路径。

```json
{
  "lakutata": {
    "resources": [{"from": "../ui/dist", "to": "ui"}]
  }
}
```

`isPackaged()` 和 `resourcesPath()`（来自 `lakutata`）告诉应用它是怎样运行的：

| 运行方式 | `isPackaged()` | `resourcesPath()` |
|---|---|---|
| 未打包（`node build/App.js`、`electron build/App.js`） | `false` | `undefined` |
| 单文件包 | `true` | 单文件包旁边的 `dist/<name>.resources` |
| 可执行文件，单文件布局 | `true` | 资源解压到的目录 |
| 可执行文件，目录布局，或已安装的应用 | `true` | 可执行文件旁边的 `resources` |
| 打包后的 Electron 应用 | `true` | Electron 资源目录中的 `main.resources` |

即使应用没有声明资源，`resourcesPath()` 也会返回路径，所以这个目录可能不存在。应用自己决定从哪里读取文件：

```typescript
import {createRequire} from 'node:module'
import path from 'node:path'
import {resourcesPath} from 'lakutata'

const resources: string | undefined = resourcesPath()
//工作区中 "ui" 包构建好的页面：打包后在资源中，否则在它的 dist 目录中
const ui: string = resources ? path.join(resources, 'ui') : path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist')
```

所有打包形式都会在应用启动前加载 `LAKUTATA_ENV_FILE` 指定的环境文件：每行是 `NAME=value` 或 `NAME="value"`，`#` 开头的是注释。文件中的值会替换已经设置的同名环境变量。
