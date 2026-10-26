# Lakutata Native Addons

A native addon is a library written in C++ or Rust that Node.js loads as a `.node` file: for drivers and devices,
codecs, system APIs, or code that must run fast. `lakutata add --native` creates an addon package in a workspace,
ready to build and test; `lakutata native` links libraries to it; and `lakutata package` ships it with the application.
The addons use Node-API, so one build runs in all the supported versions of Node.js and in Electron. To call the C
functions of a library without writing an addon, see [FFI](FFI.md).

## 1. Creating an addon

In a workspace ([Workspaces](Workspaces.md)):

```bash
# One of:
lakutata add @acme/capture --native --to app          # C++, built by node-gyp
lakutata add @acme/capture --native cmake --to app    # C++, built by cmake-js
lakutata add @acme/capture --native rust --to app     # Rust, built by napi-rs (cargo)
# Then:
npm install                                           # links the package and builds the addon
npm run rebuild -w @acme/capture
npm test -w @acme/capture
```

| Build system | Its files | Building it needs |
|---|---|---|
| `gyp` (the default) | `binding.gyp`, `cpp/binding.cc` | Python and a C++ toolchain: the Xcode command line tools on macOS, build-essential on Linux, the Visual Studio Build Tools on Windows |
| `cmake` | `CMakeLists.txt`, `cpp/binding.cc` | CMake and a C++ toolchain |
| `rust` | `Cargo.toml`, `build.rs`, `rust/lib.rs` | Rust (rustup) |

Every addon package also has `src/index.ts`, which loads the addon and gives it a typed API, a test
(`src/tests/index.spec.ts`), a `tsconfig.json` that compiles `src` into `dist`, and a `README.md`. The C++ addon:

```cpp
#include <napi.h>

static Napi::Value Greet(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "The name must be a string");
    }
    return Napi::String::New(env, "Hello, " + info[0].As<Napi::String>().Utf8Value() + " (native)");
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("greet", Napi::Function::New(env, Greet));
    return exports;
}

NODE_API_MODULE(capture, Init)
```

The Rust addon:

```rust
use napi_derive::napi;

/// Greet someone: greet(name)
#[napi]
pub fn greet(name: String) -> String {
    format!("Hello, {} (native)", name)
}
```

And `src/index.ts`, the same for all three:

```typescript
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

type Binding = {
    greet(name: string): string
}

/** The addon built into build/Release, loaded from the directory of the package */
const binding: Binding = createRequire(import.meta.url)('node-gyp-build')(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

export function greet(name: string): string {
    return binding.greet(name)
}
```

| Script | What it does |
|---|---|
| `install` | Builds the addon when the package is installed (`npm install`) |
| `build:native` | Builds the addon into `build/Release/<name>.node` |
| `build` | Compiles the TypeScript into `dist` |
| `rebuild` | `clean`, then `build:native` and `build` |
| `test` | Runs the tests (`node --test`) |
| `clean`, `clean:native` | Remove `dist`, or the build of the addon (`build`, and `target` for Rust) |

- **Errors**: a C++ exception of node-addon-api reaches JavaScript as an error of the same kind
  (`Napi::TypeError` becomes a `TypeError`). In Rust, an argument of the wrong type is refused by napi-rs with an
  `Error` whose `code` says why (`StringExpected`).
- **macOS**: the C++ addons are built for the Macs with Intel and with Apple silicon in one file; a Rust addon is built
  for the architecture of the machine (`rustup target add` adds the other ones).
- **Node-API**: the addons are built for Node-API version 8, which every supported version of Node.js and of Electron
  provides, so they are not rebuilt for each of them.
- The package is `"private": true`, like every package that `lakutata add` creates: an addon is usually shipped with
  its application rather than published.

## 2. Linking libraries

`lakutata native <link|include|define> <value>`, run in the directory of the addon, changes its build file
(`binding.gyp`, `CMakeLists.txt`, or for Rust `.cargo/config.toml`). The file is edited in place, its comments and its
layout kept, and the sources of the addon are not touched. Running the same change again changes nothing.

```bash
lakutata native link z                              # a library of the system (-lz)
lakutata native link ws2_32 --platform win          # a library of the system, on Windows only
lakutata native link zlib --pkg-config              # a library found by pkg-config (not on Windows)
lakutata native link CoreFoundation --framework     # a framework of macOS
lakutata native link deps/lib/libfoo.a              # a static library of the package, linked into the addon
lakutata native link deps/lib/libbar.dylib          # a dynamic library of the package, shipped with the addon
lakutata native include deps/include                # a directory of headers (C++)
lakutata native define TRACE_LEVEL=3                # a definition of the preprocessor (C++)
lakutata native link libc --crate                   # a crate (Rust: cargo add)
```

```
✔ Linked deps/lib/libbar.dylib (gyp): binding.gyp
```

- **A file or a system library**: a value with a `/`, or ending in `.a`, `.lib`, `.so`, `.dylib` or `.dll`, is a file of
  the package; any other value is the name of a library of the system. The files must be inside the package, since they
  are shipped with it; a directory of headers is one of the package, or an absolute directory of the system.
- **The platform** of a change: a library file gives its own (`.dylib` macOS, `.so` Linux, `.dll` and `.lib` Windows,
  `.a` every platform but Windows), `--framework` means macOS, `--pkg-config` every platform but Windows, and
  `--platform mac|linux|win` chooses one. A change for a platform other than the machine's is noted
  (`! The change is for win: it is built and tried there`).
