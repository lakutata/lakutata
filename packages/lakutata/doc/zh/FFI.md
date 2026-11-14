# Lakutata FFI

`@lakutata/ffi` 包使 Node.js、Electron 主进程和 Bun 能够调用动态库（`.so`、`.dylib`、`.dll`）中的 C 函数，例如系统 API、设备厂商的 SDK 和现有的 C 库。使用时无需编译，也无需编写扩展；只需以库头文件中的 C 声明描述库，每个库都是应用的一个组件。本包基于 [koffi](https://koffi.dev/) 实现，不属于 `lakutata`，需要单独安装：

```bash
npm install lakutata @lakutata/ffi
```

koffi 安装时会附带各平台的预编译文件（每个平台一个包）。npm 可能会提示 koffi 的安装脚本未运行，该脚本无需运行。

如果 C 函数的原型有误，或者向函数传入了不应传入的指针，整个进程都会退出，任何异常处理都无法拦截。请从库的头文件中复制声明，并测试这些声明。

## 1. 一个库

每个库都是 `NativeLibrary` 的一个子类：`@Library` 指定库的文件名和 C 声明，`@Native` 将一个函数绑定到一个属性，`@NativeVariable` 绑定一个变量。每个属性的 TypeScript 类型即为函数的类型。

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildNativeLibraryOptions, Library, Native, NativeLibrary, NativeVariable, type Out, type Pointer, readArray} from '@lakutata/ffi'

type RowCallback = (context: Pointer | null, count: number, values: Pointer, names: Pointer) => number

