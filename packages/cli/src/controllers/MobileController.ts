import {spawn} from 'node:child_process'
import {readFileSync, watch} from 'node:fs'
import {cp, mkdir, readdir, rm} from 'node:fs/promises'
import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import type {MobileStage} from '@lakutata/builder'
import {MobileDeployDTO} from '../dtos/MobileDeployDTO.js'
import {MobileStageDTO} from '../dtos/MobileStageDTO.js'
import {loadBuilder} from '../lib/Builder.js'
import {done, step, warn} from '../lib/Output.js'
import {runCommand} from '../lib/Processes.js'

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
 */
async function deployIos(directory: string, appId: string, nodeDir: string, device?: string): Promise<void> {
    if (!device && !/\(Booted\)/.test(await must('The simulators cannot be listed', 'xcrun', ['simctl', 'list', 'devices', 'booted']))) throw new Error('No simulator of iOS is running (npx cap run ios)')
    const simulator: string = device ?? 'booted'
    const container: string = (await must(`The application ${appId} is not installed on the simulator ${simulator}, or the simulator is not running (npx cap run ios)`, 'xcrun', ['simctl', 'get_app_container', simulator, appId, 'app'])).trim()
    await run('xcrun', ['simctl', 'terminate', simulator, appId])
    const project: string = path.join(container, 'public', nodeDir)
    await rm(project, {recursive: true, force: true})
    await mkdir(project, {recursive: true})
    for (const entry of await readdir(directory)) await cp(path.join(directory, entry), path.join(project, entry), {recursive: true})
    await must('The application cannot be started', 'xcrun', ['simctl', 'launch', simulator, appId])
}

/**
 * The commands of the mobile applications (Capacitor, @capawesome/capacitor-nodejs): the Node.js project of the
 * application, deployed into the application installed during the development
 */
export class MobileController extends Controller {

    @CLIAction('mobile stage', MobileStageDTO, {description: 'Make the Node.js project of the mobile application of the current directory (@capawesome/capacitor-nodejs): its bundle for the Node.js of iOS and Android, its resources and its entry; after the build of its user interface'})
    public async stage(input: MobileStageDTO): Promise<undefined> {
        const {stageMobileApp} = await loadBuilder(process.cwd())
        const stage: MobileStage = await stageMobileApp({platform: input.platform, project: process.cwd(), outdir: input.outdir, minify: input.minify})
        done(`The Node.js project for ${stage.platform} (Node.js ${stage.node}): ${path.relative(process.cwd(), stage.directory) || '.'}`)
        return undefined
    }

    @CLIAction('mobile deploy <platform>', MobileDeployDTO, {description: 'Make the Node.js project of the mobile application of the current directory, put it into the application installed in the emulator of Android or the simulator of iOS, and start the application again (the development, without installing it again)'})
    public async deploy(input: MobileDeployDTO): Promise<undefined> {
        await this.deployOnce(input)
        if (!input.watch) return undefined
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
                resolve()
            }
            process.once('SIGINT', stop)
            process.once('SIGTERM', stop)
        })
        return undefined
    }

    /**
     * Make the Node.js project, put it into the application and start the application again
     * @param input
     * @protected
     */
    protected async deployOnce(input: MobileDeployDTO): Promise<void> {
        const {stageMobileApp} = await loadBuilder(process.cwd())
        const stage: MobileStage = await stageMobileApp({platform: input.platform, project: process.cwd(), outdir: input.outdir, minify: false})
        step(`The Node.js project for ${stage.platform} (Node.js ${stage.node}): ${path.relative(process.cwd(), stage.directory) || '.'}`)
        if (input.platform === 'android') await deployAndroid(stage.directory, input.appId, input.device)
        else await deployIos(stage.directory, input.appId, input.nodeDir, input.device)
        done(`Deployed to ${input.appId} (${input.platform}${input.device ? `, ${input.device}` : ''}) and started`)
    }
}
