import os from 'node:os'
import {LaunchEnvironment} from '../Environment.js'
import {SpawnCommand} from '../Processes.js'
import {Styled, Warn} from '../Output.js'
import {MatchName, type Workspace, type WorkspacePackage} from './Workspace.js'

export type RunOptions = {
    /**
     * How many packages run at a time, the number of the processors by default
     */
    concurrency?: number
    /**
     * Stop at the first failure, true by default
     */
    bail?: boolean
    /**
     * Run all the packages at once, without waiting for their dependencies: the long-running scripts (dev servers, watchers)
     */
    parallel?: boolean
    /**
     * The names of the packages run (with "*" wildcards), all by default
     */
    scope?: string[]
    /**
     * The arguments given to the script
     */
    args?: string[]
}

export type RunResult = {
    ran: string[]
    skipped: string[]
    failed: string[]
}

const COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'] as const

/**
 * Run a script of a package, its output prefixed with the name of the package
 * @param pkg
 * @param script
 * @param args
 * @param prefix
 */
function RunPackageScript(pkg: WorkspacePackage, script: string, args: string[], prefix: string): Promise<number> {
    return new Promise((resolve: (code: number) => void): void => {
        const child = SpawnCommand('npm', ['run', script, ...(args.length ? ['--', ...args] : [])], {cwd: pkg.directory, env: LaunchEnvironment})
        const forward = (stream: NodeJS.ReadableStream, target: NodeJS.WritableStream): void => {
            let pending: string = ''
            stream.on('data', (chunk: Buffer): void => {
                const lines: string[] = (pending + chunk.toString()).split('\n')
                pending = lines.pop()!
                for (const line of lines) target.write(`${prefix} ${line}\n`)
            })
            stream.on('end', (): void => {
                if (pending) target.write(`${prefix} ${pending}\n`)
            })
        }
        //Piped (the default stdio)
        forward(child.stdout!, process.stdout)
        forward(child.stderr!, process.stderr)
        child.once('error', (error: Error): void => {
            process.stderr.write(`${prefix} ${error.message}\n`)
            resolve(1)
        })
        child.once('close', (code: number | null): void => resolve(code ?? 1))
    })
}

/**
 * Run a script in the packages of a workspace having it: a package runs once the packages it depends on ran,
 * the packages independent of each other run at the same time
 * @param workspace
 * @param script
 * @param options
 */
export async function RunScript(workspace: Workspace, script: string, options: RunOptions = {}): Promise<RunResult> {
    const inScope = (pkg: WorkspacePackage): boolean => !options.scope?.length || options.scope.some((pattern: string): boolean => MatchName(pkg.name, pattern))
    const selected: WorkspacePackage[] = workspace.packages.filter((pkg: WorkspacePackage): boolean => inScope(pkg) && !!pkg.scripts[script])
    const skipped: string[] = workspace.packages.filter((pkg: WorkspacePackage): boolean => inScope(pkg) && !pkg.scripts[script]).map((pkg: WorkspacePackage): string => pkg.name)
    const selectedNames: Set<string> = new Set(selected.map((pkg: WorkspacePackage): string => pkg.name))
    if (!options.parallel) for (const cycle of workspace.cycles()) Warn(`The packages depend on each other: ${cycle.join(' → ')}, they run in the order of their names`)
    //The selected packages each one waits for (through the packages without the script too); the cycles are broken by name
    const waitsFor: Map<string, Set<string>> = new Map(selected.map((pkg: WorkspacePackage): [string, Set<string>] => {
        if (options.parallel) return [pkg.name, new Set()]
        const dependencies: Set<string> = new Set([...workspace.transitiveDependencies(pkg)].filter((name: string): boolean => selectedNames.has(name)))
        for (const name of dependencies) if (workspace.transitiveDependencies(workspace.get(name)!).has(pkg.name) && name > pkg.name) dependencies.delete(name)
        return [pkg.name, dependencies]
    }))
    const concurrency: number = options.parallel ? Math.max(1, selected.length) : Math.max(1, options.concurrency ?? os.availableParallelism())
    const width: number = Math.max(0, ...selected.map((pkg: WorkspacePackage): number => pkg.name.length))
    const done: Set<string> = new Set()
    //The packages depending on a failed package, not run
    const blocked: Set<string> = new Set()
    const failed: string[] = []
    const ran: string[] = []
    const running: Map<string, Promise<void>> = new Map()
    let stopped: boolean = false
    while (true) {
        if (!stopped) {
            for (const pkg of selected) {
                if (running.size >= concurrency) break
                if (done.has(pkg.name) || blocked.has(pkg.name) || running.has(pkg.name) || failed.includes(pkg.name)) continue
                if (![...waitsFor.get(pkg.name)!].every((name: string): boolean => done.has(name))) continue
                const prefix: string = Styled(COLORS[selected.indexOf(pkg) % COLORS.length], `${pkg.name.padEnd(width)} │`)
                running.set(pkg.name, RunPackageScript(pkg, script, options.args ?? [], prefix).then((code: number): void => {
                    running.delete(pkg.name)
                    if (code === 0) {
                        done.add(pkg.name)
                        ran.push(pkg.name)
                    } else {
                        failed.push(pkg.name)
                        if (options.bail !== false) stopped = true
                        //The packages depending on a failed package do not run
                        else for (const other of selected) if (waitsFor.get(other.name)!.has(pkg.name)) blocked.add(other.name)
                    }
                }))
            }
        }
        if (!running.size) break
        await Promise.race(running.values())
    }
    const notRun: string[] = selected.map((pkg: WorkspacePackage): string => pkg.name).filter((name: string): boolean => !ran.includes(name) && !failed.includes(name))
    if (failed.length) throw new Error(`${script} failed in ${failed.join(', ')}${notRun.length ? `, not run in ${notRun.join(', ')}` : ''}`)
    return {ran: ran, skipped: skipped, failed: failed}
}
