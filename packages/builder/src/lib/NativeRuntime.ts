/**
 * What the require of a bundle knows of its native tree
 */
export type NativeRuntimeConfig = {
    /**
     * The name of the program, which names its cache directory
     */
    name: string
    /**
     * The hash of the tree, which names the directory it is extracted into
     */
    hash: string
    /**
     * The directory of the tree next to the bundle (the bundles run by node), or in the resources of a packaged Electron
     * application
     */
    directory: string
    /**
     * The packages loaded from the tree
     */
    modules: string[]
    /**
     * Whether the tree is embedded in an executable, extracted at its first run (with the resources of the application,
     * in its .lakutata/resources), or a directory next to the bundle
     */
    embedded: boolean
    /**
     * The tree from the directory of the bundle, for the scripts of the workers, which run from the tree (its
     * .lakutata/workers): the tree is not looked for (nor extracted)
     */
    root?: string
}

/**
 * The global symbol of the packed applications giving the directory of their resources (resourcesPath of lakutata)
 */
export const PACKAGED: string = 'lakutata.packaged'

/**
 * The directory of the resources of the embedded trees
 */
export const EMBEDDED_RESOURCES: string = '.lakutata/resources'

/**
 * The asset of the executables holding the files of the native tree (gzipped), and the one of its index
 */
export const NATIVE_DATA_ASSET: string = 'lakutata-native'
export const NATIVE_INDEX_ASSET: string = 'lakutata-native.json'

/**
 * The global symbol of the executables of Bun giving the files of the native tree they embed: {data, index}, their paths
 * in the executable
 */
export const BUN_NATIVE_ASSETS: string = 'lakutata.native'

/**
 * The require of a bundle having native addons, which loads the native packages from the native tree: next to the bundle,
 * or, in an executable, extracted from its assets once into the cache directory of the program (a directory named after
 * the hash of the tree: the versions of the program do not share it). The assets are the ones of a single executable
 * application of Node.js, or the files embedded in an executable of Bun. The other modules are loaded by the require of node.
 * Its source is written at the top of the bundle: it uses nothing but its arguments and the modules of node
 * @param nodeRequire
 * @param config
 */
