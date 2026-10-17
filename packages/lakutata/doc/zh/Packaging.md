# Lakutata 打包

编译好的应用可以不带 `node_modules` 发布，有三种形式：

- **单文件包**（bundle）：一个由 Node.js 运行的 JavaScript 文件；
- **可执行文件**：一个程序，不需要安装 Node.js 就能运行；
- **安装包**：系统的软件包（deb、rpm、pkg、msi 等），它安装可执行文件，把程序加入 PATH，还可以把它注册为服务（见 [Installers](Installers.md)）。

`lakutata package bundle`、`package exe` 和 `package installer` 借助 `@lakutata/builder` 生成它们，项目需要安装它（`npm install --save-dev @lakutata/builder`；需要打包的模板已经带上了）。

## 1. 打包的内容

- **编译后的应用**：打包的是 `tsc` 的输出（`tsc` 会生成装饰器的元数据），而不是 TypeScript 源码，所以要先构建。入口依次是 `--entry`、`package.json` 的 `main`、`build/App.js`。
- **应用的依赖**：由 esbuild 打进一个文件，原生插件和按路径读取的文件除外（第 3 节和第 4 节）。框架的包以及基于框架的包总是打进包里，这样框架、它的类和它的容器都只有一份。
- **CommonJS**：单文件包是 CommonJS 文件，所以应用不能使用顶层 `await`，请在异步函数里 await。
- **未安装的可选依赖**（应用没有用到的存储驱动）会被排除：运行时加载它会抛出异常，和不打包时一样。
- **资源**：应用运行时读取的其他文件（Web 界面构建好的页面、模板、数据）在 `package.json` 中声明（第 6 节）。

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

文件名取 `package.json` 中第一个 `bin` 的名称，没有时取去掉作用域的包名。需要时，单文件包旁边还会生成两个目录，必须和它一起发布：`dist/<name>.native/`（原生插件、单独运行的脚本、按路径读取的文件）和 `dist/<name>.resources/`（资源）。和这两个目录一起移动后，单文件包可以在任何目录中运行。

| 选项 | 含义 |
|---|---|
| `--entry <file>` | 编译后的入口 |
| `--outfile <file>` | 单文件包的路径，默认 `dist/<name>.cjs` |
| `--no-minify` | 不压缩（无论是否压缩，类名都会保留） |
| `--external <modules...>` | 不打进包里的模块，运行时从单文件包旁边的 `node_modules` 加载 |

## 3. 原生插件

含有 `.node` 文件的包（better-sqlite3，以及工作区中由 [`lakutata add --native`](NativeAddons.md) 创建的插件），以及通过计算出的路径加载它们的包（sharp），不能打进单文件包。它们被排除在外，按 `node_modules` 的结构放在 `dist/<name>.native/` 中，连同它们在运行时加载的内容：

- 它们的全部文件，以及插件所链接的共享库所在的包（例如 sharp 的 libvips）的全部文件，但不包括 C 和 C++ 源码和目标文件（better-sqlite3 带有 SQLite 的源码），也不包括构建它们时产生的文件（`build/` 中 node-gyp 和 CMake 的文件、cargo 的 `target` 目录、静态库和导入库）；
- 它们加载的 JavaScript；
- 应用自己的插件（`createRequire(import.meta.url)('./x.node')`）。

这些包的类型声明、source map、TypeScript 源码和文档会被排除。插件是为本机的平台和架构构建的，需要它构建时所针对的系统库，所以每个平台的应用要在那个平台上打包。

## 4. 按路径读取的文件

单文件包并不在原来各个模块所在的位置：单独启动的脚本（worker、`fork()` 的子进程）或者应用读取的文件（`defaults.json`、一个存放 schema 的目录）在单文件包旁边找不到。工具会在应用的模块和它所用包的模块中，找出由模块位置构造的路径，并把它们改写为指向 `dist/<name>.native/` 中的文件：

| 路径 | |
|---|---|
| `new URL('./worker.js', import.meta.url)` | 也包括 `pathToFileURL(__filename)` |
| `path.join(import.meta.dirname, 'child.js')`、`path.resolve(__dirname, '../schema')` | 也包括用 `path.dirname(fileURLToPath(import.meta.url))` 的写法 |
| `__dirname + '/worker.js'`、`` `${__dirname}/worker.js` `` | |
| `require.resolve('./worker')` | 扩展名按 Node.js 的方式查找 |
| `` path.join(__dirname, 'locales', `${lang}.json`) `` | 部分已知：发布所有与这个模式匹配的文件 |

