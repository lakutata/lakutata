import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {PassThrough} from 'node:stream'
import {Container} from '@lakutata/core'
import {Logger} from '../exports/Logger.js'

/**
 * Run a script logging to stdout in a child process, return its output
 * @param body
 */
function RunChild(body: string): string {
    const script: string = `
import {Container} from '@lakutata/core'
import {Logger} from '${new URL('../exports/Logger.js', import.meta.url).href}'
${body}
`
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8'})
}

/**
 * A destination collecting its text
 */
function Collector(): { stream: PassThrough, text: () => string } {
    const stream: PassThrough = new PassThrough()
    let text: string = ''
    stream.on('data', (chunk: Buffer): unknown => text += chunk.toString())
    return {stream: stream, text: (): string => text}
}

describe('Logger', (): void => {

    it('writes the enabled levels to stdout', (): void => {
        const output: string = RunChild(`
const container = new Container()
const logger = await container.set(Logger, {level: 'info', colorize: false})
logger.debug('hidden')
logger.info('hello %s', 'world')
logger.error(new Error('failure'), 'with error')
await container.destroy()`)
        assert.ok(!output.includes('hidden'))
        assert.match(output, /^\[\d\d:\d\d:\d\d\.\d{3}] INFO \(Unknown\/\d+\): hello world\n/)
        assert.match(output, /ERROR \(Unknown\/\d+\): with error\n {4}err: \{\n {6}"type": "Error",/)
    })

    it('writes the buffered lines when the process exits', (): void => {
        const output: string = RunChild(`
const logger = await new Container().set(Logger, {colorize: false})
for (let index = 0; index < 1000; index++) logger.info('line %d', index)
process.exit(0)`)
        assert.strictEqual(output.split('\n').filter(Boolean).length, 1000)
        assert.match(output, /line 999\n$/)
    })

    it('writes to its destinations', async (): Promise<void> => {
        const pretty = Collector()
        const json = Collector()
        const container: Container = new Container()
        const logger: Logger = await container.set(Logger, {destinations: [pretty.stream]})
        const jsonLogger: Logger = await new Container().set(Logger, {pretty: false, level: 'warn', destinations: [json.stream]})
        logger.trace({id: 1}, 'traced')
        jsonLogger.info('hidden')
        jsonLogger.warn({id: 2}, 'warned')
        await container.destroy()
        jsonLogger.flush()
        //Only stdout is colored
        assert.match(pretty.text(), /^\[\d\d:\d\d:\d\d\.\d{3}] TRACE \(Unknown\/\d+\): traced\n {4}id: 1\n$/)
        const line: Record<string, unknown> = JSON.parse(json.text())
        assert.deepStrictEqual({...line, time: 0, pid: 0, hostname: ''}, {level: 40, time: 0, pid: 0, hostname: '', name: 'Unknown', id: 2, msg: 'warned'})
    })

    it('writes synchronously', async (): Promise<void> => {
        const destination = Collector()
        const logger: Logger = await new Container().set(Logger, {sync: true, destinations: [destination.stream]})
        logger.info('now')
        await new Promise((resolve: (value: unknown) => void): unknown => process.nextTick(resolve))
        assert.match(destination.text(), /INFO .*: now\n$/)
    })
})
