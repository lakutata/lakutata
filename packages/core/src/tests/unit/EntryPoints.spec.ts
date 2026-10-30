import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The directory of the package
 */
const PACKAGE_DIRECTORY: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

/**
 * The entry points of the package: its subpaths of modules (the files exported as they are, package.json and
 * tsconfig.json, are not)
 */
const ENTRY_POINTS: string[] = Object.entries(JSON.parse(readFileSync(path.join(PACKAGE_DIRECTORY, 'package.json'), 'utf8')).exports)
    .filter(([, target]: [string, unknown]): boolean => typeof target === 'object')
    .map(([subpath]: [string, unknown]): string => subpath)
    .map((subpath: string): string => subpath === '.' ? '@lakutata/core' : `@lakutata/core/${subpath.slice(2)}`)

/**
 * Load an entry point first, in a new process: the cycles of the modules of the package must not break it, whatever
 * module is loaded first
 * @param entryPoint
 * @param format
 */
function loadFirst(entryPoint: string, format: 'esm' | 'cjs'): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, format === 'esm'
        ? ['--input-type=module', '-e', `await import('${entryPoint}')`]
        : ['--input-type=commonjs', '-e', `require('${entryPoint}')`], {cwd: PACKAGE_DIRECTORY, encoding: 'utf8'})
}

describe('The entry points', (): void => {

    it('are listed', (): void => {
        assert.ok(ENTRY_POINTS.includes('@lakutata/core') && ENTRY_POINTS.includes('@lakutata/core/decorator/di'))
    })

    for (const entryPoint of ENTRY_POINTS) {
        for (const format of ['esm', 'cjs'] as const) {
            it(`loads ${entryPoint} first (${format})`, (): void => {
                const result: SpawnSyncReturns<string> = loadFirst(entryPoint, format)
                assert.strictEqual(result.status, 0, result.stderr)
            })
        }
    }
})
