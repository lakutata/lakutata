import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, spawnSync, type SpawnSyncReturns} from 'node:child_process'
import path from 'node:path'

/**
 * The directory of the package
 */
const PACKAGE_DIRECTORY: string = path.resolve(import.meta.dirname, '../../../..')

/**
 * The classes of the applications of the tests: loggers keeping their messages, and a component
 */
const CLASSES: string = `
import {Application, Component} from '@lakutata/core'
class MemoryLogger extends Component {
    messages = []
    error(message) { this.messages.push(message) }
    warn(message) { this.messages.push(message) }
    info(message) { this.messages.push(message) }
    debug(message) { this.messages.push(message) }
    trace(message) { this.messages.push(message) }
}
class OtherLogger extends MemoryLogger {}
class Service extends Component {}
const bootstrapped = []
`

/**
 * Run an application in a new process (one application per process): the script presets and runs it, and its launched
 * handler prints the result
 * @param script
 */
function RunApplication(script: string): { status: number | null, result: any, output: string } {
    const run: SpawnSyncReturns<string> = spawnSync(process.execPath, ['--input-type=module', '-e', CLASSES + script], {
        cwd: PACKAGE_DIRECTORY,
        encoding: 'utf8',
        timeout: 30000
    })
    const line: string | undefined = run.stdout.split('\n').find((text: string): boolean => text.startsWith('RESULT '))
    return {status: run.status, result: line ? JSON.parse(line.slice('RESULT '.length)) : undefined, output: run.stdout + run.stderr}
}

/**
 * The launched handler printing the result of an application and exiting
 */
const PRINT: string = `
.onLaunched(async (app, logger) => {
    const has = async (name) => app.getObject(name).then(() => true, () => false)
    console.log('RESULT ' + JSON.stringify({
        identity: [Application.appId, Application.appName],
        logger: logger.constructor.name,
        log: await has('log') ? (await app.getObject('log')).constructor.name : null,
        service: await has('service'),
        bootstrapped: bootstrapped
    }))
    app.exit(0)
})`

