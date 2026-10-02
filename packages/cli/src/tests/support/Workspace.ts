import {execFile, execFileSync, type ExecFileException} from 'node:child_process'
import {cpSync, mkdirSync, symlinkSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripVTControlCharacters} from 'node:util'

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
 */
export function Run(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        const {NODE_TEST_CONTEXT, ...env} = process.env
        void NODE_TEST_CONTEXT
        execFile(command, args, {cwd: cwd, env: {...env, npm_config_user_agent: ''}, timeout: 300000}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            output: stripVTControlCharacters(`${stdout}${stderr}`)
        }))
    })
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
    for (const bin of ['tsc', 'node-gyp', 'node-gyp-build', 'cmake-js', 'napi']) symlinkSync(path.join(ROOT, 'node_modules', '.bin', bin), path.join(root, 'node_modules', '.bin', bin))
    symlinkSync(CLI, path.join(root, 'node_modules', '.bin', 'lakutata'))
    return root
}
