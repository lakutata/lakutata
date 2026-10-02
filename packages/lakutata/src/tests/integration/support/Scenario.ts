import {createServer, type AddressInfo, type Server} from 'node:net'
import {Writable} from 'node:stream'
import type {Application} from '../../../exports/Lakutata.js'

/**
 * The prefix of the lines telling the result of a check, read by the runner of the scenarios (Integration.spec)
 */
export const CHECK_PREFIX: string = 'CHECK '

/**
 * The result of a check of a scenario
 */
export type CheckResult = {
    name: string
    ok: boolean
    error?: string
}

/**
 * A check of a scenario: its failure is told, the next checks run
 */
export type Check = (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>

/**
 * Run the checks of a scenario on its application launched, tell their results, then exit the application (the
 * code 1 when a check failed): an application runs once per process, its scenario is a script run by Integration.spec
 * @param app
 * @param checks
 * @param end how the application ends once its checks passed (it exits with the code 0 by default; an Electron
 * application ends with its window)
 */
export async function RunChecks(app: Application, checks: (check: Check) => Promise<void>, end: () => unknown = (): void => app.exit(0)): Promise<void> {
    let failed: boolean = false
    const tell = (result: CheckResult): void => {
        if (!result.ok) failed = true
        process.stdout.write(`${CHECK_PREFIX}${JSON.stringify(result)}\n`)
    }
    const check: Check = async (name: string, fn: () => unknown | Promise<unknown>): Promise<void> => {
        try {
            await fn()
            tell({name: name, ok: true})
        } catch (error) {
            tell({name: name, ok: false, error: (error as Error)?.stack ?? String(error)})
        }
    }
    try {
        await checks(check)
    } catch (error) {
        tell({name: 'the scenario runs to its end', ok: false, error: (error as Error)?.stack ?? String(error)})
    }
    if (failed) return app.exit(1)
    end()
}

/**
 * A free port of the loopback interface
 */
export function FreePort(): Promise<number> {
    return new Promise((resolve: (port: number) => void, reject: (error: Error) => void): void => {
        const server: Server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', (): void => {
            const port: number = (server.address() as AddressInfo).port
            server.close((): void => resolve(port))
        })
    })
}

/**
 * A stream keeping what is written into it
 */
export class MemoryStream extends Writable {
    public readonly chunks: string[] = []

    public override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
        this.chunks.push(chunk.toString())
        callback()
    }

    /**
     * What was written
     */
    public text(): string {
        return this.chunks.join('')
    }
}