export function lakutataNativeRequire(nodeRequire: NodeJS.Require, config: NativeRuntimeConfig): NodeJS.Require {
    const path: typeof import('node:path') = nodeRequire('node:path')
    const fs: typeof import('node:fs') = nodeRequire('node:fs')
    const os: typeof import('node:os') = nodeRequire('node:os')
    const {createRequire} = nodeRequire('node:module') as typeof import('node:module')
    let sea: typeof import('node:sea') | undefined
    try {
        sea = nodeRequire('node:sea')
    } catch {
        sea = undefined
    }
    //The files of the tree embedded in an executable of Bun (BUN_NATIVE_ASSETS)
    const bun: { data: string, index: string } | undefined = (globalThis as Record<symbol, any>)[Symbol.for('lakutata.native')]
    const asset = (name: 'data' | 'index'): Buffer => bun ? fs.readFileSync(bun[name]) : Buffer.from(sea!.getAsset(name === 'data' ? 'lakutata-native' : 'lakutata-native.json'))
    const modules: Set<string> = new Set(config.modules)
    let root: string | undefined
    let treeRequire: NodeJS.Require | undefined

    //The cache directory of the program: LAKUTATA_NATIVE_DIR, else the one of the platform
    const cacheDirectory = (): string => {
        if (process.env.LAKUTATA_NATIVE_DIR) return process.env.LAKUTATA_NATIVE_DIR
        const home: string = os.homedir()
        if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', config.name)
        if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), config.name, 'Cache')
        return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), config.name)
    }

    //Extract the tree into a directory named after its hash: written aside, then renamed (the processes starting together
    //do not see a tree partly written)
    const extract = (base: string): string => {
        const directory: string = path.join(base, 'native', config.hash)
        if (fs.existsSync(path.join(directory, '.complete'))) return directory
        const index: { files: { path: string, offset: number, size: number, mode: number }[], links: { path: string, target: string }[] } = JSON.parse(asset('index').toString('utf8'))
        const data: Buffer = nodeRequire('node:zlib').gunzipSync(asset('data'))
        const temporary: string = `${directory}.${process.pid}.${Date.now()}`
        const local = (root: string, file: string): string => path.join(root, ...file.split('/'))
        try {
            for (const file of index.files) {
                const target: string = local(temporary, file.path)
                fs.mkdirSync(path.dirname(target), {recursive: true})
                fs.writeFileSync(target, data.subarray(file.offset, file.offset + file.size), {mode: file.mode})
            }
            for (const link of index.links) {
                const at: string = local(temporary, link.path)
                fs.mkdirSync(path.dirname(at), {recursive: true})
                //A junction of Windows points to its absolute path, the one of the tree once renamed
                if (process.platform === 'win32') fs.symlinkSync(local(directory, link.target), at, 'junction')
                else fs.symlinkSync(path.relative(path.dirname(at), local(temporary, link.target)), at, 'dir')
            }
            fs.writeFileSync(path.join(temporary, '.complete'), '')
            try {
                fs.renameSync(temporary, directory)
            } catch (error) {
                //Another process extracted it
                if (!fs.existsSync(path.join(directory, '.complete'))) throw error
            }
        } finally {
            fs.rmSync(temporary, {recursive: true, force: true})
        }
        return directory
    }

    const locate = (): string => {
        if (root) return root
        if (config.root !== undefined) {
            root = path.resolve(__dirname, config.root)
        } else if (config.embedded) {
            try {
                root = extract(cacheDirectory())
            } catch (error) {
                //The cache directory cannot be written: the temporary directory
                if (process.env.LAKUTATA_NATIVE_DIR) throw error
                root = extract(path.join(os.tmpdir(), config.name))
            }
        } else {
            //Next to the bundle, or in the resources of a packaged Electron application (outside of its archive)
            const resources: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
            const local: string = path.join(__dirname, config.directory)
            root = fs.existsSync(local) || !resources ? local : path.join(resources, config.directory)
        }
        return root
    }

    const fromTree = (id: string): boolean => {
        const parts: string[] = id.split('/')
        return modules.has(id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
    const tree = (): NodeJS.Require => treeRequire ??= createRequire(path.join(locate(), 'index.js'))

    //The files loaded by their paths (the scripts of the tree): the require of an executable of Node.js loads the modules of
    //node only
    const require = ((id: string): unknown => fromTree(id) ? tree()(id) : path.isAbsolute(id) ? createRequire(id)(id) : nodeRequire(id)) as NodeJS.Require & { lakutataNative(key: string): unknown, lakutataFiles(key: string): string, lakutataFilesURL(key: string): string, lakutataScript(): boolean }
    require.resolve = ((id: string, options?: { paths?: string[] }): string => fromTree(id) ? tree().resolve(id, options) : nodeRequire.resolve(id, options)) as NodeJS.RequireResolve
    require.cache = nodeRequire.cache
    require.main = nodeRequire.main
    require.extensions = nodeRequire.extensions
    //The addons of the application itself
    require.lakutataNative = (key: string): unknown => {
        const addon: { exports: unknown } = {exports: {}}
        process.dlopen(addon as NodeJS.Module, path.join(locate(), ...key.split('/')))
        return addon.exports
    }
    //The files the application reads by their paths, in the tree (FILES_DIRECTORY): the directory of a key, its URL
    const files = (key: string): string => path.join(locate(), '.lakutata', 'files', ...key.split('/'))
    require.lakutataFiles = files
    require.lakutataFilesURL = (key: string): string => (nodeRequire('node:url') as typeof import('node:url')).pathToFileURL(files(key) + path.sep).href
    //An executable started to run a script of its tree (fork(), spawn(process.execPath, [script]): process.execPath is the
    //executable): it runs the script as node runs it, the application not started
    require.lakutataScript = (): boolean => {
        if (!config.embedded || config.root !== undefined) return false
        const scripts: string = path.join(locate(), '.lakutata', 'files') + path.sep
        const at: number = [1, 2].find((index: number): boolean => !!process.argv[index] && path.resolve(process.argv[index]).startsWith(scripts)) ?? -1
        if (at < 0) return false
        const script: string = path.resolve(process.argv[at])
        process.argv.splice(1, at - 1)
        //The main module of node (require.main); Bun loads it by a require (its Module._load does nothing)
        if (process.versions.bun) createRequire(script)(script)
        else (nodeRequire('node:module') as { _load(request: string, parent: unknown, isMain: boolean): unknown })._load(script, null, true)
        return true
    }
    //The resources of an executable are extracted with the tree (PACKAGED, EMBEDDED_RESOURCES)
    if (config.embedded) (globalThis as Record<symbol, unknown>)[Symbol.for('lakutata.packaged')] = {resources: (): string => path.join(locate(), '.lakutata', 'resources')}
    return require
}

/**
 * Load the environment file of the application into its environment, before it starts: the file given by
 * LAKUTATA_ENV_FILE (the services of Windows, whose wrapper has none), its lines NAME=value or NAME="value" (the
 * quoted values with their \\ escapes, as the installers write them), its comments (#). Its source is written at the top
 * of the bundle: it uses nothing but its argument and the modules of node
 * @param nodeRequire
 */
export function lakutataEnvironmentFile(nodeRequire: NodeJS.Require): void {
    const file: string | undefined = process.env.LAKUTATA_ENV_FILE
    if (!file) return
    const fs: typeof import('node:fs') = nodeRequire('node:fs')
    if (!fs.existsSync(file)) return
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const matched: RegExpExecArray | null = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
        if (!matched || line.trimStart().startsWith('#')) continue
        const raw: string = matched[2]
        process.env[matched[1]] = raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw
    }
}

/**
 * The source given to the top of every bundle: it is packed (isPackaged of lakutata), its resources are in a directory
 * next to it, or in the resources of a packaged Electron application (outside of its archive); its environment file is
 * loaded (LAKUTATA_ENV_FILE)
 * @param directory the directory of the resources, relative to the bundle
 */
export function packagedBanner(directory: string): string {
    return `globalThis[Symbol.for(${JSON.stringify(PACKAGED)})]={resources:function(){var p=require('node:path'),l=p.join(__dirname,${JSON.stringify(directory)}),r=process.resourcesPath;return require('node:fs').existsSync(l)||!r?l:p.join(r,${JSON.stringify(directory)})}};(${lakutataEnvironmentFile.toString()})(require);\n`
}

/**
 * The source given to the top of a bundle: its require loads the native packages from the tree
 * @param config
 */
export function nativeBanner(config: NativeRuntimeConfig): string {
    return `var require = (${lakutataNativeRequire.toString()})(require, ${JSON.stringify(config)});\n`
}