- **Dynamic libraries** are copied next to the addon when it is built, and the addon finds them there at run time
  through its rpath (`@loader_path` on macOS, `$ORIGIN` on Linux). On macOS, the install name of the library must be
  `@rpath/libbar.dylib` (`install_name_tool -id @rpath/libbar.dylib deps/lib/libbar.dylib`): the command tells you when
  it is not. On Windows, a DLL is linked through its import library, which must be next to it (`deps/lib/bar.dll` and
  `deps/lib/bar.lib`).
- **Rust addons** link their native libraries through `build.rs`, which reads them from `.cargo/config.toml` (where
  `lakutata native link` writes them); `include`, `define` and `--pkg-config` are refused, since Rust uses crates for
  these (`--crate` adds one with `cargo add`, which looks it up in the registry of crates).
- **Several targets**: when the build file declares several, `--target <name>` chooses the one changed.

What each change writes, by build system:

| | gyp | CMake | Rust |
|---|---|---|---|
| File | `binding.gyp`, or the `.gypi` it includes that declares the target | `CMakeLists.txt` | `.cargo/config.toml` (`[env]`), read by `build.rs` |
| Library | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | the `-sys` crates |
| Framework | `xcode_settings.OTHER_LDFLAGS` | `-framework` in `if(APPLE)` | `rustc-link-lib=framework=` |
| Dynamic library | `copies`, the rpath | `INSTALL_RPATH` (`BUILD_WITH_INSTALL_RPATH`), a `POST_BUILD` copy | `rustc-cdylib-link-arg`, a copy in `build:native` |
| Headers, definitions | `include_dirs`, `defines` | `target_include_directories`, `target_compile_definitions` | none (crates) |
| Platform | `conditions` (`OS=="mac"`, `OS!="win"`) | `if(APPLE)`, `if(WIN32)`, `if(NOT WIN32)`, `if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`, `_LINUX`, `_WINDOWS`, `_UNIX` |

For example, `link deps/lib/libbar.dylib` writes the rpath, the library and its copy into the macOS condition of
`binding.gyp`:

```
['OS=="mac"', {
  'xcode_settings': {
    'MACOSX_DEPLOYMENT_TARGET': '11.0',
    'OTHER_CFLAGS': ['-arch x86_64', '-arch arm64'],
    'OTHER_LDFLAGS': [
      '-arch x86_64', '-arch arm64',
      '-Wl,-rpath,@loader_path',
    ],
  },
  'libraries': ['<(module_root_dir)/deps/lib/libbar.dylib'],
  'copies': [
    {
      'destination': '<(PRODUCT_DIR)',
      'files': ['<(module_root_dir)/deps/lib/libbar.dylib']
    }
  ]
}]
```

(The comments of the generated file are left out here.)

## 3. Other build options

The comments of the generated `binding.gyp` and `CMakeLists.txt` show the forms that `lakutata native` does not write:

- the standard of C++ (`binding.gyp`: `CLANG_CXX_LANGUAGE_STANDARD` on macOS, `cflags_cc` on Linux, `/std:` on Windows;
  `CMakeLists.txt` sets C++20, which the headers of Node.js need);
- the options of one platform, in the `conditions` of `binding.gyp`;
- in `CMakeLists.txt`, a package of CMake (`find_package(ZLIB REQUIRED)`) or a library built from its own sources
  (`add_subdirectory(deps/foo)`).

A library built by its own Makefile is built before the addon by a script of the package:

```json
{
  "scripts": {
    "build:deps": "make -C deps/foo",
    "build:native": "npm run build:deps && node-gyp rebuild"
  }
}
```

## 4. Shipping an addon

The application depends on the addon package, and imports it as any package (`import {greet} from '@acme/capture'`).

- **Bundles and executables**: `lakutata package bundle` leaves the addon packages out of the bundle and writes them,
  with their files (their JavaScript, the addon, its dynamic libraries) but without their sources and what built them,
  into `dist/<name>.native/`, which is shipped with the bundle; an executable embeds them, or holds them next to it in
  the directory layout ([Packaging](Packaging.md)). The addon is built for the platform of the machine that packs the
  application, so pack the application of each platform on that platform (a CI matrix, or a container of the
  architecture for Linux).
- **An addon package built on the framework** (it depends on `lakutata` or `@lakutata/core`, to provide a component,
  for instance) is bundled with the application instead, so that there is one copy of the framework, and only its addon
  and the files beside it go into the tree. The addon is shipped when it is loaded as the package of `lakutata add`
  loads it (`node-gyp-build` given the directory of the package), by a `require` of its file, or by a path from the
  module (`path.join(__dirname, 'prebuilds', ...)`); `lakutata package` warns of an addon loaded in another way.
- **Electron**: the addons are copied as they are installed. The addons that `lakutata add` creates run in Electron
  without being rebuilt, as do all the addons built on Node-API; an addon built on the V8 API of Node.js must be
  installed in its build for Electron before packing (`electron-rebuild`).
- **Bun**: Bun loads the addons of Node-API; an executable of Bun warns of the addons built on the V8 API of Node.js.
- **Alpine (musl)**: the executables of Node.js do not load native addons there: make them with Bun.