import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {PassThrough} from 'node:stream'
import {IncomingMessage, ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {Container} from '@lakutata/core'
import {Logger} from '../exports/Logger.js'

/**
 * Run a script logging to stdout in a child process, return its output
 * @param body
 */
function runChild(body: string): string {
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
function collector(): { stream: PassThrough, text: () => string } {
    const stream: PassThrough = new PassThrough()
    let text: string = ''
    stream.on('data', (chunk: Buffer): unknown => text += chunk.toString())
    return {stream: stream, text: (): string => text}
}

describe('Logger', (): void => {

    it('writes the enabled levels to stdout', (): void => {
        const output: string = runChild(`
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

    it('loads where SharedArrayBuffer is missing (a preload script of Electron requiring the framework)', (): void => {
        //Required as the preload scripts do (an import of node:fs by Node.js itself needs SharedArrayBuffer)
        const output: string = execFileSync(process.execPath, ['--input-type=commonjs', '-e', `
delete globalThis.SharedArrayBuffer
const {PassThrough} = require('node:stream')
const {Destination} = require(${JSON.stringify(fileURLToPath(new URL('../../cjs/lib/Destination.js', import.meta.url)))})
const stream = new PassThrough()
let text = ''
stream.on('data', (chunk) => text += chunk)
new Destination(stream, true).write('without shared memory')
console.log(text)
`], {cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8'})
        assert.match(output, /without shared memory/)
    })

    it('writes the buffered lines when the process exits', (): void => {
        const output: string = runChild(`
const logger = await new Container().set(Logger, {colorize: false})
for (let index = 0; index < 1000; index++) logger.info('line %d', index)
process.exit(0)`)
        assert.strictEqual(output.split('\n').filter(Boolean).length, 1000)
        assert.match(output, /line 999\n$/)
    })

    it('writes to its destinations', async (): Promise<void> => {
        const pretty = collector()
        const json = collector()
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
        const destination = collector()
        const logger: Logger = await new Container().set(Logger, {sync: true, destinations: [destination.stream]})
        logger.info('now')
        await new Promise((resolve: (value: unknown) => void): unknown => process.nextTick(resolve))
        assert.match(destination.text(), /INFO .*: now\n$/)
    })

    it('writes the message of a cause once when the error wrapping it has the same message', async (): Promise<void> => {
        const json = collector()
        const logger: Logger = await new Container().set(Logger, {pretty: false, destinations: [json.stream]})
        const validation: Error = new Error('"level" must be a string')
        const wrapped: Error = new Error('"level" must be a string', {cause: validation})
        logger.error(new Error('UncaughtException', {cause: wrapped}))
        logger.error(new Error('outer', {cause: new Error('inner', {cause: new Error('inner')})}))
        logger.flush()
        const lines: Record<string, any>[] = json.text().split('\n').filter(Boolean).map((line: string): Record<string, any> => JSON.parse(line))
        assert.strictEqual(lines[0].err.message, 'UncaughtException: "level" must be a string')
        assert.strictEqual(lines[1].err.message, 'outer: inner')
        //The stacks keep the causes
        assert.strictEqual(lines[0].err.stack.split('caused by: ').length, 3)
    })
    it('logs the fatal errors above the errors, at once', async (): Promise<void> => {
        const json = collector()
        const container: Container = new Container()
        const fatalOnly: Logger = await container.set(Logger, {level: 'fatal', pretty: false, destinations: [json.stream]})
        fatalOnly.error('hidden')
        fatalOnly.fatal({code: 3}, 'shutting down after %s', 'a failure')
        //Written without a flush, before the buffered lines (the next turn of the event loop); the stream emits it on
        //the next tick
        await new Promise((resolve: (value: unknown) => void): unknown => process.nextTick(resolve))
        const lines: Record<string, any>[] = json.text().split('\n').filter(Boolean).map((line: string): Record<string, any> => JSON.parse(line))
        assert.deepStrictEqual(lines.map((line: Record<string, any>): unknown[] => [line.level, line.code, line.msg]), [[60, 3, 'shutting down after a failure']])
        const silent = collector()
        const silentLogger: Logger = await new Container().set(Logger, {level: 'silent', destinations: [silent.stream]})
        silentLogger.fatal(new Error('lost'))
        silentLogger.flush()
        assert.strictEqual(silent.text(), '')
        const pretty = collector()
        const prettyLogger: Logger = await new Container().set(Logger, {destinations: [pretty.stream]})
        prettyLogger.fatal(new Error('crash'))
        await new Promise((resolve: (value: unknown) => void): unknown => process.nextTick(resolve))
        assert.match(pretty.text(), /FATAL \(Unknown\/\d+\): crash\n/)
        await container.destroy()
    })

    it('redacts the credential headers of the requests and the responses', async (): Promise<void> => {
        const request: IncomingMessage = new IncomingMessage(new Socket())
        request.method = 'GET'
        request.url = '/orders'
        request.headers = {'authorization': 'Bearer secret', 'cookie': 'session=secret', 'proxy-authorization': 'Basic secret', 'x-api-key': 'key', 'accept': '*/*'}
        const response: ServerResponse = new ServerResponse(request)
        response.setHeader('Set-Cookie', 'session=secret')
        response.setHeader('Content-Type', 'text/plain')
        const logged = async (options: Record<string, unknown>): Promise<Record<string, any>[]> => {
            const json = collector()
            const logger: Logger = await new Container().set(Logger, {pretty: false, destinations: [json.stream], ...options})
            logger.info(request, 'request')
            logger.info(response, 'response')
            logger.flush()
            return json.text().split('\n').filter(Boolean).map((line: string): Record<string, any> => JSON.parse(line))
        }
        const [requestLine, responseLine] = await logged({})
        assert.deepStrictEqual(requestLine.req.headers, {'authorization': '[Redacted]', 'cookie': '[Redacted]', 'proxy-authorization': '[Redacted]', 'x-api-key': 'key', 'accept': '*/*'})
        assert.deepStrictEqual(responseLine.res.headers, {'set-cookie': '[Redacted]', 'content-type': 'text/plain'})
        //The headers themselves are not changed
        assert.strictEqual(request.headers.authorization, 'Bearer secret')
        assert.strictEqual(response.getHeader('set-cookie'), 'session=secret')
        //Other headers, case-insensitive; none
        assert.deepStrictEqual((await logged({redactedHeaders: ['Authorization', 'X-API-Key']}))[0].req.headers, {'authorization': '[Redacted]', 'cookie': 'session=secret', 'proxy-authorization': 'Basic secret', 'x-api-key': '[Redacted]', 'accept': '*/*'})
        assert.strictEqual((await logged({redactedHeaders: []}))[1].res.headers['set-cookie'], 'session=secret')
    })
})
