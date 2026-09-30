import {readFileSync} from 'node:fs'
import {copyFile, mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Run} from '../Processes.js'
import {Warn} from '../Output.js'
import {BundleProject, type BundleOptions, type BundleResult} from './Bundle.js'
import {PackNativeTree} from './Native.js'
import {NATIVE_DATA_ASSET, NATIVE_INDEX_ASSET} from './NativeRuntime.js'

export type ExecutableOptions = Omit<BundleOptions, 'outfile'> & {
    /**
     * The directory of the executable, dist by default
     */
    outdir?: string
}

export type ExecutableResult = {
    name: string
    /**
     * The executable, and its platform ("darwin-arm64")
     */
    file: string
    platform: string
    size: number
    /**
     * The packages of native addons embedded, extracted at the first run
     */
    native: string[]
    /**
     * The Node.js embedded in the executable
     */
    node: string
}

/**
 * The fuse of the Node.js binaries telling that a single executable application is injected
 */
const SEA_FUSE: string = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

/**
 * Run a command which must succeed
 * @param command
 * @param args
 * @param cwd
 */
async function Must(command: string, args: string[], cwd: string): Promise<void> {
    const result = await Run(command, args, cwd)
    if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.output.trim()}`)
}

/**
 * Run a function without the output of the console: postject prints the warnings of LIEF, which it binds when it is called
 * ("Can't find string offset for section name", the signature of node.exe changed by the injection)
 * @param run
 */
async function Quiet<T>(run: () => Promise<T>): Promise<T> {
    const {log, warn} = console
    console.log = console.warn = (): void => undefined
    try {
        return await run()
    } finally {
        console.log = log
        console.warn = warn
    }
}

/**
 * Make the executable of the application for the platform it is made on: its bundle embedded in the Node.js binary running
 * the tool (the single executable applications of Node.js), which runs without Node.js installed. The executables of the
 * other platforms are made on them (their native addons are built there), as the applications are built there
 * @param options
 */
export async function BuildExecutable(options: ExecutableOptions): Promise<ExecutableResult> {
    const project: string = path.resolve(options.project)
    const outdir: string = path.resolve(project, options.outdir ?? 'dist')
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-executable-'))
    try {
        const bundle: BundleResult = await BundleProject({...options, outfile: path.join(work, 'main.cjs'), native: 'embedded'})
        const assets: Record<string, string> = {}
        if (bundle.native) {
            //The files of the native packages, extracted by the executable at its first run
            const {index, data} = PackNativeTree(bundle.native)
            assets[NATIVE_DATA_ASSET] = path.join(work, 'native.gz')
            assets[NATIVE_INDEX_ASSET] = path.join(work, 'native.json')
            await writeFile(assets[NATIVE_DATA_ASSET], data)
            await writeFile(assets[NATIVE_INDEX_ASSET], JSON.stringify(index))
        }
        //The preparation blob of the bundle
        const blob: string = path.join(work, 'main.blob')
        await writeFile(path.join(work, 'sea-config.json'), JSON.stringify({
            main: bundle.outfile,
            output: blob,
            disableExperimentalSEAWarning: true,
            useCodeCache: false,
            useSnapshot: false,
            assets: assets
        }))
        await Must(process.execPath, ['--experimental-sea-config', 'sea-config.json'], work)
        const {inject} = await import('postject')
        await mkdir(outdir, {recursive: true})
        const file: string = path.join(outdir, process.platform === 'win32' ? `${bundle.name}.exe` : bundle.name)
        await rm(file, {force: true})
        await copyFile(process.execPath, file)
        //The signature of macOS is removed before the binary is changed, then made again (ad hoc)
        if (process.platform === 'darwin') await Must('codesign', ['--remove-signature', file], outdir)
        await Quiet((): Promise<void> => inject(file, 'NODE_SEA_BLOB', readFileSync(blob), {sentinelFuse: SEA_FUSE, machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined}))
        if (process.platform === 'darwin') await Must('codesign', ['--sign', '-', '--force', file], outdir)
        //The Authenticode signature of node.exe does not match the executable anymore
        if (process.platform === 'win32') Warn(`${path.basename(file)} has the signature of Node.js, which is not valid anymore: sign it (signtool) before distributing it`)
        return {
            name: bundle.name,
            file: file,
            platform: `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`,
            size: (await stat(file)).size,
            native: bundle.native?.modules ?? [],
            node: process.version
        }
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}
