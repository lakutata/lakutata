import {existsSync} from 'node:fs'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {bundleProject, type BundleResult} from '../Bundle.js'
import type {NativeFile} from '../Native.js'

/**
 * The Node.js of the mobile applications of Capacitor: the one of nodejs-mobile, which @capawesome/capacitor-nodejs runs
 * on iOS and on Android
 */
export const MOBILE_NODE_VERSION: string = '18.20.4'

/**
 * The systems of the mobile applications of Capacitor
 */
export type MobilePlatform = 'android' | 'ios'

/**
 * The options of {@link stageMobileApp}
 */
export type MobileStageOptions = {
    /**
     * The system the project is made for: Capacitor copies the web directory, the project with it, to the system synced
     * (npx cap sync <platform>), so the project is made for each system before it is synced
     */
    platform: MobilePlatform
    /**
     * The directory of the application (its package.json), the current one by default
     */
    project?: string
    /**
     * The directory of the Node.js project made: the one @capawesome/capacitor-nodejs runs, `nodejs` in the web
     * directory of Capacitor (`webDir`) by default of the plugin; made again, after the build of the user interface
     * (which empties the web directory)
     */
    outdir: string
    /**
     * The compiled entry of the application (the "main" of the package.json by default)
     */
    entry?: string
    /**
     * Minify the bundle (true by default)
     */
    minify?: boolean
    /**
     * The modules left out of the bundle, besides `bridge` (the module the plugin gives the Node.js of the application)
     */
    external?: string[]
}

/**
 * The Node.js project made by {@link stageMobileApp}
 */
export type MobileStage = {
    /**
     * Its directory: its manifest (package.json), its entry (main.js), the bundle of the application (app.cjs) and its
     * resources (resources)
     */
    directory: string
    /**
     * The system it is made for
     */
    platform: MobilePlatform
    /**
     * The version of Node.js it is made for
     */
    node: string
    bundle: BundleResult
}

/**
 * The package of a file of the native tree: the last one of the node_modules in its path
 * @param file
 */
function packageOf(file: string): string {
    const parts: string[] = file.split('/')
    const index: number = parts.lastIndexOf('node_modules')
    if (index < 0) return file
    return parts.slice(index + 1, parts[index + 1]?.startsWith('@') ? index + 3 : index + 2).join('/')
}

/**
 * The entry of the Node.js project: the fetch() of Node.js put away without WebAssembly (V8 run --jitless on iOS: its
 * first call ends Node.js 18), a temporary directory that can be written (the one of the system cannot be on Android:
 * the cache directory of the application is; tried by making a directory, access() does not tell what SELinux
 * refuses). Node.js reads TMPDIR only in a process not marked secure (AT_SECURE), which an application of Android is:
 * os.tmpdir() gives the directory (the bundle reads it from the module at each call). Then the application, bundled
 */
const ENTRY_SCRIPT: string = `//The entry of the application in the Node.js of the mobile application: fetch() put away without WebAssembly, a temporary directory that can be written, then the application, bundled
const fs = require('fs')
const os = require('os')
const path = require('path')
if (typeof WebAssembly === 'undefined') delete globalThis.fetch
try {
    fs.rmdirSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lakutata-')))
} catch {
    const cache = path.join(path.dirname(require('bridge').app.datadir()), 'cache')
    fs.mkdirSync(cache, {recursive: true})
    process.env.TMPDIR = cache
    os.tmpdir = () => cache
}
require('./app.cjs')
`

/**
 * Make the Node.js project of a mobile application of Capacitor, which @capawesome/capacitor-nodejs runs on iOS and on
 * Android: the bundle of the application (CommonJS, for the Node.js of nodejs-mobile) and its resources
 * (lakutata.resources), its manifest and its entry. The bundle holds the dependencies: the plugin runs the project as it
 * is (its node_modules would be dropped from the assets of Android). The native addons are refused for now
 * @param options
 * @example
 * import {stageMobileApp} from '@lakutata/builder'
 *
 * //After the build of the user interface (vite build), before npx cap sync android
 * const stage = await stageMobileApp({platform: 'android', outdir: '../ui/dist/nodejs'})
 * console.log(stage.directory, stage.node)
 */
export async function stageMobileApp(options: MobileStageOptions): Promise<MobileStage> {
    const project: string = path.resolve(options.project ?? process.cwd())
    const manifestFile: string = path.join(project, 'package.json')
    if (!existsSync(manifestFile)) throw new Error(`${project} has no package.json`)
    const manifest: Record<string, any> = JSON.parse(await readFile(manifestFile, 'utf8'))
    const directory: string = path.resolve(project, options.outdir)
    //The directory is made again: never the project or a directory holding it
    if (!path.relative(directory, project).startsWith('..')) throw new Error(`The Node.js project of the mobile application is made in a directory of its own, not ${directory}`)
    await rm(directory, {recursive: true, force: true})
    await mkdir(directory, {recursive: true})
    const bundle: BundleResult = await bundleProject({
        project: project,
        entry: options.entry,
        outfile: path.join(directory, 'app.cjs'),
        node: MOBILE_NODE_VERSION,
        minify: options.minify ?? true,
        external: ['bridge', ...options.external ?? []],
        directories: {native: 'app.native', resources: 'resources'}
    })
    //The native tree holds the scripts of the workers too: its addons only are refused
    const addons: string[] = (bundle.native?.files ?? []).map((file: NativeFile): string => file.path).filter((file: string): boolean => file.endsWith('.node'))
    if (addons.length) {
        await rm(directory, {recursive: true, force: true})
        throw new Error(`The native addons of the application are not built for iOS and Android yet: ${[...new Set(addons.map(packageOf))].join(', ')}`)
    }
    await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({name: manifest.name ?? 'app', version: manifest.version ?? '0.0.0', private: true, main: 'main.js'}, null, 2)}\n`)
    await writeFile(path.join(directory, 'main.js'), ENTRY_SCRIPT)
    return {directory: directory, platform: options.platform, node: MOBILE_NODE_VERSION, bundle: bundle}
}
