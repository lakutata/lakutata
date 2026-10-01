import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
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
        assert.deepStrictEqual(result, {logger: 'ConsoleLogger', log: null, service: false, bootstrapped: []})
    })

    it('load the preset objects, and run the preset bootstrap first', (): void => {
        const {status, result, output} = RunApplication(`
Application.preset({
    components: {log: {class: MemoryLogger}, service: {class: Service}},
    bootstrap: ['log', async () => bootstrapped.push('preset')]
})
Application.run({id: 'test', name: 'Test', bootstrap: [async () => bootstrapped.push('run')]})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {logger: 'MemoryLogger', log: 'MemoryLogger', service: true, bootstrapped: ['preset', 'run']})
    })

    it('replace the preset objects by the objects of the same name given to run, or add their options', (): void => {
        const {status, result, output} = RunApplication(`
Application.preset({components: {log: {class: MemoryLogger}, service: {class: Service}}})
Application.run({id: 'test', name: 'Test', components: {log: {class: OtherLogger}, service: {}}})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {logger: 'OtherLogger', log: 'OtherLogger', service: true, bootstrapped: []})
    })

    it('add each preset to the previous ones', (): void => {
        const {status, result, output} = RunApplication(`
const first = async () => bootstrapped.push('first')
Application.preset({components: {log: {class: MemoryLogger}}, bootstrap: [first]})
Application.preset({components: {log: {class: OtherLogger}, service: {class: Service}}, bootstrap: [first, async () => bootstrapped.push('second')]})
Application.run({id: 'test', name: 'Test'})${PRINT}`)
        assert.strictEqual(status, 0, output)
        assert.deepStrictEqual(result, {logger: 'OtherLogger', log: 'OtherLogger', service: true, bootstrapped: ['first', 'second']})
    })
})
