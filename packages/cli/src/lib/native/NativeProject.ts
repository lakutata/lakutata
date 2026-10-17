import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import path from 'node:path'
import {promisify} from 'node:util'
import {findGypTarget, GypDocument, normalizeCondition, type GypDict, type GypNode} from './Gyp.js'
import {cMakeArgumentText, CMakeDocument} from './CMake.js'
import {TomlDocument} from './Toml.js'
import {applyEdits} from './TextEdits.js'

const run = promisify(execFile)

/**
 * The build systems of the native addons
 */
export type NativeBuildSystem = 'gyp' | 'cmake' | 'rust'

/**
 * The platforms of the options of the build, and the ones of a library which is not of Windows
 */
export type NativePlatform = 'mac' | 'linux' | 'win'

type Scope = NativePlatform | 'unix' | undefined

/**
 * A change of the build of a native addon
 */
export type NativeChange = {
    action: 'link' | 'include' | 'define'
    /**
     * The library (a name of the system, a file of the package, a package of pkg-config, a framework, a crate), the
     * directory of headers, the definition (NAME or NAME=value)
     */
    value: string
    platform?: NativePlatform
    pkgConfig?: boolean
    framework?: boolean
    crate?: boolean
    /**
     * The target of the build file changed, its only one by default
     */
    target?: string
}

/**
 * The result of a change
 */
export type NativeChangeResult = {
    build: NativeBuildSystem
    /**
     * The files changed, relative to the package
     */
    files: string[]
    /**
     * What to know (a library to fix, a platform to try)
     */
    notes: string[]
}

/**
 * The build system of a native addon, by its build file
 * @param directory
 */
export function detectBuildSystem(directory: string): NativeBuildSystem {
    const builds: NativeBuildSystem[] = (['gyp', 'cmake', 'rust'] as NativeBuildSystem[]).filter((build: NativeBuildSystem): boolean => existsSync(path.join(directory, {gyp: 'binding.gyp', cmake: 'CMakeLists.txt', rust: 'Cargo.toml'}[build])))
    if (!builds.length) throw new Error(`${directory} is not a native addon (no binding.gyp, CMakeLists.txt nor Cargo.toml)`)
    if (builds.length > 1) throw new Error(`${directory} has the build files of ${builds.join(', ')}: only one build system is changed`)
    return builds[0]
}

/**
 * A library given as a file of the package
 */
type LibraryFile = {
    /**
     * Relative to the package, with /
     */
    file: string
    /**
     * The name of the library (libfoo.a, foo.lib → foo)
     */
    name: string
    kind: 'static' | 'dynamic'
    platform: Scope
}

/**
 * The library of a file of the package, by its extension: static (.a everywhere but Windows, .lib on Windows) or
 * dynamic (.dylib on macOS, .so on Linux, .dll on Windows)
 * @param directory
 * @param value
 */
function libraryOfFile(directory: string, value: string): LibraryFile | undefined {
    if (!/[\\/]/.test(value) && !/\.(a|lib|so(\.\d+)*|dylib|dll)$/.test(value)) return undefined
    const absolute: string = path.resolve(directory, value)
    if (!existsSync(absolute)) throw new Error(`${value} does not exist in ${directory}`)
    const file: string = path.relative(directory, absolute).split(path.sep).join('/')
    if (file.startsWith('..')) throw new Error(`${value} is not in the package: its libraries are shipped with it`)
    const base: string = path.basename(file)
    const name: string = base.replace(/^lib/, '').replace(/\.(a|lib|so(\.\d+)*|dylib|dll)$/, '')
    if (/\.a$/.test(base)) return {file: file, name: name, kind: 'static', platform: 'unix'}
    if (/\.lib$/.test(base)) return {file: file, name: name, kind: 'static', platform: 'win'}
    if (/\.dylib$/.test(base)) return {file: file, name: name, kind: 'dynamic', platform: 'mac'}
    if (/\.so(\.\d+)*$/.test(base)) return {file: file, name: name, kind: 'dynamic', platform: 'linux'}
    if (/\.dll$/.test(base)) return {file: file, name: name, kind: 'dynamic', platform: 'win'}
    throw new Error(`${value} is not a library (.a, .lib, .so, .dylib, .dll)`)
}

/**
 * The import library of a DLL (foo.dll → foo.lib, next to it), which the linker of Windows links
 * @param directory
 * @param library
 */
