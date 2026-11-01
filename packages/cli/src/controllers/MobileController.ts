import {spawn} from 'node:child_process'
import {existsSync, readFileSync, watch, writeFileSync} from 'node:fs'
import {cp, mkdir, readdir, rm} from 'node:fs/promises'
import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import type {AndroidAbi, MobileStage, MobileStageOptions} from '@lakutata/builder'
import {MobileDeployDTO} from '../dtos/MobileDeployDTO.js'
import {MobileRunDTO} from '../dtos/MobileRunDTO.js'
import {MobileStageDTO} from '../dtos/MobileStageDTO.js'
import {loadBuilder} from '../lib/Builder.js'
import {done, step, warn} from '../lib/Output.js'
import {runCommand, spawnCommand} from '../lib/Processes.js'

/**
 * Where @capawesome/capacitor-nodejs copies the Node.js project on Android, in the files of the application
 */
const ANDROID_PROJECT: string = 'files/capawesome_nodejs/nodejs-project'

/**
 * The result of a command run
 */
type Run = { code: number, stdout: string, stderr: string }

/**
 * Run a command, its output given back; its input written to it (a stream of tar)
 * @param command
 * @param args
 * @param input
 */
function run(command: string, args: string[], input?: NodeJS.ReadableStream): Promise<Run> {
    return new Promise((resolve: (result: Run) => void, reject: (error: Error) => void): void => {
        const child = spawn(command, args, {stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe']})
        let stdout: string = ''
        let stderr: string = ''
        child.stdout!.on('data', (chunk: Buffer): unknown => stdout += chunk.toString())
        child.stderr!.on('data', (chunk: Buffer): unknown => stderr += chunk.toString())
        child.once('error', reject)
        child.once('close', (code: number | null): void => resolve({code: code ?? 1, stdout: stdout, stderr: stderr}))
        if (input) input.pipe(child.stdin!)
    })
}

/**
 * Run a command, which must succeed
 * @param what
 * @param command
 * @param args
 * @param input
 */
async function must(what: string, command: string, args: string[], input?: NodeJS.ReadableStream): Promise<string> {
    const result: Run = await run(command, args, input)
    if (result.code !== 0) throw new Error(`${what}: ${(result.stderr || result.stdout).trim() || `${command} exited with ${result.code}`}`)
    return result.stdout
}

/**
 * The adb of the Android SDK (ANDROID_HOME), else the one of the PATH
 */
function adbProgram(): string {
    const home: string | undefined = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
    return home ? path.join(home, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'
}

/**
 * Wait a moment
 * @param milliseconds
 */
function pause(milliseconds: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, milliseconds))
}

/**
 * Put the Node.js project into the application installed in an emulator or a device of Android (a debug build: run-as),
 * and start the application again. The plugin copies the project of the package into the files of the application at
 * its first start, and copies it again only when the package is updated: the project put there replaces the copy until
 * then. The application is started once first when it has not copied its project yet
 * @param directory
 * @param appId
 * @param device
 */
async function deployAndroid(directory: string, appId: string, device?: string): Promise<void> {
    const adb: string = adbProgram()
    const target: string[] = device ? ['-s', device] : []
    const shell = (...args: string[]): Promise<Run> => run(adb, [...target, 'shell', ...args])
    const installed: Run = await shell('pm', 'path', appId)
    if (installed.code !== 0 || !installed.stdout.includes('package:')) throw new Error(`The application ${appId} is not installed on ${device ?? 'the device'} (npx cap run android)`)
    //Its launcher activity, started with am
    const activity: string = (await must('The activity of the application cannot be found', adb, [...target, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', appId])).trim().split('\n').at(-1)!.trim()
    const start = (): Promise<string> => must('The application cannot be started', adb, [...target, 'shell', 'am', 'start', '-n', activity])
    const copied = async (): Promise<boolean> => (await shell('run-as', appId, 'ls', `${ANDROID_PROJECT}/package.json`)).code === 0
    if (!await copied()) {
        const debuggable: Run = await shell('run-as', appId, 'ls')
        if (debuggable.code !== 0) throw new Error(`The files of ${appId} cannot be written (run-as): a debug build of the application is deployed to (${(debuggable.stderr || debuggable.stdout).trim()})`)
        step('The application started once, the plugin copying its Node.js project')
        await start()
        for (let attempt: number = 0; attempt < 60 && !await copied(); attempt++) await pause(500)
        if (!await copied()) throw new Error(`The application ${appId} did not copy its Node.js project (${ANDROID_PROJECT})`)
    }
    await must('The application cannot be stopped', adb, [...target, 'shell', 'am', 'force-stop', appId])
    //The files of the project replaced by the ones made, through tar (the files of macOS without their extended attributes)
    const tar = spawn('tar', ['-c', '-C', directory, '.'], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, COPYFILE_DISABLE: '1'}})
    await must('The Node.js project cannot be written into the application', adb, [...target, 'shell', 'run-as', appId, 'sh', '-c', `'rm -rf ${ANDROID_PROJECT} && mkdir -p ${ANDROID_PROJECT} && tar -x -f - -C ${ANDROID_PROJECT}'`], tar.stdout!)
    await start()
}

/**
 * Put the Node.js project into the application installed in a simulator of iOS (the directory of the application on
 * the Mac), and start the application again
 * @param directory
 * @param appId
 * @param nodeDir the directory of the Node.js project in the web directory of the application
 * @param device
 * @param frameworks the frameworks of the native addons of the project for the simulators, put into the application
 */
async function deployIos(directory: string, appId: string, nodeDir: string, device?: string, frameworks?: string): Promise<void> {
    if (!device && !/\(Booted\)/.test(await must('The simulators cannot be listed', 'xcrun', ['simctl', 'list', 'devices', 'booted']))) throw new Error('No simulator of iOS is running (npx cap run ios)')
    const simulator: string = device ?? 'booted'
    const container: string = (await must(`The application ${appId} is not installed on the simulator ${simulator}, or the simulator is not running (npx cap run ios)`, 'xcrun', ['simctl', 'get_app_container', simulator, appId, 'app'])).trim()
    await run('xcrun', ['simctl', 'terminate', simulator, appId])
    const project: string = path.join(container, 'public', nodeDir)
    await rm(project, {recursive: true, force: true})
    await mkdir(project, {recursive: true})
    for (const entry of await readdir(directory)) await cp(path.join(directory, entry), path.join(project, entry), {recursive: true})
    //The frameworks of its native addons (signed ad hoc, which the simulators take) in place of the ones of the application
    for (const entry of frameworks && existsSync(frameworks) ? await readdir(frameworks) : []) {
        if (!entry.endsWith('.framework')) continue
        const target: string = path.join(container, 'Frameworks', entry)
        await rm(target, {recursive: true, force: true})
        await cp(path.join(frameworks!, entry), target, {recursive: true})
    }
    await must('The application cannot be started', 'xcrun', ['simctl', 'launch', simulator, appId])
}

/**
 * The architecture of an emulator or a device of Android (its ABI: arm64-v8a, x86_64…)
 * @param device the one running by default
 */
async function androidAbi(device?: string): Promise<string> {
    return (await must('The architecture of the device of Android cannot be read', adbProgram(), [...device ? ['-s', device] : [], 'shell', 'getprop', 'ro.product.cpu.abi'])).trim()
}

/**
 * The directory of the project of Capacitor holding a directory: the one of its capacitor.config
 * @param directory
 */
function capacitorRoot(directory: string): string {
    for (let current: string = directory; ; current = path.dirname(current)) {
        if (['capacitor.config.json', 'capacitor.config.ts', 'capacitor.config.js'].some((name: string): boolean => existsSync(path.join(current, name)))) return current
        if (current === path.dirname(current)) throw new Error(`${directory} is in no project of Capacitor (capacitor.config.json)`)
    }
}

/**
 * The emulator or the device of Android running (adb devices)
 */
async function androidDevice(): Promise<string> {
    const serial: string | undefined = (await must('The devices of Android cannot be listed', adbProgram(), ['devices'])).split('\n').map((line: string): string[] => line.trim().split(/\s+/)).find((parts: string[]): boolean => parts[1] === 'device')?.[0]
    if (!serial) throw new Error('No emulator or device of Android is running')
    return serial
}

/**
 * The simulator of iOS the application runs on, booted (its UDID): the one given (its UDID or its name), else the one
 * running, else the newest iPhone
 * @param device
 */
async function iosSimulator(device?: string): Promise<string> {
    type Simulator = { udid: string, name: string, state: string }
    const listed = JSON.parse(await must('The simulators cannot be listed', 'xcrun', ['simctl', 'list', 'devices', 'available', '--json'])) as { devices: Record<string, Simulator[]> }
    //The ones of the runtimes of iOS, the newest first
    const simulators: Simulator[] = Object.entries(listed.devices)
        .filter(([runtime]: [string, Simulator[]]): boolean => runtime.includes('SimRuntime.iOS-'))
        .sort(([a]: [string, Simulator[]], [b]: [string, Simulator[]]): number => b.localeCompare(a, undefined, {numeric: true}))
        .flatMap(([, devices]: [string, Simulator[]]): Simulator[] => devices)
    const simulator: Simulator | undefined = device
        ? simulators.find((candidate: Simulator): boolean => candidate.udid === device || candidate.name === device)
        : simulators.find((candidate: Simulator): boolean => candidate.state === 'Booted') ?? simulators.find((candidate: Simulator): boolean => candidate.name.startsWith('iPhone'))
    if (!simulator) throw new Error(device ? `No simulator of iOS is ${device} (xcrun simctl list devices)` : 'No simulator of iOS is available (the platform of iOS of Xcode)')
    if (simulator.state !== 'Booted') {
        step(`The simulator ${simulator.name} booted`)
        await must(`The simulator ${simulator.name} cannot be booted`, 'xcrun', ['simctl', 'bootstatus', simulator.udid, '-b'])
    }
    return simulator.udid
}

/**
 * Show a simulator of iOS in the app of Xcode showing them: Simulator, Device Hub since Xcode 27 (which native-run, the
 * runner of npx cap run ios, does not know). Not shown without it: the application runs all the same
 * @param udid
 */
async function showSimulator(udid: string): Promise<void> {
    const developer: string = (await run('xcode-select', ['-p'])).stdout.trim()
    if (!developer) return
    const simulator: string = path.join(developer, 'Applications', 'Simulator.app')
    const hub: string = path.join(developer, '..', 'Applications', 'DeviceHub.app')
    if (existsSync(simulator)) await run('open', [simulator, '--args', '-CurrentDeviceUDID', udid])
    else if (existsSync(hub)) await run('open', [hub])
}

/**
 * The project of iOS of a project of Capacitor: its directory (the ios.path of capacitor.config.json, ios by default),
 * the one of its project of Xcode (App) and its scheme (the ios.scheme, App by default)
 * @param root the project of Capacitor
 */
function iosProject(root: string): { platform: string, native: string, scheme: string } {
    const file: string = path.join(root, 'capacitor.config.json')
    const config: { ios?: { path?: string, scheme?: string } } = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    const platform: string = path.resolve(root, config.ios?.path ?? 'ios')
    return {platform: platform, native: path.join(platform, 'App'), scheme: config.ios?.scheme ?? 'App'}
}

/**
 * The directory of the frameworks of the native addons of iOS, which the project of iOS of the templates embeds in the
 * application (App/NodeAddons): in the project of Capacitor holding a directory, undefined outside of one
 * @param directory
 */
function nodeAddons(directory: string): string | undefined {
    try {
        return path.join(iosProject(capacitorRoot(directory)).native, 'App', 'NodeAddons')
    } catch {
        return undefined
    }
}

/**
 * Build the application of iOS for a simulator as npx cap run ios does (xcodebuild, in the project of iOS of Capacitor),
 * install it and start it
 * @param root the project of Capacitor
 * @param udid the simulator, booted
 * @param server the address its pages are loaded from (live reload): written into the configuration of Capacitor of
 * the application built, which the project keeps as it was
 * @return the id of the application
 */
async function runIos(root: string, udid: string, server?: string): Promise<string> {
    const {platform, native, scheme} = iosProject(root)
    const derived: string = path.join(platform, 'DerivedData', udid)
    const configuration: string = path.join(native, 'App', 'capacitor.config.json')
    const original: string | undefined = server ? readFileSync(configuration, 'utf8') : undefined
    if (original !== undefined) {
        const json: Record<string, any> = JSON.parse(original)
        writeFileSync(configuration, JSON.stringify({...json, server: {...json.server, url: server}}, null, '\t'))
    }
    try {
        //CocoaPods give the project a workspace, the Swift Package Manager does not
        const project: string[] = existsSync(path.join(native, 'App.xcworkspace')) ? ['-workspace', 'App.xcworkspace'] : ['-project', 'App.xcodeproj']
        step(`xcodebuild ${[...project, '-scheme', scheme, '-configuration', 'Debug', '-destination', `id=${udid}`].join(' ')}`)
        const built = await runCommand('xcrun', ['xcodebuild', ...project, '-scheme', scheme, '-configuration', 'Debug', '-destination', `id=${udid}`, '-derivedDataPath', derived], native)
        if (built.code !== 0) throw new Error(`The application cannot be built:\n${built.output.trim().split('\n').filter((line: string): boolean => /error|failed/i.test(line)).slice(-15).join('\n') || built.output.trim().split('\n').slice(-15).join('\n')}`)
    } finally {
        if (original !== undefined) writeFileSync(configuration, original)
    }
    const application: string = path.join(derived, 'Build', 'Products', 'Debug-iphonesimulator', `${scheme}.app`)
    const id: string = (await must('The id of the application cannot be read', 'plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(application, 'Info.plist')])).trim()
    await must('The application cannot be installed', 'xcrun', ['simctl', 'install', udid, application])
    await showSimulator(udid)
    await run('xcrun', ['simctl', 'terminate', udid, id])
    await must('The application cannot be started', 'xcrun', ['simctl', 'launch', udid, id])
    return id
}

/**
 * The commands of the mobile applications (Capacitor, @capawesome/capacitor-nodejs): the Node.js project of the
 * application, deployed into the application installed during the development
 */
export class MobileController extends Controller {

    @CLIAction('mobile stage', MobileStageDTO, {description: 'Make the Node.js project of the mobile application of the current directory (@capawesome/capacitor-nodejs): its bundle for the Node.js of iOS and Android, its resources and its entry; after the build of its user interface'})
    public async stage(input: MobileStageDTO): Promise<undefined> {
        const {stageMobileApp} = await loadBuilder(process.cwd())
        //The native addons of iOS made frameworks of the project of iOS, for the devices and the simulators
        const stage: MobileStage = await stageMobileApp({platform: input.platform, project: process.cwd(), outdir: input.outdir, minify: input.minify, frameworks: input.platform === 'ios' ? nodeAddons(process.cwd()) : undefined, progress: step})
        done(`The Node.js project for ${stage.platform} (Node.js ${stage.node}): ${path.relative(process.cwd(), stage.directory) || '.'}`)
        return undefined
    }

    @CLIAction('mobile run <platform>', MobileRunDTO, {description: 'Run the mobile application of the project on an emulator or a device of Android (npx cap run android) or a simulator of iOS (built with xcodebuild, installed and started), after npx cap sync'})
    public async run(input: MobileRunDTO): Promise<undefined> {
        const root: string = capacitorRoot(process.cwd())
        if (input.platform === 'android') {
            const args: string[] = ['cap', 'run', 'android', '--no-sync', ...input.device ? ['--target', input.device] : []]
            step(`npx ${args.join(' ')}`)
            const code: number | null = await new Promise((resolve: (code: number | null) => void, reject: (error: Error) => void): void => {
                const child = spawnCommand('npx', args, {cwd: root, stdio: 'inherit'})
                child.once('error', reject)
                child.once('exit', resolve)
            })
            if (code !== 0) throw new Error(`npx ${args.join(' ')} failed (${code})`)
            return undefined
        }
        const udid: string = await iosSimulator(input.device)
        const id: string = await runIos(root, udid)
        done(`${id} runs on the simulator ${udid}`)
        return undefined
    }

    @CLIAction('mobile deploy <platform>', MobileDeployDTO, {description: 'Make the Node.js project of the mobile application of the current directory, put it into the application installed in the emulator of Android or the simulator of iOS, and start the application again (the development, without installing it again)'})
    public async deploy(input: MobileDeployDTO): Promise<undefined> {
        //Run with live reload, the application holds the project of its last sync: deployed when its files change
        const live = input.liveReload === undefined ? undefined : await this.runLiveReload(input)
        if (!live) await this.deployOnce(input)
        if (!input.watch && !live) return undefined
        //The files of the application, without its dependencies, its compiled files and the project made: built and
        //deployed again once they stop changing
        const project: string = process.cwd()
        const manifest: Record<string, any> = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'))
        const ignored: string[] = ['node_modules', path.dirname(manifest.main ?? 'build/App.js'), path.relative(project, path.resolve(project, input.outdir))]
            .map((directory: string): string => directory.split(path.sep).join('/'))
            .filter((directory: string): boolean => !!directory && directory !== '.' && !directory.startsWith('..'))
        const watched = (file: string | null): boolean => {
            if (!file) return false
            const relative: string = file.split(path.sep).join('/')
            return !relative.split('/').some((part: string): boolean => part.startsWith('.')) && !ignored.some((directory: string): boolean => relative === directory || relative.startsWith(`${directory}/`))
        }
        step('Watching the files of the application: built and deployed again when they change (Ctrl+C to stop)')
        await new Promise<void>((resolve: () => void): void => {
            let timer: NodeJS.Timeout | undefined
            let deploying: Promise<void> = Promise.resolve()
            const watcher = watch(project, {recursive: true}, (_event: string, file: string | null): void => {
                if (!watched(file)) return
                clearTimeout(timer)
                timer = setTimeout((): void => {
                    deploying = deploying.then(async (): Promise<void> => {
                        if (manifest.scripts?.build) {
                            step('npm run build')
                            const built = await runCommand('npm', ['run', 'build'], project)
                            if (built.code !== 0) return warn(`The build failed:\n${built.output.trim().split('\n').slice(-15).join('\n')}`)
                        }
                        await this.deployOnce(input)
                    }).catch((error: Error): void => warn(error.message))
                }, 300)
            })
            const stop = (): void => {
                clearTimeout(timer)
                watcher.close()
                void (live ? live.stop() : Promise.resolve()).finally(resolve)
            }
            process.once('SIGINT', stop)
            process.once('SIGTERM', stop)
        })
        return undefined
    }

    /**
     * Run the application with live reload: its pages loaded from the dev server of the user interface at localhost (a
     * secure context of the browsers: an address of the network is not). On Android, by npx cap run android --live-reload
     * (in the project of Capacitor), which reaches the computer through adb reverse (--forwardPorts) and gives the
     * application its configuration back once stopped; on iOS, built with the address and installed in the simulator,
     * which shares localhost with the computer. Resolved once it runs, with the function stopping it
     * @param input
     * @protected
     */
    protected async runLiveReload(input: MobileDeployDTO): Promise<{ stop: () => Promise<void> }> {
        const port: string = String(input.liveReload)
        if (input.platform === 'ios') {
            const udid: string = await iosSimulator(input.device)
            await runIos(capacitorRoot(process.cwd()), udid, `http://localhost:${port}`)
            //The simulator given the UDID of the one it runs on: the Node.js project deployed there
            input.device = udid
            return {stop: async (): Promise<void> => undefined}
        }
        const target: string = input.device ?? await androidDevice()
        const args: string[] = ['cap', 'run', 'android', '--live-reload', '--host', 'localhost', '--port', port, '--forwardPorts', `${port}:${port}`, '--no-sync', '--target', target]
        step(`npx ${args.join(' ')}`)
        const child = spawnCommand('npx', args, {cwd: capacitorRoot(process.cwd()), stdio: ['ignore', 'pipe', 'pipe']})
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            let output: string = ''
            const read = (chunk: Buffer): void => {
                process.stdout.write(chunk)
                output += chunk.toString()
                if (/App running with live reload/.test(output)) resolve()
            }
            child.stdout!.on('data', read)
            child.stderr!.on('data', read)
            child.once('error', reject)
            child.once('exit', (code: number | null): void => reject(new Error(`npx cap run android --live-reload ended (${code}): ${output.trim().split('\n').slice(-5).join(' ')}`)))
        })
        return {
            stop: async (): Promise<void> => {
                if (child.exitCode === null) {
                    const exited: Promise<unknown> = new Promise((resolve: (value: unknown) => void): unknown => child.once('exit', resolve))
                    child.kill('SIGINT')
                    await exited
                }
                //The port forwarded to Android removed
                await run(adbProgram(), ['-s', target, 'reverse', '--remove', `tcp:${port}`])
            }
        }
    }

    /**
     * Make the Node.js project, put it into the application and start the application again
     * @param input
     * @protected
     */
    protected async deployOnce(input: MobileDeployDTO): Promise<void> {
        const {stageMobileApp} = await loadBuilder(process.cwd())
        //The native addons built for the device only: its architecture of Android, the simulators of iOS
        const targets: Partial<MobileStageOptions> = input.platform === 'android' ? {abis: [await androidAbi(input.device) as AndroidAbi]} : {sdks: ['iphonesimulator'], frameworks: nodeAddons(process.cwd())}
        const stage: MobileStage = await stageMobileApp({platform: input.platform, project: process.cwd(), outdir: input.outdir, minify: false, ...targets, progress: step})
        step(`The Node.js project for ${stage.platform} (Node.js ${stage.node}): ${path.relative(process.cwd(), stage.directory) || '.'}`)
        if (input.platform === 'android') await deployAndroid(stage.directory, input.appId, input.device)
        //The simulator given by its name or its UDID (simctl takes UDIDs)
        else await deployIos(stage.directory, input.appId, input.nodeDir, input.device ? await iosSimulator(input.device) : undefined, targets.frameworks && path.join(targets.frameworks, 'iphonesimulator'))
        done(`Deployed to ${input.appId} (${input.platform}${input.device ? `, ${input.device}` : ''}) and started`)
    }
}
