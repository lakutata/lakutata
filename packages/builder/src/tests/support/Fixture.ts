import {mkdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {EncodePng} from '../../lib/Icons.js'

/**
 * The icon of the applications of the tests: a red disc on a transparent background, 256 pixels
 */
function Icon(): Buffer {
    const size: number = 256
    const pixels: Buffer = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x - 128) ** 2 + (y - 128) ** 2 < 100 ** 2) pixels.set([220, 40, 40, 255], (y * size + x) * 4)
    return EncodePng({width: size, height: size, pixels: pixels})
}

/**
 * The application of the tests of the installers: a service answering what it runs with (its environment, its user, its
 * directory, its resource, its native addon built when it is installed by node-gyp), and a command (hello)
 * @param fixture its directory
 * @param dependencies its other dependencies (the builder)
 */
export function WriteServiceFixture(fixture: string, dependencies: Record<string, string> = {}): void {
    const file = (name: string, content: string): void => {
        mkdirSync(path.dirname(path.join(fixture, name)), {recursive: true})
        writeFileSync(path.join(fixture, name), content)
    }
    //A native addon built when it is installed (node-gyp)
    file('addon/package.json', JSON.stringify({name: 'hello-addon', version: '1.0.0', main: 'index.js', gypfile: true, scripts: {install: 'node-gyp rebuild'}}))
    file('addon/binding.gyp', JSON.stringify({targets: [{target_name: 'addon', sources: ['addon.c']}]}))
    file('addon/addon.c', `#include <node_api.h>
static napi_value Arch(napi_env env, napi_callback_info info) {
    napi_value result;
#if defined(__aarch64__) || defined(_M_ARM64)
    napi_create_string_utf8(env, "arm64", NAPI_AUTO_LENGTH, &result);
#else
    napi_create_string_utf8(env, "x64", NAPI_AUTO_LENGTH, &result);
#endif
    return result;
}
NAPI_MODULE_INIT() {
    napi_value function;
    napi_create_function(env, "arch", NAPI_AUTO_LENGTH, Arch, NULL, &function);
    napi_set_named_property(env, exports, "arch", function);
    return exports;
}
`)
    file('addon/index.js', `module.exports = require(require('node:path').join(__dirname, 'build', 'Release', 'addon.node'))`)
    //A service answering what it runs with, and a command
    file('assets/hello.txt', 'Hello')
    writeFileSync(path.join(fixture, 'icon.png'), Icon())
    //Named as the chunks of Turbopack: the installers take the characters of the globs as they are
    file('assets/[root-of-the-server]__chunk.js', 'chunk')
    file('build/index.js', `const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const addon = require('hello-addon')
const text = () => fs.readFileSync(path.join(globalThis[Symbol.for('lakutata.packaged')].resources(), 'texts', 'hello.txt'), 'utf8')
if (process.argv[2] === 'hello') {
    console.log(text() + ' ' + addon.arch())
    process.exit(0)
}
http.createServer((request, response) => response.end(JSON.stringify({greeting: process.env.GREETING, mode: process.env.MODE, user: os.userInfo().username, cwd: process.cwd(), text: text(), arch: addon.arch()}))).listen(Number(process.env.PORT))
process.on('SIGTERM', () => process.exit(0))
`)
    //The scripts of the installers, writing what they are run with to a log (/tmp/hello-hooks.log, the hello-hooks.log of
    //ProgramData): what the installer does, whether the files of the application are installed, their directory
    for (const hook of ['preinstall', 'postinstall', 'preremove', 'postremove', 'rpm-postinstall']) {
        file(`scripts/${hook}.sh`, `#!/bin/sh\nif [ -e "$LAKUTATA_INSTALL_DIR/hello" ]; then files=files; else files=nofiles; fi\necho "${hook} $1 $files $LAKUTATA_INSTALL_DIR" >> /tmp/hello-hooks.log\n`)
        file(`scripts/${hook}.ps1`, `$files = if (Test-Path (Join-Path $env:LAKUTATA_INSTALL_DIR 'hello.exe')) { 'files' } else { 'nofiles' }\r\nAdd-Content -Path (Join-Path $env:ProgramData 'hello-hooks.log') -Value "${hook} $($args[0]) $files $env:LAKUTATA_INSTALL_DIR"\r\n`)
    }
    file('scripts/deb-native-postinstall.sh', '#!/bin/sh\necho "native-postinstall $1" >> /tmp/hello-hooks.log\n')
    file('scripts/custom.nsh', `!macro customInstall\r\n  nsExec::Exec 'cmd.exe /d /c echo customInstall>>"%ProgramData%\\hello-hooks.log"'\r\n  Pop $0\r\n!macroend\r\n`)
    const scripts = (extension: string): Record<string, string> => Object.fromEntries(['preinstall', 'postinstall', 'preremove', 'postremove'].map((hook: string): [string, string] => [hook, `scripts/${hook}.${extension}`]))
    file('package.json', JSON.stringify({
        name: '@acme/hello', version: '1.0.0', description: 'Says hello', author: 'Acme <ops@acme.test>', license: 'MIT',
        main: 'build/index.js', bin: {hello: 'build/index.js'},
        dependencies: {...dependencies, 'hello-addon': 'file:./addon'},
        lakutata: {
            icon: 'icon.png',
            resources: [{from: 'assets', to: 'texts'}],
            installer: {
                name: 'hello-service', appId: 'test.acme.hello', service: {env: {GREETING: 'Hi', PORT: '18080'}},
                //The ones of the platforms, the ones of a package replacing them, the native ones of a package, the file
                //of NSIS included
                linux: {scripts: scripts('sh'), rpm: {scripts: {postinstall: 'scripts/rpm-postinstall.sh'}}, deb: {nativeScripts: {postinstall: 'scripts/deb-native-postinstall.sh'}}},
                mac: {scripts: scripts('sh')},
                win: {scripts: scripts('ps1'), nsis: {include: 'scripts/custom.nsh'}}
            }
        }
    }))
}

