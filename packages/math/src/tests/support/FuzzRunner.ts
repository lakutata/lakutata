import {openSync, writeSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {Container} from '@lakutata/core'
import {Math} from '../../exports/Math.js'
import {checkFormula, checkMatrices, checkText, type FuzzFailure, Random, randomFormula, randomText} from './Fuzz.js'

//The random tests of the formulas and of the matrices, in a process of their own: each case is written to the log before it runs, so that
//a crash of the addon still tells which formula (and the seed) caused it. Prints a JSON summary.
//Run: node dist/esm/tests/support/FuzzRunner.js [--seed N] [--iterations N] [--log file] [--fail] (--fail: exit with 1
//when a property does not hold, for npm run test:fuzz)
const {values} = parseArgs({
    options: {
        seed: {type: 'string'},
        iterations: {type: 'string', default: '1000'},
        log: {type: 'string'},
        fail: {type: 'boolean', default: false}
    }
})
const seed: number = values.seed === undefined ? globalThis.Math.floor(globalThis.Math.random() * 2 ** 31) : Number(values.seed)
const iterations: number = Number(values.iterations)
const log: number | undefined = values.log ? openSync(values.log, 'w') : undefined
const random: Random = new Random(seed)
const container: Container = new Container()
await container.setNamed('math', Math, {})
const math: Math = await container.get<Math>('math')
const failures: FuzzFailure[] = []
const properties: Record<string, number> = {}
for (let index: number = 0; index < iterations; index++) {
    const garbage: boolean = index % 4 === 3
    const text: string = garbage ? randomText(random) : randomFormula(random, 1 + random.int(4))
    if (log !== undefined) writeSync(log, `${index}\t${JSON.stringify(text)}\n`)
    const found: FuzzFailure[] = garbage ? checkText(math, index, text) : await checkFormula(math, random, index, text)
    //Random matrices, one case in five
    if (index % 5 === 0) found.push(...await checkMatrices(math, random, index))
    for (const failure of found) properties[failure.property] = (properties[failure.property] ?? 0) + 1
    failures.push(...found)
}
await container.destroy()
process.stdout.write(JSON.stringify({seed: seed, iterations: iterations, properties: properties, failures: failures.slice(0, 50)}) + '\n')
if (values.fail && failures.length) process.exitCode = 1
