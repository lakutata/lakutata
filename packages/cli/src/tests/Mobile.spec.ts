import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, ROOT, runCommand} from './support/Workspace.js'

/**
 * The id of the application of the tests
 */
const APP_ID: string = 'com.example.mobile'

/**
 * Where the plugin copies the Node.js project on Android
 */
const ANDROID_PROJECT: string = 'files/capawesome_nodejs/nodejs-project'

/**
 * The simulator of iOS of the tests
 */
const UDID: string = 'B33CBA54-DFCC-4509-9CA4-4AB94C8E248E'

/**
 * The simulators of iOS listed (xcrun simctl list devices available --json)
 * @param booted whether the iPhone 17 of iOS 27.2 runs
 */
function simulators(booted: boolean): string {
    return JSON.stringify({
        devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{udid: '11111111-1111-1111-1111-111111111111', name: 'iPhone 16', state: 'Shutdown'}],
            'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [{udid: '22222222-2222-2222-2222-222222222222', name: 'iPad Pro', state: 'Shutdown'}, {udid: UDID, name: 'iPhone 17', state: booted ? 'Booted' : 'Shutdown'}],
            'com.apple.CoreSimulator.SimRuntime.watchOS-12-0': [{udid: '33333333-3333-3333-3333-333333333333', name: 'Apple Watch', state: 'Shutdown'}]
        }
    })
}

/**
 * The tools of Xcode in a directory, writing the commands they run into the log of XCRUN_LOG: its xcrun (the simulators
 * of SIMULATORS, the application installed in the one of IOS_APP, xcodebuild making the application with the
 * configuration of Capacitor of the project), its plutil, its xcode-select (an Xcode with Device Hub) and open
 * @param bin
 */
function xcodeTools(bin: string): void {
    mkdirSync(bin, {recursive: true})
    writeFileSync(path.join(bin, 'xcrun'), `#!/bin/sh
echo "$*" >> "$XCRUN_LOG"
case "$*" in
    "simctl list devices booted") printf '== Devices ==\\n-- iOS 27.2 --\\n    iPhone 17 (${UDID}) (Booted)\\n' ;;
    "simctl list devices available --json") echo "$SIMULATORS" ;;
    "simctl bootstatus ${UDID} -b") ;;
    "simctl get_app_container "*" ${APP_ID} app") echo "$IOS_APP" ;;
    "simctl terminate "*" ${APP_ID}") ;;
    "simctl launch "*" ${APP_ID}") echo "${APP_ID}: 1234" ;;
    "simctl install ${UDID} "*) ;;
    "xcodebuild "*)
        derived=""; previous=""
        for argument in "$@"; do [ "$previous" = "-derivedDataPath" ] && derived="$argument"; previous="$argument"; done
        mkdir -p "$derived/Build/Products/Debug-iphonesimulator/App.app" && cp App/capacitor.config.json "$derived/Build/Products/Debug-iphonesimulator/App.app/" && echo "** BUILD SUCCEEDED **" ;;
    *) echo "unknown: $*" >&2; exit 1 ;;
esac
`, {mode: 0o755})
    writeFileSync(path.join(bin, 'plutil'), `#!/bin/sh\necho ${APP_ID}\n`, {mode: 0o755})
    const developer: string = path.join(bin, '..', 'Xcode.app', 'Contents', 'Developer')
    mkdirSync(path.join(developer, '..', 'Applications', 'DeviceHub.app'), {recursive: true})
    writeFileSync(path.join(bin, 'xcode-select'), `#!/bin/sh\necho "${developer}"\n`, {mode: 0o755})
    writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "open $*" >> "$XCRUN_LOG"\n`, {mode: 0o755})
}

describe('lakutata mobile', {skip: process.platform === 'win32' && 'the fake adb and xcrun are scripts'}, (): void => {

    let work: string
    let project: string

    /**
     * Run the command in the project
     * @param args
     * @param env
     */
    const run = (args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number, output: string }> => runCommand(process.execPath, [CLI, ...args], project, {...process.env, ...env})

    before((): void => {
        //The real path: the current directory of the command is one (/private/var on macOS)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-')))
        project = path.join(work, 'packages', 'app')
        mkdirSync(path.join(project, 'build'), {recursive: true})
        symlinkSync(path.join(ROOT, 'node_modules'), path.join(project, 'node_modules'), 'dir')
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'app', version: '1.0.0', type: 'module', main: 'build/App.js'}))
        writeFileSync(path.join(project, 'build', 'App.js'), 'console.log("mobile")\n')
    })

    after((): void => {
        rmSync(work, {recursive: true, force: true})
    })

    it('makes the Node.js project of the application in the web directory', async (): Promise<void> => {
        const staged = await run(['mobile', 'stage', '--platform', 'android', '--outdir', '../ui/dist/nodejs'])
        assert.strictEqual(staged.code, 0, staged.output)
        assert.match(staged.output, /The Node\.js project for android \(Node\.js 18\.20\.4\): \.\.\/ui\/dist\/nodejs/)
        for (const file of ['package.json', 'main.js', 'app.cjs']) assert.ok(existsSync(path.join(work, 'packages', 'ui', 'dist', 'nodejs', file)), file)
    })

    it('deploys it into the application of an emulator of Android, started once first when it has not copied its project', async (): Promise<void> => {
        //The SDK of Android: its adb writes its commands, and runs them on a directory standing for the device (the plugin
        //copies its project at the first start)
        const sdk: string = path.join(work, 'android-sdk')
        const device: string = path.join(work, 'device')
        const log: string = path.join(work, 'adb.log')
        mkdirSync(path.join(sdk, 'platform-tools'), {recursive: true})
        mkdirSync(device)
        writeFileSync(path.join(sdk, 'platform-tools', 'adb'), `#!/bin/sh
echo "$*" >> "$ADB_LOG"
[ "$1" = "-s" ] && shift 2
[ "$1" = "shell" ] || exit 1
shift
case "$*" in
    "pm path ${APP_ID}") echo "package:/data/app/base.apk" ;;
    "cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${APP_ID}") printf 'priority=0 preferredOrder=0\\n${APP_ID}/.MainActivity\\n' ;;
    "run-as ${APP_ID} ls ${ANDROID_PROJECT}/package.json") [ -f "$DEVICE/${ANDROID_PROJECT}/package.json" ] ;;
    "run-as ${APP_ID} ls") ;;
    "am start -n ${APP_ID}/.MainActivity") [ -f "$DEVICE/${ANDROID_PROJECT}/package.json" ] || { mkdir -p "$DEVICE/${ANDROID_PROJECT}" && echo '{"main": "index.js"}' > "$DEVICE/${ANDROID_PROJECT}/package.json"; } ;;
    "am force-stop ${APP_ID}") ;;
    "run-as ${APP_ID} sh -c "*) cd "$DEVICE" && rm -rf ${ANDROID_PROJECT} && mkdir -p ${ANDROID_PROJECT} && tar -x -f - -C ${ANDROID_PROJECT} ;;
    *) echo "unknown: $*" >&2; exit 1 ;;
