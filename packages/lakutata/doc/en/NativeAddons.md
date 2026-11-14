# Lakutata Native Addons

A native addon is a library written in C++ or Rust that Node.js loads as a `.node` file: for drivers and devices,
codecs, system APIs, or code that must run fast. `lakutata add --native` creates an addon package in a workspace, ready
to build and test; `lakutata native` links libraries to it; and `lakutata package` ships it with the application. These
addons use Node-API, so one build runs in all supported versions of Node.js and in Electron. To call a library's C
functions without writing an addon, see [FFI](FFI.md).

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
| `gyp` (the default) | `binding.gyp`, `cpp/binding.cc` | Python and a C++ toolchain: the Xcode command-line tools on macOS, build-essential on Linux, the Visual Studio Build Tools on Windows |
| `cmake` | `CMakeLists.txt`, `cpp/binding.cc` | CMake and a C++ toolchain |
| `rust` | `Cargo.toml`, `build.rs`, `rust/lib.rs` | Rust (rustup) |

Every addon package also has `src/index.ts`, which loads the addon and wraps it in a typed API, a test
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

type Binding = {
    greet(name: string): string
}

/** The addon built into build/Release, loaded from the directory of the package */
const binding: Binding = createRequire(__filename)('node-gyp-build')(path.resolve(__dirname, '..'))

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
| `clean`, `clean:native` | Remove `dist`, or the addon build (`build`, and `target` for Rust) |

- **Errors**: a node-addon-api C++ exception reaches JavaScript as an error of the same kind (`Napi::TypeError` becomes
  a `TypeError`). In Rust, napi-rs throws an `Error` whose `code` states the reason (`StringExpected`) when an
  argument has the wrong type.
- **macOS**: the C++ addons are built for both Intel and Apple silicon Macs in one file; a Rust addon is built for the
  machine's architecture (`rustup target add` adds the others).
- **Node-API**: the addons are built for Node-API version 8, which every supported version of Node.js and Electron
  provides, so they are not rebuilt for each version.
- **CommonJS**: the package is CommonJS (`"type": "commonjs"`). Bundles made by `lakutata package` are CommonJS and load
  it with `require`, which can load an ES module only on Node.js 20.19, 22.12 or later.
- The package is `"private": true`, like every package that `lakutata add` creates: an addon is usually shipped with
  its application rather than published.

## 2. Linking libraries

`lakutata native <link|include|define> <value>`, run in the addon's directory, changes its build file (`binding.gyp`,
`CMakeLists.txt`, or for Rust `.cargo/config.toml`). The file is edited in place with its comments and layout preserved,
and the addon's sources are not touched. Running the same change again has no effect.

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

- **A file or a system library**: a value with a `/`, or ending in `.a`, `.lib`, `.so`, `.dylib` or `.dll`, is a file in
  the package; any other value is the name of a system library. The files must be inside the package, since they are
  shipped with it; a header directory is either in the package or an absolute system directory.
- **The platform** of a change: a library file determines it by its extension (`.dylib` macOS, `.so` Linux, `.dll` and
  `.lib` Windows, `.a` every platform except Windows), `--framework` means macOS, `--pkg-config` every platform except
  Windows, and `--platform mac|linux|win` selects one. A change for a platform other than the machine's is noted
  (`! The change is for win: it is built and tried there`).
- **Dynamic libraries** are copied next to the addon when it is built, and the addon finds them there at run time
  through its rpath (`@loader_path` on macOS, `$ORIGIN` on Linux). On macOS, the library's install name must be
  `@rpath/libbar.dylib` (`install_name_tool -id @rpath/libbar.dylib deps/lib/libbar.dylib`): the command tells you when
  it is not. On Windows, a DLL is linked through its import library, which must be next to it (`deps/lib/bar.dll` and
  `deps/lib/bar.lib`).
- **Rust addons** link their native libraries through `build.rs`, which reads them from `.cargo/config.toml` (where
  `lakutata native link` writes them); `include`, `define` and `--pkg-config` are rejected, since Rust uses crates for
  these (`--crate` adds one with `cargo add`, which looks it up in the crate registry).
- **Several targets**: when the build file declares several, `--target <name>` selects the one to change.

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

For example, `link deps/lib/libbar.dylib` writes the rpath, the library and its copy into the macOS condition in
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

(The generated file's comments are omitted here.)

## 3. Other build options

Comments in the generated `binding.gyp` and `CMakeLists.txt` show the forms that `lakutata native` does not write:

- the C++ standard (`binding.gyp`: `CLANG_CXX_LANGUAGE_STANDARD` on macOS, `cflags_cc` on Linux, `/std:` on Windows;
  `CMakeLists.txt` sets C++20, which the Node.js headers need);
- platform-specific options, in the `conditions` of `binding.gyp`;
- in `CMakeLists.txt`, a CMake package (`find_package(ZLIB REQUIRED)`) or a library built from its own sources
  (`add_subdirectory(deps/foo)`).

A library built by its own Makefile is built before the addon by a package script:

```json
{
  "scripts": {
    "build:deps": "make -C deps/foo",
    "build:native": "npm run build:deps && node-gyp rebuild"
  }
}
```

## 4. Shipping an addon

The application depends on the addon package, and imports it like any other package
(`import {greet} from '@acme/capture'`).

- **Bundles and executables**: `lakutata package bundle` leaves addon packages out of the bundle and writes them, with
  their files (their JavaScript, the addon, its dynamic libraries) but without their sources and what built them, into
  `dist/<name>.native/`, which is shipped with the bundle; an executable embeds them, or holds them next to it in the
  directory layout ([Packaging](Packaging.md)). The addon is built for the platform of the machine that packs the
  application, so pack the application for each platform on that platform (a CI matrix, or, for Linux, a container of
  each architecture).
- **An addon package built on the framework** (one that depends on `lakutata` or `@lakutata/core`, to provide a
  component, for instance) is bundled with the application instead, so that there is one copy of the framework, and only
  its addon and the files beside it go into the tree. The addon is shipped when it is loaded the way the package created
  by `lakutata add` loads it (`node-gyp-build` called with the package directory), by a `require` of its file, or by a
  path built from the module's location (`path.join(__dirname, 'prebuilds', ...)`); `lakutata package` warns about an
  addon loaded any other way.
- **Electron**: addons are copied in their installed form. The addons that `lakutata add` creates run in Electron
  without being rebuilt, as do all Node-API addons; an addon built on the Node.js V8 API must be installed in its
  Electron build before packing (`electron-rebuild`).
- **NW.js**: addons are made to load in NW.js when the application runs in it (`lakutata nwjs run`, and once packaged).
  Those built for an architecture other than the runtime's are rebuilt from their sources with the headers of the
  Node.js that NW.js includes; so are those built on the Node.js V8 API, with the NW.js headers (NW.js 0.111.3 or later:
  earlier releases, such as 0.72 for Windows 7, run only Node-API addons). On Windows, the addons load the Node.js that
  NW.js includes (`node.dll`). The project's addons are left unchanged, for its tests with Node.js.
- **Mobile applications** (React Native): `lakutata mobile stage` builds the addons from their sources for Android, iOS
  and HarmonyOS, against the libnode the application embeds (see the `lakutata mobile` commands in the `@lakutata/cli`
  README).
- **Bun**: Bun loads Node-API addons; an executable built with Bun warns about addons built on the Node.js V8 API.
- **Alpine (musl)**: executables built with Node.js do not load native addons there; build the executables with
  Bun.