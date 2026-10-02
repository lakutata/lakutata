import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Workspace, type WorkspacePackage} from './workspace/Workspace.js'

/**
 * The versions of the dependencies of the native addons
 */
const NATIVE_VERSIONS: Record<string, string> = {
    'node-addon-api': '^8.9.2',
    'node-gyp-build': '^4.8.4',
    'node-gyp': '^13.1.0',
    'cmake-js': '^8.0.0',
    '@napi-rs/cli': '^3.10.6'
}

/**
 * The options of the addition of a package
 */
export type AddPackageOptions = {
    /**
     * The name of the package (an npm name, scoped or not)
     */
    name: string
    /**
     * A native addon, by its build system: gyp (C++, node-gyp), cmake (C++, cmake-js) or rust (napi-rs)
     */
    native?: NativeBuild
    /**
     * The package of the workspace depending on it
     */
    to?: string
}

/**
 * The package added
 */
export type AddPackageResult = {
    /**
     * Its directory
     */
    directory: string
    /**
     * Its files, relative to its directory
     */
    files: string[]
    /**
     * Its version, the one of the workspace
     */
    version: string
    /**
     * The package depending on it
     */
    to?: string
}

/**
 * The files of a package, by path relative to its directory
 */
type Files = Record<string, string>

/**
 * The compiler options of the packages (as the ones of the templates), their declarations emitted for the packages
 * depending on them
 * @param outDir
 */
function TSConfig(outDir: string): string {
    return `${JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            lib: ['ES2022'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            rootDir: 'src',
            outDir: outDir,
            declaration: true,
            types: ['node'],
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true
        },
        include: ['src']
    }, null, 2)}\n`
}

/**
 * The files of a TypeScript package
 * @param name
 * @param version
 */
function LibraryFiles(name: string, version: string): Files {
    return {
        'package.json': `${JSON.stringify({
            name: name,
            version: version,
            private: true,
            type: 'module',
            main: 'build/index.js',
            types: 'build/index.d.ts',
            exports: {'.': {types: './build/index.d.ts', default: './build/index.js'}},
            files: ['build', '!build/tests'],
            scripts: {
                clean: 'lakutata clean',
                build: 'tsc',
                rebuild: 'npm run clean && npm run build',
                test: 'node --test "build/tests/**/*.spec.js"'
            }
        }, null, 2)}\n`,
        'tsconfig.json': TSConfig('build'),
        'src/index.ts': `/**
 * Greet someone
 * @param name
 */
export function Greet(name: string): string {
    return \`Hello, \${name}\`
}
`,
        'src/tests/index.spec.ts': `import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Greet} from '../index.js'

describe('${name}', (): void => {
    it('greets', (): void => {
        assert.strictEqual(Greet('lakutata'), 'Hello, lakutata')
    })
})
`,
        'README.md': `# ${name}\n\n\`\`\`bash\nnpm run rebuild   # compile\nnpm test          # run the tests\n\`\`\`\n`
    }
}

/**
 * The build systems of the native addons
 */
export type NativeBuild = 'gyp' | 'cmake' | 'rust'

/**
 * The build files of an addon built by node-gyp: binding.gyp, its options commented
 * @param target
 */