function importLibrary(directory: string, library: LibraryFile): string {
    const file: string = library.file.replace(/\.dll$/, '.lib')
    if (!existsSync(path.join(directory, file))) throw new Error(`The import library of ${library.file} (${file}) does not exist: Windows links a DLL by its import library`)
    return file
}

/**
 * The scope of a change: its platform, the one of its library, or every platform
 * @param change
 * @param library
 */
function scopeOf(change: NativeChange, library?: LibraryFile): Scope {
    if (change.framework) {
        if (change.platform && change.platform !== 'mac') throw new Error('The frameworks are the libraries of macOS')
        return 'mac'
    }
    if (library && change.platform && library.platform !== 'unix' && change.platform !== library.platform) throw new Error(`${library.file} is a library of ${library.platform}, not of ${change.platform}`)
    if (change.pkgConfig && change.platform === 'win') throw new Error('pkg-config is not on Windows: link the library by its file (deps/lib/foo.lib) or by its name')
    if (change.platform) return change.platform
    if (library) return library.platform
    //pkg-config is not on Windows
    if (change.pkgConfig) return 'unix'
    return undefined
}

/**
 * The notes about a dynamic library of macOS: found through the rpath when its install name is @rpath/…
 * @param directory
 * @param library
 */
async function installNameNotes(directory: string, library: LibraryFile): Promise<string[]> {
    if (library.platform !== 'mac' || library.kind !== 'dynamic' || process.platform !== 'darwin') return []
    try {
        //otool -D prints the file, then its install name (none for a file which is not a dynamic library)
        const {stdout} = await run('otool', ['-D', path.join(directory, library.file)])
        const installName: string | undefined = stdout.trim().split('\n')[1]?.trim()
        if (!installName || installName.startsWith('@rpath/')) return []
        return [`${library.file} is named ${installName}: the addon finds it next to it once its name is @rpath/${path.basename(library.file)} (install_name_tool -id @rpath/${path.basename(library.file)} ${library.file})`]
    } catch {
        return []
    }
}

/**
 * Change a gyp addon
 * @param directory
 * @param change
 * @param library
 * @param scope
 */
