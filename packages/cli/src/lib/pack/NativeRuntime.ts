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
     * The directory of the tree next to the bundle (the bundles run by node)
     */
    directory: string
    /**
     * The packages loaded from the tree
     */
    modules: string[]
}

/**
 * The asset of the executables holding the files of the native tree (gzipped), and the one of its index
 */
export const NATIVE_DATA_ASSET: string = 'lakutata-native'
export const NATIVE_INDEX_ASSET: string = 'lakutata-native.json'

/**
 * The require of a bundle having native addons, which loads the native packages from the native tree: next to the bundle,
 * or, in an executable, extracted from its assets once into the cache directory of the program (a directory named after
 * the hash of the tree: the versions of the program do not share it). The other modules are loaded by the require of node.
 * Its source is written at the top of the bundle: it uses nothing but its arguments and the modules of node
 * @param nodeRequire
 * @param config
 */
export function LakutataNativeRequire(nodeRequire: NodeJS.Require, config: NativeRuntimeConfig): NodeJS.Require {
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
        const index: { files: { path: string, offset: number, size: number, mode: number }[], links: { path: string, target: string }[] } = JSON.parse(sea!.getAsset('lakutata-native.json', 'utf8'))
        const data: Buffer = nodeRequire('node:zlib').gunzipSync(Buffer.from(sea!.getAsset('lakutata-native')))
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
        if (sea?.isSea()) {
            try {
                root = extract(cacheDirectory())
            } catch (error) {
                //The cache directory cannot be written: the temporary directory
                if (process.env.LAKUTATA_NATIVE_DIR) throw error
                root = extract(path.join(os.tmpdir(), config.name))
            }
        } else {
            root = path.join(__dirname, config.directory)
        }
        return root
    }

    const fromTree = (id: string): boolean => {
        const parts: string[] = id.split('/')
        return modules.has(id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
    const tree = (): NodeJS.Require => treeRequire ??= createRequire(path.join(locate(), 'index.js'))

    const require = ((id: string): unknown => fromTree(id) ? tree()(id) : nodeRequire(id)) as NodeJS.Require & { lakutataNative(key: string): unknown }
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
    return require
}

/**
 * The source given to the top of a bundle: its require loads the native packages from the tree
 * @param config
 */
export function NativeBanner(config: NativeRuntimeConfig): string {
    return `var require = (${LakutataNativeRequire.toString()})(require, ${JSON.stringify(config)});\n`
}
