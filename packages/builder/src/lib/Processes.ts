import {spawn} from 'node:child_process'

/**
 * Run a command, its output is given back
 * @param command
 * @param args
 * @param cwd
 * @return the exit code and the output
 */
export function Run(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void, reject: (error: Error) => void): void => {
        //The commands of npm (bun, from the node_modules/.bin of a project) are scripts on Windows
        const child = spawn(command, args, {cwd: cwd, shell: process.platform === 'win32'})
        let output: string = ''
        child.stdout.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.stderr.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        child.once('error', reject)
        child.once('close', (code: number | null): void => resolve({code: code ?? 1, output: output}))
    })
}
