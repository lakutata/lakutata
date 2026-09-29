import {spawn} from 'node:child_process'
import {LaunchEnvironment} from './Environment.js'

/**
 * The package managers
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

/**
 * The package manager running the tool (npx, pnpm dlx, yarn dlx), npm by default
 */
export function DetectPackageManager(): PackageManager {
    const agent: string = process.env.npm_config_user_agent ?? ''
    if (agent.startsWith('pnpm')) return 'pnpm'
    if (agent.startsWith('yarn')) return 'yarn'
    return 'npm'
}

/**
 * Run a command, its output is given back
 * @param command
 * @param args
 * @param cwd
 * @return the exit code and the output
 */
export function Run(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void, reject: (error: Error) => void): void => {
        //The package managers are scripts on Windows
        const child = spawn(command, args, {cwd: cwd, shell: process.platform === 'win32', env: LaunchEnvironment})
        let output: string = ''
        child.stdout.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.stderr.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.once('error', reject)
        child.once('close', (code: number | null): void => resolve({code: code ?? 1, output: output}))
    })
}
