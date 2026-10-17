import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, realpathSync, statSync, type Stats} from 'node:fs'
import {mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {createRequire, isBuiltin} from 'node:module'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import type {BuildResult, Plugin, PluginBuild} from 'esbuild'

/**
 * A file of the native tree: its path in the tree ("/" separated) and where it is read, or its content (a script of a
 * worker, bundled)
 */
export type NativeFile = {
    path: string
    source: string
    mode: number
    content?: Buffer
}

/**
 * The content of a file of the native tree
 * @param file
 */
function contentOf(file: NativeFile): Buffer {
    return file.content ?? readFileSync(file.source)
}

/**
 * A link of the native tree to a directory of the tree, as the links of the node_modules (pnpm, the workspaces)
 */
export type NativeLink = {
    path: string
    target: string
}

/**
 * The native addons of an application and what they need at run time, which cannot be bundled: their packages (and
 * the packages they load), laid out as node lays them out, loaded from the disk.
 * The tree is the layout of the packages from the directory of their node_modules (the project, the workspace): node
 * finds them there as it finds them in the project; the links of the tree are the ones of the project (the packages of
 * the workspace, pnpm) and the packages the application loads which are not in its node_modules. The addons loaded by the
 * application itself are in .lakutata/addons
 */
export type NativeTree = {
    /**
     * The packages the application loads from the tree
     */
    modules: string[]
    files: NativeFile[]
    links: NativeLink[]
    /**
     * The hash of the tree, which names the directory it is extracted into
     */
    hash: string
}

/**
 * The index of a packed native tree
 */
export type NativeIndex = {
    hash: string
    files: { path: string, offset: number, size: number, mode: number }[]
    links: NativeLink[]
}

/**
 * Whether a package is the framework, or built on it (it depends on it)
 * @param manifest
 */
function sharesFramework(manifest: Record<string, any>): boolean {
    const name: string = String(manifest.name ?? '')
    if (name === 'lakutata' || name.startsWith('@lakutata/')) return true
    return ['dependencies', 'peerDependencies', 'optionalDependencies'].some((field: string): boolean => !!manifest[field] && ('lakutata' in manifest[field] || '@lakutata/core' in manifest[field]))
}

/**
 * The shared libraries: the addons, and the libraries they are linked with (sharp and libvips)
 */
const ADDON: RegExp = /\.node$/
const LIBRARY: RegExp = /\.(node|dylib|dll|so)$|\.so\.\d+(\.\d+)*$/

const RESOLVING: string = 'lakutataNativeResolving'

/**
 * The files of the packages node never loads: their types, their source maps, their sources in TypeScript, their
 * documentation, the sources and the objects of their addons in C and C++ (better-sqlite3 holds the source of SQLite)
 */
const UNUSED: RegExp = /\.(d\.[cm]?ts|[cm]?ts|map|md|markdown|c|cc|cpp|cxx|h|hh|hpp|hxx|o|obj|a|lib|exp|pdb|ilk)$/i

/**
 * The files of the builds of the addons in build/ (node-gyp, CMake), which node never loads: their makefiles, their
 * configurations, their objects and their dependency files; the addons and their libraries are kept
 */
const BUILD_FILES: RegExp = /^build\/(?:.*\/)?(?:\.deps|obj|obj\.target|CMakeFiles)\/|^build\/(?:.*\/)?(?:Makefile|[^/]+\.mk|config\.gypi|gyp-(?:mac|win)-tool|CMakeCache\.txt|cmake_install\.cmake|build\.ninja|\.ninja_deps|\.ninja_log|compile_commands\.json|[^/]+\.(?:vcxproj|vcxproj\.filters|sln|tlog))$/

/**
 * The JavaScript files, which a package keeps when they are loaded (traced)
 */
const SCRIPT: RegExp = /\.[cm]?js$/

/**
 * A require esbuild cannot follow loading a file of its package by its path (require(path.join(__dirname, name)))
 */
const OWN_FILE: RegExp = /__dirname|__filename|import\.meta|['"`]\.\.?\//

/**
 * The require of an ES module, createRequire(import.meta.url): in the bundle, it is the require of the bundle
 */
const MODULE_REQUIRE: RegExp = /\b(?:[A-Za-z_$][\w$]*\.)?createRequire\s*\(\s*import\.meta\.url\s*\)/g

type PackageInfo = {
    root: string
    name: string
    manifest: Record<string, any>
    addons: boolean
    libraries: boolean
}

/**
 * The name of the package of a module specifier ("@scope/name/sub/path" → "@scope/name"), undefined for a path
 * @param specifier
 */
export function specifierPackage(specifier: string): string | undefined {
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) return undefined
    const parts: string[] = specifier.split('/')
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * The files of a package directory, without the packages it holds (node_modules)
 * @param directory
 */
function packageFiles(directory: string): string[] {
    const files: string[] = []
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, {withFileTypes: true})) {
            if (entry.name === 'node_modules') continue
            const file: string = path.join(current, entry.name)
            let stats: Stats
            try {
                stats = statSync(file)
            } catch {
                //A broken link
                continue
            }
            if (stats.isDirectory()) walk(file)
            else if (stats.isFile()) files.push(file)
        }
    }
    walk(directory)
    return files
}

