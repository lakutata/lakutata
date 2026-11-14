# Lakutata 原生插件

原生插件是用 C++ 或 Rust 编写、由 Node.js 以 `.node` 文件形式加载的库，用于驱动和设备、编解码、系统 API，以及必须快速运行的代码。`lakutata add --native` 在工作区中创建一个原生插件包，创建后即可构建和测试；`lakutata native` 为其链接库；`lakutata package` 将该插件包与应用一起发布。这些插件基于 Node-API，因此同一份构建可以在所有受支持的 Node.js 版本和 Electron 中运行。如需不编写插件而直接调用库中的 C 函数，见 [FFI](FFI.md)。

## 1. 创建原生插件

在工作区中（见[工作区](Workspaces.md)）：

```bash
# 三选一：
lakutata add @acme/capture --native --to app          # C++，由 node-gyp 构建
lakutata add @acme/capture --native cmake --to app    # C++，由 cmake-js 构建
lakutata add @acme/capture --native rust --to app     # Rust，由 napi-rs（cargo）构建
# 然后：
npm install                                           # 链接这个包并构建插件
npm run rebuild -w @acme/capture
npm test -w @acme/capture
```

| 构建系统 | 包含的文件 | 构建所需 |
|---|---|---|
| `gyp`（默认） | `binding.gyp`、`cpp/binding.cc` | Python 和 C++ 工具链：macOS 上为 Xcode 命令行工具，Linux 上为 build-essential，Windows 上为 Visual Studio Build Tools |
| `cmake` | `CMakeLists.txt`、`cpp/binding.cc` | CMake 和 C++ 工具链 |
| `rust` | `Cargo.toml`、`build.rs`、`rust/lib.rs` | Rust（rustup） |

每个原生插件包还包含：`src/index.ts`，用于加载插件并为其提供类型化的 API；一个测试（`src/tests/index.spec.ts`）；将 `src` 编译到 `dist` 的 `tsconfig.json`；以及一个 `README.md`。C++ 插件：

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

Rust 插件：

```rust
use napi_derive::napi;

/// Greet someone: greet(name)
#[napi]
pub fn greet(name: String) -> String {
    format!("Hello, {} (native)", name)
}
```

以及 `src/index.ts`，其内容在三种构建系统中相同：

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

| 脚本 | 作用 |
|---|---|
| `install` | 安装该包时（`npm install`）构建插件 |
| `build:native` | 将插件构建到 `build/Release/<name>.node` |
| `build` | 将 TypeScript 编译到 `dist` |
| `rebuild` | 先执行 `clean`，再执行 `build:native` 和 `build` |
| `test` | 运行测试（`node --test`） |
| `clean`、`clean:native` | 删除 `dist`，或删除插件的构建结果（`build`，Rust 还有 `target`） |

- **错误**：node-addon-api 的 C++ 异常会作为同类错误抛到 JavaScript 中（`Napi::TypeError` 变为 `TypeError`）。在 Rust 中，参数类型错误时，napi-rs 会抛出一个 `Error`，其 `code` 说明原因（`StringExpected`）。
- **macOS**：C++ 插件在同一个文件中同时为 Intel 芯片和 Apple 芯片的 Mac 构建；Rust 插件仅为本机的架构构建（可用 `rustup target add` 添加其他架构）。
- **Node-API**：插件针对 Node-API 第 8 版构建，所有受支持的 Node.js 和 Electron 版本都提供该版本，因此无需为各个版本分别重新构建。
- **CommonJS**：该包是 CommonJS 包（`"type": "commonjs"`）。`lakutata package` 生成的文件采用 CommonJS 格式，并通过 `require` 加载该包，而 `require` 只有在 Node.js 20.19、22.12 或更高版本中才能加载 ES 模块。
- 与 `lakutata add` 创建的所有包一样，该包设置了 `"private": true`，因为原生插件通常随应用一起发布，而不单独发布。

## 2. 链接库