async function changeGyp(directory: string, change: NativeChange, library: LibraryFile | undefined, scope: Scope): Promise<string[]> {
    const located = await findGypTarget(path.join(directory, 'binding.gyp'), change.target)
    const name: GypNode | undefined = GypDocument.get(located.target, 'target_name')
    const targetName: string | undefined = name?.kind === 'string' ? name.value : undefined
    let document: GypDocument = located.document
    let changed: boolean = false
    const conditions: Record<string, string> = {mac: 'OS=="mac"', linux: 'OS=="linux"', win: 'OS=="win"', unix: 'OS!="win"'}

    //The target of the document (found again once the document is changed)
    const target = (): GypDict => {
        const targets: GypNode | undefined = GypDocument.get(document.root, 'targets')
        const found: GypNode | undefined = targets?.kind === 'list' ? targets.items.find((item: GypNode): boolean => item.kind === 'dict' && (targetName === undefined || (GypDocument.get(item, 'target_name') as { value?: string } | undefined)?.value === targetName)) : undefined
        if (found?.kind !== 'dict') throw new Error(`The target of ${document.file} is not found`)
        return found
    }
    const commit = (edited: boolean): void => {
        if (!edited) return
        document = document.applied()
        changed = true
    }
    //The dictionary of the scope: the target, or the dictionary of its condition (created when missing)
    const scoped = (): GypDict => {
        if (scope === undefined) return target()
        const condition: string = conditions[scope]
        const find = (): GypDict | undefined => {
            const list: GypNode | undefined = GypDocument.get(target(), 'conditions')
            if (list?.kind !== 'list') return undefined
            for (const item of list.items) {
                if (item.kind === 'list' && item.items[0]?.kind === 'string' && normalizeCondition(item.items[0].value) === normalizeCondition(condition) && item.items[1]?.kind === 'dict') return item.items[1]
            }
            return undefined
        }
        if (!find()) {
            const list: GypNode | undefined = GypDocument.get(target(), 'conditions')
            if (list === undefined) commit(document.addEntry(target(), 'conditions', [[condition, {}]]))
            else if (list.kind === 'list') {
                document.addItem(list, [condition, {}])
                commit(true)
            } else {
                throw new Error(`The conditions of ${document.file} are not a list`)
            }
        }
        return find()!
    }
    //The scope first: creating its condition changes the document
    const add = (key: string, values: string[]): void => {
        const dict: GypDict = scoped()
        commit(document.addToList(dict, key, values))
    }
    const addToDict = (key: string, list: string, values: string[]): void => {
        const scope: GypDict = scoped()
        commit(document.addEntry(scope, key, {}))
        const dict: GypNode | undefined = GypDocument.get(scoped(), key)
        if (dict?.kind !== 'dict') throw new Error(`"${key}" of ${document.file} is not a dictionary`)
        commit(document.addToList(dict, list, values))
    }
    const module = (file: string): string => `<(module_root_dir)/${file}`

    if (change.action === 'define') {
        add('defines', [change.value])
    } else if (change.action === 'include') {
        add('include_dirs', [existsSync(path.join(directory, change.value)) ? module(path.relative(directory, path.resolve(directory, change.value)).split(path.sep).join('/')) : change.value])
    } else if (change.framework) {
        addToDict('xcode_settings', 'OTHER_LDFLAGS', [`-framework ${change.value}`])
    } else if (change.pkgConfig) {
        add('include_dirs', [`<!@(pkg-config --cflags-only-I ${change.value} | sed s/-I//g)`])
        add('libraries', [`<!@(pkg-config --libs ${change.value})`])
    } else if (library?.kind === 'static') {
        add('libraries', [module(library.file)])
    } else if (library?.kind === 'dynamic') {
        //Linux: by its name (-l:libfoo.so), not its path, which the addon would need (a library without its soname)
        add('libraries', library.platform === 'linux'
            ? [`-L${module(path.posix.dirname(library.file))}`, `-l:${path.posix.basename(library.file)}`]
            : [module(library.platform === 'win' ? importLibrary(directory, library) : library.file)])
        //Copied next to the addon, found there at run time
        const scope: GypDict = scoped()
        const copies: GypNode | undefined = GypDocument.get(scope, 'copies')
        const destination: GypNode | undefined = copies?.kind === 'list' ? copies.items.find((item: GypNode): boolean => item.kind === 'dict' && (GypDocument.get(item, 'destination') as { value?: string } | undefined)?.value === '<(PRODUCT_DIR)') : undefined
        if (destination?.kind === 'dict') commit(document.addToList(destination, 'files', [module(library.file)]))
        else if (copies?.kind === 'list') {
            document.addItem(copies, {destination: '<(PRODUCT_DIR)', files: [module(library.file)]})
            commit(true)
        } else {
            commit(document.addEntry(scope, 'copies', [{destination: '<(PRODUCT_DIR)', files: [module(library.file)]}]))
        }
        if (library.platform === 'mac') addToDict('xcode_settings', 'OTHER_LDFLAGS', ['-Wl,-rpath,@loader_path'])
        if (library.platform === 'linux') add('ldflags', ['-Wl,-rpath,\'$$ORIGIN\''])
    } else {
        add('libraries', [scope === 'win' ? `${change.value}.lib` : `-l${change.value}`])
    }
    if (!changed) return []
    await writeFile(document.file, document.text)
    return [path.relative(directory, document.file).split(path.sep).join('/')]
}

/**
 * Change a CMake addon
 * @param directory
 * @param change
 * @param library
 * @param scope
 */
