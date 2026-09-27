import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

//The logger writes to the file descriptors of its destinations, so it runs in a child process
const SCRIPT: string = `
import {Container} from '@lakutata/core'
import {Logger} from '${new URL('../exports/Logger.js', import.meta.url).href}'
const container = new Container()
const logger = await container.set(Logger, {level: 'info', sync: true, colorize: false})
logger.debug('hidden')
logger.info('hello %s', 'world')
logger.error(new Error('failure'), 'with error')
await container.destroy()
`

describe('Logger', (): void => {

    it('writes the enabled levels', (): void => {
        const output: string = execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8'})
        assert.ok(!output.includes('hidden'))
        assert.match(output, /INFO \(Unknown\/\d+\): hello world/)
        assert.match(output, /ERROR \(Unknown\/\d+\): with error/)
        assert.match(output, /Error: failure/)
    })
})