在插件的目录中运行 `lakutata native <link|include|define> <value>`，会修改插件的构建文件（`binding.gyp`、`CMakeLists.txt`，Rust 插件则为 `.cargo/config.toml`）。构建文件就地修改，其中的注释和格式保持不变，插件的源码不受影响。重复执行同一修改不会改变任何内容。

```bash
lakutata native link z                              # 系统的库（-lz）
lakutata native link ws2_32 --platform win          # 系统的库，只用于 Windows
lakutata native link zlib --pkg-config              # 由 pkg-config 查找的库（不用于 Windows）
lakutata native link CoreFoundation --framework     # macOS 的框架
lakutata native link deps/lib/libfoo.a              # 包中的静态库，链接进插件
lakutata native link deps/lib/libbar.dylib          # 包中的动态库，随插件一起发布
lakutata native include deps/include                # 头文件目录（C++）
lakutata native define TRACE_LEVEL=3                # 预处理器的宏定义（C++）
lakutata native link libc --crate                   # 一个 crate（Rust：cargo add）
```

```
✔ Linked deps/lib/libbar.dylib (gyp): binding.gyp
```

- **文件还是系统的库**：含有 `/` 或者以 `.a`、`.lib`、`.so`、`.dylib`、`.dll` 结尾的值表示包中的文件；其他值表示系统中某个库的名称。这些文件必须位于包内，因为这些文件会随包一起发布；头文件目录或位于包内，或为系统中的绝对路径。
- **修改适用的平台**：库文件自身决定适用的平台（`.dylib` 为 macOS，`.so` 为 Linux，`.dll` 和 `.lib` 为 Windows，`.a` 为除 Windows 以外的所有平台）；`--framework` 表示 macOS，`--pkg-config` 表示除 Windows 以外的所有平台，`--platform mac|linux|win` 指定一个平台。修改针对的平台不是本机平台时，命令会给出提示（`! The change is for win: it is built and tried there`）。
- **动态库**在构建插件时被复制到插件旁边，运行时插件通过其 rpath（macOS 上为 `@loader_path`，Linux 上为 `$ORIGIN`）在该位置找到这些动态库。在 macOS 上，库的安装名称（install name）必须是 `@rpath/libbar.dylib`（`install_name_tool -id @rpath/libbar.dylib deps/lib/libbar.dylib`），否则命令会给出提醒。在 Windows 上，DLL 通过其导入库链接，导入库必须位于 DLL 旁边（`deps/lib/bar.dll` 和 `deps/lib/bar.lib`）。
- **Rust 插件**通过 `build.rs` 链接原生库，`build.rs` 从 `.cargo/config.toml` 读取这些库（这些库由 `lakutata native link` 写入该文件）。`include`、`define` 和 `--pkg-config` 会被拒绝，因为 Rust 通过 crate 实现这些功能（`--crate` 通过 `cargo add` 添加一个 crate，该命令会在 crate 的仓库中查找该 crate）。
- **多个目标**：构建文件声明了多个目标时，用 `--target <name>` 选择要修改的目标。

各构建系统中每种修改写入的内容：

| | gyp | CMake | Rust |
|---|---|---|---|
| 文件 | `binding.gyp`，或其所包含的、声明该目标的 `.gypi` | `CMakeLists.txt` | `.cargo/config.toml`（`[env]`），由 `build.rs` 读取 |
| 库 | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | `-sys` crate |
| 框架 | `xcode_settings.OTHER_LDFLAGS` | `if(APPLE)` 中的 `-framework` | `rustc-link-lib=framework=` |
| 动态库 | `copies`、rpath | `INSTALL_RPATH`（`BUILD_WITH_INSTALL_RPATH`）、一个 `POST_BUILD` 复制命令 | `rustc-cdylib-link-arg`、`build:native` 中的复制命令 |
| 头文件、宏定义 | `include_dirs`、`defines` | `target_include_directories`、`target_compile_definitions` | 无（使用 crate） |
| 平台 | `conditions`（`OS=="mac"`、`OS!="win"`） | `if(APPLE)`、`if(WIN32)`、`if(NOT WIN32)`、`if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`、`_LINUX`、`_WINDOWS`、`_UNIX` |