async function changeCMake(directory: string, change: NativeChange, library: LibraryFile | undefined, scope: Scope): Promise<string[]> {
    let document: CMakeDocument = await CMakeDocument.read(path.join(directory, 'CMakeLists.txt'))
    const target = document.target(change.target)
    const conditions: Record<string, string> = {mac: 'APPLE', linux: 'CMAKE_SYSTEM_NAME STREQUAL "Linux"', win: 'WIN32', unix: 'NOT WIN32'}
    let changed: boolean = false
    const source = (file: string): string => `\${CMAKE_SOURCE_DIR}/${file}`
    //The commands not written yet, in the block of the scope, after the commands of the target
    const commands = (lines: string[][]): void => {
        const missing: string[][] = lines.filter((line: string[]): boolean => !document.has(line[0], line.slice(1)))
        if (!missing.length) return
        const current = document.target(change.target)
        document.insertAfterTarget(current, missing.map((line: string[]): string => `${line[0]}(${line.slice(1).map(cMakeArgumentText).join(' ')})`), scope === undefined ? undefined : conditions[scope])
        document = document.applied()
        changed = true
    }
    const name: string = target.text
    //The signature of target_link_libraries the target uses: its uses are all plain or all with keywords (CMP0023)
    const plain: boolean = document.commands.some((command): boolean => command.name === 'target_link_libraries' && command.args.length > 1 &&
        document.resolve(command.args[0].value) === target.name && !['PRIVATE', 'PUBLIC', 'INTERFACE', 'LINK_PRIVATE', 'LINK_PUBLIC', 'LINK_INTERFACE_LIBRARIES'].includes(command.args[1].value))
    const link = (library: string): string[] => ['target_link_libraries', name, ...(plain ? [] : ['PRIVATE']), library]
    if (change.action === 'define') {
        commands([['target_compile_definitions', name, 'PRIVATE', change.value]])
    } else if (change.action === 'include') {
        commands([['target_include_directories', name, 'PRIVATE', existsSync(path.join(directory, change.value)) ? source(path.relative(directory, path.resolve(directory, change.value)).split(path.sep).join('/')) : change.value]])
    } else if (change.framework) {
        commands([link(`-framework ${change.value}`)])
    } else if (change.pkgConfig) {
        const variable: string = change.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        //Found in the block of its platform (pkg-config is not on Windows)
        commands([['find_package', 'PkgConfig', 'REQUIRED'], ['pkg_check_modules', variable, 'REQUIRED', 'IMPORTED_TARGET', change.value], link(`PkgConfig::${variable}`)])
    } else if (library?.kind === 'static') {
        commands([link(source(library.file))])
    } else if (library?.kind === 'dynamic') {
        commands([
            link(source(library.platform === 'win' ? importLibrary(directory, library) : library.file)),
            //The rpath of the addon is its directory only, not the directories of the libraries on the machine building it
            ...(library.platform === 'win' ? [] : [['set_target_properties', name, 'PROPERTIES', 'BUILD_WITH_INSTALL_RPATH', 'ON', 'INSTALL_RPATH', library.platform === 'mac' ? '@loader_path' : '$ORIGIN']]),
            //Copied next to the addon, found there at run time
            ['add_custom_command', 'TARGET', name, 'POST_BUILD', 'COMMAND', '${CMAKE_COMMAND}', '-E', 'copy_if_different', source(library.file), `$<TARGET_FILE_DIR:${name}>`]
        ])
    } else {
        commands([link(change.value)])
    }
    if (!changed) return []
    await writeFile(document.file, document.text)
    return ['CMakeLists.txt']
}

/**
 * Change a Rust addon: its crates by cargo add, its native libraries by the directives of cargo its build.rs gives,
 * written in the environment of .cargo/config.toml (the flags of rustc would be given to its every crate)
 * @param directory
 * @param change
 * @param library
 * @param scope
 */
