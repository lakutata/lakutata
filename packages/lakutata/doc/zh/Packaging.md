# Lakutata 打包

编译后的应用可以不附带 `node_modules` 发布，共有三种形式：

- **单文件包**（bundle）：一个由 Node.js 运行的 JavaScript 文件；
- **可执行文件**：一个无需安装 Node.js 即可运行的程序；
- **安装包**：系统的软件包（deb、rpm、pkg、msi 等），用于安装可执行文件、将程序加入 PATH，并可将程序注册为服务（见[安装包](Installers.md)）。

`lakutata package bundle`、`package exe` 和 `package installer` 借助 `@lakutata/builder` 生成上述三种形式，项目需要安装此构建器（`npm install --save-dev @lakutata/builder`；需要打包应用的模板已包含该依赖）。

`mobile-react` 模板的手机应用采用另一种方式发布。`lakutata mobile stage` 将应用打包为单文件包，供手机应用内嵌的 Node.js 运行；应用商店所需的发布版本由手机应用的原生工程构建（见模板为项目生成的 README 中的 The packaging 一节）。

## 1. 打包的内容

- **编译后的应用**：打包的是 `tsc` 的输出（`tsc` 会生成装饰器的元数据），而不是 TypeScript 源码，因此需要先构建应用。入口取 `--entry`；未指定时取 `package.json` 的 `main`；两者都没有时取 `build/App.js`。
- **应用的依赖**：由 esbuild 打包进同一个文件，原生插件和按路径读取的文件除外（第 3 节和第 4 节）。框架的包以及基于框架的包始终会打包进单文件包，以确保框架及其类和容器都只有一份。
- **CommonJS**：单文件包是 CommonJS 文件，因此应用无法使用顶层 `await`，请改为在异步函数中 await。
- **未安装的可选依赖**（应用未使用的存储驱动）会被排除，运行时加载这类依赖会抛出异常，与不打包时相同。
- **资源**：应用运行时读取的其他文件（Web 界面构建后的页面、模板、数据）在 `package.json` 中声明（第 6 节）。

## 2. 单文件包

```bash
npm run build
npx lakutata package bundle      # dist/<name>.cjs
node dist/greet.cjs
```

```
✔ dist/greet.cjs (1.1 MB): node dist/greet.cjs
✔ dist/greet.native: the native addons (better-sqlite3) and the scripts run on their own (build/child.js), distributed with the bundle
✔ dist/greet.resources: the resources (texts), distributed with the bundle
```

文件名取 `package.json` 中第一个 `bin` 的名称，未声明时取去掉作用域的包名。需要时，单文件包旁边还会生成两个目录，二者必须与单文件包一起发布：`dist/<name>.native/`（原生插件、单独运行的脚本、按路径读取的文件）和 `dist/<name>.resources/`（资源）。与这两个目录一起移动后，单文件包可以在任何目录中运行。

| 选项 | 含义 |
|---|---|
| `--entry <file>` | 编译后的入口 |
| `--outfile <file>` | 单文件包的路径，默认 `dist/<name>.cjs` |
| `--no-minify` | 不压缩（无论是否压缩，类名都会保留） |
| `--external <modules...>` | 不打包进单文件包的模块，运行时从单文件包旁边的 `node_modules` 加载 |
| `--node <version>` | 运行单文件包的 Node.js 版本（NW.js 0.70 为 `18.10`）：单文件包采用该版本支持的语法生成；默认为运行本工具的 Node.js 版本 |

## 3. 原生插件

含有 `.node` 文件的包（better-sqlite3，以及工作区中由 [`lakutata add --native`](NativeAddons.md) 创建的插件），以及通过计算出的路径加载此类文件的包（sharp），无法打包进单文件包。这些包会被排除在外，按 `node_modules` 的结构放入 `dist/<name>.native/`，连同其在运行时加载的内容：

- 这些包的全部文件，以及插件所链接共享库的所在包（例如 sharp 的 libvips）的全部文件。其中不包括 C 和 C++ 的源码与目标文件（better-sqlite3 带有 SQLite 的源码），也不包括构建时产生的文件（`build/` 中 node-gyp 和 CMake 的文件、cargo 的 `target` 目录、静态库和导入库）；
- 这些包加载的 JavaScript；
- 应用自身的插件（`createRequire(import.meta.url)('./x.node')`）。

