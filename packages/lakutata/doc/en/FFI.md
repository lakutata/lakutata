# Lakutata FFI

The `@lakutata/ffi` package calls C functions in native libraries (`.so`, `.dylib`, `.dll`) from Node.js, Electron's
main process and Bun: system APIs, device SDKs, existing C libraries. Nothing is compiled and no addon is written: a
library is declared with the C declarations from its headers, and each library is an application component. It is
built on [koffi](https://koffi.dev/). It is not part of `lakutata`:

```bash
npm install lakutata @lakutata/ffi
```

koffi comes with a package of prebuilt binaries for each platform, installed along with it. npm may warn that koffi's
install script was not run: it is not needed.

A C function called with a wrong prototype, or passed a pointer it should not receive, ends the process: no exception
can catch that. Copy the declarations from the library's headers, and test them.

## 1. A library

A library is a subclass of `NativeLibrary`: `@Library` specifies its file names and C declarations, `@Native` binds a
function to a property, and `@NativeVariable` binds a variable. Each property's TypeScript type is the function's type.

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

- **The names**: one name (`sqlite3` is completed the way each platform names its libraries, as `libsqlite3.dylib`,
  `libsqlite3.so` or `sqlite3.dll`), a file, or one per platform (`process.platform` names, `default` for the others).
  `c` is the C library and `m` its mathematical functions, found wherever each system provides them: `libSystem` on
  macOS, `libc.so.6` with glibc, musl's dynamic loader on Alpine, `ucrtbase.dll` on Windows.
- **The declarations** are written as the headers write them, and can be copied from them: typedefs, structs and unions
  (defined later, self-referencing, anonymous members), enums (their values can be constant expressions), function
  pointers, prototypes, variables, `#define` without arguments (an empty one is removed where it is used, like the
  markers on exported functions; one whose value is an integer is also a constant), `#pragma pack`, and the packed and
  aligned attributes. Other attributes, inline function bodies and `extern "C"` blocks are skipped. Each library has
  its own declarations: two libraries can both declare `HANDLE`.
- **What is refused**, with its line and column: `#if` and similar directives (run the header through the preprocessor
  first, with `cc -E` or `cl /P`), macros with arguments, `long double`, `__int128`, and old-style declarations. Types
  from `stdint.h`, POSIX (`time_t`, `pid_t`…), BSD (`u_int`…) and the Windows API (`DWORD`, `HANDLE`, `LPCWSTR`…) are
  known without being declared, with their size on each platform.
- **`@Native`** takes a prototype, the name of a function in the declarations, or nothing (the function with the
  property's name). The property receives the function when the component is created: koffi's own function when
  nothing has to be converted, so a call costs no more than through koffi (about 20 ns).
- **`@NativeVariable`** takes a declaration, a name, or nothing: reading the property reads the variable, writing it
  writes the variable (refused for a const one). A `char` array of unknown length is read as a string.
- A subclass inherits its parent class's library and can add functions.
- For a library with many functions, the class can be generated from its header (section 9).

## 2. Where the library is found

When the component is created, the library is searched for:

1. at its configuration's `path`, when specified (the only file tried then);
2. in the configuration's `search` directories, then in those of `@Library`;
3. in a packaged application, in the `native` directory of its resources;
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
built for another architecture, a library it needs missing). On Linux, system libraries are often installed only under
their versioned name (`libsqlite3.so.0`): specify that name.

To ship a library with a packaged application, put it in the package.json resources, in `native`:

```json
{
  "lakutata": {
    "resources": [{"from": "vendor/lib", "to": "native"}]
  }
}
```

The bundles, executables (Node.js and Bun) and Electron installers that `lakutata package` makes carry it, along with
koffi and its binary for the platform. On Alpine, build the executable with Bun (`--runtime bun`): Node.js executables
do not load native addons on musl. Under the Node.js permission model, run with `--allow-addons`.

## 3. Calling functions

| C | JavaScript |
|---|---|
| integers, `float`, `double`, `bool`, enums | numbers, booleans |
| 64-bit integers (`int64_t`, `long long`, `size_t`, `long`, `time_t`…) | bigints (numbers are accepted as arguments) |
| `const char *`, `char *` | strings (a `Buffer` is accepted too, and the function writes into it); `char16_t *`, `wchar_t *` too |
| other pointers | bigints (`Pointer`), `null` for NULL; a `Buffer` or a typed array can be passed |
| structs, unions | objects |
| pointers to functions | functions (see section 5) |

- **64-bit integers** are bigints everywhere: results, output parameters, struct members, callback arguments. `long` is
  64-bit on Linux and macOS, 32-bit on Windows: it is a bigint on every platform. A function declared with
  `{int64: 'number'}` produces numbers instead, and throws a `RangeError` for a value that is not a safe integer.
- **Output parameters**: a parameter marked `_Out_` (or `_Inout_`) is written by the function. An integer or a pointer
  is passed as a one-element array (`Out<T>`, `[null]` before the call); a struct as an object, whose members are set
  once the function returns. An unmarked pointer is only passed to the function: a struct passed through it is not read
  back.
- **A buffer passed to a function** is valid only during the call: memory the library keeps must be allocated with
  `alloc()` (section 6).
- **Variadic functions** (`printf`, `curl_easy_setopt`) take the type of each extra argument by its C name, before it:

```typescript
import {loadNativeLibrary} from '@lakutata/ffi'

const libc = loadNativeLibrary('c')
const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
const buffer: Buffer = Buffer.alloc(64)
snprintf(buffer, buffer.length, '%s: %d', 'const char *', 'count', 'int', 42)
```

- **Strings to free**: a function that returns a string the caller must free (or passes one through an output
  parameter) is declared with `{free: 'sqlite3_free'}`, the library's function that frees it, or `{free: true}` for
  the C library's `free()`. The string is read, then freed. On Windows, for a library built with another C library,
  specify that library's own function (`{free: '…'}`).
- **Asynchronous calls**: a function declared with `{async: true}` runs in another thread and returns a promise; the
  event loop continues during the call. By default it runs in the runtime's thread pool: Node.js runs such calls in the
  libuv pool, 4 threads by default, shared with the file system, DNS and crypto; raise `UV_THREADPOOL_SIZE` for many
  calls, or long ones. A variadic function cannot be asynchronous there. A library can have its own threads instead
  (section 10).

## 4. Structs, unions, enums and constants

A struct is an object holding its members. Nested structs are objects; `char` arrays are strings, number arrays are
typed arrays (`Uint8Array`, `Int32Array`…), and 64-bit integer arrays are arrays of bigints. An anonymous struct or
union inside a struct is the member `_0` (then `_1`…).

- **Bitfields** are members like the others, read and written by their names: the package lays them out as the
  platform's compilers do (the GCC and Clang, ARM, and Microsoft rules). A bitfield of a 64-bit type is a bigint.
- **Packed structs** (`#pragma pack`, the packed attribute) and the aligned attribute (1, 2, 4 or 8 bytes) are laid out
  as the compilers do.
- **A union** is passed as an object that sets one of its members (`{i: 42}`).
- **Enums** are integers; their values, and the static constants of the declarations and integer macros, are in
  `constants`, as bigints (`Number(sqlite.constants.SQLITE_OK)`).

A library's structs and memory are read with its types: `read(pointer, 'struct timeval')`,
`sizeOf('struct timeval')`, `offsetOf('struct timeval', 'tv_usec')`.

## 5. Callbacks

A parameter whose type is a function pointer takes a JS function: a **transient callback**, valid only during the call
(`qsort`, `sqlite3_exec`). When it throws, the function receives 0 (or NULL), and the call throws the exception once it
returns.

A library that keeps a callback to call it later (a log handler, an event handler) receives a **persistent callback**:

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

- `callback(type, fn)` takes the name of a function-pointer type in the declarations, or a prototype. Pass its
  `pointer` to the library, and `release()` it when the library no longer calls it; a component's callbacks are
  released when it is destroyed. A process has at most 8192 at a time.
- When the library calls it from another thread, it runs in the JS thread once the event loop reaches it. A function
  that waits for a thread that calls back must be asynchronous: if it were called synchronously, the JS thread would
  wait for the thread that waits for it.
- An exception it throws becomes an `error` event on the component (written to the application's log when nothing
  listens for these events), and the library receives 0 (or NULL) as its result.

## 6. Memory

| Function | What it provides |
|---|---|
| `alloc(type, count)`, `free(pointer)` | memory for values of one of the library's types, which does not move and which the library can keep; freed when the component is destroyed, if not before |
| `read(pointer, type, count?)`, `write(pointer, type, value)` | a value (or an array) of one of the library's types |
| `readCString(pointer)`, `readWString(pointer)` | a string passed as a pointer (a `void *` result, a member, a callback argument) |
| `readBuffer(pointer, length)` | a copy, still valid after the native memory is freed (about 10 GB/s) |
| `viewBuffer(pointer, length)` | the memory itself, without copying |
| `readValue`, `readArray`, `writeValue`, `allocMemory`, `freeMemory`, `sizeOf` | the same for built-in types (`int`, `uint64_t`, `char *`…), without a library |

A view pays off for large blocks read often; for small ones, a copy is as fast. A view must not be used after the native
memory is freed: the process would crash. Electron forbids views of native memory, so `viewBuffer` throws a
`NativeMemoryException` there.

## 7. The errors of the C functions

`lastErrno()` (or the component's `errno()`) returns the `errno` of the thread's last call (for a library with its own
threads, see section 10). On Windows, each C library has its own `errno`: by default, the package reads the one in
Microsoft's C library (`ucrtbase.dll`), and the `crt` option of `@Library` selects another C library (`msvcrt.dll` for
old libraries). `lastWindowsError()` returns the Windows API error (`GetLastError`), saved after each call.

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
property per function with its TypeScript type, an interface per struct and union, and its integer macros as constants.

```bash
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
lakutata ffi generate sdk/include/vendor.h --library sdk/lib/vendor.dll --out src/native/Vendor.ts
```

- **The header** is run through the C compiler's preprocessor (`cc -E`, `cl /P`): its `#include`, `#if` and macros are
  resolved as for a build on this platform (`--include` and `--define` specify a build's directories and macros). On
  Windows, run it in the Visual Studio Developer Command Prompt, which has `cl`; `--compiler` (or `CC`) selects another
  compiler.
- **What is kept**: the header's declarations, and those of the headers in its directory unless it is a system
  directory (`--own` adds the directories of the library's other headers), with the system types they use. A
  declaration the package cannot read (`long double`, a macro with arguments) is left out, and listed with its file and
  line.
- **Checked against the library**: the library named after the header (`sqlite3` for `sqlite3.h`), or the one specified
  by `--library` (a name or a file), is loaded, and functions it does not export or that cannot be called (a
  `va_list` parameter) are left out and listed. When it cannot be loaded, the class is generated without the check, with
  a warning (zlib needs `--library z`); `--no-check` skips the check.
- **The class** has a property per function, named after the function, with its C prototype above it; a function that
  has the same name as a component member (`free`, `read`) receives a different property name. TypeScript types follow
  section 3: 64-bit integers are bigints, strings are `string | null`, other pointers `Pointer | null` (a parameter
  also takes a `Buffer` or a typed array).
- **What to edit**: a header does not say which pointers are output parameters or which functions block, and the
  generated file is meant to be edited. Mark an output parameter `_Out_` in its function's prototype, in the
  declarations, and change its parameter type to `Out<T>` (to the struct's interface, for a pointer to a struct). For a
  function that blocks, add `{async: true}` to its `@Native`, which then names the function. For a new version of the
  header, generate the class again and carry those changes over.
- **For one platform**: the declarations are those of the platform the generator ran on; a header whose declarations
  differ by platform (`#ifdef _WIN32`) is generated on each platform. Another build of the library may lack some
  functions: the component's creation then fails, naming the missing function. On Linux, the library is found through
  the link its development package installs (`libsqlite3.so`): for machines without that package, set `names` to the
  versioned file (`libsqlite3.so.0`, section 2).

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

The generator can also be called from a script: `generateNativeLibrary()` from `@lakutata/ffi/generator` returns the
class's code, its declarations and the report.

## 10. The threads of a library

By default, asynchronous functions run in the runtime's thread pool. With `threads`, a library has its own worker
threads instead: each one loads the library, and asynchronous functions run in them.

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

- **The number of threads**: with one thread, asynchronous calls run one after another, in the order they were made,
  which suits a library that is not thread-safe or a device that serves one request at a time. With several, each call
  goes to the least busy thread. The configuration can specify another number
  (`buildNativeLibraryOptions(Vendor, {threads: 2})`), `loadNativeLibrary` takes it in its options, and `0` keeps the
  thread pool.
- **What runs there**: only the asynchronous functions. Synchronous ones still run in the calling thread, so two
  threads use the library at the same time: for a library that is not thread-safe, declare all its functions
  asynchronous. A variadic function can be asynchronous here. A library's threads are not taken from the thread pool:
  long calls do not hold up the file system, and `UV_THREADPOOL_SIZE` does not affect them.
- **Arguments are copied** to the thread. Those the function writes are copied back once it returns: `_Out_` and
  `_Inout_` parameters, and buffers and typed arrays passed for a pointer that is not `const`. A buffer is copied to
  the thread on each call, and back when the function may write it: for large buffers, the thread pool costs less.
  Pointers are passed unchanged: memory from `alloc()` is shared by all threads.
- **Callbacks**: a JS function passed for a function pointer runs in the thread that made the call, while the
  library's thread waits for it; an exception it throws rejects the promise. Persistent callbacks work as described in
  section 5.
- **errno**: the library's `errno()` and `windowsError()` return the values from the thread of the last completed
  asynchronous call. They are reliable with one thread, or when each call is awaited before the next. Once the first
  asynchronous call has completed, they no longer return the values of the synchronous calls: `lastErrno()` and
  `lastWindowsError()` read those (section 7).
- **Starting and closing**: the threads start with the library and take a few milliseconds to load it. A component is
  created once they have loaded it; for a library loaded by `loadNativeLibrary`, `ready` settles then (calls wait for
  it anyway). When the library is closed, running calls are awaited, then the threads unload the library and end. When
  a thread ends unexpectedly, the calls it was running fail, and the next call starts a new thread.

## 11. Destruction and worker threads

When the application stops, a library component makes its properties throw `NativeLibraryClosedException` (its
asynchronous functions reject), waits for its running asynchronous calls (`drainTimeout`, 10 seconds by default),
releases its callbacks, frees memory from `alloc()` and unloads the library (`keepLoaded` keeps it loaded; musl never
unloads). A function copied out of its property (`const abs = libc.abs`) must not be called after that: calling a
function of an unloaded library ends the process.

A native call cannot be interrupted. When calls are still running after `drainTimeout`, the library, its callbacks and
its memory are left in place, so that those calls can return safely. Calls in the thread pool continue, and settle when
they return. Those in the library's threads are rejected with `NativeLibraryClosedException`, and each of those threads
ends once its call returns. Node.js waits for such calls to return even on `process.exit()`; `process.exit()` in Bun
does not wait for them.

A worker thread loads the library for itself (a component created in the worker). Stop the application running in the
worker before stopping the worker: the application waits for the calls and closes its libraries. Stopping a worker
while it uses koffi can end the whole process:

- while koffi loads in the worker, in Node.js and in Bun: when the worker imports the package, or while the threads of
  a library created in it start (a few milliseconds). koffi 3.3.4 does not survive being stopped while it loads.
  Exiting the process while a library's threads start can do the same;
- in Bun, also while asynchronous calls run in the thread pool (a Bun bug, also present in 1.4.4), and while a
  library's threads bind its functions.

Stopping a worker while asynchronous calls run in its libraries' threads does not crash the process.

## 12. Runtimes

Node.js `>=18.10.0`, Electron's main process and Bun; neither Electron's renderers nor browsers.

The package runs on macOS, Linux (glibc and musl) and Windows.

## 13. Exceptions

| Exception | When |
|---|---|
| `NativeDeclarationException` | Declarations or a prototype cannot be read (with the line and column), a function is not in the library, a type cannot be passed (`va_list`), a class has no `@Library` |
| `NativeLibraryNotFoundException` | The library cannot be loaded: each file tried and why |
| `NativeLibraryClosedException` | A library's function, variable or callback used after the library is closed; a call still running in a library's threads when the library is closed |
| `NativeMemoryException` | A null pointer, a negative length, a view in Electron |
| `TypeError` (from koffi) | An argument of the wrong type |
| `RangeError` | A 64-bit integer that is not a safe integer, for a function declared with `{int64: 'number'}` |
