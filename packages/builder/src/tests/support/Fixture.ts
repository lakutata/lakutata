import {mkdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'

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
    file('package.json', JSON.stringify({
        name: '@acme/hello', version: '1.0.0', description: 'Says hello', author: 'Acme <ops@acme.test>', license: 'MIT',
        main: 'build/index.js', bin: {hello: 'build/index.js'},
        dependencies: {...dependencies, 'hello-addon': 'file:./addon'},
        lakutata: {
            resources: [{from: 'assets', to: 'texts'}],
            installer: {name: 'hello-service', appId: 'test.acme.hello', service: {env: {GREETING: 'Hi', PORT: '18080'}}}
        }
    }))
}
