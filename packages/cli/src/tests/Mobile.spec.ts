import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, ROOT, runCommand} from './support/Workspace.js'

/**
 * The id of the application of the tests on the three systems
 */
const APP_ID: string = 'com.example.mobile'

/**
 * The simulator of iOS of the tests
 */
const UDID: string = 'B33CBA54-DFCC-4509-9CA4-4AB94C8E248E'

/**
 * The simulators of iOS listed (xcrun simctl list devices available --json): the iPhone 17 of iOS 27.2 running
 */
const SIMULATORS: string = JSON.stringify({
    devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{udid: '11111111-1111-1111-1111-111111111111', name: 'iPhone 16', state: 'Shutdown'}],
        'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [{udid: UDID, name: 'iPhone 17', state: 'Booted'}]
    }
})

/**
 * Write an executable script
 * @param file
 * @param content
 */
function script(file: string, content: string): void {
    mkdirSync(path.dirname(file), {recursive: true})
    writeFileSync(file, content, {mode: 0o755})
}

/**
 * A libnode of the tests, laid out as the one downloaded from lakutata/libnode (Node.js 24.20.0)
 * @param directory
 * @param platform
 */
function fakeNode(directory: string, platform: 'android' | 'ios' | 'harmony'): void {
    mkdirSync(path.join(directory, 'include', 'node'), {recursive: true})
    writeFileSync(path.join(directory, 'include', 'node', 'node_version.h'), '#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 20\n#define NODE_PATCH_VERSION 0\n')
    writeFileSync(path.join(directory, 'include', 'node', 'node_api.h'), '')
    if (platform === 'ios') {
        mkdirSync(path.join(directory, 'NodeMobile.xcframework'), {recursive: true})
        writeFileSync(path.join(directory, 'NodeMobile.xcframework', 'Info.plist'), '')
    } else {
        mkdirSync(path.join(directory, 'libs', 'arm64-v8a'), {recursive: true})
        writeFileSync(path.join(directory, 'libs', 'arm64-v8a', 'libnode.so'), `libnode of ${platform}`)
    }
}

