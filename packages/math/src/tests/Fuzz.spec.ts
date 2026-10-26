import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

//The random formulas of support/Fuzz.ts, run in a child process (a crash of the addon fails the test with its case):
//a fixed seed here, LAKUTATA_MATH_FUZZ_SEED and LAKUTATA_MATH_FUZZ_ITERATIONS to change it, npm run test:fuzz for long
//runs with random seeds
const RUNNER: string = fileURLToPath(new URL('./support/FuzzRunner.js', import.meta.url))

describe('The random formulas', (): void => {

    it('are read, printed, compiled, expanded and derived consistently, without a crash', (): void => {
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-math-fuzz-'))
        const log: string = path.join(directory, 'cases.log')
        try {
            const seed: string = process.env.LAKUTATA_MATH_FUZZ_SEED ?? '20261026'
            const iterations: string = process.env.LAKUTATA_MATH_FUZZ_ITERATIONS ?? '600'
            const child = spawnSync(process.execPath, [RUNNER, '--seed', seed, '--iterations', iterations, '--log', log], {encoding: 'utf8', maxBuffer: 1 << 26})
            const lines: string[] = readFileSync(log, 'utf8').trim().split('\n')
            assert.strictEqual(child.status, 0, `the fuzzing process ended (${child.signal ?? child.status}) at the case ${lines[lines.length - 1]} of the seed ${seed}: ${child.stderr}`)
            const summary = JSON.parse(child.stdout)
            assert.deepStrictEqual(summary.failures, [], `seed ${seed}: ${JSON.stringify(summary.properties)}`)
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })
})