esac
`, {mode: 0o755})
        const env: NodeJS.ProcessEnv = {ANDROID_HOME: sdk, ADB_LOG: log, DEVICE: device}
        const first = await run(['mobile', 'deploy', 'android', '--app-id', APP_ID, '--outdir', '../ui/dist/nodejs'], env)
        assert.strictEqual(first.code, 0, first.output)
        assert.match(first.output, /The application started once, the plugin copying its Node\.js project/)
        assert.match(first.output, /Deployed to com\.example\.mobile \(android\) and started/)
        const commands: string[] = readFileSync(log, 'utf8').trim().split('\n').map((line: string): string => line.replace(/^shell /, ''))
        assert.deepStrictEqual(commands.filter((command: string): boolean => /^am /.test(command)), [`am start -n ${APP_ID}/.MainActivity`, `am force-stop ${APP_ID}`, `am start -n ${APP_ID}/.MainActivity`])
        //The project made replaces the copy of the plugin
        assert.strictEqual(JSON.parse(readFileSync(path.join(device, ANDROID_PROJECT, 'package.json'), 'utf8')).main, 'main.js')
        assert.ok(existsSync(path.join(device, ANDROID_PROJECT, 'app.cjs')))
        //Copied already: deployed at once, on the device given
        writeFileSync(log, '')
        const again = await run(['mobile', 'deploy', 'android', '--app-id', APP_ID, '--outdir', '../ui/dist/nodejs', '--device', 'emulator-5554'], env)
        assert.strictEqual(again.code, 0, again.output)
        assert.doesNotMatch(again.output, /started once/)
        const targeted: string[] = readFileSync(log, 'utf8').trim().split('\n')
        assert.ok(targeted.every((command: string): boolean => command.startsWith('-s emulator-5554 shell ')), targeted.join('\n'))
        assert.deepStrictEqual(targeted.filter((command: string): boolean => / am /.test(command)).map((command: string): string => command.split(' shell ')[1]), [`am force-stop ${APP_ID}`, `am start -n ${APP_ID}/.MainActivity`])
        //Not installed
        const missing = await run(['mobile', 'deploy', 'android', '--app-id', 'com.example.other', '--outdir', '../ui/dist/nodejs'], env)
        assert.notStrictEqual(missing.code, 0)
        assert.match(missing.output, /The application com\.example\.other is not installed on the device \(npx cap run android\)/)
    })

    it('deploys it into the application of a simulator of iOS, the previous project replaced', async (): Promise<void> => {
        //The tools of Xcode: the directory of the application installed in the simulator, on the Mac
        const bin: string = path.join(work, 'xcode', 'bin')
        const application: string = path.join(work, 'simulator', 'App.app')
        const log: string = path.join(work, 'xcrun.log')
        xcodeTools(bin)
        mkdirSync(path.join(application, 'public', 'nodejs'), {recursive: true})
        writeFileSync(path.join(application, 'public', 'nodejs', 'old.js'), 'old')
        const env: NodeJS.ProcessEnv = {PATH: `${bin}${path.delimiter}${process.env.PATH}`, XCRUN_LOG: log, IOS_APP: application, SIMULATORS: simulators(true)}
        const deployed = await run(['mobile', 'deploy', 'ios', '--app-id', APP_ID, '--outdir', '../ui/dist/nodejs'], env)
        assert.strictEqual(deployed.code, 0, deployed.output)
        assert.match(deployed.output, /Deployed to com\.example\.mobile \(ios\) and started/)
        assert.deepStrictEqual(readFileSync(log, 'utf8').trim().split('\n'), ['simctl list devices booted', `simctl get_app_container booted ${APP_ID} app`, `simctl terminate booted ${APP_ID}`, `simctl launch booted ${APP_ID}`])
        assert.ok(!existsSync(path.join(application, 'public', 'nodejs', 'old.js')))
        assert.strictEqual(JSON.parse(readFileSync(path.join(application, 'public', 'nodejs', 'package.json'), 'utf8')).main, 'main.js')
        assert.ok(existsSync(path.join(application, 'public', 'nodejs', 'app.cjs')))
        //Watching the files of the application: built (its build script copies its sources) and deployed again when
        //they change, until stopped
        mkdirSync(path.join(project, 'src'))
        writeFileSync(path.join(project, 'src', 'App.js'), 'console.log("mobile")\n')
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'app', version: '1.0.0', type: 'module', main: 'build/App.js', scripts: {build: 'node -e "require(\'fs\').cpSync(\'src\', \'build\', {recursive: true})"'}}))
        writeFileSync(log, '')
        const watching = spawn(process.execPath, [CLI, 'mobile', 'deploy', 'ios', '--app-id', APP_ID, '--outdir', '../ui/dist/nodejs', '--watch'], {cwd: project, env: {...process.env, ...env}})
        let output: string = ''
        watching.stdout.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        watching.stderr.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        const until = async (condition: () => boolean): Promise<void> => {
            for (let attempt: number = 0; attempt < 300 && !condition(); attempt++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
            assert.ok(condition(), output)
        }
        const launches = (): number => readFileSync(log, 'utf8').split('\n').filter((line: string): boolean => line.startsWith('simctl launch')).length
        await until((): boolean => /Watching the files of the application: built and deployed again when they change/.test(output))
        assert.strictEqual(launches(), 1)
        writeFileSync(path.join(project, 'src', 'App.js'), 'console.log("changed")\n')
        await until((): boolean => launches() === 2)
        assert.match(readFileSync(path.join(application, 'public', 'nodejs', 'app.cjs'), 'utf8'), /changed/)
        watching.kill('SIGINT')
        assert.strictEqual(await new Promise((resolve: (code: number | null) => void): unknown => watching.once('exit', resolve)), 0)
        //With live reload: the application built with the address of the dev server (the configuration of Capacitor of the
        //project kept as it was), installed and started in the simulator running, shown by Device Hub; the project
        //deployed into it when the files change
        writeFileSync(path.join(work, 'capacitor.config.json'), JSON.stringify({appId: APP_ID, webDir: 'packages/ui/dist'}))
        mkdirSync(path.join(work, 'ios', 'App', 'App'), {recursive: true})
        writeFileSync(path.join(work, 'ios', 'App', 'App', 'capacitor.config.json'), JSON.stringify({appId: APP_ID, server: {cleartext: true}}))
        writeFileSync(log, '')
        const live = spawn(process.execPath, [CLI, 'mobile', 'deploy', 'ios', '--app-id', APP_ID, '--outdir', '../ui/dist/nodejs', '--live-reload', '5173'], {cwd: project, env: {...process.env, ...env}})
        output = ''
        live.stdout.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        live.stderr.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        await until((): boolean => /Watching the files of the application/.test(output))
        const derived: string = path.join(work, 'ios', 'DerivedData', UDID)
        const built: string = path.join(derived, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(built, 'capacitor.config.json'), 'utf8')).server, {cleartext: true, url: 'http://localhost:5173'})
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(work, 'ios', 'App', 'App', 'capacitor.config.json'), 'utf8')), {appId: APP_ID, server: {cleartext: true}})
        assert.deepStrictEqual(readFileSync(log, 'utf8').trim().split('\n'), [
            'simctl list devices available --json',
            `xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination id=${UDID} -derivedDataPath ${derived}`,
            `simctl install ${UDID} ${built}`,
            `open ${path.join(bin, '..', 'Xcode.app', 'Contents', 'Applications', 'DeviceHub.app')}`,
            `simctl terminate ${UDID} ${APP_ID}`,
            `simctl launch ${UDID} ${APP_ID}`
        ])
        writeFileSync(path.join(project, 'src', 'App.js'), 'console.log("live")\n')
        await until((): boolean => launches() === 2)
        assert.ok(readFileSync(log, 'utf8').includes(`simctl get_app_container ${UDID} ${APP_ID} app`))
        assert.match(readFileSync(path.join(application, 'public', 'nodejs', 'app.cjs'), 'utf8'), /live/)
        live.kill('SIGINT')
        assert.strictEqual(await new Promise((resolve: (code: number | null) => void): unknown => live.once('exit', resolve)), 0)
    })

    it('runs the application on a simulator of iOS (the newest iPhone booted when none runs), and on Android through Capacitor', async (): Promise<void> => {
        const bin: string = path.join(work, 'run', 'bin')
        const log: string = path.join(work, 'run.log')
        xcodeTools(bin)
        writeFileSync(path.join(work, 'capacitor.config.json'), JSON.stringify({appId: APP_ID, webDir: 'packages/ui/dist'}))
        mkdirSync(path.join(work, 'ios', 'App', 'App'), {recursive: true})
        writeFileSync(path.join(work, 'ios', 'App', 'App', 'capacitor.config.json'), JSON.stringify({appId: APP_ID}))
        const npxLog: string = path.join(work, 'npx-run.log')
        writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\necho "$PWD $*" >> "${npxLog}"\n`, {mode: 0o755})
        const env: NodeJS.ProcessEnv = {PATH: `${bin}${path.delimiter}${process.env.PATH}`, XCRUN_LOG: log, SIMULATORS: simulators(false)}
        const ios = await run(['mobile', 'run', 'ios'], env)
        assert.strictEqual(ios.code, 0, ios.output)
        assert.match(ios.output, new RegExp(`The simulator iPhone 17 booted[\\s\\S]*${APP_ID.replaceAll('.', '\\.')} runs on the simulator ${UDID}`))
        const commands: string[] = readFileSync(log, 'utf8').trim().split('\n')
        assert.deepStrictEqual(commands.slice(0, 3), ['simctl list devices available --json', `simctl bootstatus ${UDID} -b`, `xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination id=${UDID} -derivedDataPath ${path.join(work, 'ios', 'DerivedData', UDID)}`])
        assert.strictEqual(commands.at(-1), `simctl launch ${UDID} ${APP_ID}`)
        //Not built with the address of a dev server
        assert.strictEqual(JSON.parse(readFileSync(path.join(work, 'ios', 'DerivedData', UDID, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app', 'capacitor.config.json'), 'utf8')).server, undefined)
        //A simulator unknown
        const unknown = await run(['mobile', 'run', 'ios', '--device', 'iPhone 99'], env)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.output, /No simulator of iOS is iPhone 99/)
        //Android: npx cap run android in the project of Capacitor, the project synchronized already
        const android = await run(['mobile', 'run', 'android', '--device', 'emulator-5554'], env)
        assert.strictEqual(android.code, 0, android.output)
        assert.deepStrictEqual(readFileSync(npxLog, 'utf8').trim().split('\n'), [`${work} cap run android --no-sync --target emulator-5554`])
    })
})
