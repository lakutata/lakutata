import {copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Run} from '../Processes.js'
import {Warn} from '../Output.js'
import {BundleProject, type BundleOptions, type BundleResult} from './Bundle.js'
import {ExecutableName, HostTarget, NodeBinary, type Target} from './NodeBinary.js'
import {PackNativeTree} from './Native.js'
import {NATIVE_DATA_ASSET, NATIVE_INDEX_ASSET} from './NativeRuntime.js'

export type ExecutableOptions = Omit<BundleOptions, 'outfile'> & {
    /**
     * The platforms of the executables, the one of the running Node.js by default
     */
    targets?: Target[]
    /**
     * The directory of the executables, dist by default
     */
    outdir?: string
}

export type ExecutableResult = {
    name: string
    /**
     * The packages of native addons embedded, extracted at the first run
     */
    native: string[]
    /**
     * The Node.js embedded in the executables
     */
    node: string
    executables: { target: Target, file: string, size: number }[]
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
 * Make the executables of the application: its bundle embedded in the Node.js binary of each target (the single executable
 * applications of Node.js), which run without Node.js installed. The Node.js embedded is the version of the running one
 * @param options
 */
export async function BuildExecutables(options: ExecutableOptions): Promise<ExecutableResult> {
    const project: string = path.resolve(options.project)
    const targets: Target[] = options.targets?.length ? options.targets : [HostTarget()]
    const outdir: string = path.resolve(project, options.outdir ?? 'dist')
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-executable-'))
    try {
        const bundle: BundleResult = await BundleProject({...options, outfile: path.join(work, 'main.cjs'), native: 'embedded'})
        const assets: Record<string, string> = {}
        if (bundle.native) {
            //The addons are the ones of this platform
            const others: Target[] = targets.filter(({name}): boolean => name !== HostTarget().name)
            if (others.length) {
                throw new Error([
                    `The native addons (${bundle.native.modules.join(', ') || 'the addons of the application'}) are built for ${HostTarget().name}: the executables of ${others.map(({name}): string => name).join(', ')} are made where their addons are built.`,
                    'Run lakutata executable on these platforms: a machine or a runner of the CI of the platform, or, for Linux, a container of the architecture (docker run --platform linux/<arch>)'
                ].join('\n'))
            }
            //The files of the native packages, extracted by the executable at its first run
            const {index, data} = PackNativeTree(bundle.native)
            assets[NATIVE_DATA_ASSET] = path.join(work, 'native.gz')
            assets[NATIVE_INDEX_ASSET] = path.join(work, 'native.json')
            await writeFile(assets[NATIVE_DATA_ASSET], data)
            await writeFile(assets[NATIVE_INDEX_ASSET], JSON.stringify(index))
        }
        //The preparation blob of the bundle, read by the Node.js of the same version on any platform (without the code cache
        //and the snapshot, which are specific to the platform)
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
        const data: Buffer = await readFile(blob)
        const {inject} = await import('postject')
        await mkdir(outdir, {recursive: true})
        const signs: boolean = process.platform === 'darwin'
        const executables: ExecutableResult['executables'] = []
        for (const target of targets) {
            //The name of the target is added when the executables are made for several platforms, or another one
            const file: string = path.join(outdir, ExecutableName(target, options.targets?.length ? `${bundle.name}-${target.name}` : bundle.name))
            await rm(file, {force: true})
            await copyFile(await NodeBinary(target), file)
            //The signature of the macOS binaries is removed before they are changed, then made again (ad hoc)
            if (target.platform === 'darwin' && signs) await Must('codesign', ['--remove-signature', file], outdir)
            await Quiet((): Promise<void> => inject(file, 'NODE_SEA_BLOB', data, {sentinelFuse: SEA_FUSE, machoSegmentName: target.platform === 'darwin' ? 'NODE_SEA' : undefined}))
            if (target.platform === 'darwin') {
                if (signs) await Must('codesign', ['--sign', '-', '--force', file], outdir)
                else Warn(`${path.basename(file)} is not signed: sign it on macOS (codesign --sign - ${path.basename(file)}), macOS does not run it otherwise`)
            }
            //The Authenticode signature of node.exe does not match the executable anymore
            if (target.platform === 'win') Warn(`${path.basename(file)} has the signature of Node.js, which is not valid anymore: sign it (signtool) before distributing it`)
            executables.push({target: target, file: file, size: (await stat(file)).size})
        }
        return {name: bundle.name, native: bundle.native?.modules ?? [], node: process.version, executables: executables}
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}
