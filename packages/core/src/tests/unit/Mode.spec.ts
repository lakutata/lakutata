import {afterEach, describe, it} from 'node:test'
import assert from 'node:assert'
import {ResolveMode, SetBasicInfo} from '../../lib/foundation/BasicInfo.js'

const original: NodeJS.ProcessEnv = {...process.env}

/**
 * The mode of an environment and of the options
 * @param environment
 * @param configured
 */
function Mode(environment: { MODE?: string, NODE_ENV?: string }, configured?: 'development' | 'production'): string {
    delete process.env.MODE
    delete process.env.NODE_ENV
    Object.assign(process.env, environment)
    return ResolveMode(configured)
}

describe('The mode of the application', (): void => {
    afterEach((): void => {
        process.env = {...original}
    })

    it('is the one of MODE, then of NODE_ENV, then of its options, development otherwise', (): void => {
        assert.strictEqual(Mode({}), 'development')
        assert.strictEqual(Mode({MODE: 'production'}), 'production')
        assert.strictEqual(Mode({NODE_ENV: 'production'}), 'production')
        //MODE, the variable of lakutata, before NODE_ENV
        assert.strictEqual(Mode({MODE: 'development', NODE_ENV: 'production'}), 'development')
        assert.strictEqual(Mode({MODE: ' Production ', NODE_ENV: 'development'}), 'production')
        //The environment overrides the options
        assert.strictEqual(Mode({MODE: 'production'}, 'development'), 'production')
        assert.strictEqual(Mode({NODE_ENV: 'production'}, 'development'), 'production')
        assert.strictEqual(Mode({}, 'production'), 'production')
        //The values which are not modes are left: NODE_ENV=test gives the options their mode
        assert.strictEqual(Mode({NODE_ENV: 'test'}), 'development')
        assert.strictEqual(Mode({NODE_ENV: 'test'}, 'production'), 'production')
    })

    it('warns of a MODE which is not a mode, NODE_ENV given then', async (): Promise<void> => {
        const warnings: string[] = []
        const onWarning = (warning: Error): number => warnings.push(warning.message)
        const printers: NodeJS.WarningListener[] = process.listeners('warning')
        process.removeAllListeners('warning')
        process.on('warning', onWarning)
        try {
            assert.strictEqual(Mode({MODE: 'staging', NODE_ENV: 'production'}), 'production')
        } finally {
            process.off('warning', onWarning)
            printers.forEach((printer: NodeJS.WarningListener): unknown => process.on('warning', printer))
        }
        assert.deepStrictEqual(warnings, ['The MODE environment variable "staging" is not a mode (development, production), it is ignored'])
    })

    it('is written to MODE and NODE_ENV', (): void => {
        process.env.MODE = 'development'
        process.env.NODE_ENV = 'test'
        const info = SetBasicInfo({appId: 'mode.test', appName: 'ModeTest', timezone: 'UTC', mode: 'production'})
        assert.strictEqual(info.mode, 'production')
        assert.strictEqual(process.env.MODE, 'production')
        assert.strictEqual(process.env.NODE_ENV, 'production')
    })
})
