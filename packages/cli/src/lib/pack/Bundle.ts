import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {NativeCollector, type NativeTree, WriteNativeTree} from './Native.js'
import {NativeBanner} from './NativeRuntime.js'

/**
 * The application bundled into one file
 */
export type BundleOptions = {
    /**
     * The directory of the project (its package.json)
     */
    project: string
    /**
     * The compiled entry of the application, the "main" of the package.json by default
     */
    entry?: string
    /**
     * The bundle, dist/<name>.cjs by default
     */
    outfile?: string
    /**
     * Minify the bundle (the names of the classes and of the functions are kept)
     */
    minify?: boolean
    /**
     * The modules left out of the bundle, loaded at run time
     */
    external?: string[]
    /**
     * Where the native tree goes: next to the bundle (the bundles run by node, by default), or given back (the executables
     * embed it)
     */
    native?: 'directory' | 'embedded'
    /**
     * The runtime running the bundle: node (by default), or bun (the executables of Bun, which bundle it again)
     */
    runtime?: 'node' | 'bun'
}

export type BundleResult = {
    /**
     * The name of the program: its bin, or the name of the package without its scope
     */
    name: string
    entry: string
    outfile: string
    size: number
    /**
     * The native addons of the application and what they load, undefined without addon
     */
    native?: NativeTree
    /**
     * The directory of the native tree next to the bundle
     */
    nativeDirectory?: string
}

/**
 * The name of the program of a package: its first bin, or the name of the package without its scope
 * @param manifest
 */
export function ProgramName(manifest: Record<string, any>): string {
    if (manifest.bin && typeof manifest.bin === 'object') {
        const [name] = Object.keys(manifest.bin)
        if (name) return name
    }
    return String(manifest.name ?? 'app').replace(/^@[^/]+\//, '')
}

/**
 * The ESM sources use import.meta.url, which the CommonJS bundle gives from its file
 */
const IMPORT_META_URL: string = '__lakutataImportMetaUrl'

/**
 * The first code of a bundle embedded in an executable of Bun, which bundles it again into a function without the
 * arguments of the CommonJS modules: its file is the executable (as in the executables of Node.js), its require loads
 * the modules of node and the ones of a node_modules next to the executable (the ones left out of the bundle)
 */
const BUN_PRELUDE: string = 'var __filename=process.execPath,__dirname=process.getBuiltinModule(\'node:path\').dirname(__filename),require=typeof require===\'function\'?require:process.getBuiltinModule(\'node:module\').createRequire(__filename);'

/**
 * The code with a code before it, after its hashbang
 * @param code
 * @param first
 */
function Prepend(code: string, first: string): string {
    const hashbang: RegExpExecArray | null = /^#![^\n]*\n/.exec(code)
    return hashbang ? `${hashbang[0]}${first}${code.slice(hashbang[0].length)}` : `${first}${code}`
}

/**
 * Bundle the compiled application and its dependencies into one CommonJS file, run by node and embedded in the executables.
 * The sources are compiled by tsc first: the metadata of the decorators (the injections, the DTOs) are emitted by it.
 * The native addons cannot be bundled: their packages (and what they load) are gathered into a native tree, which the
 * require of the bundle loads them from
 * @param options
 */
export async function BundleProject(options: BundleOptions): Promise<BundleResult> {
    const project: string = path.resolve(options.project)
    const manifestFile: string = path.join(project, 'package.json')
    if (!existsSync(manifestFile)) throw new Error(`${project} has no package.json`)
    const manifest: Record<string, any> = JSON.parse(await readFile(manifestFile, 'utf8'))
    const name: string = ProgramName(manifest)
    const entry: string = path.resolve(project, options.entry ?? manifest.main ?? 'build/App.js')
    if (!existsSync(entry)) throw new Error(`The entry ${path.relative(process.cwd(), entry) || entry} does not exist: build the project first`)
    const outfile: string = path.resolve(project, options.outfile ?? path.join('dist', `${name}.cjs`))
    const collector: NativeCollector = new NativeCollector(project)
    //esbuild is loaded by the commands which need it
    const {build} = await import('esbuild')
    const result = await build({
        entryPoints: [entry],
        outfile: outfile,
        write: false,
        bundle: true,
        platform: 'node',
        target: `node${process.versions.node.split('.')[0]}`,
        format: 'cjs',
        minify: options.minify ?? true,
        //The names of the classes are the ones of the objects of the container and of the errors
        keepNames: true,
        external: options.external ?? [],
        //The dynamic imports of the modules left out are requires (the require of the bundle loads the native ones)
        supported: {'dynamic-import': false},
        banner: {js: `var ${IMPORT_META_URL}=require('node:url').pathToFileURL(__filename).href;`},
        define: {
            'import.meta.url': IMPORT_META_URL,
            //Bun replaces process.env.NODE_ENV with the mode of its build: the one of the run is read
            ...options.runtime === 'bun' ? {'process.env.NODE_ENV': 'globalThis.process.env.NODE_ENV'} : {}
        },
        plugins: [collector.plugin()],
        logLevel: 'silent'
    }).catch((error: Error & { errors?: { text: string, location?: { file: string, line: number } }[] }): never => {
        const messages: string[] = (error.errors ?? []).map(({text, location}): string => location ? `${location.file}:${location.line}: ${text}` : text)
        //The bundles are CommonJS, which the executables of Node.js run
        const hint: string = messages.some((message: string): boolean => message.includes('Top-level await')) ? '\nThe bundles are CommonJS modules, without top-level await: await in an async function' : ''
        throw new Error(`The bundle failed:\n  ${messages.length ? messages.join('\n  ') : error.message}${hint}`)
    })
    let code: string = result.outputFiles[0].text
    const native: NativeTree | undefined = await collector.collect()
    const nativeDirectory: string = path.join(path.dirname(outfile), `${path.basename(outfile, path.extname(outfile))}.native`)
    await rm(nativeDirectory, {recursive: true, force: true})
    if (native) {
        //The require loading the native packages is the first code, after the hashbang
        code = Prepend(code, NativeBanner({name: name, hash: native.hash, directory: path.basename(nativeDirectory), modules: native.modules}))
        if ((options.native ?? 'directory') === 'directory') await WriteNativeTree(native, nativeDirectory)
    }
    //Before the require of the native tree, which loads the modules of node by it
    if (options.runtime === 'bun') code = Prepend(code, BUN_PRELUDE)
    await mkdir(path.dirname(outfile), {recursive: true})
    await writeFile(outfile, code)
    await chmod(outfile, 0o755)
    return {
        name: name,
        entry: entry,
        outfile: outfile,
        size: (await stat(outfile)).size,
        native: native,
        nativeDirectory: native && (options.native ?? 'directory') === 'directory' ? nativeDirectory : undefined
    }
}
