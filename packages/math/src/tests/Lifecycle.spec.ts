import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {isMainThread, parentPort, Worker, workerData} from 'node:worker_threads'
import {createMath, MathCancelledException, type MathScope, MathTimeoutException} from '../exports/Math.js'

const FILE: string = fileURLToPath(import.meta.url)

//The operations of the worker threads and of the child processes of the tests: started, never awaited
async function startOperations(): Promise<void> {
    const math: MathScope = createMath()
    for (let index: number = 0; index < 16; index++) {
        math.expression('(x + y + z + w + 1)^12').expandAsync().catch((): void => undefined)
        math.expression('pi').toDecimalAsync(20000).catch((): void => undefined)
    }
}

if (!isMainThread && workerData === 'operations') {
    await startOperations()
    parentPort!.postMessage('started')
} else if (process.env.LAKUTATA_MATH_EXIT_TEST) {
    await startOperations()
    setTimeout((): never => process.exit(0), Number(process.env.LAKUTATA_MATH_EXIT_TEST))
} else {
    describe('The asynchronous operations', (): void => {

        //(Bun 1.4 ends the process with a fatal error of Node-API there: it calls the thread-safe functions of a worker it
        //terminates, whose calls of Node-API fail)
        it('are dropped with a worker thread terminated while they run', {skip: process.versions.bun ? 'Bun ends the process there' : false}, async (): Promise<void> => {
            for (let round: number = 0; round < 10; round++) {
                const worker: Worker = new Worker(FILE, {workerData: 'operations'})
                await new Promise((resolve: (value: unknown) => void): unknown => worker.once('message', resolve))
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, round * 3))
                await worker.terminate()
            }
            const math: MathScope = createMath()
            assert.strictEqual((await math.expression('(x + 1)^2').expandAsync()).toString(), 'x^2 + 2x + 1')
        })

        it('do not crash the process exiting while they run', (): void => {
            for (let round: number = 0; round < 12; round++) {
                const child = spawnSync(process.execPath, [FILE], {env: {...process.env, LAKUTATA_MATH_EXIT_TEST: String(1 + round % 6)}, encoding: 'utf8'})
                assert.strictEqual(child.status, 0, `round ${round}: ${child.signal ?? ''} ${child.stderr}`)
            }
        })

        it('are rejected at their time limit, their threads stopped in the expansions of SymEngine', async (): Promise<void> => {
            const math: MathScope = createMath()
            const started: number = Date.now()
            await assert.rejects(math.expression('(x + y + z + w + v + 1)^60').expandAsync({timeout: 50}), MathTimeoutException)
            const controller: AbortController = new AbortController()
            setTimeout((): void => controller.abort(), 30)
            await assert.rejects(math.expression('(a + b + c + d + e + 1)^60').expandAsync({signal: controller.signal}), MathCancelledException)
            assert.ok(Date.now() - started < 2000, `the threads stopped (${Date.now() - started} ms)`)
        })
    })
}
