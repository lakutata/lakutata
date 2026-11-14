# @lakutata/ffi

English | [中文](README.zh-CN.md)

Native libraries for the [Lakutata](https://github.com/lakutata/lakutata) framework: C functions in `.so`, `.dylib` and
`.dll` files called from Node.js, Electron's main process and Bun, without compiling anything. A library is declared
with the C declarations from its headers (structs, unions, enums, typedefs, pointers to functions, prototypes,
`#define`), and each library is an application component. It is built on [koffi](https://koffi.dev/). The `lakutata`
package does not re-export this package: import it from `@lakutata/ffi`.

## Installation

```shell
npm install lakutata @lakutata/ffi
```

- koffi comes with a package of prebuilt binaries for each platform, installed along with it. npm may warn that koffi's
  install script was not run: it is not needed.
- Node.js `>=18.10.0`, Electron's main process, or Bun. Its peer dependency `@lakutata/core` is installed with
  `lakutata`.

## Usage

### A library

A subclass of `NativeLibrary`: `@Library` specifies its file names (one per platform, or one completed as each platform
names libraries) and its declarations, `@Native` binds a function to a property, and `@NativeVariable` a variable.

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

    //Runs in a thread of the pool; the error message it gives is freed by sqlite3_free
    @Native('int sqlite3_exec(sqlite3 *db, const char *sql, void *callback, void *context, _Out_ char **error)', {async: true, free: 'sqlite3_free'})
    public readonly exec: (db: Pointer, sql: string, callback: null, context: null, error: Out<string>) => Promise<number>

    //The function of the declarations named as the property
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

- **Where it is found**: the configuration's `path` (alone, when specified), the `search` directories in the
  configuration and in `@Library`, the `native` directory in a packaged application's resources, then the locations
  where the system looks for libraries. `c` is the C library on each system (musl included), `m` its mathematical
  functions.
- **Values**: numbers; strings for `char *`; bigints for pointers and for every 64-bit integer (`size_t`, `long`,
  `int64_t`…), or numbers with `{int64: 'number'}`; objects for structs and unions, their bitfields by their names; a
  one-element array for an `_Out_` integer or pointer (`Out<T>`).
- **Callbacks**: a JS function passed for a function pointer is valid during the call; `callback(type, fn)` creates one
  that the library keeps, whose exceptions become the component's `error` events.
- **Threads**: asynchronous functions run in the runtime's thread pool, or in the library's worker threads when
  `threads` is specified on `@Library` (or in the configuration). With `threads: 1`, they run one after another, for a
  library that is not thread-safe; with several, each call goes to the least busy thread. A variadic function can be
  asynchronous there.
- **Destroyed** with the application: its properties throw, running asynchronous calls are awaited, its callbacks
  released and the library unloaded. Calls still running after `drainTimeout` keep the library loaded, with its
  callbacks and memory, since a native call cannot be interrupted.

### Without the container

```typescript
import {loadNativeLibrary, type NativeLibraryHandle} from '@lakutata/ffi'

const libc: NativeLibraryHandle = loadNativeLibrary('c', 'typedef struct { int quot; int rem; } div_t;')
const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
console.log(div(17, 5))
//The types of the extra arguments of a variadic function, by their C names
const buffer: Buffer = Buffer.alloc(32)
snprintf(buffer, buffer.length, '%s=%d', 'const char *', 'count', 'int', 42)
await libc.close()
```

### Generating the class from the header

For a library with many functions, the class is generated from its header by Lakutata's command-line tool
(`@lakutata/cli`), or by `generateNativeLibrary()` from `@lakutata/ffi/generator`:

```shell
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
```

The header is run through the C compiler's preprocessor, the library's declarations are kept, and functions the library
cannot provide are left out and listed. A header does not indicate which parameters are outputs or which
functions block, so mark output parameters `_Out_` and blocking functions `{async: true}` in the generated file, as the
guide shows.

### Packaging

The bundles, executables and Electron installers built by `lakutata package` include koffi and its binary for the
platform. A library shipped with the application goes into the resources, in `native`
(`"lakutata": {"resources": [{"from": "vendor/lib", "to": "native"}]}` in the package.json). On Alpine, build the
executables with Bun (`--runtime bun`).

## API

| Export | What it is |
|---|---|
| `NativeLibrary` | The component for a library: its functions and variables on its properties; `func`, `variable`, `callback`, `read`, `write`, `sizeOf`, `offsetOf`, `alloc`, `free`, `errno`, `windowsError`, `constants`, `file`, `pending`, `threadCount`; the `error` event of its callbacks |
| `buildNativeLibraryOptions`, `NativeLibraryConfig` | Its declaration in the components, and its options: `path`, `search`, `keepLoaded`, `drainTimeout`, `threads` |
| `Library`, `LibraryOptions` | Class decorator: the library of a `NativeLibrary` subclass (`names`, `search`, `declarations`, `crt`, `threads`) |
| `Native` | Property decorator: a function (a prototype, a declared name, or the property's name) and its options (`async`, `free`, `int64`) |
| `NativeVariable` | Property decorator: a variable the library exports |
| `loadNativeLibrary`, `NativeLibraryHandle`, `NativeLibraryOptions` | A library without the container: `func`, `function`, `variable`, `callback`, `declare`, `read`, `write`, `sizeOf`, `offsetOf`, `alloc`, `free`, `errno`, `windowsError`, `threads`, `ready`, `drain`, `close` |
| `NativeFunctionOptions`, `NativeVariableAccessor`, `NativeCallback`, `LibraryNames`, `Pointer`, `Out` | The options of a function, a variable, a persistent callback (`pointer`, `release()`), a library's names, a pointer (a bigint), an output parameter |
| `readCString`, `readWString`, `readBuffer`, `viewBuffer`, `readValue`, `readArray`, `writeValue`, `allocMemory`, `freeMemory`, `sizeOf` | Native memory, with the built-in types (`viewBuffer` does not copy; Electron refuses it) |
| `lastErrno`, `lastWindowsError` | The last call's errno (on Windows, that of the specified C library), the Windows API error |
| `generateNativeLibrary`, `defaultCompiler` (`@lakutata/ffi/generator`) | A library's class generated from its header (its code, its declarations, what was left out), the C compiler run by default |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `NativeDeclarationException` | Declarations or a prototype cannot be read (with their line and column: a type not declared, `#if`, a macro with arguments, `long double`…), a function is not in the library, a `va_list` is passed, a class has no `@Library` |
| `NativeLibraryNotFoundException` | The library cannot be loaded: its message lists each file tried and why |
| `NativeLibraryClosedException` | A function, a variable or a callback of a closed library is used; a call still running in a library's threads when it is closed |
| `NativeMemoryException` | A null pointer or a negative length is passed to the memory functions, `viewBuffer` in Electron |
| `TypeError` (from koffi) | An argument of the wrong type |
| `RangeError` | A 64-bit integer that is not a safe integer, for a function declared with `{int64: 'number'}` |

A C function called with a wrong prototype, or passed a wrong pointer, ends the process: no exception can catch it.

## See also

- The guide on the website: [FFI](https://lakutata.com/guide/FFI).
- `doc/en/FFI.md` in the `lakutata` package (Chinese version in `doc/zh`): the guide to native libraries.
- `doc/en/NativeAddons.md` in the `lakutata` package: native addons written in C++ or Rust, for what a C function
  library cannot provide.
- [koffi](https://koffi.dev/): the FFI the package is built on.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
