import {execFileSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripVTControlCharacters} from 'node:util'
import {SpawnCommand} from '../../lib/Processes.js'

export const CLI: string = fileURLToPath(new URL('../../CLIApp.js', import.meta.url))
export const ROOT: string = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../..')

/**
 * Whether a command runs on the machine
 * @param command
 */
export function Has(command: string): boolean {
    try {
        execFileSync(command, ['--version'], {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
}

/**
 * The toolchains of the build systems of the native addons (a C++ compiler, CMake, cargo); Windows needs the Visual
 * Studio Build Tools, not checked here
 */
export const TOOLCHAINS: Record<string, boolean> = {
    gyp: process.platform !== 'win32' && Has('c++'),
    cmake: process.platform !== 'win32' && Has('c++') && Has('cmake'),
    rust: Has('cargo')
}

/**
 * Run a command
 * @param command
 * @param args
 * @param cwd
 * @param variables its environment variables
 */
export function Run(command: string, args: string[], cwd: string, variables: Record<string, string> = {}): Promise<{ code: number, output: string }> {
    const {NODE_TEST_CONTEXT, ...env} = process.env
    void NODE_TEST_CONTEXT
    return RunCommand(command, args, cwd, {...env, npm_config_user_agent: '', ...variables})
}

/**
 * Run a command as the tool runs them (npm.cmd on Windows), its output given back
 * @param command
 * @param args
 * @param cwd
 * @param env
 * @param timeout
 */
export function RunCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number = 300000): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        const child = SpawnCommand(command, args, {cwd: cwd, env: env})
        let output: string = ''
        child.stdout!.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.stderr!.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        const timer: NodeJS.Timeout = setTimeout((): unknown => child.kill(), timeout)
        child.once('error', (error: Error): unknown => output += error.message)
        child.once('close', (code: number | null): void => {
            clearTimeout(timer)
            resolve({code: code ?? 1, output: stripVTControlCharacters(output)})
        })
    })
}

/**
 * A command of the scripts of a project (node_modules/.bin), as npm installs it: a link to its script, a command file
 * running it on Windows (cmd.exe does not run the links)
 * @param bin the directory of the commands
 * @param name
 * @param script the JavaScript file of the command, or a command of the node_modules/.bin of the repository
 */
export function LinkCommand(bin: string, name: string, script: string): void {
    if (process.platform !== 'win32') return symlinkSync(script, path.join(bin, name))
    const command: string = existsSync(`${script}.cmd`) ? `@call "${script}.cmd" %*` : `@node "${script}" %*`
    writeFileSync(path.join(bin, `${name}.cmd`), `${command}\r\n`)
}

/**
 * A workspace of version 1.2.3 with a package app, the tools of the repository linked in its node_modules (as npm
 * install would)
 * @param work the directory of the workspaces
 * @param name
 */
export function Workspace(work: string, name: string): string {
    const root: string = path.join(work, name)
    mkdirSync(path.join(root, 'packages', 'app'), {recursive: true})
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: name, version: '1.2.3', private: true, workspaces: ['packages/*']}, null, 2))
    writeFileSync(path.join(root, 'packages', 'app', 'package.json'), JSON.stringify({name: 'app', version: '1.2.3', type: 'module', main: 'build/App.js', dependencies: {lakutata: '^3.0.0'}}, null, 2))
    mkdirSync(path.join(root, 'node_modules', '.bin'), {recursive: true})
    mkdirSync(path.join(root, 'node_modules', '@types'), {recursive: true})
    mkdirSync(path.join(root, 'node_modules', '@napi-rs'), {recursive: true})
    for (const module of ['typescript', 'node-gyp-build', 'node-gyp', 'cmake-js', '@napi-rs/cli', '@types/node']) symlinkSync(path.join(ROOT, 'node_modules', module), path.join(root, 'node_modules', module), 'dir')
    //Copied, as installed: gyp includes its targets by paths relative to the package
    cpSync(path.join(ROOT, 'node_modules', 'node-addon-api'), path.join(root, 'node_modules', 'node-addon-api'), {recursive: true})
    for (const bin of ['tsc', 'node-gyp', 'node-gyp-build', 'cmake-js', 'napi']) LinkCommand(path.join(root, 'node_modules', '.bin'), bin, path.join(ROOT, 'node_modules', '.bin', bin))
    LinkCommand(path.join(root, 'node_modules', '.bin'), 'lakutata', CLI)
    return root
}
