# Lakutata 原生插件

原生插件是用 C++ 或 Rust 编写、由 Node.js 以 `.node` 文件加载的库：用于驱动和设备、编解码、系统 API，或者必须跑得快的代码。`lakutata add --native` 在工作区中创建一个原生插件包，可以直接构建和测试；`lakutata native` 给它链接库；`lakutata package` 把它和应用一起发布。这些插件使用 Node-API，所以同一份构建能在所有受支持的 Node.js 版本和 Electron 中运行。不写插件、直接调用库里的 C 函数，见 [FFI](FFI.md)。

## 1. 创建原生插件

在工作区中（见 [Workspaces](Workspaces.md)）：

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

| 构建系统 | 它的文件 | 构建需要 |
|---|---|---|
| `gyp`（默认） | `binding.gyp`、`cpp/binding.cc` | Python 和 C++ 工具链：macOS 上是 Xcode 命令行工具，Linux 上是 build-essential，Windows 上是 Visual Studio Build Tools |
| `cmake` | `CMakeLists.txt`、`cpp/binding.cc` | CMake 和 C++ 工具链 |
| `rust` | `Cargo.toml`、`build.rs`、`rust/lib.rs` | Rust（rustup） |

每个原生插件包还有：加载插件并给它提供类型化 API 的 `src/index.ts`，一个测试（`src/tests/index.spec.ts`），把 `src` 编译到 `dist` 的 `tsconfig.json`，以及一个 `README.md`。C++ 插件：

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

还有 `src/index.ts`，三种构建系统都一样：

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

| 脚本 | 作用 |
|---|---|
| `install` | 安装这个包时（`npm install`）构建插件 |
| `build:native` | 把插件构建到 `build/Release/<name>.node` |
| `build` | 把 TypeScript 编译到 `dist` |
| `rebuild` | 先 `clean`，再 `build:native` 和 `build` |
| `test` | 运行测试（`node --test`） |
| `clean`、`clean:native` | 删除 `dist`，或删除插件的构建结果（`build`，Rust 还有 `target`） |

- **错误**：node-addon-api 的 C++ 异常会以同类错误抛到 JavaScript 中（`Napi::TypeError` 变成 `TypeError`）。在 Rust 中，类型不对的参数由 napi-rs 拒绝，抛出一个 `Error`，它的 `code` 说明原因（`StringExpected`）。
- **macOS**：C++ 插件在一个文件中同时为 Intel 和 Apple 芯片的 Mac 构建；Rust 插件只为本机的架构构建（用 `rustup target add` 添加其他架构）。
- **Node-API**：插件针对 Node-API 第 8 版构建，所有受支持的 Node.js 和 Electron 版本都提供这一版，所以不需要为它们分别重新构建。
- 和 `lakutata add` 创建的所有包一样，这个包是 `"private": true`：原生插件通常随应用一起发布，而不单独发布。

## 2. 链接库

在插件的目录中运行 `lakutata native <link|include|define> <value>`，会修改它的构建文件（`binding.gyp`、`CMakeLists.txt`，Rust 则是 `.cargo/config.toml`）。文件就地修改，保留其中的注释和格式，插件的源码不受影响。同样的修改再执行一次不会改变任何内容。

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

- **文件还是系统的库**：含有 `/`，或者以 `.a`、`.lib`、`.so`、`.dylib`、`.dll` 结尾的值，是包中的文件；其他值是系统中某个库的名称。这些文件必须在包内，因为它们要随包一起发布；头文件目录要么在包内，要么是系统中的绝对路径。
- **修改适用的平台**：库文件决定它自己的平台（`.dylib` 是 macOS，`.so` 是 Linux，`.dll` 和 `.lib` 是 Windows，`.a` 是除 Windows 以外的所有平台），`--framework` 表示 macOS，`--pkg-config` 表示除 Windows 以外的所有平台，`--platform mac|linux|win` 指定一个平台。修改针对的不是本机的平台时，命令会提示（`! The change is for win: it is built and tried there`）。
- **动态库**在构建插件时被复制到插件旁边，运行时插件通过它的 rpath（macOS 上是 `@loader_path`，Linux 上是 `$ORIGIN`）在那里找到它们。在 macOS 上，库的安装名称（install name）必须是 `@rpath/libbar.dylib`（`install_name_tool -id @rpath/libbar.dylib deps/lib/libbar.dylib`），不是时命令会提醒你。在 Windows 上，DLL 通过它的导入库链接，导入库必须在它旁边（`deps/lib/bar.dll` 和 `deps/lib/bar.lib`）。
- **Rust 插件**通过 `build.rs` 链接原生库，`build.rs` 从 `.cargo/config.toml` 读取这些库（`lakutata native link` 写在那里）。`include`、`define` 和 `--pkg-config` 会被拒绝，因为 Rust 用 crate 来做这些事（`--crate` 用 `cargo add` 添加一个 crate，它会在 crate 的仓库中查找）。
- **多个目标**：构建文件声明了多个目标时，用 `--target <name>` 选择要修改的那一个。

