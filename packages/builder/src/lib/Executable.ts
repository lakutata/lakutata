import {existsSync, readFileSync} from 'node:fs'
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {Run} from './Processes.js'
import {BundleProject, ProgramName, type BundleOptions, type BundleResult} from './Bundle.js'
import {PackNativeTree} from './Native.js'
import {BUN_NATIVE_ASSETS, NATIVE_DATA_ASSET, NATIVE_INDEX_ASSET} from './NativeRuntime.js'

export type ExecutableOptions = Omit<BundleOptions, 'outfile' | 'native' | 'directories'> & {
    /**
     * The directory of the executable, dist by default
     */
    outdir?: string
    /**
     * One file, its native tree and its resources embedded, extracted at its first run (by default); or a directory, the
     * executable and its native tree (native) and its resources (resources) next to it, loaded from there (the
     * installers, the images)
     */
    layout?: 'file' | 'directory'
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
     * The packages of native addons embedded, extracted at the first run, or next to the executable
     */
    native: string[]
    /**
     * The resources of the application (their paths in the resources)
     */
    resources: string[]
    /**
     * The directory of the executable, its native tree and its resources (the layout directory)
     */
    directory?: string
    /**
     * The runtime embedded in the executable, and its version ("Node.js v24.11.1", "Bun 1.4.2")
     */
    runtime: string
    /**
     * What to do before distributing the executable (sign it)
     */
    warnings: string[]
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
 * The bun of the project (the bun package of npm, in its node_modules or in the ones of its workspace), else the one of
 * the system
 * @param project
 * @return the command, and the version of Bun
 */
async function FindBun(project: string): Promise<{ command: string, version: string }> {
    const candidates: string[] = []
    try {
        const root: string = path.dirname(createRequire(path.join(project, 'package.json')).resolve('bun/package.json'))
        candidates.push(path.join(root, 'bin', 'bun.exe'))
    } catch {
        //Not installed in the project
    }
    candidates.push('bun')
    for (const command of candidates) {
        if (command !== 'bun' && !existsSync(command)) continue
        const result = await Run(command, ['--version'], project).catch((): undefined => undefined)
        if (result?.code === 0) return {command: command, version: result.output.trim()}
    }
    throw new Error('Bun is not installed: install it in the project (npm install --save-dev bun), or on the system (https://bun.sh)')
}

/**
 * Embed a bundle in the Node.js binary running the tool (the single executable applications of Node.js)
 * @param bundle
 * @param work
 * @param file
 * @param warnings
 */
async function EmbedInNode(bundle: BundleResult, work: string, file: string, warnings: string[]): Promise<string> {
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
        //The code cache of V8, made by the Node.js embedded: the bundle is not compiled again at start
        useCodeCache: true,
        useSnapshot: false,
        assets: assets
    }))
    await Must(process.execPath, ['--experimental-sea-config', 'sea-config.json'], work)
    const {inject} = await import('postject')
    await copyFile(process.execPath, file)
    //The signature of macOS is removed before the binary is changed, then made again (ad hoc)
    if (process.platform === 'darwin') await Must('codesign', ['--remove-signature', file], work)
    await Quiet((): Promise<void> => inject(file, 'NODE_SEA_BLOB', readFileSync(blob), {sentinelFuse: SEA_FUSE, machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined}))
    if (process.platform === 'darwin') await Must('codesign', ['--sign', '-', '--force', file], work)
    //The Authenticode signature of node.exe does not match the executable anymore
    if (process.platform === 'win32') warnings.push(`${path.basename(file)} has the signature of Node.js, which is not valid anymore: sign it (signtool) before distributing it`)
    return `Node.js ${process.version}`
}

