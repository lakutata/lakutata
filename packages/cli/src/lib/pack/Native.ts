import {createHash} from 'node:crypto'
import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats} from 'node:fs'
import {mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {isBuiltin} from 'node:module'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import type {Plugin, PluginBuild} from 'esbuild'

/**
 * A file of the native tree: its path in the tree ("/" separated) and where it is read
 */
export type NativeFile = {
    path: string
    source: string
    mode: number
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
 * The shared libraries: the addons, and the libraries they are linked with (sharp and libvips)
 */
const ADDON: RegExp = /\.node$/
const LIBRARY: RegExp = /\.(node|dylib|dll|so)$|\.so\.\d+(\.\d+)*$/

const RESOLVING: string = 'lakutataNativeResolving'

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
export function SpecifierPackage(specifier: string): string | undefined {
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) return undefined
    const parts: string[] = specifier.split('/')
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * The files of a package directory, without the packages it holds (node_modules)
 * @param directory
 */
function PackageFiles(directory: string): string[] {
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
 * The directory both paths are in
 * @param a
 * @param b
 */
function CommonDirectory(a: string, b: string): string {
    const left: string[] = a.split(path.sep)
    const right: string[] = b.split(path.sep)
    let index: number = 0
    while (index < left.length && index < right.length && left[index] === right[index]) index++
    return left.slice(0, index).join(path.sep) || path.sep
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
     * @param project the directory of the project, whose files are bundled
     */
    constructor(protected readonly project: string) {
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
                const files: string[] = PackageFiles(root)
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
        return info.addons || this.dependencies(root).some(({root: dependency}): boolean => !!this.package(dependency)?.addons)
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
     * The plugin of the bundle: the native packages are external, the addons of the application are loaded from the tree
     */
    public plugin(): Plugin {
        return {
            name: 'lakutata-native',
            setup: (build: PluginBuild): void => {
                build.onResolve({filter: /.*/}, async (args) => {
                    if (args.pluginData?.[RESOLVING] || isBuiltin(args.path) || args.kind === 'entry-point') return undefined
                    const file: string | undefined = await this.resolve(build, args)
                    if (!file) return undefined
                    const root: string | undefined = this.packageRoot(file)
                    if (this.isNative(root)) {
                        const name: string | undefined = SpecifierPackage(args.path)
                        if (!name) throw new Error(`${args.importer} loads ${args.path} of the native package ${this.package(root)!.name} by its path: load it by its name`)
                        const external = this.externals.get(name) ?? {root: root, entries: new Set<string>()}
                        external.entries.add(file)
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
                    const source: string = await readFile(args.path, 'utf8')
                    if (!MODULE_REQUIRE.test(source)) return undefined
                    MODULE_REQUIRE.lastIndex = 0
                    return {contents: source.replace(MODULE_REQUIRE, 'require'), loader: 'js', resolveDir: path.dirname(args.path)}
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
            const result = await build({
                entryPoints: [...current.entries],
                bundle: true,
                write: false,
                metafile: true,
                platform: 'node',
                format: 'cjs',
                logLevel: 'silent',
                plugins: [{
                    name: 'lakutata-native-trace',
                    setup: (trace: PluginBuild): void => {
                        trace.onResolve({filter: /.*/}, async (args) => {
                            if (args.pluginData?.[RESOLVING] || isBuiltin(args.path) || args.kind === 'entry-point') return undefined
                            const file: string | undefined = await this.resolve(trace, args)
                            //The requires which cannot be followed (computed paths) are left to the run time
                            if (!file || ADDON.test(file)) return {path: args.path, external: true}
                            const dependency: string | undefined = this.packageRoot(file)
                            if (dependency !== current.root && this.isNative(dependency)) {
                                pending.push({root: dependency, entries: new Set([file])})
                                return {path: args.path, external: true}
                            }
                            return undefined
                        })
                    }
                }]
            })
            for (const input of Object.keys(result.metafile!.inputs)) {
                const dependency: string | undefined = this.packageRoot(realpathSync(path.resolve(input)))
                if (dependency && dependency !== this.project) included.add(dependency)
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
     * The native tree of the application, once it is bundled; undefined when it has no native addon
     */
    public async collect(): Promise<NativeTree | undefined> {
        if (!this.externals.size && !this.addons.size) return undefined
        const {build} = await import('esbuild')
        const included: Set<string> = new Set()
        for (const {root, entries} of this.externals.values()) await this.trace(build, root, entries, included)
        //The links node follows from a package to its dependencies (pnpm, the workspaces)
        const links: { lookup: string, root: string }[] = []
        for (const root of included) {
            for (const dependency of this.dependencies(root)) {
                if (included.has(dependency.root) && lstatSync(dependency.lookup).isSymbolicLink()) links.push(dependency)
            }
        }
        let base: string = [...included][0] ?? this.project
        for (const location of [...included, ...links.map(({lookup}): string => lookup)]) base = CommonDirectory(base, location)
        //The directory of the outermost node_modules: the packages keep the node_modules node looks them up in
        const parts: string[] = base.split(path.sep)
        if (parts.includes('node_modules')) base = parts.slice(0, parts.indexOf('node_modules')).join(path.sep) || path.sep
        const store = (location: string): string => path.relative(base, location).split(path.sep).join('/')
        const files: NativeFile[] = []
        for (const root of [...included].sort()) {
            for (const file of PackageFiles(root)) files.push({path: store(file), source: file, mode: statSync(file).mode & 0o777})
        }
        for (const [key, file] of this.addons) files.push({path: key, source: file, mode: statSync(file).mode & 0o777})
        const treeLinks: NativeLink[] = [
            ...links.map(({lookup, root}): NativeLink => ({path: store(lookup), target: store(root)})),
            //The packages the application loads, where node finds them from the root of the tree
            ...[...this.externals].filter(([name, {root}]): boolean => store(root) !== `node_modules/${name}`).map(([name, {root}]): NativeLink => ({path: `node_modules/${name}`, target: store(root)}))
        ]
        const hash = createHash('sha256')
        for (const file of files) hash.update(`${file.path}\0${file.mode}\0`).update(readFileSync(file.source))
        for (const link of treeLinks) hash.update(`${link.path}\0${link.target}\0`)
        return {modules: [...this.externals.keys()].sort(), files: files, links: treeLinks, hash: hash.digest('hex').slice(0, 16)}
    }
}

/**
 * Write a native tree into a directory (next to a bundle)
 * @param tree
 * @param directory
 */
export async function WriteNativeTree(tree: NativeTree, directory: string): Promise<void> {
    await rm(directory, {recursive: true, force: true})
    for (const file of tree.files) {
        const target: string = path.join(directory, ...file.path.split('/'))
        await mkdir(path.dirname(target), {recursive: true})
        await writeFile(target, readFileSync(file.source), {mode: file.mode})
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
export function PackNativeTree(tree: NativeTree): { index: NativeIndex, data: Buffer } {
    const chunks: Buffer[] = []
    const files: NativeIndex['files'] = []
    let offset: number = 0
    for (const file of tree.files) {
        const content: Buffer = readFileSync(file.source)
        files.push({path: file.path, offset: offset, size: content.length, mode: file.mode})
        chunks.push(content)
        offset += content.length
    }
    return {index: {hash: tree.hash, files: files, links: tree.links}, data: gzipSync(Buffer.concat(chunks))}
}