各构建系统中每种修改写入的内容：

| | gyp | CMake | Rust |
|---|---|---|---|
| 文件 | `binding.gyp`，或它所包含的、声明该目标的 `.gypi` | `CMakeLists.txt` | `.cargo/config.toml`（`[env]`），由 `build.rs` 读取 |
| 库 | `libraries` | `target_link_libraries` | `rustc-link-lib` |
| pkg-config | `<!@(pkg-config ...)` | `pkg_check_modules(... IMPORTED_TARGET ...)` | `-sys` crate |
| 框架 | `xcode_settings.OTHER_LDFLAGS` | `if(APPLE)` 中的 `-framework` | `rustc-link-lib=framework=` |
| 动态库 | `copies`、rpath | `INSTALL_RPATH`（`BUILD_WITH_INSTALL_RPATH`）、一个 `POST_BUILD` 复制命令 | `rustc-cdylib-link-arg`、`build:native` 中的复制命令 |
| 头文件、宏定义 | `include_dirs`、`defines` | `target_include_directories`、`target_compile_definitions` | 无（用 crate） |
| 平台 | `conditions`（`OS=="mac"`、`OS!="win"`） | `if(APPLE)`、`if(WIN32)`、`if(NOT WIN32)`、`if(CMAKE_SYSTEM_NAME STREQUAL "Linux")` | `LAKUTATA_NATIVE_MACOS`、`_LINUX`、`_WINDOWS`、`_UNIX` |

例如，`link deps/lib/libbar.dylib` 把 rpath、库和复制它的命令写入 `binding.gyp` 的 macOS 条件中：

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

（这里省略了生成文件中的注释。）

## 3. 其他构建选项

生成的 `binding.gyp` 和 `CMakeLists.txt` 中的注释给出了 `lakutata native` 不会写入的那些写法：

- C++ 标准（`binding.gyp`：macOS 上是 `CLANG_CXX_LANGUAGE_STANDARD`，Linux 上是 `cflags_cc`，Windows 上是 `/std:`；`CMakeLists.txt` 设置为 C++20，这是 Node.js 的头文件所要求的）；
- 某个平台专用的选项，写在 `binding.gyp` 的 `conditions` 中；
- 在 `CMakeLists.txt` 中，CMake 的包（`find_package(ZLIB REQUIRED)`），或者从自身源码构建的库（`add_subdirectory(deps/foo)`）。

由自己的 Makefile 构建的库，用包中的一个脚本在插件之前构建：

```json
{
  "scripts": {
    "build:deps": "make -C deps/foo",
    "build:native": "npm run build:deps && node-gyp rebuild"
  }
}
```

## 4. 发布原生插件

应用依赖这个插件包，并像导入其他包一样导入它（`import {greet} from '@acme/capture'`）。

- **单文件包和可执行文件**：`lakutata package bundle` 把插件包排除在单文件包之外，连同它们的文件（JavaScript、插件本身、它的动态库，但不包括源码和构建时产生的文件）写入 `dist/<name>.native/`，这个目录随单文件包一起发布；可执行文件则把它们嵌入其中，或者在目录布局中放在自己旁边（见 [Packaging](Packaging.md)）。插件是为打包所在机器的平台构建的，所以每个平台的应用要在那个平台上打包（用 CI 的矩阵，Linux 也可以用对应架构的容器）。
- **Electron**：插件按安装时的样子复制。`lakutata add` 创建的插件不需要重新构建就能在 Electron 中运行，所有基于 Node-API 的插件都是如此；基于 Node.js V8 API 的插件，打包前要安装它为 Electron 构建的版本（`electron-rebuild`）。
- **Bun**：Bun 能加载 Node-API 的插件；Bun 可执行文件会对基于 Node.js V8 API 的插件发出警告。
- **Alpine（musl）**：Node.js 的可执行文件在那里不能加载原生插件，请用 Bun 制作。