describe('lakutata mobile', {skip: process.platform === 'win32' && 'the fake tools are scripts'}, (): void => {

    let work: string
    let log: string
    let env: NodeJS.ProcessEnv

    /**
     * Run the command in a directory of the project (its root by default)
     * @param args
     * @param cwd
     */
    const run = (args: string[], cwd: string = work): Promise<{ code: number, output: string }> => runCommand(process.execPath, [CLI, ...args], cwd, {...process.env, ...env})

    /**
     * The commands the fake tools ran since the last call, then forgotten
     */
    const commands = (): string[] => {
        const lines: string[] = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []
        writeFileSync(log, '')
        return lines
    }

    before((): void => {
        //The real path: the current directory of the command is one (/private/var on macOS)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-')))
        log = path.join(work, 'tools.log')
        //The project as the mobile-react template lays it out
        const app: string = path.join(work, 'packages', 'app')
        mkdirSync(path.join(app, 'build'), {recursive: true})
        symlinkSync(path.join(ROOT, 'node_modules'), path.join(app, 'node_modules'), 'dir')
        writeFileSync(path.join(app, 'package.json'), JSON.stringify({name: 'app', version: '1.0.0', type: 'module', main: 'build/App.js'}))
        writeFileSync(path.join(app, 'build', 'App.js'), 'console.log("mobile")\n')
        mkdirSync(path.join(work, 'packages', 'ipc', 'native'), {recursive: true})
        writeFileSync(path.join(work, 'packages', 'ipc', 'native', 'NodeHost.cpp'), '')
        script(path.join(work, 'android', 'app', 'build.gradle'), `android {\n    defaultConfig {\n        applicationId "${APP_ID}"\n    }\n}\n`)
        mkdirSync(path.join(work, 'ios', 'App.xcodeproj'), {recursive: true})
        writeFileSync(path.join(work, 'ios', 'App.xcodeproj', 'project.pbxproj'), `PRODUCT_BUNDLE_IDENTIFIER = "${APP_ID}";\n`)
        mkdirSync(path.join(work, 'harmony', 'AppScope'), {recursive: true})
        writeFileSync(path.join(work, 'harmony', 'AppScope', 'app.json5'), `{\n  "app": {\n    "bundleName": "${APP_ID}"\n  }\n}\n`)
        //The libnode of the three systems, given instead of downloaded (no network in the tests)
        for (const platform of ['android', 'ios', 'harmony'] as const) fakeNode(path.join(work, 'exports', platform), platform)
        //The tools of the systems: they write their commands into the log, and run them on directories standing for the
        //devices (DEVICE: the files of the application of Android, IOS_APP: the application in the simulator)
        const bin: string = path.join(work, 'bin')
        script(path.join(work, 'android-sdk', 'platform-tools', 'adb'), `#!/bin/sh
echo "adb $*" >> "$TOOLS_LOG"
[ "$1" = "devices" ] && { printf 'List of devices attached\\nemulator-5554\\tdevice\\n'; exit 0; }
[ "$1" = "-s" ] && shift 2
[ "$1" = "reverse" ] && exit 0
[ "$1" = "shell" ] || exit 1
shift
case "$*" in
    "pm path ${APP_ID}") echo "package:/data/app/base.apk" ;;
    "getprop ro.product.cpu.abi") echo "arm64-v8a" ;;
    "cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${APP_ID}") printf 'priority=0 preferredOrder=0\\n${APP_ID}/dev.lakutata.mobile.MainActivity\\n' ;;
    "run-as ${APP_ID} ls") ;;
    "run-as ${APP_ID} rm -f files/nodejs.dev") rm -f "$DEVICE/files/nodejs.dev" ;;
    "am start -n ${APP_ID}/dev.lakutata.mobile.MainActivity") ;;
    "am force-stop ${APP_ID}") ;;
    "run-as ${APP_ID} sh -c "*) cd "$DEVICE" && rm -rf files/nodejs && mkdir -p files/nodejs && tar -x -f - -C files/nodejs && touch files/nodejs.dev ;;
    *) echo "unknown: $*" >&2; exit 1 ;;
esac
`)
        script(path.join(work, 'android', 'gradlew'), '#!/bin/sh\necho "gradlew $* ($ANDROID_SERIAL)" >> "$TOOLS_LOG"\n')
        script(path.join(bin, 'xcrun'), `#!/bin/sh
echo "xcrun $*" >> "$TOOLS_LOG"
case "$*" in
    "simctl list devices available --json") echo '${SIMULATORS}' ;;
    "simctl get_app_container ${UDID} ${APP_ID} app") echo "$IOS_APP" ;;
    "simctl terminate ${UDID} ${APP_ID}") ;;
    "simctl launch ${UDID} ${APP_ID}") echo "${APP_ID}: 1234" ;;
    "simctl install ${UDID} "*) ;;
    "xcodebuild "*)
        derived=""; previous=""
        for argument in "$@"; do [ "$previous" = "-derivedDataPath" ] && derived="$argument"; previous="$argument"; done
        mkdir -p "$derived/Build/Products/Debug-iphonesimulator/App.app" && echo "** BUILD SUCCEEDED **" ;;
    *) echo "unknown: $*" >&2; exit 1 ;;
esac
`)
        script(path.join(bin, 'pod'), '#!/bin/sh\necho "pod $*" >> "$TOOLS_LOG"\nmkdir -p App.xcworkspace Pods && echo lock > Podfile.lock && echo lock > Pods/Manifest.lock\n')
        script(path.join(bin, 'plutil'), `#!/bin/sh\necho ${APP_ID}\n`)
        script(path.join(bin, 'xcode-select'), '#!/bin/sh\nexit 1\n')
        //DevEco Studio: hvigor making the HAP, hdc installing it; the bundle of RNOH
        const deveco: string = path.join(work, 'deveco')
        script(path.join(deveco, 'tools', 'hvigor', 'bin', 'hvigorw.js'), `const fs = require('fs')
fs.appendFileSync(process.env.TOOLS_LOG, 'hvigor ' + process.argv.slice(2).join(' ') + ' (' + process.env.DEVECO_SDK_HOME + ')\\n')
fs.mkdirSync('entry/build/default/outputs/default', {recursive: true})
fs.writeFileSync('entry/build/default/outputs/default/entry-default-unsigned.hap', 'hap')
`)
        script(path.join(deveco, 'tools', 'ohpm', 'bin', 'ohpm'), '#!/bin/sh\necho "ohpm $*" >> "$TOOLS_LOG"\n')
        mkdirSync(path.join(deveco, 'tools', 'node', 'bin'), {recursive: true})
        symlinkSync(process.execPath, path.join(deveco, 'tools', 'node', 'bin', 'node'))
        script(path.join(deveco, 'sdk', 'default', 'openharmony', 'toolchains', 'hdc'), `#!/bin/sh
echo "hdc $*" >> "$TOOLS_LOG"
#A command failing as hdc fails: its exit code 0, its output telling the failure
if [ -n "$HDC_FAIL" ]; then case "$*" in *" $HDC_FAIL "*) echo "$HDC_FAIL_OUTPUT"; exit 0 ;; esac; fi
case "$*" in
    "list targets") echo "127.0.0.1:5555" ;;
    #The forward of Metro, kept by the server of hdc from a run to the next: rport fails while it is set up
    *" rport tcp:8081 tcp:8081") if [ -f "$HDC_FORWARD" ]; then echo "[Fail]TCP Port listen failed at 8081"; else touch "$HDC_FORWARD"; echo "Forwardport result:OK"; fi ;;
    *" fport rm tcp:8081 tcp:8081") if [ -f "$HDC_FORWARD" ]; then rm "$HDC_FORWARD"; echo "Remove forward ruler success, ruler:tcp:8081 tcp:8081"; else echo "[Fail]Remove forward ruler failed, ruler is not exist tcp:8081 tcp:8081"; fi ;;
    *" file send -b "*)
        #The files of the application once it has run after the device started (HDC_SANDBOX, when given)
        if [ -n "$HDC_SANDBOX" ] && [ ! -f "$HDC_SANDBOX" ]; then echo "[Fail][E005101] Invalid bundle name: $6"; exit 0; fi
        #The files of the application ($HARMONY_FILES): a directory copied into the one of its name, a file written
        if [ -d "$7" ]; then cp -R "$7" "$HARMONY_FILES/"; elif [ -d "$(dirname "$HARMONY_FILES\${8#/data/storage/el2/base/files}")" ]; then cp "$7" "$HARMONY_FILES\${8#/data/storage/el2/base/files}"; else echo "[Fail]Error opening file"; exit 0; fi
        echo "FileTransfer finish" ;;
    *" aa start "*) [ -n "$HDC_SANDBOX" ] && touch "$HDC_SANDBOX"; echo "start ability successfully." ;;
esac
`)
        script(path.join(work, 'node_modules', '.bin', 'react-native'), '#!/bin/sh\necho "react-native $*" >> "$TOOLS_LOG"\n')
        env = {
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            TOOLS_LOG: log,
            ANDROID_HOME: path.join(work, 'android-sdk'),
            DEVICE: path.join(work, 'device'),
            IOS_APP: path.join(work, 'simulator', 'App.app'),
            DEVECO_STUDIO_HOME: deveco,
            HARMONY_FILES: path.join(work, 'harmony-files'),
            HDC_FORWARD: path.join(work, 'hdc-forward'),
            LAKUTATA_MOBILE_NODE_DIR: path.join(work, 'exports')
        }
        mkdirSync(path.join(work, 'device', 'files'), {recursive: true})
        mkdirSync(path.join(work, 'harmony-files'), {recursive: true})
        mkdirSync(path.join(work, 'simulator', 'App.app', 'nodejs'), {recursive: true})
        writeFileSync(path.join(work, 'simulator', 'App.app', 'nodejs', 'old.js'), '')
    })

    after((): void => {
        rmSync(work, {recursive: true, force: true})
    })

    it('exports the libnode of a system into the project, the one of HarmonyOS into the libraries of the HAP too', async (): Promise<void> => {
        //The project found from a directory of it
        const exported = await run(['mobile', 'node', 'harmony'], path.join(work, 'packages', 'app'))
        assert.strictEqual(exported.code, 0, exported.output)
        assert.match(exported.output, /The libnode of harmony: \.\.\/ipc\/native\/node\/out\/harmony/)
        assert.strictEqual(readFileSync(path.join(work, 'packages', 'ipc', 'native', 'node', 'out', 'harmony', 'libs', 'arm64-v8a', 'libnode.so'), 'utf8'), 'libnode of harmony')
        assert.strictEqual(readFileSync(path.join(work, 'harmony', 'entry', 'libs', 'arm64-v8a', 'libnode.so'), 'utf8'), 'libnode of harmony')
        for (const platform of ['android', 'ios']) assert.strictEqual((await run(['mobile', 'node', platform])).code, 0)
        assert.ok(existsSync(path.join(work, 'packages', 'ipc', 'native', 'node', 'out', 'ios', 'NodeMobile.xcframework', 'Info.plist')))
        //Outside of a project
        const outside = await run(['mobile', 'node', 'android'], tmpdir())
        assert.notStrictEqual(outside.code, 0)
        assert.match(outside.output, /is in no project of a mobile application \(packages\/app and packages\/ipc\/native\/NodeHost\.cpp/)
    })

    it('makes the Node.js project of the application where the native project of the system takes it', async (): Promise<void> => {
        //The libnode of the system put into the project first when it has none
        rmSync(path.join(work, 'packages', 'ipc', 'native', 'node', 'out', 'android'), {recursive: true})
        const staged = await run(['mobile', 'stage', 'android'])
        assert.strictEqual(staged.code, 0, staged.output)
        assert.ok(existsSync(path.join(work, 'packages', 'ipc', 'native', 'node', 'out', 'android', 'libs', 'arm64-v8a', 'libnode.so')))
        assert.match(staged.output, /The Node\.js project for android \(Node\.js 24\.20\.0\): android\/app\/src\/main\/assets\/nodejs/)
        for (const file of ['package.json', 'main.js', 'app.cjs']) assert.ok(existsSync(path.join(work, 'android', 'app', 'src', 'main', 'assets', 'nodejs', file)), file)
        for (const [platform, directory] of [['ios', 'ios/nodejs'], ['harmony', 'harmony/entry/src/main/resources/resfile/nodejs']]) {
            const result = await run(['mobile', 'stage', platform])
            assert.strictEqual(result.code, 0, result.output)
            assert.ok(existsSync(path.join(work, ...directory.split('/'), 'main.js')), directory)
        }
    })

    it('deploys the project into the application of Android, kept by the application until it is installed again, and runs the application', async (): Promise<void> => {
        commands()
        const deployed = await run(['mobile', 'deploy', 'android'])
        assert.strictEqual(deployed.code, 0, deployed.output)
        assert.match(deployed.output, /Deployed to com\.example\.mobile \(emulator-5554\) and started/)
        assert.strictEqual(JSON.parse(readFileSync(path.join(work, 'device', 'files', 'nodejs', 'package.json'), 'utf8')).main, 'main.js')
        assert.ok(existsSync(path.join(work, 'device', 'files', 'nodejs.dev')))
        const ran: string[] = commands()
        assert.deepStrictEqual(ran.filter((command: string): boolean => / am /.test(command)), [`adb -s emulator-5554 shell am force-stop ${APP_ID}`, `adb -s emulator-5554 shell am force-stop ${APP_ID}`, `adb -s emulator-5554 shell am start -n ${APP_ID}/dev.lakutata.mobile.MainActivity`])
        //Run: built for the architecture of the device, Metro reachable, the copy deployed given up
        const started = await run(['mobile', 'run', 'android', '--device', 'emulator-5556'])
        assert.strictEqual(started.code, 0, started.output)
        assert.match(started.output, /com\.example\.mobile runs on emulator-5556/)
        const built: string[] = commands()
        assert.ok(built.includes('adb -s emulator-5556 reverse tcp:8081 tcp:8081'), built.join('\n'))
        assert.ok(built.includes('gradlew installDebug -PreactNativeArchitectures=arm64-v8a (emulator-5556)'), built.join('\n'))
        assert.ok(built.indexOf(`adb -s emulator-5556 shell run-as ${APP_ID} rm -f files/nodejs.dev`) > built.indexOf('gradlew installDebug -PreactNativeArchitectures=arm64-v8a (emulator-5556)'))
        assert.ok(!existsSync(path.join(work, 'device', 'files', 'nodejs.dev')))
    })

    it('deploys the project into the application of a simulator of iOS, and builds and runs the application, its pods installed first', async (): Promise<void> => {
        commands()
        const deployed = await run(['mobile', 'deploy', 'ios'])
        assert.strictEqual(deployed.code, 0, deployed.output)
        assert.match(deployed.output, new RegExp(`Deployed to com\\.example\\.mobile \\(${UDID}\\) and started`))
        assert.ok(existsSync(path.join(work, 'simulator', 'App.app', 'nodejs', 'app.cjs')))
        assert.ok(!existsSync(path.join(work, 'simulator', 'App.app', 'nodejs', 'old.js')))
        assert.deepStrictEqual(commands().filter((command: string): boolean => command.startsWith('xcrun simctl') && !command.includes('list')), [`xcrun simctl get_app_container ${UDID} ${APP_ID} app`, `xcrun simctl terminate ${UDID} ${APP_ID}`, `xcrun simctl launch ${UDID} ${APP_ID}`])
        writeFileSync(path.join(work, 'ios', 'Podfile'), "target 'App' do\nend\n")
        const started = await run(['mobile', 'run', 'ios'])
        assert.strictEqual(started.code, 0, started.output)
        assert.match(started.output, new RegExp(`com\\.example\\.mobile runs on the simulator ${UDID}`))
        const built: string[] = commands()
        assert.strictEqual(built[1], 'pod install')
        assert.ok(built.some((command: string): boolean => command.startsWith(`xcrun xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -destination id=${UDID} -derivedDataPath ${path.join(work, 'ios', 'build')} build`)), built.join('\n'))
        //The pods installed are kept
        assert.strictEqual((await run(['mobile', 'run', 'ios'])).code, 0)
        assert.ok(!commands().includes('pod install'))
    })

    it('builds and runs the application of HarmonyOS, and deploys the project into its files', async (): Promise<void> => {
        commands()
        const started = await run(['mobile', 'run', 'harmony'])
        assert.strictEqual(started.code, 0, started.output)
        assert.match(started.output, /com\.example\.mobile runs on 127\.0\.0\.1:5555/)
        const sdk: string = path.join(work, 'deveco', 'sdk')
        const hap: string = path.join(work, 'harmony', 'entry', 'build', 'default', 'outputs', 'default', 'entry-default-unsigned.hap')
        //The temporary directories of the files sent written <tmp>
        const sent = (): string[] => commands().map((command: string): string => command.replace(/\S*lakutata-harmony-[^/ ]+/g, '<tmp>'))
        assert.deepStrictEqual(sent(), [
            'hdc list targets',
            'react-native bundle-harmony --dev false --bundle-output harmony/entry/src/main/resources/rawfile/bundle.harmony.js',
            'ohpm install --all',
            `hvigor --mode module -p product=default -p module=entry@default assembleHap --no-daemon (${sdk})`,
            `hdc -t 127.0.0.1:5555 install -r ${hap}`,
            'hdc -t 127.0.0.1:5555 fport rm tcp:8081 tcp:8081',
            'hdc -t 127.0.0.1:5555 rport tcp:8081 tcp:8081',
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 file send -b ${APP_ID} <tmp>/nodejs-dev/.development /data/storage/el2/base/files/nodejs-dev/.development`,
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 shell aa start -a EntryAbility -b ${APP_ID}`
        ])
        //Deployed: the copy of the files turned on
        const deployed = await run(['mobile', 'deploy', 'harmony'])
        assert.strictEqual(deployed.code, 0, deployed.output)
        assert.match(deployed.output, /Deployed to com\.example\.mobile \(127\.0\.0\.1:5555\) and started/)
        assert.deepStrictEqual(sent(), [
            'hdc list targets',
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 file send -b ${APP_ID} <tmp>/nodejs-dev /data/storage/el2/base/files`,
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 shell aa start -a EntryAbility -b ${APP_ID}`
        ])
        const development: string = path.join(work, 'harmony-files', 'nodejs-dev')
        assert.strictEqual(readFileSync(path.join(development, '.development'), 'utf8'), 'on\n')
        assert.ok(existsSync(path.join(development, 'app.cjs')))
        //Run again: the forward of Metro set up again, the copy turned off, the project of the HAP runs
        const again = await run(['mobile', 'run', 'harmony'])
        assert.strictEqual(again.code, 0, again.output)
        assert.strictEqual(readFileSync(path.join(development, '.development'), 'utf8'), 'off\n')
    })

    it('deploys into the application of HarmonyOS after the device started again, and runs it, the application started once first', async (): Promise<void> => {
        //The device started again: the files of the application are not there until it runs
        const sandbox: string = path.join(work, 'hdc-sandbox')
        rmSync(sandbox, {force: true})
        commands()
        const deployed = await runCommand(process.execPath, [CLI, 'mobile', 'deploy', 'harmony'], work, {...process.env, ...env, HDC_SANDBOX: sandbox})
        assert.strictEqual(deployed.code, 0, deployed.output)
        assert.match(deployed.output, /Deployed to com\.example\.mobile \(127\.0\.0\.1:5555\) and started/)
        const ran: string[] = commands().filter((command: string): boolean => / aa | file send /.test(command)).map((command: string): string => command.replace(/\S*lakutata-harmony-[^/ ]+/g, '<tmp>'))
        assert.deepStrictEqual(ran, [
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 file send -b ${APP_ID} <tmp>/nodejs-dev /data/storage/el2/base/files`,
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 shell aa start -a EntryAbility -b ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 file send -b ${APP_ID} <tmp>/nodejs-dev /data/storage/el2/base/files`,
            `hdc -t 127.0.0.1:5555 shell aa force-stop ${APP_ID}`,
            `hdc -t 127.0.0.1:5555 shell aa start -a EntryAbility -b ${APP_ID}`
        ])
        assert.strictEqual(readFileSync(path.join(work, 'harmony-files', 'nodejs-dev', '.development'), 'utf8'), 'on\n')
        //Run after the device started again: the copy deployed turned off, not left to run instead of the project
        //installed
        rmSync(sandbox, {force: true})
        const again = await runCommand(process.execPath, [CLI, 'mobile', 'run', 'harmony'], work, {...process.env, ...env, HDC_SANDBOX: sandbox})
        assert.strictEqual(again.code, 0, again.output)
        assert.strictEqual(readFileSync(path.join(work, 'harmony-files', 'nodejs-dev', '.development'), 'utf8'), 'off\n')
    })

    it('stops when hdc tells a failure, which it exits with 0', async (): Promise<void> => {
        const fail = (command: string, output: string): Promise<{ code: number, output: string }> => runCommand(process.execPath, [CLI, 'mobile', 'run', 'harmony'], work, {...process.env, ...env, HDC_FAIL: command, HDC_FAIL_OUTPUT: output})
        //The port of Metro taken on the device
        const forwarded = await fail('rport', '[Fail]TCP Port listen failed at 8081')
        assert.notStrictEqual(forwarded.code, 0)
        assert.match(forwarded.output, /Metro cannot be made reachable from the device \(hdc rport\): \[Fail\]TCP Port listen failed at 8081/)
        assert.doesNotMatch(forwarded.output, /runs on/)
        //The HAP refused by the device: nothing run after it
        commands()
        const installed = await fail('install', '[Info]App install path:/hap msg:error: failed to install bundle.\ncode:9568322\nAppMod finish')
        assert.notStrictEqual(installed.code, 0)
        assert.match(installed.output, /The application cannot be installed: .*msg:error: failed to install bundle\./)
        assert.ok(!commands().some((command: string): boolean => / rport /.test(command)))
    })
})
