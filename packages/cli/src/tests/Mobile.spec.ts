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
        //The xcrun of Xcode: the directory of the application installed in the simulator, on the Mac
        const bin: string = path.join(work, 'bin')
        const application: string = path.join(work, 'simulator', 'App.app')
        const log: string = path.join(work, 'xcrun.log')
        mkdirSync(bin)
        mkdirSync(path.join(application, 'public', 'nodejs'), {recursive: true})
        writeFileSync(path.join(application, 'public', 'nodejs', 'old.js'), 'old')
        writeFileSync(path.join(bin, 'xcrun'), `#!/bin/sh
echo "$*" >> "$XCRUN_LOG"
case "$*" in
    "simctl list devices booted") printf '== Devices ==\\n-- iOS 27.2 --\\n    iPhone 17 (B33CBA54-DFCC-4509-9CA4-4AB94C8E248E) (Booted)\\n' ;;
    "simctl get_app_container booted ${APP_ID} app") echo "$IOS_APP" ;;
    "simctl terminate booted ${APP_ID}") ;;
    "simctl launch booted ${APP_ID}") echo "${APP_ID}: 1234" ;;
    *) echo "unknown: $*" >&2; exit 1 ;;
esac
`, {mode: 0o755})
        const env: NodeJS.ProcessEnv = {PATH: `${bin}${path.delimiter}${process.env.PATH}`, XCRUN_LOG: log, IOS_APP: application}
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
        //With live reload: the application run by Capacitor on the simulator running, given its configuration back once
        //stopped; the project deployed when the files change
        writeFileSync(path.join(work, 'capacitor.config.json'), JSON.stringify({appId: APP_ID, webDir: 'packages/ui/dist'}))
        const npxLog: string = path.join(work, 'npx.log')
        writeFileSync(path.join(bin, 'npx'), `#!/bin/sh
echo "$PWD $*" >> "${npxLog}"
trap 'echo "given back" >> "${npxLog}"; exit 0' INT
echo "App running with live reload listing for: http://192.168.1.2:5173. Press Ctrl+C to quit."
while true; do sleep 0.1; done
`, {mode: 0o755})
        writeFileSync(log, '')
        const live = spawn(process.execPath, [CLI, 'mobile', 'deploy', 'ios', '--app-id', APP_ID, '--outdir', '../ui/dist/nodejs', '--live-reload', '5173'], {cwd: project, env: {...process.env, ...env}})
        output = ''
        live.stdout.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        live.stderr.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        await until((): boolean => /Watching the files of the application/.test(output))
        assert.deepStrictEqual(readFileSync(npxLog, 'utf8').trim().split('\n'), [`${work} cap run ios --live-reload --port 5173 --no-sync --target B33CBA54-DFCC-4509-9CA4-4AB94C8E248E`])
        assert.strictEqual(launches(), 0)
        writeFileSync(path.join(project, 'src', 'App.js'), 'console.log("live")\n')
        await until((): boolean => launches() === 1)
        live.kill('SIGINT')
        assert.strictEqual(await new Promise((resolve: (code: number | null) => void): unknown => live.once('exit', resolve)), 0)
        assert.match(readFileSync(npxLog, 'utf8'), /given back/)
    })
})
