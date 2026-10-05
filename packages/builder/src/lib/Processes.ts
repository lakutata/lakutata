import {type ChildProcess, spawn, type SpawnOptions} from 'node:child_process'
import path from 'node:path'

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
export function runCommand(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void, reject: (error: Error) => void): void => {
        const child = spawnCommand(command, args, {cwd: cwd})
        let output: string = ''
        //Piped (the default stdio)
        child.stdout!.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.stderr!.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.once('error', reject)
        child.once('close', (code: number | null): void => resolve({code: code ?? 1, output: output}))
    })
}
