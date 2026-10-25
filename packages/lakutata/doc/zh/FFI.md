# Lakutata FFI

`@lakutata/ffi` 包让 Node.js、Electron 的主进程和 Bun 调用动态库（`.so`、`.dylib`、`.dll`）里的 C 函数：系统 API、设备厂商的 SDK、现成的 C 库。不需要编译，也不需要写扩展：用库的头文件里的 C 声明来描述它，每个库都是应用的一个组件。它基于 [koffi](https://koffi.dev/)。它不属于 `lakutata`：

```bash
npm install lakutata @lakutata/ffi
```

koffi 会连同各平台的预编译文件一起安装（每个平台一个包）。npm 可能会提示 koffi 的安装脚本没有运行：不需要运行它。

C 函数的原型写错，或者传给它不该传的指针，整个进程都会退出，任何异常处理都拦不住。请从库的头文件里复制声明，并且测试它们。

## 1. 一个库

一个库就是 `NativeLibrary` 的一个子类：`@Library` 给出它的文件名和 C 声明，`@Native` 把一个函数绑到一个属性上，`@NativeVariable` 绑定一个变量。每个属性的 TypeScript 类型就是函数的类型。

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

- **文件名**：可以写一个名字（`sqlite3` 会按各平台给库命名的方式补全：`libsqlite3.dylib`、`libsqlite3.so`、`sqlite3.dll`），可以写一个文件，也可以按平台分别写（键是 `process.platform` 的值，`default` 用于其他平台）。`c` 表示 C 标准库，`m` 表示它的数学函数，包会到各系统存放它们的地方去找：macOS 的 `libSystem`、glibc 的 `libc.so.6`、Alpine 上 musl 的动态加载器、Windows 的 `ucrtbase.dll`。
- **声明**按头文件的写法写，可以直接从头文件里复制：typedef、结构体和联合（可以后定义、可以引用自身、可以有匿名成员）、枚举（值可以是常量表达式）、函数指针、原型、变量、不带参数的 `#define`（空的宏在使用处会被去掉，比如导出函数的标记；值是整数的宏同时也是常量）、`#pragma pack`、`packed` 和 `aligned` 属性。其他属性、inline 函数的函数体和 `extern "C"` 块会被跳过。每个库的声明都是独立的：两个库可以各自声明 `HANDLE`。
- **不支持的写法**会报错，并给出行号和列号：`#if` 一类条件编译（请先用预处理器展开头文件：`cc -E`、`cl /P`）、带参数的宏、`long double`、`__int128`，以及旧式声明。`stdint.h`、POSIX（`time_t`、`pid_t` 等）、BSD（`u_int` 等）和 Windows API（`DWORD`、`HANDLE`、`LPCWSTR` 等）的类型不用声明就能用，大小按各平台的实际情况。
- **`@Native`** 的参数可以是原型、声明里某个函数的名字，或者省略（用和属性同名的函数）。组件创建时，属性就会得到这个函数。不需要做任何转换时，它就是 koffi 的函数本身，调用的开销和直接用 koffi 一样（约 20 ns）。
- **`@NativeVariable`** 的参数可以是声明、名字，或者省略：读属性就是读变量，写属性就是写变量（`const` 变量拒绝写入）。长度未知的 `char` 数组按字符串读取。
- 子类会继承父类的库，也可以再加函数。
- 函数很多的库，可以根据它的头文件生成类（第 9 节）。

## 2. 到哪里找库

组件创建时，按以下顺序找库：

1. 配置里给了 `path` 时，只试这一个文件；
2. 配置里 `search` 的目录，然后是 `@Library` 里的目录；
3. 打包后的应用里，资源目录下的 `native` 目录；
4. 系统找库的位置（`dlopen`、`LoadLibrary`）。

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

加载不了时，`NativeLibraryNotFoundException` 会列出试过的每个文件，以及没能加载的原因（找不到、为别的架构编译的、缺少它依赖的库）。Linux 上系统自带的库常常只装了带版本号的文件（`libsqlite3.so.0`），这时请写这个名字。

要把库和打包后的应用一起发布，把它放进 package.json 的资源里，放到 `native` 目录：

```json
{
  "lakutata": {
    "resources": [{"from": "vendor/lib", "to": "native"}]
  }
}
```

`lakutata package` 打出的 bundle、可执行文件（Node.js 的和 Bun 的）和 Electron 安装包都会带上它，也会带上 koffi 和本平台的预编译文件。在 Alpine 上请用 Bun 打可执行文件（`--runtime bun`）：Node.js 的可执行文件在 musl 上加载不了原生插件。在 Node.js 的权限模型下运行时，要加 `--allow-addons`。

## 3. 调用函数

| C | JavaScript |
|---|---|
| 整数、`float`、`double`、`bool`、枚举 | number、boolean |
| 64 位整数（`int64_t`、`long long`、`size_t`、`long`、`time_t` 等） | bigint（作为参数时也接受 number） |
| `const char *`、`char *` | 字符串（也接受 `Buffer`，函数会直接写进去）；`char16_t *`、`wchar_t *` 也一样 |
| 其他指针 | bigint（`Pointer`），空指针是 `null`；可以传 `Buffer` 或类型化数组 |
| 结构体、联合 | 对象 |
| 函数指针 | 函数（见第 5 节） |

- **64 位整数**在任何地方都是 bigint：返回值、输出参数、结构体成员、回调参数。`long` 在 Linux 和 macOS 上是 64 位，在 Windows 上是 32 位：它在所有平台上都是 bigint。声明函数时加上 `{int64: 'number'}`，就改为给出 number；值超出安全整数范围时抛出 `RangeError`。
- **输出参数**：标了 `_Out_`（或 `_Inout_`）的参数由函数写入。整数和指针用只有一个元素的数组传入（`Out<T>`，调用前是 `[null]`）；结构体用对象传入，函数返回后，对象的成员会被填上。没有标记的指针只把值传给函数：通过它传入的结构体，调用后不会读回来。
- **传给函数的缓冲区**只在这次调用期间有效：库要保存起来以后再用的内存，要用 `alloc()` 分配（第 6 节）。
- **可变参数的函数**（`printf`、`curl_easy_setopt`）的每个额外参数，前面都要用 C 类型名写出它的类型：

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
const buffer: Buffer = Buffer.alloc(64)
snprintf(buffer, buffer.length, '%s: %d', 'const char *', 'count', 'int', 42)
```

- **需要释放的字符串**：函数返回（或通过输出参数给出）一个要由调用方释放的字符串时，声明时加上 `{free: 'sqlite3_free'}`，写库里负责释放的函数；或者加上 `{free: true}`，用 C 标准库的 `free()`。字符串读出来以后就会被释放。在 Windows 上，如果库是用另一套 C 运行库编译的，必须给出它自己的释放函数。
- **异步调用**：声明时加上 `{async: true}` 的函数在另一个线程里执行，返回一个 Promise；调用期间事件循环照常运行。默认用的是运行时的线程池：Node.js 用的是 libuv 的线程池，默认只有 4 个线程，而且和文件系统、DNS、加解密共用；调用多或者调用时间长时，请调大 `UV_THREADPOOL_SIZE`。在线程池里，可变参数的函数不能异步调用。库也可以改用自己的线程（第 10 节）。

## 4. 结构体、联合、枚举和常量

结构体是一个由它的成员组成的对象。嵌套的结构体也是对象；`char` 数组是字符串，数字数组是类型化数组（`Uint8Array`、`Int32Array` 等），64 位整数的数组是由 bigint 组成的数组。结构体里的匿名结构体或匿名联合是成员 `_0`（依次是 `_1` 等）。

- **位域**和其他成员一样，按名字读写：包会按平台上编译器的规则来排布它们（GCC 和 Clang 的规则、ARM 的规则、微软的规则）。64 位类型的位域是 bigint。
- **紧凑的结构体**（`#pragma pack`、`packed` 属性）和 `aligned` 属性（1、2、4 或 8 字节）都按编译器的方式排布。
- **联合**用一个只设置了其中一个成员的对象传入（`{i: 42}`）。
- **枚举**是整数；声明里枚举的值、`static const` 常量和值是整数的宏都在 `constants` 里，类型是 bigint（`Number(sqlite.constants.SQLITE_OK)`）。

库的结构体和内存，要用库自己的类型来读：`read(pointer, 'struct timeval')`、`sizeOf('struct timeval')`、`offsetOf('struct timeval', 'tv_usec')`。

## 5. 回调

参数类型是函数指针时，可以直接传一个 JS 函数，这就是**临时回调**，只在这次调用期间有效（`qsort`、`sqlite3_exec`）。它抛出的异常会让函数收到 0（或空指针），等这次调用返回后再抛出来。

库要把回调保存起来以后再调用时（日志处理函数、事件处理函数），要给它一个**持久回调**：

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

- `callback(type, fn)` 的第一个参数是声明里某个函数指针类型的名字，或者一个原型。把它的 `pointer` 交给库；库不再调用它时，调用 `release()` 释放。组件销毁时，它的回调会全部释放。一个进程同时最多有 8192 个持久回调。
- 库从别的线程调用它时，它会在事件循环轮到它时，在 JS 线程里执行。如果一个函数会等某个线程回调，就必须把它声明为异步：同步调用的话，JS 线程在等那个线程，而那个线程又在等 JS 线程。
- 它抛出的异常会成为组件的 `error` 事件（没人监听时写进应用日志），库收到的结果是 0（或空指针）。

## 6. 内存

| 函数 | 得到什么 |
|---|---|
| `alloc(type, count)`、`free(pointer)` | 为库的某个类型分配内存，地址不会变，库可以保存它；没释放的，组件销毁时会释放 |
| `read(pointer, type, count?)`、`write(pointer, type, value)` | 按库的类型读写一个值（或一个数组） |
| `readCString(pointer)`、`readWString(pointer)` | 读一个以指针形式给出的字符串（`void *` 返回值、结构体成员、回调参数） |
| `readBuffer(pointer, length)` | 一份副本，原生内存释放以后也能用（约 10 GB/s） |
| `viewBuffer(pointer, length)` | 原生内存本身，不复制 |
| `readValue`、`readArray`、`writeValue`、`allocMemory`、`freeMemory`、`sizeOf` | 内置类型（`int`、`uint64_t`、`char *` 等）的对应操作，不需要库 |

64 KiB 以下，复制和不复制一样快；数据块很大、读得又频繁时才值得用视图（8 MiB：约 0.13 ms，复制要约 1 ms）。原生内存释放以后，绝不能再使用视图，否则进程会崩溃。Electron 不允许原生内存的视图：在那里调用 `viewBuffer` 会抛出 `NativeMemoryException`。

## 7. C 函数的错误

`lastErrno()`（或组件的 `errno()`）给出本线程上一次调用之后的 `errno`（库有自己的线程时，见第 10 节）。在 Windows 上，每个 C 运行库各有一份 `errno`：默认读微软 C 运行库（`ucrtbase.dll`）的，其他运行库在 `@Library` 的 `crt` 里指定（旧的库是 `msvcrt.dll`）。`lastWindowsError()` 给出 Windows API 的错误（`GetLastError`），每次调用之后都会保留下来。

```typescript
import {lastErrno, loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const open = libc.func<(path: string, flags: number) => number>('int open(const char *path, int flags, ...)')
if (open('/missing', 0) < 0) console.log('errno', lastErrno())
```

## 8. 不用容器

脚本和测试可以用 `loadNativeLibrary(names, declarations, options)` 加载库：声明一样、规则一样，方法也和组件一样（`func`、`function`、`variable`、`callback`、`read` 等），另外还有 `close()`。

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c', 'typedef struct { int quot; int rem; } div_t;')
const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
console.log(div(17, 5))
await libc.close()
```

## 9. 根据头文件生成类

函数很多的库，可以用 `lakutata ffi generate` 根据它的头文件生成类：包括它的声明、每个函数一个带 TypeScript 类型的属性、每个结构体和联合一个接口，整数宏作为常量。

```bash
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
lakutata ffi generate sdk/include/vendor.h --library sdk/lib/vendor.dll --out src/native/Vendor.ts
```

- **头文件**先经过 C 编译器的预处理器（`cc -E`、`cl /P`）：`#include`、`#if` 和宏按在当前平台上编译时那样展开（编译时用的头文件目录和宏用 `--include`、`--define` 给出）。在 Windows 上，请在 Visual Studio 的开发者命令提示符里运行，那里有 `cl`；用 `--compiler`（或 `CC` 环境变量）可以换别的编译器。
- **保留哪些声明**：头文件里的声明；它所在的目录不是系统目录时，还有这个目录里其他头文件的声明（库的其他头文件所在的目录用 `--own` 加上）；以及这些声明用到的系统类型。这个包读不了的声明（`long double`、带参数的宏）会被去掉，并列出它所在的文件和行号。
- **用库检查**：加载和头文件同名的库（`sqlite3.h` 对应 `sqlite3`），或者 `--library` 给出的库（库名或文件），库里没有导出的函数和不能调用的函数（参数是 `va_list`）会被去掉并列出来。库加载不了时，照样生成类，只是不做检查，并给出警告（zlib 要写 `--library z`）；`--no-check` 跳过检查。
- **生成的类**：每个函数一个属性，属性名就是函数名，上面注释着它的 C 原型；函数名和组件的成员重名时（`free`、`read`），属性换一个名字。TypeScript 类型按第 3 节的规则：64 位整数是 bigint，字符串是 `string | null`，其他指针是 `Pointer | null`（作为参数时也可以传 `Buffer` 或类型化数组）。
- **哪些要自己改**：头文件看不出哪些指针是输出参数，也看不出哪些函数会阻塞，生成的文件就是供你修改的。输出参数要在声明里它所属函数的原型上标成 `_Out_`，参数类型改成 `Out<T>`（指向结构体的指针改成那个结构体的接口）。会阻塞的函数在 `@Native` 里加上 `{async: true}`，这时 `@Native` 要写出函数名。头文件出了新版本时，重新生成类，再把这些修改搬过去。
- **只针对一个平台**：声明是运行生成器的那个平台上的；头文件按平台写了不同声明的（`#ifdef _WIN32`），要在每个平台上各生成一份。换一个版本的库可能少一些函数：组件启动时会报错，并指出缺的是哪个函数。

下面是生成器为 `sqlite3_open` 和 `sqlite3_exec` 生成的代码改过之后的样子：

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

生成器也可以在脚本里调用：`@lakutata/ffi/generator` 的 `generateNativeLibrary()` 返回类的代码、它的声明和报告。

## 10. 库的线程

异步函数默认在运行时的线程池里执行。设置了 `threads` 之后，库就有自己的工作线程：每个线程各自加载这个库，异步函数在这些线程里执行。

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

- **几个线程**：只有一个线程时，异步调用按发起的先后顺序，一个接一个执行，适合不是线程安全的库，或者一次只能处理一个请求的设备。有多个线程时，每个调用交给最空闲的那个线程。配置里可以改成别的数量（`buildNativeLibraryOptions(Vendor, {threads: 2})`），`loadNativeLibrary` 的选项里也可以设置；`0` 表示仍然用线程池。
- **哪些函数在线程里执行**：只有异步函数。同步函数仍然在调用它的线程里执行，所以这个库会同时被两个线程使用：如果库不是线程安全的，请把它的函数全部声明为异步。在这里，可变参数的函数也可以异步调用。库的线程不占用线程池：耗时长的调用不会拖慢文件系统，`UV_THREADPOOL_SIZE` 对它们也不起作用。
- **参数会复制**到线程里。函数会写入的参数，在函数返回后再复制回来：`_Out_` 和 `_Inout_` 参数，以及传给非 `const` 指针的缓冲区和类型化数组。缓冲区每次调用都要复制过去，函数可能写入的还要复制回来：缓冲区很大时，用线程池开销更小。指针原样传过去：`alloc()` 分配的内存所有线程都能用。
- **回调**：传给函数指针参数的 JS 函数，在发起调用的那个线程里执行，库的线程会等它执行完；它抛出的异常会让 Promise 被拒绝。持久回调和第 5 节说的一样。
- **开销**：每次调用都等上一次完成时，一次调用约 11 µs，线程池约 7 µs（Node.js，Apple 芯片）。
- **errno**：库的 `errno()` 和 `windowsError()` 给出最近完成的那次异步调用所在线程的值。只有一个线程，或者每次调用都等上一次完成时，这个值才可靠。从第一次异步调用完成起，它们就不再给出同步调用的值了：同步调用的值用 `lastErrno()` 和 `lastWindowsError()` 读（第 7 节）。
- **启动和关闭**：线程随库一起启动，加载库要几毫秒。组件要等线程把库加载好才算创建完成；用 `loadNativeLibrary` 加载的库，这时它的 `ready` 才会完成（调用本来也会等它）。关闭库时，先等进行中的调用结束，再让线程卸载库并退出。线程意外退出时，它正在执行的调用会失败，下一次调用会启动一个新线程。

## 11. 销毁和工作线程

应用停止时，库组件会：让它的属性抛出 `NativeLibraryClosedException`（异步函数返回被拒绝的 Promise）；等进行中的异步调用结束（`drainTimeout`，默认 10 秒）；释放它的回调；释放 `alloc()` 分配的内存；卸载库（`keepLoaded` 时保留；musl 从不卸载）。如果把属性上的函数另外存了一份（`const abs = libc.abs`），销毁后就不能再调用它：调用已卸载的库里的函数，进程会退出。

原生调用没法中途打断。过了 `drainTimeout` 还有调用没结束时，库、它的回调和它的内存都保持原样，让这些调用能安全返回。线程池里的调用继续执行，返回时照常完成；库的线程里的调用会以 `NativeLibraryClosedException` 被拒绝，那些线程在调用返回后退出。即使调用了 `process.exit()`，Node.js 也要等这样的调用返回才退出；Bun 的 `process.exit()` 不等它们。

工作线程要自己加载库（在线程里创建组件）。请先停止工作线程里运行的应用，再终止这个线程：应用会等调用结束，并关闭它的库。工作线程正在用 koffi 时被终止，整个进程都可能退出：

- koffi 正在这个线程里加载时，Node.js 和 Bun 都会这样：线程正在 import 这个包，或者线程里创建的库正在启动它的线程（几毫秒）。koffi 3.3.4 在加载过程中被终止就会让进程退出。库的线程启动期间退出进程，也可能这样；
- 在 Bun 里，线程池里还有异步调用没返回时（这是 Bun 的 bug，1.4.4 里也有），以及库的线程正在绑定函数时，也会这样。

库的线程里有异步调用正在执行时终止工作线程，进程不会崩溃。

## 12. 运行环境

Node.js `^22.13.0 || >=24.11.0`、Electron 的主进程和 Bun；不支持 Electron 的渲染进程和浏览器。

这个包的测试（包括库的线程）在 macOS（arm64：Node.js 24、Bun 1.4、Electron 44）、Linux（arm64，glibc 和 musl：Node.js 24、Bun 1.4）和 Windows 11（arm64，以及模拟运行的 x64：Node.js 24、Bun 1.4）上都能通过。在 macOS 上，还用 `lakutata package` 把一个使用它的应用（它的库在自己的线程里执行）分别打成了 bundle、Node.js 和 Bun 的可执行文件以及 Electron 应用：每一个都能运行，库的线程也都从应用自己的资源目录里加载了自带的库。

## 13. 异常

| 异常 | 什么时候 |
|---|---|
| `NativeDeclarationException` | 声明或原型读不了（带行号和列号）、库里没有这个函数、某个类型不能传（`va_list`）、类上没有 `@Library` |
| `NativeLibraryNotFoundException` | 库加载不了：列出试过的每个文件和原因 |
| `NativeLibraryClosedException` | 库关闭后又使用它的函数、变量或回调；库关闭时，它的线程里还没结束的调用 |
| `NativeMemoryException` | 空指针、负的长度、在 Electron 里用视图 |
| `TypeError`（来自 koffi） | 参数类型不对 |
| `RangeError` | 声明了 `{int64: 'number'}` 的函数遇到超出安全整数范围的 64 位整数 |