/**
 * The directories node looks a package up in from a directory of the tree, the nearest first
 * @param directory
 * @param name
 */
function lookupDirectories(directory: string, name: string): string[] {
    const parts: string[] = directory.split('/')
    const lookups: string[] = []
    for (let index: number = parts.length; index >= 0; index--) {
        const prefix: string[] = parts.slice(0, index)
        if (prefix.at(-1) === 'node_modules') continue
        lookups.push([...prefix, 'node_modules', name].join('/'))
    }
    return lookups
}

/**
 * Find the native addons of an application while it is bundled: the packages holding addons (and the packages loading
 * them with computed paths, such as sharp) are left out of the bundle and gathered, with the packages they load, into
 * a native tree; the addons of the application itself are loaded from the tree
 */
export class NativeCollector {

    protected readonly packages: Map<string, PackageInfo | undefined> = new Map()

    protected readonly roots: Map<string, string | undefined> = new Map()

    /**
     * The packages left out of the bundle, by the name the application loads them with, and the files it loads
     */
    protected readonly externals: Map<string, { root: string, entries: Set<string> }> = new Map()

    /**
     * The addons of the application itself, by their key in the tree
     */
    protected readonly addons: Map<string, string> = new Map()

    /**
     * The files of the packages of the tree which are loaded, by package (traced)
     */
    protected readonly loaded: Map<string, Set<string>> = new Map()

    /**
     * The packages of the tree kept as a whole: the ones which are not traced, the ones loading their files by paths
     * esbuild cannot follow
     */
    protected readonly whole: Set<string> = new Set()

    /**
     * The packages each package of the tree requires, by their names (traced)
     */
    protected readonly required: Map<string, Map<string, string>> = new Map()

    /**
     * @param project the directory of the project, whose files are bundled
     * @param runtime the runtime loading the tree: Bun resolves the packages with its condition (bun) first
     */
    constructor(protected readonly project: string, protected readonly runtime: 'node' | 'bun' = 'node') {
        this.project = realpathSync(project)
    }

    /**
     * The directory of the package a file belongs to: the nearest directory with a named package.json
     * @param file
     */
    protected packageRoot(file: string): string | undefined {
        let directory: string = path.dirname(file)
        const visited: string[] = []
        let found: string | undefined
        while (true) {
            if (this.roots.has(directory)) {
                found = this.roots.get(directory)
                break
            }
            visited.push(directory)
            const manifest: string = path.join(directory, 'package.json')
            if (existsSync(manifest)) {
                try {
                    if (JSON.parse(readFileSync(manifest, 'utf8')).name) {
                        found = directory
                        break
                    }
                } catch {
                    //Not a package.json of a package
                }
            }
            const parent: string = path.dirname(directory)
            if (parent === directory) break
            directory = parent
        }
        for (const entry of visited) this.roots.set(entry, found)
        return found
    }

    /**
     * A package: its manifest and whether it holds addons or shared libraries
     * @param root
     */
    protected package(root: string): PackageInfo | undefined {
        if (!this.packages.has(root)) {
            let info: PackageInfo | undefined
            try {
                const manifest: Record<string, any> = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
                const files: string[] = packageFiles(root)
                info = {
                    root: root,
                    name: manifest.name,
                    manifest: manifest,
                    addons: files.some((file: string): boolean => ADDON.test(file)),
                    libraries: files.some((file: string): boolean => LIBRARY.test(file))
                }
            } catch {
                info = undefined
            }
            this.packages.set(root, info)
        }
        return this.packages.get(root)
    }