/**
 * The Electron application of the tests of the installers (Hello Desk): a main process quitting once ready, a resource,
 * and the scripts of the installers writing what they are run with to a log (/tmp/hello-desk-hooks.log, the
 * hello-desk-hooks.log of ProgramData): what the installer does, whether the application is installed, its directory
 * @param fixture its directory
 * @param versions the versions of electron and of electron-builder
 * @param dependencies its other dependencies (the builder)
 */
export function WriteElectronFixture(fixture: string, versions: { electron: string, builder: string }, dependencies: Record<string, string> = {}): void {
    const file = (name: string, content: string): void => {
        mkdirSync(path.dirname(path.join(fixture, name)), {recursive: true})
        writeFileSync(path.join(fixture, name), content)
    }
    file('build/index.js', `const {app} = require('electron')\napp.whenReady().then(() => app.quit())\n`)
    file('assets/hello.txt', 'Hello')
    writeFileSync(path.join(fixture, 'icon.png'), Icon())
    for (const hook of ['preinstall', 'postinstall', 'preremove', 'postremove']) {
        file(`scripts/${hook}.sh`, `#!/bin/sh\nif [ -n "$(find "$LAKUTATA_INSTALL_DIR" -type f 2>/dev/null | head -n 1)" ]; then files=files; else files=nofiles; fi\necho "${hook} $1 $files $LAKUTATA_INSTALL_DIR \${LAKUTATA_INSTALL_DIR:+kept}" >> /tmp/hello-desk-hooks.log\n`)
        file(`scripts/${hook}.ps1`, `$files = if (Get-ChildItem $env:LAKUTATA_INSTALL_DIR -ErrorAction SilentlyContinue) { 'files' } else { 'nofiles' }\r\nAdd-Content -Path (Join-Path $env:ProgramData 'hello-desk-hooks.log') -Value "${hook} $($args[0]) $files $env:LAKUTATA_INSTALL_DIR"\r\n`)
    }
    const scripts = (extension: string): Record<string, string> => Object.fromEntries(['preinstall', 'postinstall', 'preremove', 'postremove'].map((hook: string): [string, string] => [hook, `scripts/${hook}.${extension}`]))
    file('package.json', JSON.stringify({
        name: 'hello-desk', productName: 'Hello Desk', version: '1.0.0', description: 'Says hello', author: 'Acme <ops@acme.test>', license: 'MIT',
        homepage: 'https://acme.test', main: 'build/index.js',
        devDependencies: {...dependencies, 'electron': versions.electron, 'electron-builder': versions.builder},
        lakutata: {
            icon: 'icon.png',
            resources: [{from: 'assets', to: 'texts'}],
            installer: {
                runtime: 'electron', appId: 'test.acme.desk',
                linux: {targets: ['deb', 'rpm'], scripts: scripts('sh')},
                mac: {targets: ['pkg'], scripts: scripts('sh')},
                win: {targets: ['nsis'], scripts: scripts('ps1')}
            }
        }
    }))
}
