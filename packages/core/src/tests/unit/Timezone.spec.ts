import {describe, it} from 'node:test'
import assert from 'node:assert'
import {ValidateTimezone} from '../../lib/foundation/BasicInfo.js'

/**
 * The warnings emitted while a function runs
 * @param run
 */
async function Warnings(run: () => void): Promise<string[]> {
    const warnings: string[] = []
    const listener = (warning: Error): unknown => warnings.push(warning.message)
    process.on('warning', listener)
    try {
        run()
        //The warnings are emitted on the next tick
        await new Promise((resolve: (value: unknown) => void): unknown => setImmediate(resolve))
    } finally {
        process.off('warning', listener)
    }
    return warnings
}

describe('The time zone of the application', (): void => {

    it('accepts the canonical time zones and their aliases (the default one of the containers is "UTC")', async (): Promise<void> => {
        for (const timezone of ['UTC', 'Etc/UTC', 'Etc/GMT+8', 'Asia/Shanghai', 'US/Eastern', 'asia/shanghai']) {
            const warnings: string[] = await Warnings((): unknown => assert.strictEqual(ValidateTimezone(timezone), timezone))
            assert.deepStrictEqual(warnings, [], timezone)
        }
    })

    it('replaces an unknown time zone by the default one, with a warning', async (): Promise<void> => {
        const warnings: string[] = await Warnings((): unknown => assert.strictEqual(ValidateTimezone('Mars/Olympus'), Intl.DateTimeFormat().resolvedOptions().timeZone))
        assert.strictEqual(warnings.length, 1)
        assert.match(warnings[0], /"Mars\/Olympus" is invalid/)
    })
})
