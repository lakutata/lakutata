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
    'node-gyp': '^13.1.0'
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
     * A native addon (C++, node-addon-api, built by node-gyp, loaded by node-gyp-build)
     */
    native: boolean
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
 * The files of a native addon: its C++ (node-addon-api) built by node-gyp into build/Release, loaded by node-gyp-build
 * from the TypeScript compiled into dist (node-gyp owns build)
 * @param name
 * @param version
 */
function NativeFiles(name: string, version: string): Files {
    const target: string = name.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9_]/g, '_')
    return {
        'package.json': `${JSON.stringify({
            name: name,
            version: version,
            private: true,
            type: 'module',
            main: 'dist/index.js',
            types: 'dist/index.d.ts',
            exports: {'.': {types: './dist/index.d.ts', default: './dist/index.js'}},
            gypfile: true,
            files: ['dist', '!dist/tests', 'cpp', 'binding.gyp'],
            scripts: {
                //The addon is built when the package is installed (from its sources, without prebuilt binaries)
                install: 'node-gyp-build',
                clean: 'lakutata clean',
                'clean:native': 'lakutata clean build',
                'build:native': 'node-gyp rebuild',
                build: 'tsc',
                rebuild: 'npm run clean && npm run build:native && npm run build',
                test: 'node --test "dist/tests/**/*.spec.js"'
            },
            dependencies: {
                'node-addon-api': NATIVE_VERSIONS['node-addon-api'],
                'node-gyp-build': NATIVE_VERSIONS['node-gyp-build']
            },
            devDependencies: {
                'node-gyp': NATIVE_VERSIONS['node-gyp']
            }
        }, null, 2)}\n`,
        'binding.gyp': `${JSON.stringify({
            targets: [{
                target_name: target,
                sources: ['cpp/binding.cc'],
                include_dirs: ['<!@(node -p "require(\'node-addon-api\').include")'],
                //The C++ exceptions of node-addon-api on every platform
                dependencies: ['<!(node -p "require(\'node-addon-api\').targets"):node_addon_api_except'],
                defines: ['NAPI_VERSION=8'],
                conditions: [
                    ['OS=="mac"', {
                        xcode_settings: {
                            MACOSX_DEPLOYMENT_TARGET: '11.0',
                            //One addon for the Macs with Intel and with Apple silicon
                            OTHER_CFLAGS: ['-arch x86_64', '-arch arm64'],
                            OTHER_LDFLAGS: ['-arch x86_64', '-arch arm64']
                        }
                    }],
                    ['OS=="win"', {
                        msvs_settings: {VCCLCompilerTool: {AdditionalOptions: ['/utf-8']}}
                    }]
                ]
            }]
        }, null, 2)}\n`,
        'cpp/binding.cc': `#include <napi.h>

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
`,
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
 * The addon built by node-gyp (build/Release), loaded from the directory of the package
 */
const binding: Binding = createRequire(import.meta.url)('node-gyp-build')(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

/**
 * Greet someone, in C++
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
    it('greets in C++', (): void => {
        assert.strictEqual(Greet('lakutata'), 'Hello, lakutata (native)')
    })

    it('throws the errors of C++ as JavaScript errors', (): void => {
        assert.throws((): unknown => Greet(42 as unknown as string), {name: 'TypeError', message: 'The name must be a string'})
    })
})
`,
        'tsconfig.json': TSConfig('dist'),
        'README.md': `# ${name}\n\nA native addon: C++ with [node-addon-api](https://github.com/nodejs/node-addon-api) (Node-API, so the same addon runs in\nNode.js and Electron), built by node-gyp, loaded by node-gyp-build.\n\n\`\`\`bash\nnpm run rebuild   # build the addon (build/Release) and compile the TypeScript (dist)\nnpm test          # run the tests\n\`\`\`\n\nBuilding the addon needs Python and a C++ toolchain (the Xcode command line tools on macOS, build-essential on Linux,\nthe Visual Studio Build Tools on Windows).\n`
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
    const files: Files = options.native ? NativeFiles(options.name, version) : LibraryFiles(options.name, version)
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
