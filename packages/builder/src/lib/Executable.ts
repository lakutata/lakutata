import {existsSync, readFileSync} from 'node:fs'
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {detectLibc} from './Platform.js'
import {runCommand} from './Processes.js'
import {bundleProject, programName, type BundleOptions, type BundleResult} from './Bundle.js'
import {applicationIcon, icoFile, setExecutableIcon} from './Icons.js'
import {packNativeTree, type NativeFile} from './Native.js'
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
    /**
     * The node program embedded in the executable, which also makes its single executable application. Another Node.js
     * than the one running the build (20.12, 21.7 or later, which have the assets of the single executable applications),
     * so that an older Node.js can run the build; the bundle is written in the syntax of the node program. The one
     * running the build by default.
     */
    nodeProgram?: string
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
     * The scripts of the workers of the application (their files, from the project), with the native addons
     */
    workers: string[]
    /**
     * The other files and the directories of data the application reads by their paths (from the project), with the
     * native addons
     */
    files: string[]
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
async function must(command: string, args: string[], cwd: string): Promise<void> {
    const result = await runCommand(command, args, cwd)
    if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.output.trim()}`)
}

/**
 * Run a function without the output of the console: postject prints the warnings of LIEF, which it binds when it is called
 * ("Can't find string offset for section name", the signature of node.exe changed by the injection)
 * @param run
 */
async function quiet<T>(run: () => Promise<T>): Promise<T> {
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
async function findBun(project: string): Promise<{ command: string, version: string }> {
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
        const result = await runCommand(command, ['--version'], project).catch((): undefined => undefined)
        if (result?.code === 0) return {command: command, version: result.output.trim()}
    }
    throw new Error('Bun is not installed: install it in the project (npm install --save-dev bun), or on the system (https://bun.sh)')
}

/**
 * Write the icon of the application (ico) into the work directory
 * @param work
 * @param icon
 */
async function writeIcon(work: string, icon: Buffer): Promise<string> {
    const file: string = path.join(work, 'icon.ico')
    await writeFile(file, icon)
    return file
}

/**
 * The node program embedded in an executable and its version: the one given, else the one running the tool. It must
 * have the assets of the single executable applications (Node.js 20.12, 21.7 or later): node:sea and its getAsset.
 * @param program
 */
async function nodeOfExecutable(program?: string): Promise<{ path: string, version: string }> {
    const node: string = program ? path.resolve(program) : process.execPath
    const probe: { code: number, output: string } = await runCommand(node, ['-e', "let assets=false;try{assets=typeof require('node:sea').getAsset==='function'}catch{}process.stdout.write(process.version+' '+assets)"], process.cwd()).catch((error: Error): { code: number, output: string } => ({code: 1, output: error.message}))
    const [version, assets] = probe.output.trim().split(' ')
    if (probe.code !== 0 || !/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`${node} cannot be run as the node program of the executable: ${probe.output.trim()}`)
    if (assets !== 'true') throw new Error(`The executables of Node.js need the assets of its single executable applications (Node.js 20.12, 21.7 or later): ${node} is Node.js ${version}. Give a newer node program (nodeProgram, --node-program). Or make the executable with Bun (--runtime bun)`)
    return {path: node, version: version}
}

/**
 * Embed a bundle in a Node.js binary (the single executable applications of Node.js)
 * @param bundle
 * @param work
 * @param file
 * @param warnings
 * @param node the node program embedded
 * @param icon the icon of the application (ico, Windows)
 */
async function embedInNode(bundle: BundleResult, work: string, file: string, warnings: string[], node: { path: string, version: string }, icon?: Buffer): Promise<string> {
    const assets: Record<string, string> = {}
    if (bundle.native) {
        //The files of the native packages, extracted by the executable at its first run
        const {index, data} = packNativeTree(bundle.native)
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
    await must(node.path, ['--experimental-sea-config', 'sea-config.json'], work)
    const {inject} = await import('postject')
    await copyFile(node.path, file)
    //The icon of the application replaces the one of node.exe, before the bundle is embedded
    if (icon) await setExecutableIcon(file, icon)
    //The signature of macOS is removed before the binary is changed, then made again (ad hoc)
    if (process.platform === 'darwin') await must('codesign', ['--remove-signature', file], work)
    await quiet((): Promise<void> => inject(file, 'NODE_SEA_BLOB', readFileSync(blob), {sentinelFuse: SEA_FUSE, machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined}))
    if (process.platform === 'darwin') await must('codesign', ['--sign', '-', '--force', file], work)
    //The Authenticode signature of node.exe does not match the executable anymore
    if (process.platform === 'win32') warnings.push(`${path.basename(file)} has the signature of Node.js, which is not valid anymore: sign it (signtool) before distributing it`)
    return `Node.js ${node.version}`
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
 * @param icon the icon of the application (ico, Windows)
 */
async function compileWithBun(bun: { command: string, version: string }, bundle: BundleResult, work: string, file: string, icon?: Buffer): Promise<string> {
    let entry: string = bundle.outfile
    if (bundle.native) {
        const {index, data} = packNativeTree(bundle.native)
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
    await must(bun.command, [
        'build', entry, '--compile', '--outfile', file,
        //Compiled to the bytecode of JavaScriptCore: it starts without parsing the bundle
        '--bytecode',
        '--compile-autoload-package-json', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig',
        //The icon of the application (Windows)
        ...icon ? [`--windows-icon=${await writeIcon(work, icon)}`] : []
    ], work)
    return `Bun ${bun.version}`
}

/**
 * The packages of a native tree whose addons are built on the V8 API of Node.js (they export
 * node_register_module_v<ABI>), not on Node-API (napi_register_module_v1): Bun may not load them (better-sqlite3)
 * @param files The files of the native tree.
 * @returns The names of the packages (or of the addons of the application itself), sorted.
 */
export function v8Addons(files: NativeFile[]): string[] {
    const names: Set<string> = new Set()
    for (const file of files) {
        if (!file.path.endsWith('.node')) continue
        const content: Buffer = file.content ?? readFileSync(file.source)
        if (!content.includes('node_register_module_v') || content.includes('napi_register_module_v1')) continue
        const at: number = file.path.lastIndexOf('node_modules/')
        const parts: string[] = at < 0 ? [path.posix.basename(file.path)] : file.path.slice(at + 'node_modules/'.length).split('/')
        names.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
    return [...names].sort()
}

/**
 * Make the executable of the application for the platform it is made on, which runs without Node.js installed: its bundle
 * embedded in the Node.js binary running the tool (the single executable applications of Node.js), or compiled by Bun.
 * The executables of the other platforms are made on them (their native addons are built there), as the applications are
 * built there
 * @param options
 */
export async function buildExecutable(options: ExecutableOptions): Promise<ExecutableResult> {
    const project: string = path.resolve(options.project)
    const outdir: string = path.resolve(project, options.outdir ?? 'dist')
    //Bun is found before the application is bundled
    const bun: { command: string, version: string } | undefined = options.runtime === 'bun' ? await findBun(project) : undefined
    //The node program embedded, checked before the application is bundled
    const node: { path: string, version: string } | undefined = bun ? undefined : await nodeOfExecutable(options.nodeProgram)
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-executable-'))
    try {
        const directory: boolean = options.layout === 'directory'
        //The directory of the executable: dist/<name>, its native tree and its resources written there (the links of
        //the tree are the ones of their directory), the one of the executable alone otherwise
        const manifest: Record<string, any> = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
        const target: string = directory ? path.join(outdir, programName(manifest)) : outdir
        if (directory) await rm(target, {recursive: true, force: true})
        await mkdir(target, {recursive: true})
        const bundle: BundleResult = await bundleProject({
            //The syntax of the node embedded
            ...node ? {node: node.version} : {},
            ...options,
            outfile: path.join(work, 'main.cjs'),
            native: directory ? 'directory' : 'embedded',
            executable: true,
            directories: {native: path.join(target, 'native'), resources: path.join(target, 'resources')}
        })
        //The executables of Node.js do not load the native addons on musl (postject rewrites their symbols): the ones of Bun do
        if (!bun && detectLibc() === 'musl' && bundle.native?.files.some((file): boolean => file.path.endsWith('.node'))) throw new Error('The executables of Node.js do not load native addons on musl (Alpine): make the executable with Bun (--runtime bun, or "runtime": "bun" of lakutata.installer)')
        const file: string = path.join(target, process.platform === 'win32' ? `${bundle.name}.exe` : bundle.name)
        await rm(file, {force: true})
        //The native tree and the resources of the layout directory are not embedded
        const embedded: BundleResult = directory ? {...bundle, native: undefined} : bundle
        //Made and signed aside: codesign takes a directory holding "resources" for a bundle of macOS (its file system
        //ignores the case), whose signature it writes beside the executable (_CodeSignature)
        const made: string = path.join(work, 'executable', path.basename(file))
        await mkdir(path.dirname(made), {recursive: true})
        const warnings: string[] = [...bundle.warnings]
        //Bun loads the addons of Node-API; an addon built on the V8 API of Node.js may fail when it is loaded
        if (bun) for (const name of v8Addons(bundle.native?.files ?? [])) warnings.push(`${name}: its addon is built on the V8 API of Node.js, not on Node-API, and Bun may not load it (the executable then fails when it loads the package): make the executable with Node.js (--runtime node)`)
        //The icon of the application: the one of the executables of Windows (the ones of macOS and Linux have none)
        const application = applicationIcon(project, manifest)
        const icon: Buffer | undefined = application && process.platform === 'win32' ? icoFile(application.image) : undefined
        const runtime: string = bun ? await compileWithBun(bun, embedded, work, made, icon) : await embedInNode(embedded, work, made, warnings, node!, icon)
        await copyFile(made, file)
        await chmod(file, 0o755)
        return {
            name: bundle.name,
            file: file,
            platform: `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`,
            size: (await stat(file)).size,
            native: bundle.native?.modules ?? [],
            workers: bundle.workers,
            files: bundle.files,
            resources: bundle.resources,
            directory: directory ? target : undefined,
            runtime: runtime,
            warnings: warnings
        }
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}