    /**
     * The dependencies of a package, as node finds them from it: the path looked up (a link with pnpm) and the package
     * @param root
     */
    protected dependencies(root: string): { name: string, lookup: string, root: string }[] {
        const manifest: Record<string, any> = this.package(root)?.manifest ?? {}
        const names: Set<string> = new Set(Object.keys({...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies}))
        const found: { name: string, lookup: string, root: string }[] = []
        for (const name of names) {
            let directory: string = root
            while (true) {
                const lookup: string = path.join(directory, 'node_modules', name)
                if (existsSync(path.join(lookup, 'package.json'))) {
                    found.push({name: name, lookup: lookup, root: realpathSync(lookup)})
                    break
                }
                const parent: string = path.dirname(directory)
                if (parent === directory) break
                directory = parent
            }
        }
        return found
    }

    /**
     * Whether a package is left out of the bundle: it holds addons, or one of its dependencies does (it loads them,
     * with computed paths often), and it is not the project
     * @param root
     */
    protected isNative(root: string | undefined): root is string {
        if (!root || root === this.project) return false
        const info: PackageInfo | undefined = this.package(root)
        if (!info) return false
        if (info.addons) return true
        //A package of the framework, or built on it, shares it with the application: bundled with it (one copy of its
        //classes, its container), its native dependencies loaded by their names, which the bundler follows
        if (sharesFramework(info.manifest)) return false
        return this.dependencies(root).some(({root: dependency}): boolean => !!this.package(dependency)?.addons)
    }

    /**
     * Resolve an import as esbuild does
     * @param build
     * @param args
     */
    protected async resolve(build: PluginBuild, args: { path: string, kind: any, resolveDir: string, importer: string }): Promise<string | undefined> {
        const result = await build.resolve(args.path, {kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: {[RESOLVING]: true}})
        return result.errors.length || result.external || !result.path ? undefined : realpathSync(result.path)
    }

    /**
     * Whether a package is an optional dependency of the package of a module: an optional peer dependency
     * (peerDependenciesMeta) or an optional dependency
     * @param specifier
     * @param importer
     */
    protected isOptionalOf(specifier: string, importer: string): boolean {
        const name: string | undefined = specifierPackage(specifier)
        const root: string | undefined = name && importer ? this.packageRoot(existsSync(importer) ? realpathSync(importer) : importer) : undefined
        const manifest: Record<string, any> | undefined = root ? this.package(root)?.manifest : undefined
        return !!name && !!manifest && (!!manifest.peerDependenciesMeta?.[name]?.optional || !!manifest.optionalDependencies?.[name])
    }