例如，`link deps/lib/libbar.dylib` 将 rpath、库以及复制该库的命令写入 `binding.gyp` 的 macOS 条件中：

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

（此处省略了生成文件中的注释。）

## 3. 其他构建选项

生成的 `binding.gyp` 和 `CMakeLists.txt` 中的注释给出了 `lakutata native` 不会写入的写法：

- C++ 标准（`binding.gyp`：macOS 上为 `CLANG_CXX_LANGUAGE_STANDARD`，Linux 上为 `cflags_cc`，Windows 上为 `/std:`；`CMakeLists.txt` 设置为 Node.js 头文件所要求的 C++20）；
- 某个平台专用的选项，写在 `binding.gyp` 的 `conditions` 中；
- 在 `CMakeLists.txt` 中，CMake 的包（`find_package(ZLIB REQUIRED)`），或者从自身源码构建的库（`add_subdirectory(deps/foo)`）。

由自身 Makefile 构建的库，由包中的一个脚本在插件之前构建：

```json
{
  "scripts": {
    "build:deps": "make -C deps/foo",
    "build:native": "npm run build:deps && node-gyp rebuild"
  }
}
```

## 4. 发布原生插件

应用依赖该插件包，并像导入其他包一样将其导入（`import {greet} from '@acme/capture'`）。

- **单文件包和可执行文件**：`lakutata package bundle` 将插件包排除在单文件包之外，并将插件包连同其文件（JavaScript、插件本身及插件的动态库，但不包括源码和构建时产生的文件）写入 `dist/<name>.native/`。该目录随单文件包一起发布；可执行文件则将这些插件包嵌入自身，或者在目录布局中将其放在可执行文件旁边（见[打包](Packaging.md)）。插件按执行打包的机器的平台构建，因此每个平台的应用需要在该平台上打包（使用 CI 的矩阵，Linux 也可以使用对应架构的容器）。
- **基于框架的插件包**（依赖 `lakutata` 或 `@lakutata/core` 的插件包，例如为了提供一个组件）则与应用一起打进单文件包，从而保证框架只有一份，只有插件及其旁边的文件放入该目录。只有以下列方式之一加载的插件才会被放入该目录：像 `lakutata add` 生成的插件包那样，将包的目录交给 `node-gyp-build`；直接 `require` 插件文件；或者使用从模块位置构造的路径（`path.join(__dirname, 'prebuilds', ...)`）。对于以其他方式加载的插件，`lakutata package` 会发出警告。
- **Electron**：插件按安装时的原样复制。`lakutata add` 创建的插件无需重新构建即可在 Electron 中运行，所有基于 Node-API 的插件都是如此；对于基于 Node.js V8 API 的插件，打包前需要安装其为 Electron 构建的版本（`electron-rebuild`）。
- **NW.js**：应用在 NW.js 中运行时（`lakutata nwjs run`，以及打包之后），插件会经过处理，以便在 NW.js 中加载。为运行时以外的架构构建的插件会从源码重新构建，并使用 NW.js 内置 Node.js 的头文件；基于 Node.js V8 API 的插件也会重新构建，并使用 NW.js 的头文件（需要 NW.js 0.111.3 及以后的版本；更早的版本，例如用于 Windows 7 的 0.72，只能运行基于 Node-API 的插件）。在 Windows 上，插件加载的是 NW.js 的 Node.js（`node.dll`）。项目中的插件保持原样，项目的测试仍然使用 Node.js 运行。
- **手机应用**（React Native）：`lakutata mobile stage` 会基于应用内嵌的 libnode，从源码为 Android、iOS 和鸿蒙编译插件（见 `@lakutata/cli` README 中的 `lakutata mobile` 命令）。
- **Bun**：Bun 可以加载 Node-API 的插件；Bun 可执行文件会对基于 Node.js V8 API 的插件发出警告。
- **Alpine（musl）**：在 Alpine 上，Node.js 的可执行文件无法加载原生插件，因此请使用 Bun 制作可执行文件。
