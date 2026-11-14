# @lakutata/ffi

[English](README.md) | 中文

[Lakutata](https://github.com/lakutata/lakutata) 框架的动态库调用：在 Node.js、Electron 主进程和 Bun 中调用 `.so`、`.dylib`、`.dll` 文件中的 C 函数，无需编译任何代码。库以其头文件中的 C 声明描述（结构体、联合、枚举、typedef、函数指针、原型、`#define`），每个库都是应用的一个组件。本包基于 [koffi](https://koffi.dev/)。`lakutata` 包不重新导出本包，请从 `@lakutata/ffi` 导入。

## 安装

```shell
npm install lakutata @lakutata/ffi
```

- koffi 安装时会附带各平台的预编译文件（每个平台一个包）；npm 可能会提示 koffi 的安装脚本未运行，该脚本无需运行。
- 需要 Node.js `>=18.10.0`、Electron 主进程或 Bun。本包的 peer 依赖 `@lakutata/core` 会随 `lakutata` 一起安装。

## 用法

### 一个库

每个库都是 `NativeLibrary` 的一个子类：`@Library` 指定库的文件名（可以按平台分别指定，也可以写一个名称，由各平台的库命名方式补全）和声明，`@Native` 将一个函数绑定到一个属性，`@NativeVariable` 绑定一个变量。

```typescript
import {Application} from 'lakutata'
import {buildNativeLibraryOptions, Library, Native, NativeLibrary, NativeVariable, type Out, type Pointer} from '@lakutata/ffi'

@Library({
    names: {darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'},
    declarations: `
        typedef struct sqlite3 sqlite3;
        #define SQLITE_OK 0
        int sqlite3_close(sqlite3 *db);
    `
})
export class SQLite extends NativeLibrary {
    @Native('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
    public readonly open: (filename: string, db: Out<Pointer>) => number

    //在线程池里执行；它给出的错误信息由 sqlite3_free 释放
    @Native('int sqlite3_exec(sqlite3 *db, const char *sql, void *callback, void *context, _Out_ char **error)', {async: true, free: 'sqlite3_free'})
    public readonly exec: (db: Pointer, sql: string, callback: null, context: null, error: Out<string>) => Promise<number>

    //声明里和属性同名的函数
    @Native()
    public readonly sqlite3_close: (db: Pointer) => number

    @NativeVariable('extern const char sqlite3_version[]')
    public readonly version: string
}

Application
    .run(() => ({
        id: 'store.app',
        name: 'Store',
        components: {
            sqlite: buildNativeLibraryOptions(SQLite)
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const sqlite: SQLite = await app.getObject('sqlite')
        const db: Out<Pointer> = [null]
        if (sqlite.open(':memory:', db) !== Number(sqlite.constants.SQLITE_OK)) throw new Error('open failed')
        const error: Out<string> = [null]
        if (await sqlite.exec(db[0]!, 'CREATE TABLE t (id INTEGER)', null, null, error)) console.error(error[0])
        sqlite.sqlite3_close(db[0]!)
        console.log(sqlite.version)
    })
```

- **库的查找位置**：配置中的 `path`（指定后只尝试该路径），配置和 `@Library` 中 `search` 指定的目录，打包后应用资源目录下的 `native` 目录，最后是系统查找库的位置。`c` 表示各系统上的 C 标准库（包括 musl），`m` 表示其中的数学函数。
- **值的对应关系**：数字对应 number；`char *` 对应字符串；指针和所有 64 位整数（`size_t`、`long`、`int64_t` 等）对应 bigint，声明时加上 `{int64: 'number'}` 则改为 number；结构体和联合对应对象，位域按名称读写；`_Out_` 的整数或指针以只含一个元素的数组传入（`Out<T>`）。
- **回调**：为函数指针参数传入的 JS 函数只在本次调用期间有效；`callback(type, fn)` 生成一个可由库保存并在以后调用的回调，该回调抛出的异常会成为组件的 `error` 事件。
- **线程**：异步函数默认在运行时的线程池中执行；在 `@Library`（或配置）中设置 `threads` 后，改为在库自身的线程中执行。`threads: 1` 时，异步调用依次执行，适用于非线程安全的库；有多个线程时，每个调用交给最空闲的线程。在这些线程中，可变参数的函数也可以异步调用。
- **销毁**：库随应用一起销毁时，其属性开始抛出异常；销毁过程会等待进行中的异步调用结束，释放全部回调，并卸载库。原生调用无法中途打断，因此超过 `drainTimeout` 后仍有调用未结束时，库及其回调和内存都保留下来。

### 不用容器

```typescript
import {loadNativeLibrary, type NativeLibraryHandle} from '@lakutata/ffi'

const libc: NativeLibraryHandle = loadNativeLibrary('c', 'typedef struct { int quot; int rem; } div_t;')
const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
console.log(div(17, 5))
//可变参数函数的额外参数，前面用 C 类型名写出类型
const buffer: Buffer = Buffer.alloc(32)
snprintf(buffer, buffer.length, '%s=%d', 'const char *', 'count', 'int', 42)
await libc.close()
```

### 根据头文件生成类

对于函数较多的库，可以使用 Lakutata 的命令行工具（`@lakutata/cli`）或 `@lakutata/ffi/generator` 的 `generateNativeLibrary()` 根据头文件生成类：

```shell
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
```

头文件先经过 C 编译器的预处理器处理，然后保留库自身的声明，库无法提供的函数会被去掉并列出。之后请在生成的文件中将输出参数标记为 `_Out_`，将会阻塞的函数声明为 `{async: true}`（做法见指南），因为无法从头文件中看出哪些是输出参数、哪些是阻塞的函数。

### 打包

`lakutata package` 生成的 bundle、可执行文件和 Electron 安装包都会包含 koffi 和本平台的预编译文件。随应用一同发布的库放在资源中的 `native` 目录下（在 package.json 中写入 `"lakutata": {"resources": [{"from": "vendor/lib", "to": "native"}]}`）。在 Alpine 上，请使用 Bun 构建可执行文件（`--runtime bun`）。

## API

| 导出 | 说明 |
|---|---|
| `NativeLibrary` | 库的组件：函数和变量位于其属性上；`func`、`variable`、`callback`、`read`、`write`、`sizeOf`、`offsetOf`、`alloc`、`free`、`errno`、`windowsError`、`constants`、`file`、`pending`、`threadCount`；回调异常的 `error` 事件 |
| `buildNativeLibraryOptions`、`NativeLibraryConfig` | 在 `components` 中注册库，以及库的选项：`path`、`search`、`keepLoaded`、`drainTimeout`、`threads` |
| `Library`、`LibraryOptions` | 类装饰器，指定 `NativeLibrary` 子类的库：`names`、`search`、`declarations`、`crt`、`threads` |
| `Native` | 属性装饰器，指定一个函数（原型、声明中的名称或属性名）及其选项：`async`、`free`、`int64` |
| `NativeVariable` | 属性装饰器：库导出的一个变量 |
| `loadNativeLibrary`、`NativeLibraryHandle`、`NativeLibraryOptions` | 不使用容器时的库：`func`、`function`、`variable`、`callback`、`declare`、`read`、`write`、`sizeOf`、`offsetOf`、`alloc`、`free`、`errno`、`windowsError`、`threads`、`ready`、`drain`、`close` |
| `NativeFunctionOptions`、`NativeVariableAccessor`、`NativeCallback`、`LibraryNames`、`Pointer`、`Out` | 函数的选项、变量、持久回调（`pointer`、`release()`）、库的文件名、指针（bigint）、输出参数 |
| `readCString`、`readWString`、`readBuffer`、`viewBuffer`、`readValue`、`readArray`、`writeValue`、`allocMemory`、`freeMemory`、`sizeOf` | 用内置类型读写原生内存（`viewBuffer` 不复制内存，在 Electron 中无法使用） |
| `lastErrno`、`lastWindowsError` | 上一次调用后的 errno（Windows 上为指定的 C 运行库的 errno），以及 Windows API 的错误 |
| `generateNativeLibrary`、`defaultCompiler`（`@lakutata/ffi/generator`） | 根据头文件生成库的类（类的代码、声明，以及被去掉的内容），以及默认运行的 C 编译器 |

类型声明中附有每个导出的说明和示例。

## 错误

| 错误 | 抛出时机 |
|---|---|
| `NativeDeclarationException` | 声明或原型无法读取（附带行号和列号：类型未声明、`#if`、带参数的宏、`long double` 等）、库中没有该函数、传入了 `va_list`、类上没有 `@Library` |
| `NativeLibraryNotFoundException` | 库无法加载，消息中列出尝试过的每个文件及其原因 |
| `NativeLibraryClosedException` | 库关闭后仍使用其函数、变量或回调；库关闭时，其线程中尚未结束的调用 |
| `NativeMemoryException` | 向内存函数传入空指针或负的长度，或在 Electron 中使用 `viewBuffer` |
| `TypeError`（来自 koffi） | 参数类型错误 |
| `RangeError` | 声明了 `{int64: 'number'}` 的函数遇到超出安全整数范围的 64 位整数 |

如果 C 函数的原型有误，或者传入了错误的指针，整个进程都会退出，任何异常处理都无法拦截。

## 另见

- 网站上的指南：[FFI](https://lakutata.com/zh/guide/FFI)。
- `lakutata` 包中的 `doc/zh/FFI.md`（英文版在 `doc/en`）：动态库调用指南。
- `lakutata` 包中的 `doc/zh/NativeAddons.md`：以 C++ 或 Rust 编写的原生插件，用于 C 函数库无法实现的场景。
- [koffi](https://koffi.dev/)：本包所基于的 FFI。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
