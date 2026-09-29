import {existsSync} from 'node:fs'
import {chmod, readFile, stat} from 'node:fs/promises'
import path from 'node:path'

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
}

export type BundleResult = {
    /**
     * The name of the program: its bin, or the name of the package without its scope
     */
    name: string
    entry: string
    outfile: string
    size: number
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
 * Bundle the compiled application and its dependencies into one CommonJS file, run by node and embedded in the executables.
 * The sources are compiled by tsc first: the metadata of the decorators (the injections, the DTOs) are emitted by it
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
    //esbuild is loaded by the commands which need it
    const {build} = await import('esbuild')
    await build({
        entryPoints: [entry],
        outfile: outfile,
        bundle: true,
        platform: 'node',
        target: `node${process.versions.node.split('.')[0]}`,
        format: 'cjs',
        minify: options.minify ?? true,
        //The names of the classes are the ones of the objects of the container and of the errors
        keepNames: true,
        external: options.external ?? [],
        banner: {js: `var ${IMPORT_META_URL}=require('node:url').pathToFileURL(__filename).href;`},
        define: {'import.meta.url': IMPORT_META_URL},
        logLevel: 'silent'
    }).catch((error: Error & { errors?: { text: string, location?: { file: string, line: number } }[] }): never => {
        const messages: string[] = (error.errors ?? []).map(({text, location}): string => location ? `${location.file}:${location.line}: ${text}` : text)
        throw new Error(`The bundle failed:\n  ${messages.length ? messages.join('\n  ') : error.message}`)
    })
    await chmod(outfile, 0o755)
    return {name: name, entry: entry, outfile: outfile, size: (await stat(outfile)).size}
}
