import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '../../lib/core/Container.js'
import {ConsoleLogger} from '../../components/ConsoleLogger.js'

/**
 * Capture the lines written to stdout and stderr
 * @param fn
 */
async function capture(fn: () => Promise<void>): Promise<string[]> {
    const lines: string[] = []
    const out: typeof process.stdout.write = process.stdout.write
    const err: typeof process.stderr.write = process.stderr.write
    process.stdout.write = ((chunk: string): boolean => lines.push(`out ${chunk}`) > 0) as typeof process.stdout.write
    process.stderr.write = ((chunk: string): boolean => lines.push(`err ${chunk}`) > 0) as typeof process.stderr.write
    try {
        await fn()
    } finally {
        process.stdout.write = out
        process.stderr.write = err
    }
    return lines
}

describe('ConsoleLogger', (): void => {

    it('writes the enabled levels', async (): Promise<void> => {
        const container: Container = new Container()
        const logger: ConsoleLogger = await container.set(ConsoleLogger, {level: 'info'})
        const lines: string[] = await capture(async (): Promise<void> => {
            logger.debug('hidden')
            logger.info('hello %s', 'world')
            logger.warn({id: 1}, 'with object')
            logger.error(new Error('failure'))
        })
        await container.destroy()
        assert.strictEqual(lines.length, 3)
        assert.match(lines[0], /^out \[.+] INFO \(.+\): hello world\n$/)
        assert.match(lines[1], /^err \[.+] WARN \(.+\): with object \{ id: 1 }\n$/)
        assert.match(lines[2], /^err \[.+] ERROR \(.+\): Error: failure\n/)
    })
})