function GypFiles(target: string): Files {
    return {
        'binding.gyp': `# The build of the addon by node-gyp (gyp: a Python literal, its comments start with #)
{
  'targets': [
    {
      'target_name': '${target}',
      'sources': ['cpp/binding.cc'],
      # The C++ exceptions of node-addon-api (thrown in JavaScript as errors) on every platform
      'dependencies': ["<!(node -p \\"require('node-addon-api').targets\\"):node_addon_api_except"],
      'defines': ['NAPI_VERSION=8'],
      'include_dirs': [
        # The headers of the addon and of its libraries: 'deps/include'
      ],
      'libraries': [
        # A library of the system: '-lpcap' (Linux, macOS), 'ws2_32.lib' (Windows, in its condition below)
        # A static library of the package: '<(module_root_dir)/deps/lib/libfoo.a'
        # A library found by pkg-config: '<!@(pkg-config --libs libpcap)' (its headers in include_dirs:
        #   '<!@(pkg-config --cflags-only-I libpcap | sed s/-I//g)')
        # A dynamic library shipped with the addon (deps/lib/libfoo.so, .dylib): '-L<(module_root_dir)/deps/lib', '-lfoo',
        #   copied next to the addon (copies below) and found there at run time (the rpath of the conditions below)
      ],
      # 'copies': [{'destination': '<(PRODUCT_DIR)', 'files': ['<(module_root_dir)/deps/lib/libfoo.so']}],
      'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            'MACOSX_DEPLOYMENT_TARGET': '11.0',
            # One addon for the Macs with Intel and with Apple silicon
            'OTHER_CFLAGS': ['-arch x86_64', '-arch arm64'],
            'OTHER_LDFLAGS': [
              '-arch x86_64', '-arch arm64',
              # The dynamic libraries shipped with the addon, found next to it: '-Wl,-rpath,@loader_path'
              # A framework of the system: '-framework CoreFoundation'
            ],
            # The standard of C++: 'CLANG_CXX_LANGUAGE_STANDARD': 'c++20'
          }
        }],
        ['OS=="linux"', {
          'ldflags': [
            # The dynamic libraries shipped with the addon, found next to it: "-Wl,-rpath,'$$ORIGIN'"
          ],
          # The standard of C++: 'cflags_cc': ['-std=c++20']
        }],
        ['OS=="win"', {
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': ['/utf-8']
              # The standard of C++: '/std:c++20'
            }
          },
          'libraries': [
            # A library of the system: 'ws2_32.lib', 'iphlpapi.lib'
          ]
        }]
      ]
    }
  ]
}
`,
        'cpp/binding.cc': CppBinding(target)
    }
}

/**
 * The build files of an addon built by cmake-js: CMakeLists.txt, its options commented
 * @param target
 */
function CMakeFiles(target: string): Files {
    return {
        'CMakeLists.txt': `# The build of the addon by cmake-js (npm run build:native)
cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)
cmake_policy(SET CMP0042 NEW)

# One addon for the Macs with Intel and with Apple silicon (forced: cmake-js gives the architecture of the machine)
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "The architectures of macOS" FORCE)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")

project(${target})

# The standard of C++: the headers of Node.js (and node-addon-api) need C++20, as node-gyp gives it
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(\${PROJECT_NAME} SHARED cpp/binding.cc \${CMAKE_JS_SRC})
set_target_properties(\${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# The headers of Node.js and of node-addon-api; the C++ exceptions thrown in JavaScript as errors
execute_process(COMMAND node -p "require('node-addon-api').include" WORKING_DIRECTORY \${CMAKE_SOURCE_DIR} OUTPUT_VARIABLE NODE_ADDON_API_DIR)
string(REGEX REPLACE "[\\r\\n\\"]" "" NODE_ADDON_API_DIR \${NODE_ADDON_API_DIR})
target_include_directories(\${PROJECT_NAME} PRIVATE \${CMAKE_JS_INC} \${NODE_ADDON_API_DIR})
target_compile_definitions(\${PROJECT_NAME} PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS)
if(MSVC)
    target_compile_options(\${PROJECT_NAME} PRIVATE /utf-8 /EHsc)
endif()
target_link_libraries(\${PROJECT_NAME} \${CMAKE_JS_LIB})

# The libraries of the addon:
# - a library of the system: target_link_libraries(\${PROJECT_NAME} pcap) (Windows: ws2_32)
# - a library found by pkg-config:
#     find_package(PkgConfig REQUIRED)
#     pkg_check_modules(PCAP REQUIRED libpcap)
#     target_include_directories(\${PROJECT_NAME} PRIVATE \${PCAP_INCLUDE_DIRS})
#     target_link_libraries(\${PROJECT_NAME} \${PCAP_LIBRARIES})
# - a package of CMake: find_package(ZLIB REQUIRED) then target_link_libraries(\${PROJECT_NAME} ZLIB::ZLIB)
# - a static library of the package: target_link_libraries(\${PROJECT_NAME} \${CMAKE_SOURCE_DIR}/deps/lib/libfoo.a)
# - a library built from its sources (its own CMakeLists.txt): add_subdirectory(deps/foo) then
#     target_link_libraries(\${PROJECT_NAME} foo)
# - a dynamic library shipped with the addon (deps/lib), copied next to it and found there at run time:
#     target_link_libraries(\${PROJECT_NAME} \${CMAKE_SOURCE_DIR}/deps/lib/libfoo.so)
#     set_target_properties(\${PROJECT_NAME} PROPERTIES BUILD_RPATH "$<IF:$<PLATFORM_ID:Darwin>,@loader_path,$ORIGIN>")
#     add_custom_command(TARGET \${PROJECT_NAME} POST_BUILD COMMAND \${CMAKE_COMMAND} -E copy \${CMAKE_SOURCE_DIR}/deps/lib/libfoo.so $<TARGET_FILE_DIR:\${PROJECT_NAME}>)

# The import library of Node.js on Windows
if(MSVC AND CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
    execute_process(COMMAND \${CMAKE_AR} /def:\${CMAKE_JS_NODELIB_DEF} /out:\${CMAKE_JS_NODELIB_TARGET} \${CMAKE_STATIC_LINKER_FLAGS})
endif()
`,
        'cpp/binding.cc': CppBinding(target)
    }
}