这些包的类型声明、source map、TypeScript 源码和文档会被排除。插件针对本机的平台和架构构建，并依赖构建时所针对的系统库，因此每个平台的应用需要在该平台上打包。

## 4. 按路径读取的文件

单文件包并不位于原先各个模块所在的位置，因此在单文件包旁边无法找到单独启动的脚本（worker、`fork()` 的子进程）或应用读取的文件（`defaults.json`、一个存放 schema 的目录）。工具会在应用的模块和应用所用包的模块中，找出由模块位置构造的路径，并将这些路径改写为指向 `dist/<name>.native/` 中的文件：

| 路径 | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | 也包括 `pathToFileURL(__filename)` |
| `path.join(import.meta.dirname, 'child.js')`、`path.resolve(__dirname, '../schema')` | 也包括使用 `path.dirname(fileURLToPath(import.meta.url))` 的写法 |
| `__dirname + '/worker.js'`、`` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')` | 扩展名按 Node.js 的方式查找 |
| `` path.join(__dirname, 'locales', `${lang}.json`) `` | 部分已知：发布与该模式匹配的所有文件 |

| 路径指向 | |
|---|---|
| 脚本（`.js`、`.cjs`） | 单独打包，连同其加载的内容 |
| 其他文件、存放数据的目录 | 复制 |
| 包含该模块的目录（`path.join(__dirname, '..')`：应用、模块所在的包） | 不发布，并发出警告：请将其中的文件声明为资源 |
| 包含脚本或包的目录（`package.json`、`node_modules`） | 不发布，并发出警告：其中的脚本在运行时需要各自的包 |
| 尚不存在的路径（应用运行时创建的目录） | 保持原样 |

```typescript
import {fork} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'

//两者都会发布：脚本单独打包，文件被复制
fork(path.join(import.meta.dirname, 'child.js'), ['one', 'two'])
const defaults: Record<string, unknown> = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'))
```

对于应用模块中以下无法跟踪的写法，工具会发出警告，并指出所在的文件和行号：路径仅在运行时才能确定的 worker（`new Worker(file)`）或相对于当前目录的 worker（`new Worker('./worker.js')`），以及应用同时又导入的脚本（该脚本会被打包两次，其模块存在两份副本）。请从模块所在的目录构造这些路径，或者将这些文件作为资源发布。

## 5. 可执行文件

```bash
npx lakutata package exe                   # dist/<name>（Windows 上是 dist/<name>.exe），使用 Node.js
npx lakutata package exe --runtime bun     # 使用 Bun
```

```
› Node.js v24.11.1 embedded
› Resources embedded, extracted at the first run: texts
› Scripts run on their own embedded, extracted at the first run: build/child.js
✔ dist/greet (darwin-arm64, 112.9 MB)
```

可执行文件只能针对制作时所在的平台生成。其他平台的可执行文件需要在相应平台上制作，因为其原生插件需要在该平台上构建。为此，可以使用 CI 的矩阵（Linux、macOS、Windows 的机器），Linux 也可以使用对应架构的容器（`docker run --platform linux/arm64`）；`cli` 模板的 README 给出了这两种做法。

| 选项 | 含义 |
|---|---|
| `--runtime node`（默认） | 将单文件包嵌入运行本工具的 Node.js（或 `--node-program` 指定的 Node.js）的副本中（Node.js 的单可执行文件应用）：在 macOS arm64 上约为 110 MB |
| `--runtime bun` | 由 Bun 编译单文件包（优先使用项目中的 `bun` 包，否则使用系统中的 `bun`）：在 macOS arm64 上约为 70 MB，启动更快；此时的运行时为 Bun |
| `--layout file`（默认） | 单个文件：原生插件、按路径读取的文件和资源都嵌入其中，启动时解压 |
| `--layout directory` | `dist/<name>/` 中包含可执行文件、`native/` 和 `resources/`，直接从该目录加载，不经解压（安装包采用的即是这种布局） |
| `--outdir <directory>` | 可执行文件的输出目录，默认 `dist` |
| `--node-program <path>` | 嵌入另一个 Node.js，而非运行本工具的 Node.js：要求 Node.js 20.12、21.7 或更高版本（例如 `$(nvm which 22)`），从而使较旧的 Node.js 也能运行该命令；单文件包采用被嵌入的 Node.js 所支持的语法生成 |
| `--entry`、`--no-minify`、`--external` | 与单文件包相同 |