    /**
     * The plugin of the bundle: the native packages are external, the addons of the application are loaded from the tree
     * @param transforms the transformations of the sources of the modules (the paths of the workers), giving their new
     * source or undefined
     */
    public plugin(transforms: ((source: string, file: string) => string | undefined)[] = []): Plugin {
        return {
            name: 'lakutata-native',
            setup: (build: PluginBuild): void => {
                build.onResolve({filter: /.*/}, async (args) => {
                    if (args.pluginData?.[RESOLVING] || isBuiltin(args.path) || args.kind === 'entry-point') return undefined
                    const file: string | undefined = await this.resolve(build, args)
                    //An optional dependency of the package importing it, not installed: left out, it throws when it is
                    //loaded at run time, as without the bundle (the drivers of the stores the application does not use)
                    if (!file) return this.isOptionalOf(args.path, args.importer) ? {path: args.path, external: true} : undefined
                    const root: string | undefined = this.packageRoot(file)
                    if (this.isNative(root)) {
                        const name: string | undefined = specifierPackage(args.path)
                        if (!name) throw new Error(`${args.importer} loads ${args.path} of the native package ${this.package(root)!.name} by its path: load it by its name`)
                        const external = this.externals.get(name) ?? {root: root, entries: new Set<string>()}
                        external.entries.add(file)
                        //The bundle is CommonJS: the require of the run loads the file of the require condition
                        if (args.kind !== 'require-call') {
                            const required: string | undefined = await this.resolve(build, {...args, kind: 'require-call'})
                            if (required) external.entries.add(required)
                        }
                        this.externals.set(name, external)
                        return {path: args.path, external: true}
                    }
                    if (ADDON.test(file)) {
                        const key: string = `.lakutata/addons/${createHash('sha256').update(file).digest('hex').slice(0, 16)}-${path.basename(file)}`
                        this.addons.set(key, file)
                        return {path: key, namespace: 'lakutata-native'}
                    }
                    return undefined
                })
                //The requires of the ES modules are the one of the bundle: esbuild follows what they load (the addons)
                build.onLoad({filter: /\.(c|m)?js$/}, async (args) => {
                    let source: string = await readFile(args.path, 'utf8')
                    let changed: boolean = false
                    if (MODULE_REQUIRE.test(source)) {
                        MODULE_REQUIRE.lastIndex = 0
                        source = source.replace(MODULE_REQUIRE, 'require')
                        changed = true
                    }
                    for (const transform of transforms) {
                        const transformed: string | undefined = transform(source, args.path)
                        if (transformed === undefined) continue
                        source = transformed
                        changed = true
                    }
                    return changed ? {contents: source, loader: 'js', resolveDir: path.dirname(args.path)} : undefined
                })
                //The addons of the application are loaded by the require of the bundle, from the extracted tree
                build.onLoad({filter: /.*/, namespace: 'lakutata-native'}, (args) => ({
                    contents: `module.exports = require.lakutataNative(${JSON.stringify(args.path)})`,
                    loader: 'js'
                }))
            }
        }
    }

    /**
     * The packages a native package loads at run time: the JavaScript it requires (followed by esbuild), the packages of
     * shared libraries it depends on (the libraries linked with its addons), and the native packages it loads
     * @param build the build function of esbuild
     * @param root
     * @param entries the files of the package which are loaded
     * @param included the packages of the tree
     */
    protected async trace(build: typeof import('esbuild').build, root: string, entries: Set<string>, included: Set<string>): Promise<void> {
        const pending: { root: string, entries: Set<string> }[] = [{root: root, entries: entries}]
        const traced: Set<string> = new Set()
        while (pending.length) {
            const current = pending.shift()!
            const key: string = `${current.root}\0${[...current.entries].sort().join('\0')}`
            if (traced.has(key)) continue
            traced.add(key)
            included.add(current.root)
            //A package esbuild cannot trace (a glob of its requires matching nothing) is kept as a whole
            const result: BuildResult<{ metafile: true }> | undefined = await build({
                entryPoints: [...current.entries],
                bundle: true,
                write: false,
                //Not written: a package loaded by several of its files is several entries, which need a directory
                outdir: path.join(current.root, '.lakutata-trace'),
                metafile: true,
                platform: 'node',
                format: 'cjs',
                conditions: this.runtime === 'bun' ? ['bun'] : [],
                logLevel: 'silent',
                //The addons are loaded at run time (the paths of their globs may match nothing: sharp built from its sources)
                external: ['*.node'],
                //Reported in the node_modules too: the requires it cannot follow
                logOverride: {'unsupported-require-call': 'warning'},
                plugins: [{
                    name: 'lakutata-native-trace',
                    setup: (trace: PluginBuild): void => {
                        trace.onResolve({filter: /.*/}, async (args) => {
                            if (args.pluginData?.[RESOLVING] || isBuiltin(args.path) || args.kind === 'entry-point') return undefined
                            const file: string | undefined = await this.resolve(trace, args)
                            //The requires which cannot be followed (computed paths) are left to the run time
                            if (!file || ADDON.test(file)) return {path: args.path, external: true}
                            const dependency: string | undefined = this.packageRoot(file)
                            //The package it requires by this name (the ones it does not declare too)
                            const name: string | undefined = specifierPackage(args.path)
                            const importer: string | undefined = args.importer ? this.packageRoot(realpathSync(args.importer)) : undefined
                            if (name && importer && dependency && importer !== dependency) this.requires(importer).set(name, dependency)
                            if (dependency !== current.root && this.isNative(dependency)) {
                                pending.push({root: dependency, entries: new Set([file])})
                                return {path: args.path, external: true}
                            }
                            return undefined
                        })
                    }
                }]
            }).catch((): undefined => undefined)
            if (!result) this.whole.add(current.root)
            for (const input of Object.keys(result?.metafile.inputs ?? {})) {
                const file: string = realpathSync(path.resolve(input))
                const dependency: string | undefined = this.packageRoot(file)
                if (!dependency || dependency === this.project) continue
                included.add(dependency)
                const files: Set<string> = this.loaded.get(dependency) ?? new Set()
                this.loaded.set(dependency, files.add(file))
            }
            //The packages loading their files by paths esbuild cannot follow are kept as a whole
            for (const warning of result?.warnings ?? []) {
                if (!warning.location || !OWN_FILE.test(warning.location.lineText.slice(warning.location.column, warning.location.column + 200))) continue
                const dependency: string | undefined = this.packageRoot(realpathSync(path.resolve(warning.location.file)))
                if (dependency) this.whole.add(dependency)
            }
            //The packages it declares which its code names: the ones it loads by requires esbuild does not follow
            //(createRequire(import.meta.url)('node-gyp-build')), not the ones installing it (node-gyp, prebuild-install)
            const sources: string = (result ? Object.keys(result.metafile.inputs).map((input: string): string => realpathSync(path.resolve(input))) : packageFiles(current.root))
                .filter((file: string): boolean => this.packageRoot(file) === current.root && /\.[cm]?[jt]s$/.test(file))
                .map((file: string): string => readFileSync(file, 'utf8'))
                .join('\n')
            for (const dependency of this.dependencies(current.root)) {
                if (dependency.root === this.project || included.has(dependency.root)) continue
                if (!new RegExp(`(['"\`])${dependency.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\1`).test(sources)) continue
                let entry: string | undefined
                try {
                    entry = createRequire(path.join(current.root, 'package.json')).resolve(dependency.name)
                } catch {
                    //A package without a CommonJS entry: kept as a whole
                }
                if (entry && !isBuiltin(entry)) pending.push({root: dependency.root, entries: new Set([realpathSync(entry)])})
                else {
                    included.add(dependency.root)
                    this.whole.add(dependency.root)
                }
            }
        }
        //The packages of the shared libraries (the addons of the platform packages, the libraries they are linked with)
        const libraries: string[] = [...included]
        while (libraries.length) {
            for (const {root: dependency} of this.dependencies(libraries.pop()!)) {
                if (!included.has(dependency) && this.package(dependency)?.libraries) {
                    included.add(dependency)
                    libraries.push(dependency)
                }
            }
        }
    }

