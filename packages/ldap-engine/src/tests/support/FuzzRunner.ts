//Run the fuzzing at length: node dist/esm/tests/support/FuzzRunner.js --iterations 200000 [--seed 7]
import {parseArgs} from 'node:util'
import {fuzz, type FuzzFailure} from './Fuzz.js'

const {values} = parseArgs({options: {iterations: {type: 'string', default: '20000'}, seed: {type: 'string', default: String(Date.now() % 100000)}}})
const iterations: number = Number(values.iterations)
const seed: number = Number(values.seed)
const started: number = Date.now()
const failures: FuzzFailure[] = fuzz(iterations, seed)
console.log(`${iterations} iterations, seed ${seed}, ${Date.now() - started} ms, ${failures.length} failures`)
for (const failure of failures.slice(0, 20)) console.log(`#${failure.iteration} ${failure.target} ${JSON.stringify(failure.input)}: ${failure.error.stack}`)
if (failures.length) process.exitCode = 1