@Library({
    names: {darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'},
    declarations: `
        typedef struct sqlite3 sqlite3;
        typedef int (*sqlite3_callback)(void *context, int count, char **values, char **names);
        #define SQLITE_OK 0
        int sqlite3_close(sqlite3 *db);
    `
})
export class SQLite extends NativeLibrary {
    @Native('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
    public readonly open: (filename: string, db: Out<Pointer>) => number

    //在线程池里执行；它给出的错误信息由 sqlite3_free 释放
    @Native('int sqlite3_exec(sqlite3 *db, const char *sql, sqlite3_callback callback, void *context, _Out_ char **error)', {async: true, free: 'sqlite3_free'})
    public readonly exec: (db: Pointer, sql: string, callback: RowCallback | null, context: null, error: Out<string>) => Promise<number>

    //声明里和属性同名的函数
    @Native()
    public readonly sqlite3_close: (db: Pointer) => number

    @NativeVariable('extern const char sqlite3_version[]')
    public readonly version: string
}

class Store extends Component {
    @Inject('sqlite')
    protected readonly sqlite: SQLite

    public async tables(): Promise<string[]> {
        const db: Out<Pointer> = [null]
        if (this.sqlite.open(':memory:', db) !== Number(this.sqlite.constants.SQLITE_OK)) throw new Error('open failed')
        const names: string[] = []
        const error: Out<string> = [null]
        await this.sqlite.exec(db[0]!, 'SELECT name FROM sqlite_master', (context: Pointer | null, count: number, values: Pointer): number => {
            names.push(...readArray(values, 'char *', count) as string[])
            return 0
        }, null, error)
        this.sqlite.sqlite3_close(db[0]!)
        return names
    }
}

Application.run(() => ({
    id: 'store.app',
    name: 'Store',
    components: {
        sqlite: buildNativeLibraryOptions(SQLite),
        store: {class: Store}
    }
}))
```

- **文件名**：可以是一个名称（`sqlite3` 会按各平台的库命名方式补全为 `libsqlite3.dylib`、`libsqlite3.so` 或 `sqlite3.dll`），可以是一个文件，也可以按平台分别指定（键为 `process.platform` 的值，`default` 用于其他平台）。`c` 表示 C 标准库，`m` 表示其中的数学函数，包会在各系统提供这些函数的位置查找：macOS 的 `libSystem`、glibc 的 `libc.so.6`、Alpine 上 musl 的动态加载器、Windows 的 `ucrtbase.dll`。
- **声明**按头文件的写法编写，可以直接从头文件中复制。支持的写法包括：typedef、结构体和联合（可以后定义、可以引用自身、可以包含匿名成员）、枚举（值可以是常量表达式）、函数指针、原型、变量、不带参数的 `#define`（空宏在使用处会被移除，例如导出函数的标记；值为整数的宏同时也是常量）、`#pragma pack`，以及 `packed` 和 `aligned` 属性。其他属性、inline 函数的函数体和 `extern "C"` 块会被跳过。每个库的声明相互独立，因此两个库可以各自声明 `HANDLE`。
- **不支持的写法**如下，遇到时会报错并给出行号和列号：`#if` 一类的条件编译（请先使用预处理器展开头文件，例如 `cc -E`、`cl /P`）、带参数的宏、`long double`、`__int128`，以及旧式声明。`stdint.h`、POSIX（`time_t`、`pid_t` 等）、BSD（`u_int` 等）和 Windows API（`DWORD`、`HANDLE`、`LPCWSTR` 等）中的类型无需声明即可使用，其大小与各平台的实际情况一致。
- **`@Native`** 的参数可以是原型、声明中某个函数的名称，也可以省略（此时使用与属性同名的函数）。组件创建时，属性即获得该函数。无需任何转换时，该函数就是 koffi 的函数本身，调用开销与直接使用 koffi 相同（约 20 ns）。
- **`@NativeVariable`** 的参数可以是声明或名称，也可以省略。读取属性即读取变量，写入属性即写入变量（`const` 变量拒绝写入）。长度未知的 `char` 数组按字符串读取。
- 子类会继承父类的库，并可以添加更多函数。
- 对于函数较多的库，可以根据其头文件生成类（第 9 节）。

## 2. 到哪里找库

组件创建时，按以下顺序查找库：

1. 配置中指定了 `path` 时，只尝试该文件；
2. 配置中 `search` 指定的目录，然后是 `@Library` 中的目录；
3. 在打包后的应用中，资源目录下的 `native` 目录；
4. 系统查找库的位置（`dlopen`、`LoadLibrary`）。

```typescript
import {Application} from 'lakutata'
import {buildNativeLibraryOptions, Library, Native, NativeLibrary} from '@lakutata/ffi'

@Library({names: {darwin: 'libvendor.dylib', linux: 'libvendor.so.2', win32: 'vendor.dll'}})
class Vendor extends NativeLibrary {
    @Native('int vendor_version(void)')
    public readonly version: () => number
}

Application.run(() => ({
    id: 'devices.app',
    name: 'Devices',
    components: {
        vendor: buildNativeLibraryOptions(Vendor, {search: ['./native']})
    }
}))
```

无法加载时，`NativeLibraryNotFoundException` 会列出尝试过的每个文件及其未能加载的原因（未找到、为其他架构编译、缺少所依赖的库）。在 Linux 上，系统自带的库往往只安装了带版本号的文件（`libsqlite3.so.0`），此时请指定该名称。

如需将库与打包后的应用一起发布，请将库放入 package.json 的资源中，并置于 `native` 目录下：

```json
{
  "lakutata": {
    "resources": [{"from": "vendor/lib", "to": "native"}]
  }
}
```

`lakutata package` 生成的 bundle、可执行文件（Node.js 和 Bun）以及 Electron 安装包都会包含该库，以及 koffi 和本平台的预编译文件。在 Alpine 上，请使用 Bun 构建可执行文件（`--runtime bun`），因为 Node.js 的可执行文件在 musl 上无法加载原生插件。在 Node.js 权限模型下运行时，需要添加 `--allow-addons`。

## 3. 调用函数

| C | JavaScript |
|---|---|
| 整数、`float`、`double`、`bool`、枚举 | number、boolean |
| 64 位整数（`int64_t`、`long long`、`size_t`、`long`、`time_t` 等） | bigint（作为参数时也接受 number） |
| `const char *`、`char *` | 字符串（也接受 `Buffer`，函数会直接写入其中）；`char16_t *`、`wchar_t *` 同样如此 |
| 其他指针 | bigint（`Pointer`），空指针为 `null`；也可以传入 `Buffer` 或类型化数组 |
| 结构体、联合 | 对象 |
| 函数指针 | 函数（见第 5 节） |

- **64 位整数**在所有位置都是 bigint，包括返回值、输出参数、结构体成员和回调参数。`long` 在 Linux 和 macOS 上为 64 位，在 Windows 上为 32 位，但在所有平台上都是 bigint。声明函数时添加 `{int64: 'number'}`，则改为使用 number；值超出安全整数范围时抛出 `RangeError`。
- **输出参数**：标记为 `_Out_`（或 `_Inout_`）的参数由函数写入。整数和指针以只含一个元素的数组传入（`Out<T>`，调用前为 `[null]`）；结构体以对象传入，函数返回后，对象的成员会被填充。未标记的指针只将值传给函数，通过该指针传入的结构体在调用后不会被读回。
- **传给函数的缓冲区**只在本次调用期间有效。库需要保存以供后续使用的内存，必须使用 `alloc()` 分配（第 6 节）。
- **可变参数函数**（`printf`、`curl_easy_setopt`）的每个额外参数之前，都必须以 C 类型名写明该参数的类型：

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
const buffer: Buffer = Buffer.alloc(64)
snprintf(buffer, buffer.length, '%s: %d', 'const char *', 'count', 'int', 42)
```

- **需要释放的字符串**：如果函数返回（或通过输出参数提供）一个须由调用方释放的字符串，声明时请添加 `{free: 'sqlite3_free'}`，指定库中负责释放的函数；或者添加 `{free: true}`，使用 C 标准库的 `free()`。字符串读取后即被释放。在 Windows 上，如果库是用另一套 C 运行库编译的，须指定该库自身的释放函数（`{free: '…'}`）。
- **异步调用**：声明时添加了 `{async: true}` 的函数在另一个线程中执行，并返回一个 Promise；调用期间，事件循环仍然正常运行。默认使用运行时的线程池。Node.js 使用 libuv 线程池，默认只有 4 个线程，并且与文件系统、DNS 和加解密共用；调用较多或耗时较长时，请调大 `UV_THREADPOOL_SIZE`。在线程池中，可变参数函数无法异步调用。库也可以改用自身的线程（第 10 节）。

## 4. 结构体、联合、枚举和常量

结构体是由其成员组成的对象。嵌套的结构体同样是对象；`char` 数组是字符串，数字数组是类型化数组（`Uint8Array`、`Int32Array` 等），64 位整数数组是由 bigint 组成的数组。结构体中的匿名结构体或匿名联合为成员 `_0`（之后依次为 `_1` 等）。

- **位域**与其他成员一样按名称读写，包会按平台编译器的规则排布位域（GCC 和 Clang 的规则、ARM 的规则、微软的规则）。64 位类型的位域是 bigint。
- **紧凑结构体**（`#pragma pack`、`packed` 属性）和 `aligned` 属性（1、2、4 或 8 字节）均按编译器的方式排布。
- **联合**以只设置了其中一个成员的对象传入（`{i: 42}`）。
- **枚举**是整数；声明中的枚举值、`static const` 常量以及值为整数的宏都位于 `constants` 中，类型为 bigint（`Number(sqlite.constants.SQLITE_OK)`）。

库的结构体和内存需要使用库自身的类型读取：`read(pointer, 'struct timeval')`、`sizeOf('struct timeval')`、`offsetOf('struct timeval', 'tv_usec')`。

## 5. 回调

参数类型为函数指针时，可以直接传入一个 JS 函数，即**临时回调**，它只在本次调用期间有效（`qsort`、`sqlite3_exec`）。临时回调抛出异常时，函数会收到 0（或空指针），该异常则在本次调用返回后抛出。

如果库需要保存回调以便之后调用（日志处理函数、事件处理函数），请为其提供一个**持久回调**：

```typescript
import {Library, Native, NativeLibrary, type NativeCallback} from '@lakutata/ffi'

@Library({
    names: 'vendor',
    declarations: 'typedef void (*vendor_log)(int level, const char *message);'
})
export class Vendor extends NativeLibrary {
    @Native('void vendor_set_logger(vendor_log logger)')
    public readonly setLogger: (logger: bigint | null) => void

    #logger?: NativeCallback

    public listen(): void {
        this.#logger = this.callback('vendor_log', (level: number, message: string): void => console.log(level, message))
        this.setLogger(this.#logger.pointer)
        this.on('error', (error: unknown): void => console.error('the logger threw', error))
    }

    public stop(): void {
        this.setLogger(null)
        this.#logger?.release()
    }
}
```

- `callback(type, fn)` 的第一个参数是声明中某个函数指针类型的名称，或者一个原型。请将返回的回调的 `pointer` 交给库；库不再调用该回调时，调用 `release()` 释放。组件销毁时，其所有回调都会被释放。一个进程同时最多可以有 8192 个持久回调。
- 库从其他线程调用持久回调时，回调会在事件循环处理到它时在 JS 线程中执行。如果某个函数会等待某个线程发起回调，就必须将该函数声明为异步，因为同步调用时，JS 线程在等待那个线程，而那个线程又在等待 JS 线程。
- 持久回调抛出的异常会成为组件的 `error` 事件（无人监听时写入应用日志），库收到的结果为 0（或空指针）。

## 6. 内存

| 函数 | 提供的内容 |
|---|---|
| `alloc(type, count)`、`free(pointer)` | 为库的某个类型分配内存，地址固定不变，库可以保存该地址；未释放的内存会在组件销毁时释放 |
| `read(pointer, type, count?)`、`write(pointer, type, value)` | 按库的类型读写一个值（或一个数组） |
| `readCString(pointer)`、`readWString(pointer)` | 读取以指针形式提供的字符串（`void *` 返回值、结构体成员、回调参数） |
| `readBuffer(pointer, length)` | 一份副本，原生内存释放后仍可使用（约 10 GB/s） |
| `viewBuffer(pointer, length)` | 原生内存本身，不复制 |
| `readValue`、`readArray`、`writeValue`、`allocMemory`、`freeMemory`、`sizeOf` | 内置类型（`int`、`uint64_t`、`char *` 等）的对应操作，无需库 |

数据在 64 KiB 以下时，复制与不复制同样快；只有数据块很大且读取频繁时，才值得使用视图（8 MiB 时约 0.13 ms，而复制约需 1 ms）。原生内存释放后，绝不能再使用视图，否则进程会崩溃。Electron 不允许创建原生内存的视图，因此在 Electron 中调用 `viewBuffer` 会抛出 `NativeMemoryException`。

## 7. C 函数的错误

`lastErrno()`（或组件的 `errno()`）返回本线程上一次调用之后的 `errno`（库拥有自身的线程时，见第 10 节）。在 Windows 上，每个 C 运行库各有一份 `errno`：默认读取微软 C 运行库（`ucrtbase.dll`）中的值，其他运行库通过 `@Library` 的 `crt` 指定（旧的库使用 `msvcrt.dll`）。`lastWindowsError()` 返回 Windows API 的错误（`GetLastError`），该值在每次调用之后都会被保存。

```typescript
import {lastErrno, loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const open = libc.func<(path: string, flags: number) => number>('int open(const char *path, int flags, ...)')
if (open('/missing', 0) < 0) console.log('errno', lastErrno())
```

## 8. 不用容器

脚本和测试可以使用 `loadNativeLibrary(names, declarations, options)` 加载库。其声明、规则和方法都与组件相同（`func`、`function`、`variable`、`callback`、`read` 等），此外还提供 `close()`。

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c', 'typedef struct { int quot; int rem; } div_t;')
const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
console.log(div(17, 5))
await libc.close()
```

## 9. 根据头文件生成类

对于函数较多的库，可以使用 `lakutata ffi generate` 根据其头文件生成类。生成的类包含：库的声明、每个函数对应的一个带 TypeScript 类型的属性、每个结构体和联合对应的一个接口，以及作为常量的整数宏。

```bash
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
lakutata ffi generate sdk/include/vendor.h --library sdk/lib/vendor.dll --out src/native/Vendor.ts
```

- **头文件**先经过 C 编译器的预处理器（`cc -E`、`cl /P`）处理，`#include`、`#if` 和宏按在当前平台上编译时的方式展开（编译所用的头文件目录和宏通过 `--include`、`--define` 指定）。在 Windows 上，请在 Visual Studio 的开发者命令提示符中运行，该环境提供 `cl`；使用 `--compiler`（或 `CC` 环境变量）可以换用其他编译器。
- **保留的声明**：头文件中的声明；头文件所在的目录不是系统目录时，还包括该目录中其他头文件的声明（库的其他头文件所在的目录通过 `--own` 添加）；以及这些声明所用到的系统类型。本包无法读取的声明（`long double`、带参数的宏）会被移除，并列出其所在的文件和行号。
- **与库对照检查**：生成器加载与头文件同名的库（`sqlite3.h` 对应 `sqlite3`），或者 `--library` 指定的库（库名或文件），库中未导出的函数和无法调用的函数（参数为 `va_list`）会被移除并列出。库无法加载时，仍会生成类，但不做检查，并给出警告（zlib 需要指定 `--library z`）；`--no-check` 跳过检查。
- **生成的类**：每个函数对应一个属性，属性名即函数名，其上方的注释为该函数的 C 原型；函数名与组件的成员重名时（`free`、`read`），属性会改用其他名称。TypeScript 类型遵循第 3 节的规则：64 位整数为 bigint，字符串为 `string | null`，其他指针为 `Pointer | null`（作为参数时也可以传入 `Buffer` 或类型化数组）。
- **需要自行修改的内容**：从头文件无法看出哪些指针是输出参数，也无法看出哪些函数会阻塞，因此生成的文件本来就需要修改。输出参数需要在声明中其所属函数的原型上标记为 `_Out_`，并将参数类型改为 `Out<T>`（指向结构体的指针改为该结构体的接口）。对于会阻塞的函数，在 `@Native` 中添加 `{async: true}`，此时 `@Native` 必须写明函数名。头文件发布新版本时，请重新生成类，再将这些修改迁移过去。
- **仅适用于一个平台**：声明来自运行生成器的平台；如果头文件按平台给出了不同的声明（`#ifdef _WIN32`），需要在每个平台上分别生成。换用其他版本的库时，可能缺少某些函数，此时组件创建失败，并指出缺少的函数。在 Linux 上，库通过其开发包安装的链接（`libsqlite3.so`）找到；在未安装开发包的机器上，`names` 需要指定带版本号的文件名（`libsqlite3.so.0`，见第 2 节）。

以下是生成器为 `sqlite3_open` 和 `sqlite3_exec` 生成并经过修改的代码：

```typescript
import {Library, Native, NativeLibrary, type Out, type Pointer} from '@lakutata/ffi'

@Library({
    names: 'sqlite3',
    declarations: `
        typedef struct sqlite3 sqlite3;
        int sqlite3_open(const char *filename, _Out_ sqlite3 **ppDb);
        int sqlite3_exec(sqlite3 *, const char *sql, int (*callback)(void *, int, char **, char **), void *, _Out_ char **errmsg);
    `
})
export class SQLite3 extends NativeLibrary {
    //生成时 ppDb 是 Pointer | Buffer | ArrayBufferView | null；在声明里把 ppDb 标成了 _Out_
    @Native()
    public readonly sqlite3_open: (filename: string | null, ppDb: Out<Pointer>) => number

    //它会阻塞：改成异步；errmsg 标成 _Out_，消息由 sqlite3_free 释放
    @Native('sqlite3_exec', {async: true, free: 'sqlite3_free'})
    public readonly sqlite3_exec: (db: Pointer | null, sql: string | null, callback: null, context: null, errmsg: Out<string>) => Promise<number>
}
```

生成器也可以在脚本中调用：`@lakutata/ffi/generator` 的 `generateNativeLibrary()` 返回类的代码、类的声明和报告。

## 10. 库的线程

异步函数默认在运行时的线程池中执行。设置 `threads` 后，库将拥有自身的工作线程：每个线程各自加载该库，异步函数在这些线程中执行。

```typescript
import {Library, Native, NativeLibrary} from '@lakutata/ffi'

@Library({names: 'vendor', threads: 1})
export class Vendor extends NativeLibrary {
    @Native('int vendor_read(int device, unsigned char *buffer, size_t size)', {async: true})
    public readonly read: (device: number, buffer: Buffer, size: number) => Promise<number>

    @Native('int vendor_version(void)')
    public readonly version: () => number
}
```

- **线程数量**：只有一个线程时，异步调用按发起的先后顺序依次执行，适用于非线程安全的库，或一次只能处理一个请求的设备。有多个线程时，每个调用会交给最空闲的线程。可以在配置中指定其他数量（`buildNativeLibraryOptions(Vendor, {threads: 2})`），也可以在 `loadNativeLibrary` 的选项中设置；`0` 表示仍使用线程池。
- **在线程中执行的函数**：只有异步函数。同步函数仍在调用方线程中执行，因此该库会同时被两个线程使用；如果库不是线程安全的，请将其函数全部声明为异步。在这些线程中，可变参数函数也可以异步调用。库的线程不占用线程池，因此耗时较长的调用不会拖慢文件系统，`UV_THREADPOOL_SIZE` 对这些线程也不起作用。
- **参数会被复制**到线程中。函数会写入的参数在函数返回后复制回来，包括 `_Out_` 和 `_Inout_` 参数，以及传给非 `const` 指针的缓冲区和类型化数组。每次调用都需要将缓冲区复制到线程中，函数可能写入的缓冲区还需要复制回来，因此缓冲区很大时，使用线程池的开销更小。指针按原样传递，`alloc()` 分配的内存可供所有线程使用。
- **回调**：传给函数指针参数的 JS 函数在发起调用的线程中执行，库的线程会等待其执行完毕；该函数抛出的异常会使 Promise 被拒绝。持久回调的行为与第 5 节所述相同。
- **开销**：每次调用都等待上一次调用完成时，单次调用约需 11 µs，线程池约需 7 µs（Node.js，Apple 芯片）。
- **errno**：库的 `errno()` 和 `windowsError()` 返回最近完成的异步调用所在线程的值。只有在仅有一个线程，或每次调用都等待上一次调用完成时，该值才可靠。自第一次异步调用完成起，这两个方法不再返回同步调用的值；同步调用的值需要通过 `lastErrno()` 和 `lastWindowsError()` 读取（第 7 节）。
- **启动和关闭**：线程随库一起启动，加载库需要几毫秒。线程加载完库之后，组件才算创建完成；对于通过 `loadNativeLibrary` 加载的库，其 `ready` 此时才会完成（调用本身也会等待其完成）。关闭库时，先等待进行中的调用结束，再由线程卸载库并退出。线程意外退出时，其正在执行的调用会失败，下一次调用会启动一个新线程。

## 11. 销毁和工作线程

应用停止时，库组件会执行以下操作：使其属性抛出 `NativeLibraryClosedException`（异步函数返回被拒绝的 Promise）；等待进行中的异步调用结束（`drainTimeout`，默认 10 秒）；释放其回调；释放 `alloc()` 分配的内存；卸载库（设置 `keepLoaded` 时保留；musl 从不卸载）。如果将属性上的函数另外保存了一份（`const abs = libc.abs`），销毁后便不能再调用该函数，因为调用已卸载库中的函数会导致进程退出。

原生调用无法中途打断。超过 `drainTimeout` 后仍有调用未结束时，库及其回调和内存都会保持原样，以便这些调用能够安全返回。线程池中的调用会继续执行，并在返回时正常完成；库的线程中的调用会以 `NativeLibraryClosedException` 被拒绝，这些线程在调用返回后退出。即使调用了 `process.exit()`，Node.js 也会等待此类调用返回后才退出；Bun 的 `process.exit()` 则不会等待。

工作线程需要自行加载库（在线程中创建组件）。请先停止工作线程中运行的应用，再终止该线程，因为应用会等待调用结束并关闭其库。如果工作线程在使用 koffi 时被终止，整个进程都可能退出：

- koffi 正在该线程中加载时，Node.js 和 Bun 都会出现这种情况，即线程正在 import 该包，或线程中创建的库正在启动其线程（耗时几毫秒）。koffi 3.3.4 在加载过程中被终止时，会导致进程退出。在库的线程启动期间退出进程，也可能出现同样的情况；
- 在 Bun 中，线程池中仍有异步调用未返回时（这是 Bun 的 bug，1.4.4 中同样存在），以及库的线程正在绑定函数时，也会出现这种情况。

如果在库的线程中有异步调用正在执行时终止工作线程，进程不会崩溃。

## 12. 运行环境

支持 Node.js `>=18.10.0`、Electron 主进程和 Bun；不支持 Electron 渲染进程和浏览器。

本包可以在 macOS、Linux（glibc 和 musl）和 Windows 上运行。

## 13. 异常

| 异常 | 抛出时机 |
|---|---|
| `NativeDeclarationException` | 声明或原型无法读取（附带行号和列号）、库中没有该函数、某个类型无法传递（`va_list`）、类上没有 `@Library` |
| `NativeLibraryNotFoundException` | 库无法加载；异常会列出尝试过的每个文件及原因 |
| `NativeLibraryClosedException` | 库关闭后仍使用其函数、变量或回调；库关闭时，其线程中尚未结束的调用 |
| `NativeMemoryException` | 空指针、负数长度、在 Electron 中使用视图 |
| `TypeError`（来自 koffi） | 参数类型错误 |
| `RangeError` | 声明了 `{int64: 'number'}` 的函数遇到超出安全整数范围的 64 位整数 |