    /**
     * The packages a package requires, by their names
     * @param root
     */
    protected requires(root: string): Map<string, string> {
        const required: Map<string, string> = this.required.get(root) ?? new Map()
        this.required.set(root, required)
        return required
    }

    /**
     * The layout of the packages of the tree, without links (as npm installs them, the tree is moved, copied, archived
     * and installed as it is): the packages the application loads in node_modules, the packages each package requires
     * (traced) or declares where node finds them from it: shared when node finds the same package, at the top when its
     * name is free there, else in the node_modules of the package
     * @param included the packages of the tree
     * @return the packages by their directories in the tree
     */
    protected layout(included: Set<string>): Map<string, string> {
        const placed: Map<string, string> = new Map()
        const queue: string[] = []
        const place = (directory: string, root: string): unknown => queue.push(placed.set(directory, root) && directory)
        const drain = (): void => {
            while (queue.length) {
                const directory: string = queue.shift()!
                const root: string = placed.get(directory)!
                const needed: Map<string, string> = new Map(this.required.get(root))
                for (const dependency of this.dependencies(root)) {
                    if (included.has(dependency.root) && !needed.has(dependency.name)) needed.set(dependency.name, dependency.root)
                }
                for (const [name, dependency] of [...needed].sort(([a], [b]): number => a.localeCompare(b))) {
                    if (dependency === root || !included.has(dependency)) continue
                    const found: string | undefined = lookupDirectories(directory, name).find((lookup: string): boolean => placed.has(lookup))
                    if (found !== undefined && placed.get(found) === dependency) continue
                    place(found === undefined ? `node_modules/${name}` : `${directory}/node_modules/${name}`, dependency)
                }
            }
        }
        for (const [name, {root}] of [...this.externals].sort(([a], [b]): number => a.localeCompare(b))) place(`node_modules/${name}`, root)
        drain()
        //The packages reached otherwise (by the libraries of a package): at the top
        const reached: Set<string> = new Set(placed.values())
        for (const root of [...included].sort()) {
            const name: string | undefined = this.package(root)?.name
            if (reached.has(root) || !name || placed.has(`node_modules/${name}`)) continue
            place(`node_modules/${name}`, root)
        }
        drain()
        return placed
    }

