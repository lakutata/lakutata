import {spawn} from 'node:child_process'
import {existsSync, readdirSync, readFileSync, statSync, watch} from 'node:fs'
import {cp, mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import type {AndroidAbi, MobilePlatform, MobileStage} from '@lakutata/builder'
import {MobileDeployDTO} from '../dtos/MobileDeployDTO.js'
import {MobileNodeDTO} from '../dtos/MobileNodeDTO.js'
import {MobileRunDTO} from '../dtos/MobileRunDTO.js'
import {MobileStageDTO} from '../dtos/MobileStageDTO.js'
import {loadBuilder} from '../lib/Builder.js'
import {done, step, warn} from '../lib/Output.js'
import {runCommand, spawnCommand} from '../lib/Processes.js'

/**
 * Where the native module of Android runs the Node.js project (copied there from the assets), and the marker of a copy
 * written while developing, which the native module keeps instead of copying the assets again
 */
const ANDROID_PROJECT: string = 'files/nodejs'
const ANDROID_DEVELOPMENT: string = 'files/nodejs.dev'

/**
 * The port of Metro, which the debug builds of the user interface load it from
 */
const METRO_PORT: number = 8081

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
 * Run a command whose output is shown as it runs (the builds of the native projects), which must succeed
 * @param command
 * @param args
 * @param cwd
 * @param env
 */
async function shown(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
    step(`${path.basename(command)} ${args.join(' ')}`)
    const code: number | null = await new Promise((resolve: (code: number | null) => void, reject: (error: Error) => void): void => {
        const child = spawnCommand(command, args, {cwd: cwd, env: env, stdio: 'inherit'})
        child.once('error', reject)
        child.once('exit', resolve)
    })
    if (code !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed (${code})`)
}

/**
 * A project of a mobile application laid out as the mobile-react template: the user interface of React Native at its
 * root, the application in packages/app, the native module and the libnode of each system in native/
 */
type MobileProject = {
    /**
     * Its root
     */
    root: string
    /**
     * The application, whose Node.js project is made
     */
    app: string
    /**
     * The directory of the native module (native/), which holds the libnode of each system (native/node/out/<platform>)
     */
    native: string
}

/**
 * The project of a mobile application holding a directory: the first one up holding native/NodeHost.cpp and
 * packages/app
 * @param directory
 */
function mobileProject(directory: string): MobileProject {
    for (let current: string = directory; ; current = path.dirname(current)) {
        if (existsSync(path.join(current, 'native', 'NodeHost.cpp')) && existsSync(path.join(current, 'packages', 'app', 'package.json'))) {
            return {root: current, app: path.join(current, 'packages', 'app'), native: path.join(current, 'native')}
        }
        if (current === path.dirname(current)) throw new Error(`${directory} is in no project of a mobile application (native/NodeHost.cpp and packages/app, as the mobile-react template lays them out)`)
    }
}

/**
 * The libnode of a system put into the project (native/node/out/<platform>)
 * @param project
 * @param platform
 */
function nodeOf(project: MobileProject, platform: MobilePlatform): string {
    return path.join(project.native, 'node', 'out', platform)
}

/**
 * Download the libnode of a system from the releases of lakutata/libnode (once: kept in the cache of lakutata) and put
 * it into the project, where its native project takes it
 * @param project
 * @param platform
 * @param abis the architectures of Android
 * @returns where it is put
 */
async function putNode(project: MobileProject, platform: MobilePlatform, abis?: AndroidAbi[]): Promise<string> {
    const {downloadMobileNode} = await loadBuilder(project.app)
    const downloaded: string = await downloadMobileNode({platform: platform, abis: abis, progress: (line: string): void => step(`Downloading ${line}`)})
    const out: string = nodeOf(project, platform)
    await rm(out, {recursive: true, force: true})
    await mkdir(path.dirname(out), {recursive: true})
    //The files themselves, not the links of an export given (LAKUTATA_MOBILE_NODE_DIR): CocoaPods does not follow them
    await cp(downloaded, out, {recursive: true, dereference: true, filter: (file: string): boolean => path.basename(file) !== '.complete'})
    //The libraries of the HAP hold libnode.so, which the addons and the runtime of the native module load by its name
    if (platform === 'harmony') {
        await mkdir(harmonyLibraries(project), {recursive: true})
        await cp(path.join(out, 'libs', 'arm64-v8a', 'libnode.so'), path.join(harmonyLibraries(project), 'libnode.so'))
    }
    return out
}

/**
 * Where the native project of a system takes the Node.js project of the application
 * @param project
 * @param platform
 */
function stageOf(project: MobileProject, platform: MobilePlatform): string {
    if (platform === 'android') return path.join(project.root, 'android', 'app', 'src', 'main', 'assets', 'nodejs')
    if (platform === 'ios') return path.join(project.root, 'ios', 'nodejs')
    return path.join(project.root, 'harmony', 'entry', 'src', 'main', 'resources', 'resfile', 'nodejs')
}

/**
 * The libraries of the HAP of HarmonyOS (the libs/arm64-v8a of its module): libnode.so and the native addons
 * @param project
 */
function harmonyLibraries(project: MobileProject): string {
    return path.join(project.root, 'harmony', 'entry', 'libs', 'arm64-v8a')
}

/**
 * The id of the application on a system, as its native project gives it: the applicationId of Android, the bundle
 * identifier of iOS, the bundleName of HarmonyOS
 * @param project
 * @param platform
 */
function appIdOf(project: MobileProject, platform: MobilePlatform): string {
    const read = (file: string, pattern: RegExp, what: string): string => {
        const id: string | undefined = existsSync(file) ? pattern.exec(readFileSync(file, 'utf8'))?.[1] : undefined
        if (!id) throw new Error(`The id of the application cannot be read (${what} of ${path.relative(project.root, file)})`)
        return id
    }
    if (platform === 'android') return read(path.join(project.root, 'android', 'app', 'build.gradle'), /applicationId\s+["']([^"']+)["']/, 'applicationId')
    if (platform === 'ios') return read(path.join(project.root, 'ios', 'App.xcodeproj', 'project.pbxproj'), /PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/, 'PRODUCT_BUNDLE_IDENTIFIER')
    return read(path.join(project.root, 'harmony', 'AppScope', 'app.json5'), /"bundleName"\s*:\s*"([^"]+)"/, 'bundleName')
}

/**
 * The adb of the Android SDK (ANDROID_HOME), else the one of the PATH
 */
function adbProgram(): string {
    const home: string | undefined = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
    return home ? path.join(home, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'
}

/**
 * The emulator or the device of Android the command runs on: the one given, else the one running (adb devices)
 * @param device
 */
async function androidDevice(device?: string): Promise<string> {
    if (device) return device
    const serial: string | undefined = (await must('The devices of Android cannot be listed', adbProgram(), ['devices'])).split('\n').map((line: string): string[] => line.trim().split(/\s+/)).find((parts: string[]): boolean => parts[1] === 'device')?.[0]
    if (!serial) throw new Error('No emulator or device of Android is running (start one: emulator -avd <name>)')
    return serial
}

/**
 * The architecture of an emulator or a device of Android (its ABI: arm64-v8a, x86_64…)
 * @param serial
 */
async function androidAbi(serial: string): Promise<AndroidAbi> {
    return (await must('The architecture of the device of Android cannot be read', adbProgram(), ['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi'])).trim() as AndroidAbi
}

/**
 * Start the application installed on an emulator or a device of Android again (its launcher activity)
 * @param serial
 * @param appId
 */
async function restartAndroid(serial: string, appId: string): Promise<void> {
    const adb: string = adbProgram()
    const activity: string = (await must('The activity of the application cannot be found', adb, ['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', appId])).trim().split('\n').at(-1)!.trim()
    await must('The application cannot be stopped', adb, ['-s', serial, 'shell', 'am', 'force-stop', appId])
    await must('The application cannot be started', adb, ['-s', serial, 'shell', 'am', 'start', '-n', activity])
}

/**
 * Put the Node.js project into the application installed on an emulator or a device of Android (a debug build:
 * run-as), marked as written while developing (the native module keeps it instead of copying the assets again), and
 * start the application again
 * @param directory
 * @param appId
 * @param serial
 */
async function deployAndroid(directory: string, appId: string, serial: string): Promise<void> {
    const adb: string = adbProgram()
    const installed: Run = await run(adb, ['-s', serial, 'shell', 'pm', 'path', appId])
    if (installed.code !== 0 || !installed.stdout.includes('package:')) throw new Error(`The application ${appId} is not installed on ${serial} (npm run android)`)
    const debuggable: Run = await run(adb, ['-s', serial, 'shell', 'run-as', appId, 'ls'])
    if (debuggable.code !== 0) throw new Error(`The files of ${appId} cannot be written (run-as): a debug build of the application is deployed to (${(debuggable.stderr || debuggable.stdout).trim()})`)
    await must('The application cannot be stopped', adb, ['-s', serial, 'shell', 'am', 'force-stop', appId])
    //The files of the project replaced by the ones made, through tar (the files of macOS without their extended attributes)
    const tar = spawn('tar', ['-c', '-C', directory, '.'], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, COPYFILE_DISABLE: '1'}})
    await must('The Node.js project cannot be written into the application', adb, ['-s', serial, 'shell', 'run-as', appId, 'sh', '-c', `'rm -rf ${ANDROID_PROJECT} && mkdir -p ${ANDROID_PROJECT} && tar -x -f - -C ${ANDROID_PROJECT} && touch ${ANDROID_DEVELOPMENT}'`], tar.stdout!)
    await restartAndroid(serial, appId)
}

/**
 * Build the debug application of Android (Gradle, for the architecture of the device), install it, make Metro reachable
 * from the device (adb reverse) and start the application: the Node.js project of its assets replaces a copy deployed
 * before
 * @param project
 * @param device
 * @return the id of the application and the device
 */
async function runAndroid(project: MobileProject, device?: string): Promise<{ appId: string, serial: string }> {
    const serial: string = await androidDevice(device)
    const adb: string = adbProgram()
    const appId: string = appIdOf(project, 'android')
    await must('Metro cannot be made reachable from the device (adb reverse)', adb, ['-s', serial, 'reverse', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`])
    const gradlew: string = path.join(project.root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
    await shown(gradlew, ['installDebug', `-PreactNativeArchitectures=${await androidAbi(serial)}`], path.join(project.root, 'android'), {...process.env, ANDROID_SERIAL: serial})
    await run(adb, ['-s', serial, 'shell', 'run-as', appId, 'rm', '-f', ANDROID_DEVELOPMENT])
    await restartAndroid(serial, appId)
    return {appId: appId, serial: serial}
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
 * Show a simulator of iOS in the app of Xcode showing them: Simulator, Device Hub since Xcode 27. Not shown without it:
 * the application runs all the same
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
 * Whether the pods of the project of iOS are those of its Podfile and of the libnode exported: installed after the last
 * change of the Podfile and the last export of the libnode (whose framework the pod of the native module vendors)
 * @param ios
 * @param node the export of the libnode of iOS
 */
function podsInstalled(ios: string, node: string): boolean {
    const lock: string = path.join(ios, 'Podfile.lock')
    const manifest: string = path.join(ios, 'Pods', 'Manifest.lock')
    if (!existsSync(path.join(ios, 'App.xcworkspace')) || !existsSync(lock) || !existsSync(manifest) || !existsSync(path.join(ios, 'Podfile'))) return false
    const installed: number = statSync(manifest).mtimeMs
    return readFileSync(lock, 'utf8') === readFileSync(manifest, 'utf8') && installed >= statSync(path.join(ios, 'Podfile')).mtimeMs && (!existsSync(node) || installed >= statSync(node).mtimeMs)
}

/**
 * Build the debug application of iOS for a simulator (the pods installed first when needed, xcodebuild), install it and
 * start it; a simulator shares localhost with the computer, so Metro is reachable
 * @param project
 * @param udid the simulator, booted
 * @return the id of the application
 */
async function runIos(project: MobileProject, udid: string): Promise<string> {
    const ios: string = path.join(project.root, 'ios')
    if (!podsInstalled(ios, nodeOf(project, 'ios'))) await shown('pod', ['install'], ios)
    const derived: string = path.join(ios, 'build')
    await shown('xcrun', ['xcodebuild', '-workspace', 'App.xcworkspace', '-scheme', 'App', '-configuration', 'Debug', '-destination', `id=${udid}`, '-derivedDataPath', derived, 'build'], ios)
    const application: string = path.join(derived, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app')
    const id: string = (await must('The id of the application cannot be read', 'plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(application, 'Info.plist')])).trim()
    await must('The application cannot be installed', 'xcrun', ['simctl', 'install', udid, application])
    await showSimulator(udid)
    await run('xcrun', ['simctl', 'terminate', udid, id])
    await must('The application cannot be started', 'xcrun', ['simctl', 'launch', udid, id])
    return id
}

/**
 * Put the Node.js project into the application installed in a simulator of iOS (the directory of the application on
 * the Mac), with the frameworks of its native addons, and start the application again
 * @param directory
 * @param appId
 * @param udid
 * @param frameworks the frameworks of the native addons for the simulators
 */
async function deployIos(directory: string, appId: string, udid: string, frameworks: string): Promise<void> {
    const container: string = (await must(`The application ${appId} is not installed on the simulator ${udid} (npm run ios)`, 'xcrun', ['simctl', 'get_app_container', udid, appId, 'app'])).trim()
    await run('xcrun', ['simctl', 'terminate', udid, appId])
    const project: string = path.join(container, 'nodejs')
    await rm(project, {recursive: true, force: true})
    await mkdir(project, {recursive: true})
    for (const entry of await readdir(directory)) await cp(path.join(directory, entry), path.join(project, entry), {recursive: true})
    //The frameworks of its native addons (signed ad hoc, which the simulators take) in place of the ones of the application
    for (const entry of existsSync(frameworks) ? await readdir(frameworks) : []) {
        if (!entry.endsWith('.framework')) continue
        const target: string = path.join(container, 'Frameworks', entry)
        await rm(target, {recursive: true, force: true})
        await cp(path.join(frameworks, entry), target, {recursive: true})
    }
    await must('The application cannot be started', 'xcrun', ['simctl', 'launch', udid, appId])
}

/**
 * The tools of DevEco Studio building and installing the applications of HarmonyOS: ohpm and hvigor (run by the Node.js
 * of DevEco Studio), its SDK and hdc. DEVECO_STUDIO_HOME gives the directory of DevEco Studio (its Contents on macOS) or
 * of its command line tools, DEVECO_SDK_HOME its SDK
 */
function devEcoTools(): { ohpm: string, hvigor: string, node: string, sdk: string, hdc: string } {
    const home: string = process.env.DEVECO_STUDIO_HOME ?? (process.platform === 'darwin' ? '/Applications/DevEco-Studio.app/Contents' : path.join(os.homedir(), 'command-line-tools'))
    const sdk: string = process.env.DEVECO_SDK_HOME ?? path.join(home, 'sdk')
    const hvigor: string = path.join(home, 'tools', 'hvigor', 'bin', 'hvigorw.js')
    const node: string = path.join(home, 'tools', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    if (!existsSync(hvigor)) throw new Error(`DevEco Studio builds the application of HarmonyOS: install it, or give its directory (DEVECO_STUDIO_HOME; ${hvigor} missing)`)
    return {
        ohpm: path.join(home, 'tools', 'ohpm', 'bin', process.platform === 'win32' ? 'ohpm.bat' : 'ohpm'),
        hvigor: hvigor,
        node: existsSync(node) ? node : process.execPath,
        sdk: sdk,
        hdc: path.join(sdk, 'default', 'openharmony', 'toolchains', process.platform === 'win32' ? 'hdc.exe' : 'hdc')
    }
}

/**
 * Run a command of hdc, which must succeed: hdc exits with 0 when it fails too, telling the failure in its output (a
 * line [Fail]…, or error: … from the device)
 * @param what
 * @param hdc
 * @param args
 */
async function mustHdc(what: string, hdc: string, args: string[]): Promise<string> {
    const output: string = await must(what, hdc, args)
    if (/^\[Fail\]|error:/im.test(output)) throw new Error(`${what}: ${output.trim()}`)
    return output
}

/**
 * The emulator or the device of HarmonyOS the command runs on: the one given, else the one connected (hdc list targets)
 * @param hdc
 * @param device
 */
async function harmonyTarget(hdc: string, device?: string): Promise<string> {
    if (device) return device
    const target: string | undefined = (await must('The devices of HarmonyOS cannot be listed', hdc, ['list', 'targets'])).split('\n').map((line: string): string => line.trim()).find((line: string): boolean => !!line && line !== '[Empty]')
    if (!target) throw new Error('No emulator or device of HarmonyOS is connected (start one in the Device Manager of DevEco Studio)')
    return target
}

/**
 * The files of the application of HarmonyOS, as it sees them (hdc file send -b writes there into a debug build), where
 * the native module runs the copy of the Node.js project written while developing (nodejs-dev: the resources of the HAP
 * cannot be written) while its .development says on. The files cannot be removed from the computer, only written: the
 * copy is turned off instead
 */
const HARMONY_FILES: string = '/data/storage/el2/base/files'

/**
 * Write the state of the copy of the Node.js project written while developing on HarmonyOS (on: deployed, off: the
 * project of the HAP runs), along with the files of a project to deploy
 * @param hdc
 * @param target
 * @param bundle
 * @param state
 * @param project the Node.js project deployed with the state on
 * @returns the output of hdc
 */
async function writeHarmonyDevelopment(hdc: string, target: string, bundle: string, state: 'on' | 'off', project?: string): Promise<Run> {
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-harmony-'))
    try {
        //Sent into the files as nodejs-dev, merged into the copy there (hdc copies a directory into the one of its name)
        const development: string = path.join(work, 'nodejs-dev')
        if (project) await cp(project, development, {recursive: true})
        else await mkdir(development)
        await writeFile(path.join(development, '.development'), `${state}\n`)
        return project
            ? await run(hdc, ['-t', target, 'file', 'send', '-b', bundle, development, HARMONY_FILES])
            : await run(hdc, ['-t', target, 'file', 'send', '-b', bundle, path.join(development, '.development'), `${HARMONY_FILES}/nodejs-dev/.development`])
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}

/**
 * Start the application installed on an emulator or a device of HarmonyOS again
 * @param hdc
 * @param target
 * @param bundle
 */
async function restartHarmony(hdc: string, target: string, bundle: string): Promise<void> {
    await run(hdc, ['-t', target, 'shell', 'aa', 'force-stop', bundle])
    const started: string = await must('The application cannot be started', hdc, ['-t', target, 'shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundle])
    if (/error/i.test(started)) throw new Error(`The application cannot be started: ${started.trim()}`)
}

/**
 * Build the debug HAP of HarmonyOS (the user interface bundled by RNOH, hvigor), install it, make Metro reachable from
 * the device (hdc rport) and start the application: the Node.js project of its resources replaces a copy deployed before
 * @param project
 * @param device
 * @return the bundle of the application and the device
 */
async function runHarmony(project: MobileProject, device?: string): Promise<{ bundle: string, target: string }> {
    const tools = devEcoTools()
    const target: string = await harmonyTarget(tools.hdc, device)
    const bundle: string = appIdOf(project, 'harmony')
    //The user interface in the HAP, which loads it when Metro does not run (RNOH: a bundle of JavaScript)
    const reactNative: string = path.join(project.root, 'node_modules', '.bin', process.platform === 'win32' ? 'react-native.cmd' : 'react-native')
    await shown(reactNative, ['bundle-harmony', '--dev', 'false', '--bundle-output', path.join('harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'bundle.harmony.js')], project.root)
    const harmony: string = path.join(project.root, 'harmony')
    const env: NodeJS.ProcessEnv = {...process.env, DEVECO_SDK_HOME: tools.sdk, PATH: `${path.dirname(tools.node)}${path.delimiter}${process.env.PATH ?? ''}`}
    //The packages of the HAP (RNOH, from node_modules) in harmony/oh_modules, which its native build reads
    await shown(tools.ohpm, ['install', '--all'], harmony, env)
    await shown(tools.node, [tools.hvigor, '--mode', 'module', '-p', 'product=default', '-p', 'module=entry@default', 'assembleHap', '--no-daemon'], harmony, env)
    const outputs: string = path.join(harmony, 'entry', 'build', 'default', 'outputs', 'default')
    const haps: string[] = existsSync(outputs) ? readdirSync(outputs).filter((name: string): boolean => name.endsWith('.hap')) : []
    const hap: string | undefined = haps.find((name: string): boolean => name.includes('-signed')) ?? haps[0]
    if (!hap) throw new Error(`The build made no HAP (${path.relative(project.root, outputs)})`)
    await mustHdc('The application cannot be installed', tools.hdc, ['-t', target, 'install', '-r', path.join(outputs, hap)])
    //The forward of a run before removed first: the server of hdc keeps it, setting it up again on an emulator started
    //again, and rport fails on the port it takes (none to remove: hdc tells it, which is no failure)
    await run(tools.hdc, ['-t', target, 'fport', 'rm', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`])
    await mustHdc('Metro cannot be made reachable from the device (hdc rport)', tools.hdc, ['-t', target, 'rport', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`])
    //A copy deployed before turned off (none deployed: nothing to write)
    await writeHarmonyDevelopment(tools.hdc, target, bundle, 'off')
    await restartHarmony(tools.hdc, target, bundle)
    return {bundle: bundle, target: target}
}

/**
 * Put the Node.js project into the debug application installed on an emulator or a device of HarmonyOS (files/nodejs-dev
 * of the application, turned on: the native module runs it instead of the one of its resources), and start the
 * application again
 * @param directory
 * @param bundle
 * @param device
 */
async function deployHarmony(directory: string, bundle: string, device?: string): Promise<string> {
    const tools = devEcoTools()
    const target: string = await harmonyTarget(tools.hdc, device)
    await run(tools.hdc, ['-t', target, 'shell', 'aa', 'force-stop', bundle])
    const sent: Run = await writeHarmonyDevelopment(tools.hdc, target, bundle, 'on', directory)
    if (sent.code !== 0 || /fail|error/i.test(sent.stdout)) throw new Error(`The Node.js project cannot be written into the application ${bundle} (a debug build, hdc file send -b): ${(sent.stdout || sent.stderr).trim()}`)
    await restartHarmony(tools.hdc, target, bundle)
    return target
}

/**
 * The commands of the mobile applications of React Native laid out as the mobile-react template: their libnode, their
 * Node.js project, the application run on an emulator or a simulator, the project deployed into the application
 * installed during the development
 */
export class MobileController extends Controller {

    @CLIAction('mobile node <platform>', MobileNodeDTO, {description: 'Download the libnode of a system (android, ios, harmony) from the releases of lakutata/libnode (LAKUTATA_LIBNODE_MIRROR: a mirror of them), once: kept in the cache of lakutata, put into native/node/out/<platform>'})
    public async node(input: MobileNodeDTO): Promise<undefined> {
        const project: MobileProject = mobileProject(process.cwd())
        const abis: AndroidAbi[] | undefined = input.abis ? input.abis.split(',').map((abi: string): string => abi.trim()).filter(Boolean) as AndroidAbi[] : undefined
        const out: string = await putNode(project, input.platform, abis)
        done(`The libnode of ${input.platform}: ${path.relative(process.cwd(), out)}`)
        return undefined
    }

    @CLIAction('mobile stage <platform>', MobileStageDTO, {description: 'Make the Node.js project of the mobile application (packages/app) for a system (android, ios, harmony), where its native project takes it, with its native addons built against the libnode of the system'})
    public async stage(input: MobileStageDTO): Promise<undefined> {
        const project: MobileProject = mobileProject(process.cwd())
        const stage: MobileStage = await this.stageProject(project, input.platform, {minify: input.minify, abis: input.abis ? input.abis.split(',').map((abi: string): string => abi.trim()).filter(Boolean) as AndroidAbi[] : undefined})
        done(`The Node.js project for ${stage.platform} (Node.js ${stage.node}): ${path.relative(process.cwd(), stage.directory)}`)
        return undefined
    }

    @CLIAction('mobile run <platform>', MobileRunDTO, {description: 'Build the debug application of a system (android, ios, harmony) from its native project, install it on an emulator, a device or a simulator and start it, Metro (npm start) giving its user interface'})
    public async run(input: MobileRunDTO): Promise<undefined> {
        const project: MobileProject = mobileProject(process.cwd())
        if (input.platform === 'android') {
            const {appId, serial} = await runAndroid(project, input.device)
            done(`${appId} runs on ${serial}`)
        } else if (input.platform === 'ios') {
            const udid: string = await iosSimulator(input.device)
            done(`${await runIos(project, udid)} runs on the simulator ${udid}`)
        } else {
            const {bundle, target} = await runHarmony(project, input.device)
            done(`${bundle} runs on ${target}`)
        }
        return undefined
    }

    @CLIAction('mobile deploy <platform>', MobileDeployDTO, {description: 'Make the Node.js project of the mobile application, put it into the debug application installed on an emulator, a device or a simulator of a system (android, ios, harmony), and start the application again (the development, without installing it again)'})
    public async deploy(input: MobileDeployDTO): Promise<undefined> {
        const project: MobileProject = mobileProject(process.cwd())
        await this.deployOnce(project, input)
        if (!input.watch) return undefined
        //The files of the application, without its dependencies and its compiled files: built and deployed again once
        //they stop changing
        const manifest: Record<string, any> = JSON.parse(readFileSync(path.join(project.app, 'package.json'), 'utf8'))
        const ignored: string[] = ['node_modules', path.dirname(manifest.main ?? 'build/App.js')].map((directory: string): string => directory.split(path.sep).join('/'))
        const watched = (file: string | null): boolean => {
            if (!file) return false
            const relative: string = file.split(path.sep).join('/')
            return !relative.split('/').some((part: string): boolean => part.startsWith('.')) && !ignored.some((directory: string): boolean => relative === directory || relative.startsWith(`${directory}/`))
        }
        step('Watching the files of the application: built and deployed again when they change (Ctrl+C to stop)')
        await new Promise<void>((resolve: () => void): void => {
            let timer: NodeJS.Timeout | undefined
            let deploying: Promise<void> = Promise.resolve()
            const watcher = watch(project.app, {recursive: true}, (_event: string, file: string | null): void => {
                if (!watched(file)) return
                clearTimeout(timer)
                timer = setTimeout((): void => {
                    deploying = deploying.then(async (): Promise<void> => {
                        if (manifest.scripts?.build) {
                            step('npm run build')
                            const built = await runCommand('npm', ['run', 'build'], project.app)
                            if (built.code !== 0) return warn(`The build failed:\n${built.output.trim().split('\n').slice(-15).join('\n')}`)
                        }
                        await this.deployOnce(project, input)
                    }).catch((error: Error): void => warn(error.message))
                }, 300)
            })
            const stop = (): void => {
                clearTimeout(timer)
                watcher.close()
                resolve()
            }
            process.once('SIGINT', stop)
            process.once('SIGTERM', stop)
        })
        return undefined
    }

    /**
     * Make the Node.js project of the application for a system, where its native project takes it
     * @param project
     * @param platform
     * @param options
     * @protected
     */
    protected async stageProject(project: MobileProject, platform: MobilePlatform, options: { minify?: boolean, abis?: AndroidAbi[], sdks?: ('iphoneos' | 'iphonesimulator')[] }): Promise<MobileStage> {
        const {stageMobileApp} = await loadBuilder(project.app)
        //The libnode of the system downloaded first when the project has none yet
        if (!existsSync(path.join(nodeOf(project, platform), 'include', 'node', 'node_api.h'))) await putNode(project, platform)
        return stageMobileApp({
            platform: platform,
            project: project.app,
            outdir: stageOf(project, platform),
            node: nodeOf(project, platform),
            frameworks: platform === 'ios' ? path.join(project.root, 'ios', 'NodeAddons') : undefined,
            libraries: platform === 'harmony' ? harmonyLibraries(project) : undefined,
            minify: options.minify,
            abis: options.abis,
            sdks: options.sdks,
            progress: step
        })
    }

    /**
     * Make the Node.js project, put it into the application and start the application again
     * @param project
     * @param input
     * @protected
     */
    protected async deployOnce(project: MobileProject, input: MobileDeployDTO): Promise<void> {
        if (input.platform === 'android') {
            const serial: string = await androidDevice(input.device)
            //The native addons built for the architecture of the device only
            const stage: MobileStage = await this.stageProject(project, 'android', {minify: false, abis: [await androidAbi(serial)]})
            await deployAndroid(stage.directory, appIdOf(project, 'android'), serial)
            done(`Deployed to ${appIdOf(project, 'android')} (${serial}) and started`)
        } else if (input.platform === 'ios') {
            const udid: string = await iosSimulator(input.device)
            const stage: MobileStage = await this.stageProject(project, 'ios', {minify: false, sdks: ['iphonesimulator']})
            await deployIos(stage.directory, appIdOf(project, 'ios'), udid, path.join(project.root, 'ios', 'NodeAddons', 'iphonesimulator'))
            done(`Deployed to ${appIdOf(project, 'ios')} (${udid}) and started`)
        } else {
            const stage: MobileStage = await this.stageProject(project, 'harmony', {minify: false})
            //The libraries of the native addons are in the HAP: installed again with it
            if (stage.addons?.libraries.length) warn(`The native addons of HarmonyOS are libraries of the HAP: npm run harmony installs them (${stage.addons.libraries.join(', ')})`)
            const target: string = await deployHarmony(stage.directory, appIdOf(project, 'harmony'), input.device)
            done(`Deployed to ${appIdOf(project, 'harmony')} (${target}) and started`)
        }
    }
}
