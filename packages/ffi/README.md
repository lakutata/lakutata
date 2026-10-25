# @lakutata/ffi

English | [中文](README.zh-CN.md)

Native libraries for the [lakutata](https://github.com/lakutata/lakutata) framework: the C functions of `.so`, `.dylib`
and `.dll` files called from Node.js, the main process of Electron and Bun, without compiling anything. A library is
declared with the C declarations of its headers (structs, unions, enums, typedefs, pointers to functions, prototypes,
`#define`), and each library is a component of the application. It is built on [koffi](https://koffi.dev/). The
`lakutata` package does not re-export this package: import it from `@lakutata/ffi`.

## Installation

```shell
npm install lakutata @lakutata/ffi
```

- koffi comes with a package of prebuilt binaries for each platform, installed with it; npm may warn that its install
  script was not run: it is not needed.
- Node.js `^22.13.0 || >=24.11.0`, the main process of Electron, or Bun. Its peer dependency `@lakutata/core` is
  installed with `lakutata`.

## Usage

### A library

A subclass of `NativeLibrary`: `@Library` gives its file names (one by platform, or one completed as each platform names
libraries) and its declarations, `@Native` binds a function to a property, `@NativeVariable` a variable.

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

- **Where it is found**: the `path` of the configuration (alone, when given), the directories of `search` in the
  configuration and in `@Library`, the directory `native` of the resources of a packaged application, then where the
  system looks for libraries. `c` is the C library on each system (musl included), `m` its mathematical functions.
- **The values**: numbers; strings for `char *`; bigints for pointers and for every 64-bit integer (`size_t`, `long`,
  `int64_t`…), or numbers with `{int64: 'number'}`; objects for structs and unions, their bitfields by their names; an
  array of one element for an `_Out_` integer or pointer (`Out<T>`).
- **Callbacks**: a JS function given for a pointer to a function is valid during the call; `callback(type, fn)` makes
  one the library keeps, whose exceptions are `error` events of the component.
- **Threads**: the asynchronous functions run in the thread pool of the runtime, or in worker threads of the library
  when `threads` is given on `@Library` (or in the configuration). With `threads: 1`, they run one after the other,
  for a library that is not thread-safe; with several, each call goes to the least busy thread. A variadic function can
  be asynchronous there.
- **Destroyed** with the application: its properties throw, the asynchronous calls running are awaited, its callbacks
  released, the library unloaded. Calls still running after `drainTimeout` keep the library loaded, with its callbacks
  and its memory, since a native call cannot be interrupted.

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

For a library with many functions, the class is generated from its header by the command line tool of lakutata
(`@lakutata/cli`), or by `generateNativeLibrary()` of `@lakutata/ffi/generator`:

```shell
lakutata ffi generate /usr/include/sqlite3.h --class-name SQLite3 --out src/native/SQLite3.ts
```

The header is run through the preprocessor of the C compiler, the declarations of the library are kept, and the
functions the library cannot give are left out and listed. Then mark the output parameters `_Out_` and the functions
that block `{async: true}` in the file generated, as the guide shows: a header does not say which ones they are.

### Packaging

The bundles, the executables and the installers of Electron made by `lakutata package` carry koffi and its binary for
the platform. A library shipped with the application goes in the resources, in `native`
(`"lakutata": {"resources": [{"from": "vendor/lib", "to": "native"}]}` in the package.json). On Alpine, make the
executables with Bun (`--runtime bun`).

## API

| Export | What it is |
|---|---|
| `NativeLibrary` | The component of a library: its functions and variables on its properties; `func`, `variable`, `callback`, `read`, `write`, `sizeOf`, `offsetOf`, `alloc`, `free`, `errno`, `windowsError`, `constants`, `file`, `pending`, `threadCount`; the `error` event of its callbacks |
| `buildNativeLibraryOptions`, `NativeLibraryConfig` | Its declaration in the components, and its options: `path`, `search`, `keepLoaded`, `drainTimeout`, `threads` |
| `Library`, `LibraryOptions` | Class decorator: the library of a `NativeLibrary` subclass: `names`, `search`, `declarations`, `crt`, `threads` |
| `Native` | Property decorator: a function (a prototype, a declared name, or the name of the property) and its options: `async`, `free`, `int64` |
| `NativeVariable` | Property decorator: a variable the library exports |
| `loadNativeLibrary`, `NativeLibraryHandle`, `NativeLibraryOptions` | A library without the container: `func`, `function`, `variable`, `callback`, `declare`, `read`, `write`, `sizeOf`, `offsetOf`, `alloc`, `free`, `errno`, `windowsError`, `threads`, `ready`, `drain`, `close` |
| `NativeFunctionOptions`, `NativeVariableAccessor`, `NativeCallback`, `LibraryNames`, `Pointer`, `Out` | The options of a function, a variable, a persistent callback (`pointer`, `release()`), the names of a library, a pointer (a bigint), an output parameter |
| `readCString`, `readWString`, `readBuffer`, `viewBuffer`, `readValue`, `readArray`, `writeValue`, `allocMemory`, `freeMemory`, `sizeOf` | Native memory, with the built-in types (`viewBuffer` does not copy; Electron refuses it) |
| `lastErrno`, `lastWindowsError` | The errno of the last call (on Windows, the one of the C library given), the error of the Windows API |
| `generateNativeLibrary`, `defaultCompiler` (`@lakutata/ffi/generator`) | The class of a library generated from its header (its code, its declarations, what was left out), the C compiler run by default |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `NativeDeclarationException` | Declarations or a prototype cannot be read (with their line and column: a type not declared, `#if`, a macro with arguments, `long double`…), a function is not in the library, a `va_list` is passed, a class has no `@Library` |
| `NativeLibraryNotFoundException` | The library cannot be loaded: its message lists each file tried and why |
| `NativeLibraryClosedException` | A function, a variable or a callback of a closed library is used; a call still running in the threads of a library when it is closed |
| `NativeMemoryException` | A null pointer or a negative length is given to the memory functions, `viewBuffer` in Electron |
| `TypeError` (from koffi) | An argument of the wrong type |
| `RangeError` | A 64-bit integer that is not a safe integer, for a function declared with `{int64: 'number'}` |

A C function called with a wrong prototype, or given a wrong pointer, ends the process: no exception can catch it.

## See also

- The guide on the website: [FFI](https://lakutata.com/guide/FFI).
- `doc/en/FFI.md` in the `lakutata` package (Chinese version in `doc/zh`): the guide to native libraries.
- `doc/en/NativeAddons.md` in the `lakutata` package: native addons written in C++ or Rust, for what a library of C
  functions cannot give.
- [koffi](https://koffi.dev/): the FFI the package is built on.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