    /**
     * The files of a package of the tree which are loaded at run time, without the ones node never loads (UNUSED): the
     * packages of shared libraries (which find their addons by computed paths), and the ones kept as a whole, have all
     * their files; the others have the JavaScript files they load (traced) and all their other files (the data they read)
     * @param root
     */
    protected packageFiles(root: string): string[] {
        //The builds of cargo (the Rust addons) are in target/
        const cargo: boolean = existsSync(path.join(root, 'Cargo.toml'))
        const files: string[] = packageFiles(root).filter((file: string): boolean => {
            const relative: string = path.relative(root, file).split(path.sep).join('/')
            return !UNUSED.test(file) && !BUILD_FILES.test(relative) && !(cargo && relative.startsWith('target/'))
        })
        const loaded: Set<string> | undefined = this.loaded.get(root)
        if (!loaded || this.whole.has(root) || this.package(root)?.libraries) return files
        return files.filter((file: string): boolean => !SCRIPT.test(file) || loaded.has(file))
    }

    /**
     * The native tree of the application, once it is bundled; undefined when it has no native addon
     */
    public async collect(): Promise<NativeTree | undefined> {
        if (!this.externals.size && !this.addons.size) return undefined
        const {build} = await import('esbuild')
        const included: Set<string> = new Set()
        for (const {root, entries} of this.externals.values()) await this.trace(build, root, entries, included)
        const files: NativeFile[] = []
        for (const [directory, root] of [...this.layout(included)].sort(([a], [b]): number => a.localeCompare(b))) {
            for (const file of this.packageFiles(root)) files.push({path: `${directory}/${path.relative(root, file).split(path.sep).join('/')}`, source: file, mode: statSync(file).mode & 0o777})
        }
        for (const [key, file] of this.addons) files.push({path: key, source: file, mode: statSync(file).mode & 0o777})
        return {modules: [...this.externals.keys()].sort(), files: files, links: [], hash: hashNativeTree(files, [])}
    }
}

/**
 * The hash of a native tree, which names the directory it is extracted into: its files and their content, its links
 * @param files
 * @param links
 */
export function hashNativeTree(files: NativeFile[], links: NativeLink[]): string {
    const hash = createHash('sha256')
    for (const file of files) hash.update(`${file.path}\0${file.mode}\0`).update(contentOf(file))
    for (const link of links) hash.update(`${link.path}\0${link.target}\0`)
    return hash.digest('hex').slice(0, 16)
}

/**
 * Write a native tree into a directory (next to a bundle)
 * @param tree
 * @param directory
 */
export async function writeNativeTree(tree: NativeTree, directory: string): Promise<void> {
    await rm(directory, {recursive: true, force: true})
    for (const file of tree.files) {
        const target: string = path.join(directory, ...file.path.split('/'))
        await mkdir(path.dirname(target), {recursive: true})
        await writeFile(target, contentOf(file), {mode: file.mode})
    }
    for (const link of tree.links) {
        const at: string = path.join(directory, ...link.path.split('/'))
        const target: string = path.join(directory, ...link.target.split('/'))
        await mkdir(path.dirname(at), {recursive: true})
        //The junctions of Windows need no privilege
        if (process.platform === 'win32') await symlink(target, at, 'junction')
        else await symlink(path.relative(path.dirname(at), target), at, 'dir')
    }
}

/**
 * Pack a native tree into the assets of an executable: its gzipped files and their index
 * @param tree
 */
export function packNativeTree(tree: NativeTree): { index: NativeIndex, data: Buffer } {
    const chunks: Buffer[] = []
    const files: NativeIndex['files'] = []
    let offset: number = 0
    for (const file of tree.files) {
        const content: Buffer = contentOf(file)
        files.push({path: file.path, offset: offset, size: content.length, mode: file.mode})
        chunks.push(content)
        offset += content.length
    }
    return {index: {hash: tree.hash, files: files, links: tree.links}, data: gzipSync(Buffer.concat(chunks))}
}
