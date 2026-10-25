# Lakutata FFI

The package `@lakutata/ffi` calls the C functions of native libraries (`.so`, `.dylib`, `.dll`) from Node.js, the main
process of Electron and Bun: the APIs of the system, the SDKs of devices, existing C libraries. Nothing is
compiled and no addon is written: a library is declared with the C declarations of its headers, and each library is a
component of the application. It is built on [koffi](https://koffi.dev/). It is not part of `lakutata`:

```bash
npm install lakutata @lakutata/ffi
```

koffi comes with a package of prebuilt binaries for each platform, installed with it. npm may warn that the install
script of koffi was not run: it is not needed.

A C function called with a wrong prototype, or given a pointer it should not get, ends the process: no exception can
catch that. Copy the declarations from the headers of the library, and test them.

## 1. A library

A library is a subclass of `NativeLibrary`: `@Library` gives its file names and its C declarations, `@Native` binds a
function to a property, `@NativeVariable` a variable. The TypeScript type of each property is the type of the
function.

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

    //Runs in a thread of the pool; the error message it gives is freed by sqlite3_free
    @Native('int sqlite3_exec(sqlite3 *db, const char *sql, sqlite3_callback callback, void *context, _Out_ char **error)', {async: true, free: 'sqlite3_free'})
    public readonly exec: (db: Pointer, sql: string, callback: RowCallback | null, context: null, error: Out<string>) => Promise<number>

    //The function of the declarations named as the property
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

- **The names**: one name (`sqlite3` is completed as each platform names its libraries: `libsqlite3.dylib`,
  `libsqlite3.so`, `sqlite3.dll`), a file, or one by platform (the names of `process.platform`, `default` for the
  others). `c` is the C library and `m` its mathematical functions, found where each system has them: `libSystem` on
  macOS, `libc.so.6` with glibc, the dynamic loader of musl on Alpine, `ucrtbase.dll` on Windows.
- **The declarations** are written as the headers write them, and can be copied from them: typedefs, structs and unions
  (defined later, referring to themselves, anonymous members), enums (their values can be constant expressions),
  pointers to functions, prototypes, variables, `#define` without arguments (an empty one is removed where it is used,
  as the markers of exported functions; one whose value is an integer is also a constant), `#pragma pack`, the packed
  and aligned attributes. The other attributes, the bodies of inline functions and the `extern "C"` blocks are skipped.
  Each library has its own declarations: two libraries can both declare `HANDLE`.
- **What is refused**, with its line and its column: `#if` and its kind (run the header through the preprocessor first:
  `cc -E`, `cl /P`), the macros with arguments, `long double`, `__int128`, and the declarations of the old style. The
  types of `stdint.h`, of POSIX (`time_t`, `pid_t`…), of BSD (`u_int`…) and of the Windows API (`DWORD`, `HANDLE`,
  `LPCWSTR`…) are known without being declared, with their size on each platform.
- **`@Native`** takes a prototype, the name of a function of the declarations, or nothing (the function named as the
  property). The property gets the function when the component is created: the function of koffi itself when nothing
  has to be converted, so a call costs no more than through koffi (about 20 ns).
- **`@NativeVariable`** takes a declaration, a name, or nothing: reading the property reads the variable, writing it
  writes the variable (refused for a const one). An array of `char` of unknown length is read as a string.
- A subclass inherits the library of its parent class and can add functions.
- For a library with many functions, the class can be generated from its header (section 9).

## 2. Where the library is found

When the component is created, the library is looked for:

1. at the `path` of its configuration, when given (the only file tried then);
2. in the directories of `search` in the configuration, then in the ones of `@Library`;
3. in a packaged application, in the directory `native` of its resources;
4. where the system looks for libraries (`dlopen`, `LoadLibrary`).

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

When it cannot be loaded, `NativeLibraryNotFoundException` lists each file tried and why it was not loaded (not found,
built for another architecture, a library it needs missing). On Linux, the libraries of the system are often installed
with their version only (`libsqlite3.so.0`): give that name.

To ship a library with a packaged application, put it in the resources of the package.json, in `native`:

```json
{
  "lakutata": {
    "resources": [{"from": "vendor/lib", "to": "native"}]
  }
}
```

The bundles, the executables (of Node.js and of Bun) and the installers of Electron made by `lakutata package` carry it,
and koffi with its binary for the platform. On Alpine, make the executable with Bun (`--runtime bun`): the executables
of Node.js do not load native addons on musl. Under the permission model of Node.js, run with `--allow-addons`.

## 3. Calling functions

| C | JavaScript |
|---|---|
| integers, `float`, `double`, `bool`, enums | numbers, booleans |
| 64-bit integers (`int64_t`, `long long`, `size_t`, `long`, `time_t`…) | bigints (numbers are accepted as arguments) |
| `const char *`, `char *` | strings (a `Buffer` is accepted too, and the function writes into it); `char16_t *`, `wchar_t *` too |
| other pointers | bigints (`Pointer`), `null` for NULL; a `Buffer` or a typed array can be given |
| structs, unions | objects |
| pointers to functions | functions (see section 5) |

- **The 64-bit integers** are bigints everywhere: results, output parameters, members of structs, arguments of
  callbacks. `long` is 64-bit on Linux and macOS, 32-bit on Windows: it is a bigint on every platform. A function
  declared with `{int64: 'number'}` gives numbers instead, and throws a `RangeError` for a value that is not a safe
  integer.
- **Output parameters**: a parameter marked `_Out_` (or `_Inout_`) is written by the function. An integer or a pointer
  is given as an array of one element (`Out<T>`, `[null]` before the call); a struct as an object, whose members are
  set once the function returns. A pointer without a mark is given to the function only: a struct passed through it is
  not read back.
- **A buffer given to a function** is valid during the call only: memory the library keeps must be allocated with
  `alloc()` (section 6).
- **Variadic functions** (`printf`, `curl_easy_setopt`) take the type of each extra argument by its C name, before it:

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
const buffer: Buffer = Buffer.alloc(64)
snprintf(buffer, buffer.length, '%s: %d', 'const char *', 'count', 'int', 42)
```

- **Strings to free**: a function returning a string the caller must free (or giving one through an output parameter)
  is declared with `{free: 'sqlite3_free'}`, the function of the library that frees it, or `{free: true}` for `free()`
  of the C library. The string is read, then freed. On Windows, a library built with another C library must be given its
  own function.
- **Asynchronous calls**: a function declared with `{async: true}` runs in another thread and returns a promise; the
  event loop goes on during the call. By default it runs in the thread pool of the runtime: Node.js runs them in the
  pool of libuv, 4 threads by default, shared with the file system, DNS and crypto; raise `UV_THREADPOOL_SIZE` for many
  calls, or long ones. A variadic function cannot be asynchronous there. A library can have threads of its own instead
  (section 10).

## 4. Structs, unions, enums and constants

A struct is an object of its members. Its nested structs are objects; its arrays of `char` are strings, its arrays of
numbers typed arrays (`Uint8Array`, `Int32Array`…), its arrays of 64-bit integers arrays of bigints. An anonymous
struct or union inside a struct is the member `_0` (then `_1`…).

- **Bitfields** are members like the others, read and written by their names: the package lays them out as the
  compilers of the platform do (the rules of GCC and Clang, of ARM, of Microsoft). A bitfield of a 64-bit type is a
  bigint.
- **Packed structs** (`#pragma pack`, the packed attribute) and the aligned attribute (1, 2, 4 or 8 bytes) are laid out
  as the compilers do.
- **A union** is given as an object setting one of its members (`{i: 42}`).
- **Enums** are integers; their values, the static constants and the integer macros of the declarations are in
  `constants`, as bigints (`Number(sqlite.constants.SQLITE_OK)`).

The structs and the memory of a library are read with its types: `read(pointer, 'struct timeval')`,
`sizeOf('struct timeval')`, `offsetOf('struct timeval', 'tv_usec')`.

## 5. Callbacks

A parameter whose type is a pointer to a function takes a JS function: a **transient callback**, valid during the call
only (`qsort`, `sqlite3_exec`). An exception it throws makes the function receive 0 (or NULL), then is thrown by the
call once it returns.

A library that keeps a callback to call it later (a log handler, an event handler) gets a **persistent callback**:

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

- `callback(type, fn)` takes the name of a pointer-to-function type of the declarations, or a prototype. Give its
  `pointer` to the library, and `release()` it when the library no longer calls it; the callbacks of a component are
  released when it is destroyed. A process has at most 8192 at a time.
- Called from another thread of the library, it runs in the JS thread once the event loop gets to it. A function that
  waits for a thread calling back must be asynchronous: called synchronously, the JS thread would wait for the thread
  that waits for it.
- An exception it throws is an `error` event of the component (written to the log of the application when nothing
  listens to them), and the library gets 0 (or NULL) as its result.

## 6. Memory

| Function | What it gives |
|---|---|
| `alloc(type, count)`, `free(pointer)` | memory for values of a type of the library, which does not move and which the library can keep; freed when the component is destroyed if not before |
| `read(pointer, type, count?)`, `write(pointer, type, value)` | a value (or an array) of a type of the library |
| `readCString(pointer)`, `readWString(pointer)` | a string given as a pointer (a `void *` result, a member, an argument of a callback) |
| `readBuffer(pointer, length)` | a copy, valid once the native memory is freed (about 10 GB/s) |
| `viewBuffer(pointer, length)` | the memory itself, without copy |
| `readValue`, `readArray`, `writeValue`, `allocMemory`, `freeMemory`, `sizeOf` | the same for the built-in types (`int`, `uint64_t`, `char *`…), without a library |

A copy is as fast as a view below 64 KiB; a view is worth it for large blocks read often (8 MiB: about 0.13 ms
rather than 1 ms). A view must not be used once the native memory is freed: the process would crash. Electron forbids
views of native memory: `viewBuffer` throws a `NativeMemoryException` there.

## 7. The errors of the C functions

`lastErrno()` (or `errno()` of the component) gives the `errno` of the last call of the thread (for a library with
threads of its own, see section 10). On Windows, each C library has its own `errno`: the one of the C library of
Microsoft (`ucrtbase.dll`) is read by default, another one given by `crt` of `@Library` (`msvcrt.dll` for the old
libraries). `lastWindowsError()` gives the error of the Windows API (`GetLastError`), kept after each call.

```typescript
import {lastErrno, loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const open = libc.func<(path: string, flags: number) => number>('int open(const char *path, int flags, ...)')
if (open('/missing', 0) < 0) console.log('errno', lastErrno())
```

## 8. Without the container

Scripts and tests load a library with `loadNativeLibrary(names, declarations, options)`: the same declarations, the
same rules, the same methods as a component (`func`, `function`, `variable`, `callback`, `read`…), and `close()`.

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c', 'typedef struct { int quot; int rem; } div_t;')
const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
console.log(div(17, 5))
await libc.close()
```

## 9. Generating the class from the header

For a library with many functions, `lakutata ffi generate` writes its class from its header: its declarations, a
property by function with its TypeScript type, an interface by struct and union, its integer macros as constants.

```bash
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
lakutata ffi generate sdk/include/vendor.h --library sdk/lib/vendor.dll --out src/native/Vendor.ts
```

- **The header** is run through the preprocessor of the C compiler (`cc -E`, `cl /P`): its `#include`, its `#if` and its
  macros are resolved as for a build on this platform (`--include` and `--define` give the directories and the macros
  of a build). On Windows, run it in the Developer Command Prompt of Visual Studio, which has `cl`; `--compiler` (or
  `CC`) chooses another compiler.
- **What is kept**: the declarations of the header, and those of the headers of its directory unless it is a directory
  of the system (`--own` adds the directories of the other headers of the library), with the types of the system they
  use. A declaration the package cannot read (`long double`, a macro with arguments) is left out, and listed with its
  file and its line.
- **Checked against the library**: the library named as the header (`sqlite3.h`: `sqlite3`), or the one given by
  `--library` (a name or a file), is loaded, and the functions it does not export or that cannot be called (a
  `va_list` parameter) are left out and listed. When it cannot be loaded, the class is generated without the check, with
  a warning (zlib needs `--library z`); `--no-check` skips the check.
- **The class** gets a property by function, named as the function, with its C prototype above it; a function named as
  a member of the component (`free`, `read`) gets another property name. The TypeScript types follow section 3:
  64-bit integers are bigints, strings are `string | null`, other pointers `Pointer | null` (a parameter also takes a
  `Buffer` or a typed array).
- **What to edit**: a header does not say which pointers are output parameters, nor which functions block, and the
  generated file is meant to be edited. Mark an output parameter `_Out_` in the prototype of its function, in the
  declarations, and change the type of its parameter to `Out<T>` (to the interface of the struct, for a pointer to a
  struct). A function that blocks gets `{async: true}` in `@Native`, which then names the function. For a new version
  of the header, generate the class again and carry those changes over.
- **For one platform**: the declarations are the ones of the platform the generator ran on; a header whose declarations
  differ by platform (`#ifdef _WIN32`) is generated on each of them. Another build of the library may lack some of the
  functions: the component then refuses to start, naming the missing function.

What the generator wrote for `sqlite3_open` and `sqlite3_exec`, edited:

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
    //Generated with ppDb: Pointer | Buffer | ArrayBufferView | null; ppDb marked _Out_ in the declarations
    @Native()
    public readonly sqlite3_open: (filename: string | null, ppDb: Out<Pointer>) => number

    //It blocks: asynchronous; errmsg marked _Out_, the message freed by sqlite3_free
    @Native('sqlite3_exec', {async: true, free: 'sqlite3_free'})
    public readonly sqlite3_exec: (db: Pointer | null, sql: string | null, callback: null, context: null, errmsg: Out<string>) => Promise<number>
}
```

The generator can also be called from a script: `generateNativeLibrary()` of `@lakutata/ffi/generator` returns the
code of the class, its declarations and the report.

## 10. The threads of a library

By default, the asynchronous functions run in the thread pool of the runtime. With `threads`, a library has worker
threads of its own instead: each one loads the library, and the asynchronous functions run in them.

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

- **The number of threads**: with one thread, the asynchronous calls run one after the other, in the order they were
  made: for a library that is not thread-safe, or a device that serves one request at a time. With several, each call
  goes to the least busy thread. The configuration can give another number
  (`buildNativeLibraryOptions(Vendor, {threads: 2})`), `loadNativeLibrary` takes it in its options, and `0` keeps the
  thread pool.
- **What runs there**: the asynchronous functions only. The synchronous ones still run in the thread calling them, so
  the library is used by two threads at once: for a library that is not thread-safe, declare all its functions
  asynchronous. A variadic function can be asynchronous here. The threads of a library are not taken from the thread
  pool: long calls do not hold up the file system, and `UV_THREADPOOL_SIZE` does not matter for them.
- **The arguments are copied** to the thread. The ones the function writes are copied back once it returns: the
  `_Out_` and `_Inout_` parameters, and the buffers and typed arrays given for a pointer that is not `const`. A
  buffer is copied to the thread at each call, and back when the function may write it: for large buffers, the thread
  pool costs less. Pointers are passed as they are: the memory of `alloc()` is shared by all the threads.
- **Callbacks**: a JS function given for a pointer to a function runs in the thread that made the call, while the
  thread of the library waits for it; an exception it throws rejects the promise. Persistent callbacks work as in
  section 5.
- **Cost**: about 11 µs for a call awaited before the next one, against 7 µs in the thread pool (Node.js on Apple
  silicon).
- **errno**: `errno()` and `windowsError()` of the library give the values of the thread of the last asynchronous call
  completed. They are reliable with one thread, or when each call is awaited before the next. From the first
  asynchronous call completed on, they no longer give the values of the synchronous calls: `lastErrno()` and
  `lastWindowsError()` read those (section 7).
- **Starting and closing**: the threads start with the library and take a few milliseconds to load it. A component is
  created once they have loaded it; for a library loaded by `loadNativeLibrary`, `ready` settles then (the calls wait
  for it anyway). When the library is closed, the calls running are awaited, then the threads unload the library and
  end. A thread that ends unexpectedly fails the calls it was running, and the next call starts a new one.

## 11. Destruction and worker threads

When the application stops, a library component makes its properties throw `NativeLibraryClosedException` (its
asynchronous functions reject), waits for its asynchronous calls running (`drainTimeout`, 10 seconds by default),
releases its callbacks, frees the memory of `alloc()` and unloads the library (`keepLoaded` keeps it loaded; musl never
unloads). A function copied out of its property (`const abs = libc.abs`) must not be called after that: a function of an
unloaded library ends the process.

A native call cannot be interrupted. When calls are still running after `drainTimeout`, the library, its callbacks and
its memory are left as they are, so that those calls can return safely. The calls in the thread pool go on, and settle
when they return. The ones in the threads of the library are rejected with `NativeLibraryClosedException`, and each of
those threads ends once its call returns. Node.js waits for such calls to return even on `process.exit()`;
`process.exit()` in Bun does not wait for them.

A worker thread loads the library for itself (a component created in the worker). Stop the application running in the
worker before stopping the worker: the application waits for the calls and closes its libraries. Stopping a worker
while it uses koffi can end the whole process:

- while koffi loads in the worker, in Node.js and in Bun: when the worker imports the package, or while the threads of
  a library created in it start (a few milliseconds). koffi 3.3.4 does not survive being stopped while it loads.
  Exiting the process while the threads of a library start can do the same;
- in Bun, also while asynchronous calls run in the thread pool (a bug of Bun, in 1.4.4 as well), and while the threads
  of a library bind its functions.

Stopping a worker while asynchronous calls run in the threads of its libraries does not crash the process.

## 12. Runtimes

Node.js `^22.13.0 || >=24.11.0`, the main process of Electron and Bun; not the renderers of Electron nor the browsers.

The tests of the package, including those of the threads of a library, pass on macOS (arm64: Node.js 24, Bun 1.4,
Electron 44), on Linux (arm64, glibc and musl: Node.js 24, Bun 1.4) and on Windows 11 (arm64, and x64 under emulation:
Node.js 24, Bun 1.4). On macOS, an application whose libraries run in threads of their own was also packed by
`lakutata package` into a bundle, executables of Node.js and of Bun, and an Electron application: each one ran, and the
threads loaded the library shipped in its resources.

## 13. Exceptions

| Exception | When |
|---|---|
| `NativeDeclarationException` | Declarations or a prototype cannot be read (with the line and the column), a function is not in the library, a type cannot be passed (`va_list`), a class has no `@Library` |
| `NativeLibraryNotFoundException` | The library cannot be loaded: each file tried and why |
| `NativeLibraryClosedException` | A function, a variable or a callback of a library used once it is closed; a call still running in the threads of a library when the library is closed |
| `NativeMemoryException` | A null pointer, a negative length, a view in Electron |
| `TypeError` (from koffi) | An argument of the wrong type |
| `RangeError` | A 64-bit integer that is not a safe integer, for a function declared with `{int64: 'number'}` |
