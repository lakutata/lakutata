import {describe, it} from 'node:test'
import assert from 'node:assert'
import {MutexDriverNotFoundException} from '../exports/Mutex.js'
import {loadDriver} from '../mutex/lib/LoadDriver.js'

describe('The client packages of the drivers', (): void => {

    it('are loaded by their names written out', async (): Promise<void> => {
        const pg: { Pool?: unknown } = await loadDriver('Pool', 'pg')
        assert.strictEqual(typeof pg.Pool, 'function')
    })

    it('report a package missing, told to install it, or to bundle again a bundled application', async (): Promise<void> => {
        await assert.rejects(loadDriver('createClient', 'lakutata-missing-driver'), (error: Error): boolean => error instanceof MutexDriverNotFoundException && error.message.includes('npm install lakutata-missing-driver') && error.cause !== undefined)
        const packaged: symbol = Symbol.for('lakutata.packaged')
        ;(globalThis as Record<symbol, unknown>)[packaged] = {resources: (): string => '/resources'}
        try {
            await assert.rejects(loadDriver('createClient', 'lakutata-missing-driver'), (error: Error): boolean => error instanceof MutexDriverNotFoundException && error.message.includes('not installed when the application was bundled'))
        } finally {
            delete (globalThis as Record<symbol, unknown>)[packaged]
        }
    })
})