describe('The applications', (): void => {

    it('have no preset object: they log to the console without "log" component', (): void => {
        const {status, result, output} = RunApplication(`Application.run({id: 'test', name: 'Test'})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {identity: ['test', 'Test'], logger: 'ConsoleLogger', log: null, service: false, bootstrapped: []})
    })

    it('load the preset objects, and run the preset bootstrap first', (): void => {
        const {status, result, output} = RunApplication(`
Application.preset({
    components: {log: {class: MemoryLogger}, service: {class: Service}},
    bootstrap: ['log', async () => bootstrapped.push('preset')]
})
Application.run({id: 'test', name: 'Test', bootstrap: [async () => bootstrapped.push('run')]})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {identity: ['test', 'Test'], logger: 'MemoryLogger', log: 'MemoryLogger', service: true, bootstrapped: ['preset', 'run']})
    })

    it('replace the preset objects by the objects of the same name given to run, or add their options', (): void => {
        const {status, result, output} = RunApplication(`
Application.preset({components: {log: {class: MemoryLogger}, service: {class: Service}}})
Application.run({id: 'test', name: 'Test', components: {log: {class: OtherLogger}, service: {}}})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {identity: ['test', 'Test'], logger: 'OtherLogger', log: 'OtherLogger', service: true, bootstrapped: []})
    })

    it('call launched() once the application has launched, right after the initialization of the objects created then, not for the objects destroyed before', (): void => {
        const {status, result, output} = RunApplication(`
const order = []
class Early extends Component { async launched() { order.push('early launched') } }
class Late extends Component { async launched() { order.push('late launched') } }
class Gone extends Component { async launched() { order.push('gone launched') } }
Application.run({
    id: 'test', name: 'Test',
    components: {early: {class: Early}, late: {class: Late}, gone: {class: Gone}},
    bootstrap: ['early', async (app) => {
        await (await app.getObject('gone')).dispose()
        order.push('bootstrap done')
    }]
}).onLaunched(async (app) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    order.push('get late')
    await app.getObject('late')
    await new Promise((resolve) => setTimeout(resolve, 20))
    console.log('RESULT ' + JSON.stringify(order))
    app.exit(0)
})`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, ['bootstrap done', 'early launched', 'get late', 'late launched'])
    })

    it('add each preset to the previous ones', (): void => {
        const {status, result, output} = RunApplication(`
const first = async () => bootstrapped.push('first')
Application.preset({components: {log: {class: MemoryLogger}}, bootstrap: [first]})
Application.preset({components: {log: {class: OtherLogger}, service: {class: Service}}, bootstrap: [first, async () => bootstrapped.push('second')]})
Application.run({id: 'test', name: 'Test'})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {identity: ['test', 'Test'], logger: 'OtherLogger', log: 'OtherLogger', service: true, bootstrapped: ['first', 'second']})
    })

    describe('failing to launch', (): void => {
        /**
         * An application whose component kept alive is created, then its component failing
         */
        const FAILING: string = `
class Keeper extends Component {
    async init() { this.timer = setInterval(() => undefined, 1000) }
}
class Failing extends Component {
    async init() { throw new Error('the database is down') }
}
const application = Application.run({
    id: 'failing.app',
    name: 'FailingApp',
    components: {keeper: {class: Keeper}, failing: {class: Failing}},
    bootstrap: ['keeper', 'failing']
})`

        it('exit with the code 1 without handler, the error logged, though objects keep the process alive', (): void => {
            const run = RunApplication(FAILING)
            assert.strictEqual(run.status, 1, run.output)
            assert.match(run.output, /FatalException/)
            assert.match(run.output, /the database is down/)
        })

        it('exit with the code of the handler, 1 when it gives none', (): void => {
            assert.strictEqual(RunApplication(`${FAILING}.onFatalException(() => 3)`).status, 3)
            const handled = RunApplication(`${FAILING}.onFatalException((error, logger) => console.log('HANDLED ' + error.message))`)
            assert.strictEqual(handled.status, 1, handled.output)
            assert.match(handled.output, /HANDLED the database is down/)
        })
    })

    describe('ending on the signals', (): void => {
        /**
         * Start an application in a new process; once it printed READY (or once it started when its launch is
         * awaited), send it the signals, one by one
         * @param script
         * @param signals
         * @param ready the line telling when to send the signals
         */
        function Signal(script: string, signals: NodeJS.Signals[], ready: string = 'READY'): Promise<{ code: number | null, signal: NodeJS.Signals | null, output: string }> {
            return new Promise((resolve): void => {
                const child = spawn(process.execPath, ['--input-type=module', '-e', CLASSES + script], {cwd: PACKAGE_DIRECTORY})
                let output: string = ''
                let sent: boolean = false
                const timeout: NodeJS.Timeout = setTimeout((): unknown => child.kill('SIGKILL'), 20000)
                const read = (chunk: Buffer): void => {
                    output += chunk.toString()
                    if (sent || !output.includes(ready)) return
                    sent = true
                    signals.forEach((signal: NodeJS.Signals, index: number): unknown => setTimeout((): unknown => child.kill(signal), index * 200))
                }
                child.stdout.on('data', read)
                child.stderr.on('data', read)
                child.once('close', (code: number | null, signal: NodeJS.Signals | null): void => {
                    clearTimeout(timeout)
                    resolve({code: code, signal: signal, output: output})
                })
            })
        }

        /**
         * An application kept alive, its component telling its destruction (hanging when asked), done when it ends
         * @param options the options of the application
         * @param hang the destruction of the component never ends
         */
        const APPLICATION = (options: string = '', hang: boolean = false): string => `
class Keeper extends Component {
    async init() { this.timer = setInterval(() => undefined, 1000) }
    async destroy() {
        console.log('DESTROYED keeper')
        //Hanging, the process kept alive by its timer
        ${hang ? 'await new Promise(() => undefined)' : 'clearInterval(this.timer)'}
    }
}
Application.run({id: 'signals.app', name: 'SignalsApp', components: {keeper: {class: Keeper}}, bootstrap: ['keeper']${options}})
    .onLaunched(() => console.log('READY'))
    .onDone(() => console.log('DONE'))`

        it('end gracefully on SIGTERM and SIGINT: the objects destroyed, done, the code 0', async (): Promise<void> => {
            for (const signal of ['SIGTERM', 'SIGINT'] as NodeJS.Signals[]) {
                const run = await Signal(APPLICATION(), [signal])
                assert.strictEqual(run.code, 0, `${signal}: ${run.output}`)
                assert.match(run.output, /DONE[\s\S]*DESTROYED keeper/, signal)
            }
        })

        it('end at once on a second signal, the shutdown hanging, with the code 128 + the number of the signal', async (): Promise<void> => {
            const run = await Signal(APPLICATION('', true), ['SIGTERM', 'SIGTERM'])
            assert.strictEqual(run.code, 143, run.output)
            assert.match(run.output, /DESTROYED keeper/)
            assert.strictEqual((await Signal(APPLICATION('', true), ['SIGINT', 'SIGINT'])).code, 130)
        })

        it('end at once on a signal received while the application launches', async (): Promise<void> => {
            const run = await Signal(`
class Slow extends Component {
    async init() {
        console.log('LAUNCHING')
        await new Promise((resolve) => setTimeout(resolve, 10000))
    }
}
Application.run({id: 'signals.app', name: 'SignalsApp', components: {slow: {class: Slow}}, bootstrap: ['slow']}).onLaunched(() => console.log('READY'))`, ['SIGTERM'], 'LAUNCHING')
            assert.strictEqual(run.code, 143, run.output)
            assert.doesNotMatch(run.output, /READY/)
        })

        it('listen to the signals given, or to none', async (): Promise<void> => {
            const custom = await Signal(APPLICATION(`, shutdownSignals: ['SIGUSR2']`), ['SIGUSR2'])
            assert.strictEqual(custom.code, 0, custom.output)
            assert.match(custom.output, /DONE/)
            //Not listened: Node.js ends the process at once, nothing destroyed
            const none = await Signal(APPLICATION(', shutdownSignals: false'), ['SIGTERM'])
            assert.strictEqual(none.signal, 'SIGTERM', none.output)
            assert.doesNotMatch(none.output, /DESTROYED|DONE/)
            //The signals which cannot be caught are rejected
            const invalid = RunApplication(`Application.run({id: 'signals.app', name: 'SignalsApp', shutdownSignals: ['SIGKILL']})`)
            assert.strictEqual(invalid.status, 1, invalid.output)
            assert.match(invalid.output, /shutdownSignals/)
        })
    })
})