/**
 * The build files of an addon of Rust built by napi-rs: Cargo.toml, build.rs and rust/lib.rs
 * @param target
 * @param version
 */
function RustFiles(target: string, version: string): Files {
    return {
        'Cargo.toml': `[package]
name = "${target}"
version = "${version.replace(/[-+].*$/, '')}"
edition = "2021"

[lib]
crate-type = ["cdylib"]
path = "rust/lib.rs"

[dependencies]
# Node-API: the same addon runs in Node.js and Electron
napi = { version = "3", default-features = false, features = ["napi8"] }
napi-derive = "3"
# The crates of the addon: their native libraries are built and linked by cargo (their build.rs)

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
strip = "symbols"
`,
        'build.rs': `fn main() {
    napi_build::setup();
    // The native libraries of the addon (beside its crates): a library of the system, a static library of the package
    // println!("cargo:rustc-link-lib=pcap");
    // println!("cargo:rustc-link-search=native=deps/lib");
    // println!("cargo:rustc-link-lib=static=foo");
}
`,
        'rust/lib.rs': `use napi_derive::napi;

/// Greet someone: greet(name)
#[napi]
pub fn greet(name: String) -> String {
    format!("Hello, {} (native)", name)
}
`
    }
}

/**
 * The C++ of an addon (node-addon-api)
 * @param target
 */
function CppBinding(target: string): string {
    return `#include <napi.h>

/**
 * Greet someone: greet(name)
 */
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

NODE_API_MODULE(${target}, Init)
`
}

/**
 * How the libraries and the options of the build are given, by build system
 */
const NATIVE_GUIDES: Record<NativeBuild, string> = {
    gyp: `C++ with [node-addon-api](https://github.com/nodejs/node-addon-api), built by node-gyp from \`binding.gyp\`.

The libraries and the options of the build are given in \`binding.gyp\`, whose comments show them: the libraries of
the system (\`-lpcap\`, \`ws2_32.lib\`, the frameworks of macOS), the ones found by pkg-config, the static libraries
of the package, the dynamic libraries shipped with the addon (copied next to it, found there at run time by its rpath:
\`$ORIGIN\` on Linux, \`@loader_path\` on macOS), the standard of C++, the options of each platform (\`conditions\`).`,
    cmake: `C++ with [node-addon-api](https://github.com/nodejs/node-addon-api), built by [cmake-js](https://github.com/cmake-js/cmake-js)
from \`CMakeLists.txt\`.

The libraries and the options of the build are given in \`CMakeLists.txt\`, whose comments show them: the libraries of
the system, the ones found by pkg-config or by \`find_package\`, the static libraries of the package, the libraries built
from their sources (\`add_subdirectory\`), the dynamic libraries shipped with the addon (copied next to it, found there
at run time by its rpath). The headers of Node.js need C++20 (\`CMAKE_CXX_STANDARD\`).`,
    rust: `Rust with [napi-rs](https://napi.rs), built by cargo (\`Cargo.toml\`, \`build.rs\`, \`rust/lib.rs\`).

The libraries of the addon are crates (\`Cargo.toml\`), their native libraries built and linked by cargo; the other
native libraries are linked by \`build.rs\`, whose comments show how. The addon is built for the platform and the
architecture of the machine (\`rustup target add\` builds the other ones).`
}