| 路径指向 | |
|---|---|
| 脚本（`.js`、`.cjs`） | 单独打包，连同它加载的内容 |
| 其他文件、存放数据的目录 | 复制 |
| 包含该模块的目录（`path.join(__dirname, '..')`：应用、它所在的包） | 不发布，并发出警告：请把其中的文件声明为资源 |
| 包含脚本或包的目录（`package.json`、`node_modules`） | 不发布，并发出警告：其中的脚本运行时需要它们的包 |
| 还不存在的路径（应用运行时创建的目录） | 保持原样 |

```typescript
import {fork} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'

//两者都会发布：脚本单独打包，文件被复制
fork(path.join(import.meta.dirname, 'child.js'), ['one', 'two'])
const defaults: Record<string, unknown> = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'))
```

对于应用模块中无法跟踪的写法，工具会给出警告并指出文件和行号：路径只在运行时才知道的 worker（`new Worker(file)`），或者相对于当前目录的 worker（`new Worker('./worker.js')`），以及应用同时又导入了的脚本（它会被打包两次，模块有两份副本）。请从模块所在的目录构造这些路径，或者把这些文件作为资源发布。

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

可执行文件只能为生成它的平台制作。其他平台的可执行文件要在那些平台上制作，因为它们的原生插件要在那里构建：可以用 CI 的矩阵（Linux、macOS、Windows 的机器），Linux 也可以用对应架构的容器（`docker run --platform linux/arm64`）；`cli` 模板的 README 给出了这两种做法。

| 选项 | 含义 |
|---|---|
| `--runtime node`（默认） | 把单文件包嵌入运行工具的那个 Node.js 的副本中（Node.js 的单可执行文件应用）：在 macOS arm64 上约 110 MB |
| `--runtime bun` | 由 Bun 编译单文件包（优先用项目中的 `bun` 包，否则用系统的 `bun`）：在 macOS arm64 上约 70 MB，启动更快；运行时也就是 Bun |
| `--layout file`（默认） | 单个文件：原生插件、按路径读取的文件和资源都嵌入其中，启动时解压 |
| `--layout directory` | `dist/<name>/` 中包含可执行文件、`native/` 和 `resources/`，直接从那里加载，不解压（安装包用的就是这种布局） |
| `--outdir <directory>` | 可执行文件的输出目录，默认 `dist` |
| `--entry`、`--no-minify`、`--external` | 与单文件包相同 |

- **解压**：单文件布局的可执行文件在第一次运行时，把嵌入的内容解压到缓存目录中一个以内容命名的子目录，所以每个版本只解压一次：macOS 上是 `~/Library/Caches/<name>`，Windows 上是 `%LOCALAPPDATA%\<name>\Cache`，Linux 上是 `$XDG_CACHE_HOME/<name>` 或 `~/.cache/<name>`，也可以用 `LAKUTATA_NATIVE_DIR` 指定目录。缓存目录不可写时，改用临时目录中的 `<name>`（指定了 `LAKUTATA_NATIVE_DIR` 时不会这样）。
- **原生插件**：Bun 能加载基于 Node-API 的插件，但不一定能加载基于 Node.js V8 API 的插件：Bun 可执行文件会对这类插件发出警告，并在加载这样的包时失败（例如 better-sqlite3）。在 Alpine（musl）上，Node.js 的可执行文件不能加载原生插件，请用 Bun 制作。
- **外部模块**：`--external` 指定的模块从可执行文件旁边的 `node_modules` 加载。
- **子进程**：可执行文件被启动来运行它的某个脚本时（`fork(path.join(import.meta.dirname, 'child.js'))`），会运行这个脚本并传入它的参数，两种布局都是如此。用 Node.js 制作时，`require.main` 就是这个脚本，和 Node.js 一样；用 Bun 制作时则不是。
- **不读取 `.env`**：可执行文件不会加载所在目录的 `.env`，请使用 `LAKUTATA_ENV_FILE`（第 6 节）。
- **图标与签名**：`package.json` 中的 `lakutata.icon`（256 像素或更大的正方形 PNG）会成为 Windows 可执行文件的图标。macOS 的可执行文件使用临时签名（ad hoc）。用 Node.js 制作的 Windows 可执行文件保留着 `node.exe` 的签名，而这个签名已经不再匹配：发布前请用 signtool 重新签名。

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

```bash
LAKUTATA_ENV_FILE=/etc/greet.env ./greet
```