/**
 * Compile a bundle into an executable of Bun, in bytecode: the files of the native tree are embedded beside it, the
 * executable gives their paths to the require of the bundle (BUN_NATIVE_ASSETS). As the executables of Node.js, it loads neither the .env
 * nor the bunfig.toml of the directory it runs in; it reads the package.json of the packages it loads from the disk (the
 * native tree, the modules left out)
 * @param bun
 * @param bundle
 * @param work
 * @param file
 */
async function CompileWithBun(bun: { command: string, version: string }, bundle: BundleResult, work: string, file: string): Promise<string> {
    let entry: string = bundle.outfile
    if (bundle.native) {
        const {index, data} = PackNativeTree(bundle.native)
        await writeFile(path.join(work, 'native.gz'), data)
        await writeFile(path.join(work, 'native.json'), JSON.stringify(index))
        entry = path.join(work, 'main.mjs')
        await writeFile(entry, [
            `import data from './native.gz' with {type: 'file'}`,
            `import index from './native.json' with {type: 'file'}`,
            `globalThis[Symbol.for(${JSON.stringify(BUN_NATIVE_ASSETS)})] = {data, index}`,
            //Not imported: the bytecode of Bun is the one of CommonJS modules, without top-level await
            `require(${JSON.stringify(`./${path.basename(bundle.outfile)}`)})`
        ].join('\n'))
    }
    await Must(bun.command, [
        'build', entry, '--compile', '--outfile', file,
        //Compiled to the bytecode of JavaScriptCore: it starts without parsing the bundle
        '--bytecode',
        '--compile-autoload-package-json', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig'
    ], work)
    return `Bun ${bun.version}`
}

/**
 * Make the executable of the application for the platform it is made on, which runs without Node.js installed: its bundle
 * embedded in the Node.js binary running the tool (the single executable applications of Node.js), or compiled by Bun.
 * The executables of the other platforms are made on them (their native addons are built there), as the applications are
 * built there
 * @param options
 */
export async function BuildExecutable(options: ExecutableOptions): Promise<ExecutableResult> {
    const project: string = path.resolve(options.project)
    const outdir: string = path.resolve(project, options.outdir ?? 'dist')
    //Bun is found before the application is bundled
    const bun: { command: string, version: string } | undefined = options.runtime === 'bun' ? await FindBun(project) : undefined
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-executable-'))
    try {
        const directory: boolean = options.layout === 'directory'
        //The directory of the executable: dist/<name>, its native tree and its resources written there (the links of
        //the tree are the ones of their directory), the one of the executable alone otherwise
        const target: string = directory ? path.join(outdir, ProgramName(JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')))) : outdir
        if (directory) await rm(target, {recursive: true, force: true})
        await mkdir(target, {recursive: true})
        const bundle: BundleResult = await BundleProject({
            ...options,
            outfile: path.join(work, 'main.cjs'),
            native: directory ? 'directory' : 'embedded',
            directories: {native: path.join(target, 'native'), resources: path.join(target, 'resources')}
        })
        const file: string = path.join(target, process.platform === 'win32' ? `${bundle.name}.exe` : bundle.name)
        await rm(file, {force: true})
        //The native tree and the resources of the layout directory are not embedded
        const embedded: BundleResult = directory ? {...bundle, native: undefined} : bundle
        //Made and signed aside: codesign takes a directory holding "resources" for a bundle of macOS (its file system
        //ignores the case), whose signature it writes beside the executable (_CodeSignature)
        const made: string = path.join(work, 'executable', path.basename(file))
        await mkdir(path.dirname(made), {recursive: true})
        const warnings: string[] = []
        const runtime: string = bun ? await CompileWithBun(bun, embedded, work, made) : await EmbedInNode(embedded, work, made, warnings)
        await copyFile(made, file)
        await chmod(file, 0o755)
        return {
            name: bundle.name,
            file: file,
            platform: `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`,
            size: (await stat(file)).size,
            native: bundle.native?.modules ?? [],
            resources: bundle.resources,
            directory: directory ? target : undefined,
            runtime: runtime,
            warnings: warnings
        }
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}
