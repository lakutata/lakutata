import {existsSync} from 'node:fs'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {bundleProject, type BundleResult} from '../Bundle.js'
import {nwjsRelease, type NwjsRelease} from './Runtime.js'

/**
 * The NW.js of an application: the "lakutata.nwjs" of its package.json
 */
export type NwjsConfig = {
    /**
     * The version of NW.js: a version (0.119.2), latest, or win7 (0.72.0, the last one running on Windows 7, 8 and 8.1)
     */
    version: string
    /**
     * The name of the application in NW.js, which names the directory of its data: the appId of its installer, else the
     * name of its package (in lower case)
     */
    name?: string
    /**
     * The arguments given to Chromium (the "chromium-args" of the manifest of NW.js)
     */
    chromiumArgs?: string
}

/**
 * The options of {@link stageNwjsApp}
 */
export type NwjsStageOptions = {
    /**
     * The directory of the application (its package.json), the current one by default
     */
    project?: string
    /**
     * The directory of the application of NW.js made
     */
    outdir: string
    /**
     * The version of NW.js, the one of lakutata.nwjs by default
     */
    version?: string
    /**
     * The compiled entry of the application (the "main" of the package.json by default)
     */
    entry?: string
    /**
     * Minify the bundle (false by default)
     */
    minify?: boolean
    /**
     * The modules left out of the bundle
     */
    external?: string[]
}

/**
 * The application of NW.js made by {@link stageNwjsApp}
 */
export type NwjsStage = {
    /**
     * Its directory: its manifest (package.json), its background script (main.js), the bundle of the application (app.cjs),
     * its native tree (app.native) and its resources (resources)
     */
    directory: string
    /**
     * The release of NW.js it is made for
     */
    release: NwjsRelease
    /**
     * Its name in NW.js (the directory of its data)
     */
    name: string
    bundle: BundleResult
}

/**
 * The background script of the application in NW.js: its Node.js context, where the application runs
 */
const BACKGROUND_SCRIPT: string = `//The background script of the application in NW.js (its Node.js context): the application, bundled
require('./app.cjs')
`

/**
 * The NW.js of an application, from the "lakutata.nwjs" of its package.json
 * @param manifest
 */
export function nwjsConfig(manifest: Record<string, any>): NwjsConfig {
    const config: unknown = manifest.lakutata?.nwjs
    if (!config || typeof config !== 'object' || typeof (config as NwjsConfig).version !== 'string') throw new Error('The application has no version of NW.js: give it with lakutata nwjs use <version> (latest, win7, 0.119.2…), which writes "lakutata": {"nwjs": {"version": …}} into its package.json')
    return config as NwjsConfig
}

/**
 * The name of an application in NW.js: lower case, the characters of the names of the packages
 * @param manifest
 * @param config
 */
function nwjsName(manifest: Record<string, any>, config: NwjsConfig): string {
    const name: string = String(config.name ?? manifest.lakutata?.installer?.appId ?? manifest.name ?? 'app')
    return name.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]+/g, '-')
}

/**
 * Make the application of NW.js of a project: its bundle (CommonJS, for the Node.js of the release), its native tree
 * and its resources (lakutata.resources), the manifest of NW.js (its name, its background script, the partition of the
 * webviews holding its user interface) and the background script running the bundle
 * @param options
 * @example
 * import {stageNwjsApp} from '@lakutata/builder'
 *
 * //The application of the development, run by: nw .nwjs/app
 * const stage = await stageNwjsApp({outdir: '.nwjs/app'})
 * console.log(stage.directory, stage.release.version, stage.name)
 */
export async function stageNwjsApp(options: NwjsStageOptions): Promise<NwjsStage> {
    const project: string = path.resolve(options.project ?? process.cwd())
    const manifestFile: string = path.join(project, 'package.json')
    if (!existsSync(manifestFile)) throw new Error(`${project} has no package.json`)
    const manifest: Record<string, any> = JSON.parse(await readFile(manifestFile, 'utf8'))
    const config: NwjsConfig = options.version ? {...manifest.lakutata?.nwjs, version: options.version} : nwjsConfig(manifest)
    const release: NwjsRelease = await nwjsRelease(config.version)
    //nwjs.json, what the user interface is built for (its Chromium), follows the version of the application
    const derived: string = `${JSON.stringify({version: release.version, node: release.node, chromium: release.chromium}, null, 2)}\n`
    const derivedFile: string = path.join(project, 'nwjs.json')
    if (!existsSync(derivedFile) || await readFile(derivedFile, 'utf8') !== derived) await writeFile(derivedFile, derived)
    const directory: string = path.resolve(project, options.outdir)
    //The directory is made again: never the project or a directory holding it
    if (!path.relative(directory, project).startsWith('..')) throw new Error(`The application of NW.js is made in a directory of its own, not ${directory}`)
    await rm(directory, {recursive: true, force: true})
    await mkdir(directory, {recursive: true})
    const bundle: BundleResult = await bundleProject({
        project: project,
        entry: options.entry,
        outfile: path.join(directory, 'app.cjs'),
        node: release.node,
        minify: options.minify ?? false,
        external: options.external,
        directories: {native: 'app.native', resources: 'resources'}
    })
    const name: string = nwjsName(manifest, config)
    const nwManifest: Record<string, unknown> = {
        name: name,
        productName: manifest.productName ?? manifest.name,
        version: manifest.version ?? '0.0.0',
        main: 'main.js',
        //The pages of the user interface, held by the webviews of the windows (without Node.js), are the files of the application
        webview: {partitions: [{name: 'trusted', accessible_resources: ['<all_urls>']}]},
        ...(config.chromiumArgs ? {'chromium-args': config.chromiumArgs} : {})
    }
    await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(nwManifest, null, 2)}\n`)
    await writeFile(path.join(directory, 'main.js'), BACKGROUND_SCRIPT)
    return {directory: directory, release: release, name: name, bundle: bundle}
}