/**
 * The files of a native addon: built into build/Release (gyp, cmake-js, napi-rs), loaded by node-gyp-build from the
 * TypeScript compiled into dist (the build systems own build)
 * @param name
 * @param version
 * @param build
 */
function NativeFiles(name: string, version: string, build: NativeBuild): Files {
    const target: string = name.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9_]/g, '_')
    const builds: Record<NativeBuild, { files: Files, buildNative: string, install: string, sources: string[], dependencies: Record<string, string>, devDependencies: Record<string, string>, toolchain: string }> = {
        gyp: {
            files: GypFiles(target),
            buildNative: 'node-gyp rebuild',
            //Built when installed (node-gyp-build builds it without prebuilt binaries)
            install: 'node-gyp-build',
            sources: ['cpp', 'binding.gyp'],
            dependencies: {'node-addon-api': NATIVE_VERSIONS['node-addon-api'], 'node-gyp-build': NATIVE_VERSIONS['node-gyp-build']},
            devDependencies: {'node-gyp': NATIVE_VERSIONS['node-gyp']},
            toolchain: 'Python and a C++ toolchain (the Xcode command line tools on macOS, build-essential on Linux, the Visual Studio Build Tools on Windows)'
        },
        cmake: {
            files: CMakeFiles(target),
            buildNative: 'cmake-js rebuild',
            install: 'cmake-js compile',
            sources: ['cpp', 'CMakeLists.txt'],
            dependencies: {'node-addon-api': NATIVE_VERSIONS['node-addon-api'], 'node-gyp-build': NATIVE_VERSIONS['node-gyp-build'], 'cmake-js': NATIVE_VERSIONS['cmake-js']},
            devDependencies: {},
            toolchain: 'CMake and a C++ toolchain (the Xcode command line tools on macOS, build-essential on Linux, the Visual Studio Build Tools on Windows)'
        },
        rust: {
            files: RustFiles(target, version),
            buildNative: 'napi build --release --output-dir build/Release',
            install: 'napi build --release --output-dir build/Release',
            sources: ['rust', 'Cargo.toml', 'build.rs'],
            dependencies: {'node-gyp-build': NATIVE_VERSIONS['node-gyp-build'], '@napi-rs/cli': NATIVE_VERSIONS['@napi-rs/cli']},
            devDependencies: {},
            toolchain: 'Rust (rustup, or the package manager of the system)'
        }
    }
    const chosen = builds[build]
    return {
        'package.json': `${JSON.stringify({
            name: name,
            version: version,
            private: true,
            type: 'module',
            main: 'dist/index.js',
            types: 'dist/index.d.ts',
            exports: {'.': {types: './dist/index.d.ts', default: './dist/index.js'}},
            ...(build === 'gyp' ? {gypfile: true} : {}),
            ...(build === 'rust' ? {napi: {binaryName: target}} : {}),
            files: ['dist', '!dist/tests', ...chosen.sources],
            scripts: {
                //The addon is built when the package is installed (from its sources, without prebuilt binaries)
                install: chosen.install,
                clean: 'lakutata clean',
                'clean:native': build === 'rust' ? 'lakutata clean build target' : 'lakutata clean build',
                'build:native': chosen.buildNative,
                build: 'tsc',
                rebuild: 'npm run clean && npm run build:native && npm run build',
                test: 'node --test "dist/tests/**/*.spec.js"'
            },
            dependencies: chosen.dependencies,
            ...(Object.keys(chosen.devDependencies).length ? {devDependencies: chosen.devDependencies} : {})
        }, null, 2)}\n`,
        ...chosen.files,
        'src/index.ts': `import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The functions of the addon
 */
type Binding = {
    greet(name: string): string
}

/**
 * The addon built into build/Release, loaded from the directory of the package
 */
const binding: Binding = createRequire(import.meta.url)('node-gyp-build')(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

/**
 * Greet someone, in ${build === 'rust' ? 'Rust' : 'C++'}
 * @param name
 */
export function Greet(name: string): string {
    return binding.greet(name)
}
`,
        'src/tests/index.spec.ts': `import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Greet} from '../index.js'

describe('${name}', (): void => {
    it('greets in ${build === 'rust' ? 'Rust' : 'C++'}', (): void => {
        assert.strictEqual(Greet('lakutata'), 'Hello, lakutata (native)')
    })

    it('throws the errors of the addon as JavaScript errors', (): void => {
        assert.throws((): unknown => Greet(42 as unknown as string), ${build === 'rust' ? '/String/' : "{name: 'TypeError', message: 'The name must be a string'}"})
    })
})
`,
        'tsconfig.json': TSConfig('dist'),
        'README.md': `# ${name}

A native addon: ${NATIVE_GUIDES[build]}

Node-API is stable across the versions of Node.js and Electron: the same addon runs in both without being rebuilt.
\`lakutata bundle\` and \`lakutata executable\` ship it with the application.

\`\`\`bash
npm run rebuild   # build the addon (build/Release) and compile the TypeScript (dist)
npm test          # run the tests
\`\`\`

A library built by its own Makefile (or its own build) is built before the addon by a script, then linked by it:
\`"build:deps": "make -C deps/foo"\`, \`"build:native": "npm run build:deps && ${chosen.buildNative}"\`.

Building the addon needs ${chosen.toolchain}.
`
    }
}