async function changeRust(directory: string, change: NativeChange, library: LibraryFile | undefined, scope: Scope): Promise<string[]> {
    if (change.action !== 'link') throw new Error(`The Rust addons have no ${change.action === 'include' ? 'directory of headers' : 'definition'} of C: their libraries are crates (--crate), the -sys crates building and linking the native libraries`)
    if (change.pkgConfig) throw new Error('The Rust addons find the libraries of pkg-config by their -sys crates (--crate), whose build scripts use the pkg-config crate')
    if (change.crate) {
        const cfg: Record<string, string> = {mac: 'cfg(target_os = "macos")', linux: 'cfg(target_os = "linux")', win: 'cfg(windows)', unix: 'cfg(unix)'}
        const before: string = await readFile(path.join(directory, 'Cargo.toml'), 'utf8')
        await run('cargo', ['add', change.value, ...(scope === undefined ? [] : ['--target', cfg[scope]])], {cwd: directory})
        return before === await readFile(path.join(directory, 'Cargo.toml'), 'utf8') ? [] : ['Cargo.toml']
    }
    const script: string = path.join(directory, 'build.rs')
    if (!existsSync(script) || !(await readFile(script, 'utf8')).includes('LAKUTATA_NATIVE')) throw new Error('The build.rs of the addon does not give the native libraries of .cargo/config.toml (LAKUTATA_NATIVE): the build.rs of lakutata add --native rust does')
    const file: string = path.join(directory, '.cargo', 'config.toml')
    const document: TomlDocument = await TomlDocument.read(file)
    const directives: string[] = []
    if (change.framework) {
        directives.push(`rustc-link-lib=framework=${change.value}`)
    } else if (library?.kind === 'static') {
        directives.push(`rustc-link-search=native=${path.posix.dirname(library.file)}`, `rustc-link-lib=static=${library.name}`)
    } else if (library?.kind === 'dynamic') {
        if (library.platform === 'win') importLibrary(directory, library)
        //A versioned library (libfoo.so.1) by its file name: -lfoo would find libfoo.so
        const base: string = path.posix.basename(library.file)
        directives.push(`rustc-link-search=native=${path.posix.dirname(library.file)}`, /\.so\.\d/.test(base) ? `rustc-link-lib=dylib:+verbatim=${base}` : `rustc-link-lib=dylib=${library.name}`)
        if (library.platform === 'mac') directives.push('rustc-cdylib-link-arg=-Wl,-rpath,@loader_path')
        if (library.platform === 'linux') directives.push('rustc-cdylib-link-arg=-Wl,-rpath,$ORIGIN')
    } else {
        directives.push(`rustc-link-lib=${change.value}`)
    }
    //The variable of the platform (build.rs reads the ones of its target)
    const variable: string = scope === undefined ? 'LAKUTATA_NATIVE' : `LAKUTATA_NATIVE_${{mac: 'MACOS', linux: 'LINUX', win: 'WINDOWS', unix: 'UNIX'}[scope]}`
    const files: string[] = []
    if (document.addToStringList(['env'], variable, directives, ';')) {
        await mkdir(path.dirname(file), {recursive: true})
        await writeFile(file, applyEdits(document.text, document.changes))
        files.push('.cargo/config.toml')
    }
    if (library?.kind === 'dynamic') {
        //Copied next to the addon by its build (when it is built on the platform of the library), whatever the package
        //manager running it (pnpm runs no post scripts by default)
        const manifestFile: string = path.join(directory, 'package.json')
        const manifest: { scripts?: Record<string, string> } = JSON.parse(await readFile(manifestFile, 'utf8'))
        const copy: string = `node -e "const fs=require('node:fs');if(fs.existsSync('${library.file}'))fs.copyFileSync('${library.file}','build/Release/${path.posix.basename(library.file)}')"`
        const scripts: Record<string, string> = manifest.scripts ?? {}
        const build: string = scripts['build:native'] ?? 'napi build --release --output-dir build/Release'
        if (!build.includes(copy) && !(scripts['postbuild:native'] ?? '').includes(copy)) {
            scripts['build:native'] = `${build} && ${copy}`
            manifest.scripts = scripts
            await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
            files.push('package.json')
        }
    }
    return files
}

/**
 * Change the build of the native addon of a directory: link a library, add a directory of headers, define a macro,
 * in its build file (binding.gyp and the files it includes, CMakeLists.txt, Cargo.toml and .cargo/config.toml), its
 * comments and its layout kept
 * @param directory
 * @param change
 */
export async function changeNative(directory: string, change: NativeChange): Promise<NativeChangeResult> {
    const build: NativeBuildSystem = detectBuildSystem(directory)
    if (change.crate && build !== 'rust') throw new Error('The crates are the libraries of the Rust addons')
    const library: LibraryFile | undefined = change.action === 'link' && !change.crate && !change.pkgConfig && !change.framework ? libraryOfFile(directory, change.value) : undefined
    const scope: Scope = scopeOf(change, library)
    //The headers of the package, or of the system (an absolute directory): the addon is built where it is installed
    if (change.action === 'include' && !path.isAbsolute(change.value) && path.relative(directory, path.resolve(directory, change.value)).startsWith('..')) {
        throw new Error(`${change.value} is not in the package: the addon is built where the package is installed (give a directory of the package, or an absolute directory of the system)`)
    }
    const files: string[] = build === 'gyp'
        ? await changeGyp(directory, change, library, scope)
        : build === 'cmake' ? await changeCMake(directory, change, library, scope) : await changeRust(directory, change, library, scope)
    const notes: string[] = library ? await installNameNotes(directory, library) : []
    if (scope !== undefined && scope !== 'unix' && scope !== (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux')) notes.push(`The change is for ${scope}: it is built and tried there`)
    return {build: build, files: files, notes: notes}
}
