import {type ChildProcess, spawn, type SpawnOptions} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {LaunchEnvironment} from './Environment.js'
import {type ProcessResult} from '../types/ProcessResult.js'

/**
 * The package managers
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

/**
 * The package manager running the tool (npx, pnpm dlx, yarn dlx), npm by default
 */
export function detectPackageManager(): PackageManager {
    const agent: string = process.env.npm_config_user_agent ?? ''
    if (agent.startsWith('pnpm')) return 'pnpm'
    if (agent.startsWith('yarn')) return 'yarn'
    return 'npm'
}

/**
 * Whether a directory is the root of a workspace: its package.json declares workspaces, or a pnpm-workspace.yaml is
 * next to it
 * @param directory
 */
function workspaceRoot(directory: string): boolean {
    const manifest: string = path.join(directory, 'package.json')
    if (!existsSync(manifest)) return false
    if (existsSync(path.join(directory, 'pnpm-workspace.yaml'))) return true
    try {
        const workspaces: unknown = JSON.parse(readFileSync(manifest, 'utf8')).workspaces
        return Array.isArray(workspaces) || Array.isArray((workspaces as { packages?: unknown } | undefined)?.packages)
    } catch {
        return false
    }
}

/**
 * The package manager of a project: the packageManager field of its package.json ("pnpm@9.15.0"), else its lock file
 * (pnpm-lock.yaml or pnpm-workspace.yaml, yarn.lock, package-lock.json), looked for from the directory up to the root
 * of its workspace (the directory itself when it is in none); npm by default
 * @param directory The directory of the project, or of one of the packages of its workspace.
 */
export function projectPackageManager(directory: string): PackageManager {
    const start: string = path.resolve(directory)
    //The directories of the project: up to the nearest root of a workspace, the directory itself without one
    const directories: string[] = []
    for (let current: string = start; ; current = path.dirname(current)) {
        directories.push(current)
        if (workspaceRoot(current)) break
        if (path.dirname(current) === current) {
            directories.splice(1)
            break
        }
    }
    for (const current of directories) {
        const manifest: string = path.join(current, 'package.json')
        if (existsSync(manifest)) {
            let declared: unknown
            try {
                declared = JSON.parse(readFileSync(manifest, 'utf8')).packageManager
            } catch {
                declared = undefined
            }
            const name: string | undefined = typeof declared === 'string' ? declared.split('@')[0] : undefined
            if (name === 'npm' || name === 'pnpm' || name === 'yarn') return name
        }
        if (existsSync(path.join(current, 'pnpm-lock.yaml')) || existsSync(path.join(current, 'pnpm-workspace.yaml'))) return 'pnpm'
        if (existsSync(path.join(current, 'yarn.lock'))) return 'yarn'
        if (existsSync(path.join(current, 'package-lock.json'))) return 'npm'
    }
    return 'npm'
}

/**
 * An argument of a command run by cmd.exe (Windows): quoted as the programs read their arguments
 * @param arg
 */
function quoted(arg: string): string {
    if (/^[\w\-.:/\\=@,+]+$/.test(arg)) return arg
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/**
 * Spawn a command: on Windows, the commands found in the PATH by their names (the package managers, the commands of npm:
 * npm.cmd, bun.cmd) are scripts, run by cmd.exe with their arguments quoted; the executables given by their paths (the
 * ones of spaces: C:\Program Files\nodejs\node.exe) are run as they are
 * @param command
 * @param args
 * @param options
 */
export function spawnCommand(command: string, args: string[], options: SpawnOptions): ChildProcess {
    if (process.platform === 'win32' && !path.isAbsolute(command)) return spawn([command, ...args].map(quoted).join(' '), {...options, shell: true})
    return spawn(command, args, options)
}

/**
 * Run a command, its output is given back
 * @param command
 * @param args
 * @param cwd
 * @return the exit code and the output
 */
export function runCommand(command: string, args: string[], cwd: string): Promise<ProcessResult> {
    return new Promise((resolve: (result: ProcessResult) => void, reject: (error: Error) => void): void => {
        const child = spawnCommand(command, args, {cwd: cwd, env: LaunchEnvironment})
        let output: string = ''
        //Piped (the default stdio)
        child.stdout!.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.stderr!.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.once('error', reject)
        child.once('close', (code: number | null): void => resolve({code: code ?? 1, output: output}))
    })
}