/**
 * Add a package to the workspace of the current directory: packages/<name> (without its scope), of the version of the
 * workspace; a package of the workspace may depend on it
 * @param options
 */
export async function AddPackage(options: AddPackageOptions): Promise<AddPackageResult> {
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(options.name)) throw new Error(`"${options.name}" is not a name of package (lower case, digits, - . _ ~, an optional @scope/)`)
    const workspace: Workspace = await Workspace.find()
    if (workspace.packages.some((pkg: WorkspacePackage): boolean => pkg.name === options.name)) throw new Error(`The workspace has already a package ${options.name}`)
    const dependent: WorkspacePackage | undefined = options.to === undefined ? undefined : workspace.packages.find((pkg: WorkspacePackage): boolean => pkg.name === options.to)
    if (options.to !== undefined && !dependent) throw new Error(`The workspace has no package ${options.to} (${workspace.packages.map((pkg: WorkspacePackage): string => pkg.name).join(', ')})`)
    const directory: string = path.join(workspace.root, 'packages', options.name.replace(/^@[^/]+\//, ''))
    if (existsSync(directory)) throw new Error(`${path.relative(process.cwd(), directory) || directory} exists already`)
    const version: string = workspace.lerna?.data.version ?? workspace.manifest.data.version ?? '0.0.1'
    const files: Files = options.native ? NativeFiles(options.name, version, options.native) : LibraryFiles(options.name, version)
    for (const [file, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(directory, file)), {recursive: true})
        await writeFile(path.join(directory, file), content)
    }
    if (dependent) {
        dependent.manifest.data.dependencies = {...(dependent.manifest.data.dependencies ?? {}), [options.name]: `^${version}`}
        await dependent.manifest.write()
    }
    return {directory: directory, files: Object.keys(files), version: version, to: dependent?.name}
}