- **解压**：单文件布局的可执行文件在首次运行时，将嵌入的内容解压到缓存目录中一个以内容命名的子目录，因此每个版本只解压一次。缓存目录在 macOS 上为 `~/Library/Caches/<name>`，在 Windows 上为 `%LOCALAPPDATA%\<name>\Cache`，在 Linux 上为 `$XDG_CACHE_HOME/<name>` 或 `~/.cache/<name>`，也可以通过 `LAKUTATA_NATIVE_DIR` 指定。缓存目录不可写时，可执行文件改用临时目录中的 `<name>`（指定了 `LAKUTATA_NATIVE_DIR` 时则不会改用）。
- **原生插件**：Bun 可以加载基于 Node-API 的插件，但不一定能够加载基于 Node.js V8 API 的插件。Bun 可执行文件会对这类插件发出警告，并在加载这类包（例如 better-sqlite3）时失败。在 Alpine（musl）上，Node.js 的可执行文件无法加载原生插件，因此请使用 Bun 制作可执行文件。
- **外部模块**：`--external` 指定的模块从可执行文件旁边的 `node_modules` 加载。
- **子进程**：可执行文件被启动以运行其中的某个脚本时（`fork(path.join(import.meta.dirname, 'child.js'))`），会运行该脚本并传入其参数，两种布局均是如此。用 Node.js 制作时，`require.main` 即为该脚本，与 Node.js 中的行为一致；用 Bun 制作时则不然。
- **不读取 `.env`**：可执行文件不会加载运行时所在目录中的 `.env`，请改用 `LAKUTATA_ENV_FILE`（第 6 节）。
- **图标与签名**：`package.json` 中的 `lakutata.icon`（256 像素或更大的正方形 PNG）会用作 Windows 可执行文件的图标。macOS 的可执行文件使用临时签名（ad hoc）。用 Node.js 制作的 Windows 可执行文件没有有效的签名（`node.exe` 的签名已不再匹配，设置 `lakutata.icon` 时该签名还会被移除），因此发布前请用 signtool 签名。

## 6. 运行时

资源在 `lakutata.resources` 中声明为由 `{from, to}` 对象组成的列表：`from` 是项目中的文件或目录（可以位于包以外，例如 `../ui/dist`），`to` 是该文件或目录在资源中的路径。

```json
{
  "lakutata": {
    "resources": [{"from": "../ui/dist", "to": "ui"}]
  }
}
```

`isPackaged()` 和 `resourcesPath()`（来自 `lakutata`）反映应用的运行方式：

| 运行方式 | `isPackaged()` | `resourcesPath()` |
|---|---|---|
| 未打包（`node build/App.js`、`electron .`） | `false` | `undefined` |
| 单文件包 | `true` | 单文件包旁边的 `dist/<name>.resources` |
| 可执行文件，单文件布局 | `true` | 资源的解压目录 |
| 可执行文件，目录布局，或已安装的应用 | `true` | 可执行文件旁边的 `resources` |
| 打包后的 Electron 应用 | `true` | Electron 资源目录中的 `main.resources` |
| NW.js 应用（由 `lakutata nwjs run` 运行，或已打包） | `true` | 应用目录中的 `resources` |

即使应用没有声明资源，`resourcesPath()` 也会返回路径，因此该目录可能并不存在。从何处读取文件由应用自行决定：

```typescript
import {createRequire} from 'node:module'
import path from 'node:path'
import {resourcesPath} from 'lakutata'

const resources: string | undefined = resourcesPath()
//工作区中 "ui" 包构建好的页面：打包后在资源中，否则在它的 dist 目录中
const ui: string = resources ? path.join(resources, 'ui') : path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist')
```

所有打包形式都会在应用启动前加载 `LAKUTATA_ENV_FILE` 指定的环境文件。该文件每行为 `NAME=value` 或 `NAME="value"`，以 `#` 开头的行是注释。文件中的值会替换已设置的同名环境变量。

```bash
LAKUTATA_ENV_FILE=/etc/greet.env ./greet
```
