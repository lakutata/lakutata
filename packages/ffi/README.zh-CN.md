# @lakutata/ffi

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的动态库调用：在 Node.js、Electron 的主进程和 Bun 里调用 `.so`、`.dylib`、`.dll` 文件中的 C 函数，不需要编译任何东西。库用它头文件里的 C 声明来描述（结构体、联合、枚举、typedef、函数指针、原型、`#define`），每个库都是应用的一个组件。它基于 [koffi](https://koffi.dev/)。`lakutata` 包不重新导出这个包：请从 `@lakutata/ffi` 导入。

## 安装

```shell
npm install lakutata @lakutata/ffi
```

- koffi 会连同各平台的预编译文件一起安装（每个平台一个包）；npm 可能会提示它的安装脚本没有运行：不需要运行它。
- 需要 Node.js `^22.13.0 || >=24.11.0`、Electron 的主进程或 Bun。它的 peer 依赖 `@lakutata/core` 会随 `lakutata` 一起安装。

## 用法

### 一个库

一个库就是 `NativeLibrary` 的一个子类：`@Library` 给出它的文件名（可以按平台分别写，也可以写一个名字，按各平台给库命名的方式补全）和它的声明，`@Native` 把一个函数绑到一个属性上，`@NativeVariable` 绑定一个变量。

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

- **到哪里找库**：配置里的 `path`（给了就只试它），配置和 `@Library` 里 `search` 的目录，打包后应用的资源目录下的 `native` 目录，最后是系统找库的位置。`c` 表示各系统上的 C 标准库（包括 musl），`m` 表示它的数学函数。
- **值的对应关系**：数字对应 number；`char *` 对应字符串；指针和所有 64 位整数（`size_t`、`long`、`int64_t` 等）对应 bigint，声明时加上 `{int64: 'number'}` 就改为 number；结构体和联合对应对象，位域按名字读写；`_Out_` 的整数或指针用只有一个元素的数组传入（`Out<T>`）。
- **回调**：给函数指针参数传入的 JS 函数只在这次调用期间有效；`callback(type, fn)` 生成一个库可以保存起来以后再调用的回调，它抛出的异常会成为组件的 `error` 事件。
- **销毁**：随应用一起销毁时，属性开始抛出异常，会等进行中的异步调用结束，回调全部释放，库被卸载。

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

### 打包

`lakutata package` 打出的 bundle、可执行文件和 Electron 安装包都会带上 koffi 和本平台的预编译文件。要和应用一起发布的库放进资源里的 `native` 目录（在 package.json 里写 `"lakutata": {"resources": [{"from": "vendor/lib", "to": "native"}]}`）。在 Alpine 上请用 Bun 打可执行文件（`--runtime bun`）。

## API

| 导出 | 是什么 |
|---|---|
| `NativeLibrary` | 库的组件：函数和变量在它的属性上；`func`、`variable`、`callback`、`read`、`write`、`sizeOf`、`offsetOf`、`alloc`、`free`、`errno`、`constants`、`file`、`pending`；回调异常的 `error` 事件 |
| `buildNativeLibraryOptions`、`NativeLibraryConfig` | 在 `components` 里注册它，以及它的选项：`path`、`search`、`keepLoaded`、`drainTimeout` |
| `Library`、`LibraryOptions` | 类装饰器：`NativeLibrary` 子类的库：`names`、`search`、`declarations`、`crt` |
| `Native` | 属性装饰器：一个函数（原型、声明里的名字，或者属性名）及其选项：`async`、`free`、`int64` |
| `NativeVariable` | 属性装饰器：库导出的一个变量 |
| `loadNativeLibrary`、`NativeLibraryHandle`、`NativeLibraryOptions` | 不用容器时的库：`func`、`function`、`variable`、`callback`、`declare`、`read`、`write`、`sizeOf`、`offsetOf`、`alloc`、`free`、`errno`、`drain`、`close` |
| `NativeFunctionOptions`、`NativeVariableAccessor`、`NativeCallback`、`LibraryNames`、`Pointer`、`Out` | 函数的选项、变量、持久回调（`pointer`、`release()`）、库的文件名、指针（bigint）、输出参数 |
| `readCString`、`readWString`、`readBuffer`、`viewBuffer`、`readValue`、`readArray`、`writeValue`、`allocMemory`、`freeMemory`、`sizeOf` | 用内置类型读写原生内存（`viewBuffer` 不复制；Electron 里不能用） |
| `lastErrno`、`lastWindowsError` | 上一次调用后的 errno（Windows 上是指定的 C 运行库的 errno），以及 Windows API 的错误 |

类型声明里有每个导出的说明和示例。

## 错误

| 错误 | 什么时候 |
|---|---|
| `NativeDeclarationException` | 声明或原型读不了（带行号和列号：类型没有声明、`#if`、带参数的宏、`long double` 等）、库里没有这个函数、传了 `va_list`、类上没有 `@Library` |
| `NativeLibraryNotFoundException` | 库加载不了：消息里列出试过的每个文件和原因 |
| `NativeLibraryClosedException` | 库关闭后又使用它的函数、变量或回调 |
| `NativeMemoryException` | 给内存函数传了空指针或负的长度、在 Electron 里用 `viewBuffer` |
| `TypeError`（来自 koffi） | 参数类型不对 |
| `RangeError` | 声明了 `{int64: 'number'}` 的函数遇到超出安全整数范围的 64 位整数 |

C 函数的原型写错，或者传了错误的指针，整个进程都会退出，任何异常处理都拦不住。

## 另见

- 网站上的指南：[FFI](https://lakutata.com/zh/guide/FFI)。
- `lakutata` 包里的 `doc/zh/FFI.md`（英文版在 `doc/en`）：动态库调用指南。
- `lakutata` 包里的 `doc/zh/NativeAddons.md`：用 C++ 或 Rust 编写的原生插件，用于 C 函数库做不到的情况。
- [koffi](https://koffi.dev/)：这个包所基于的 FFI。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
