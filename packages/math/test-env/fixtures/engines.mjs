// The formulas of the grammar and numbers cases evaluated by mathjs and nerdamer (1.x) at the sample points of SymPy's
// results (expected/*.json, written by reference.py first), and compared with them. Each difference must be noted in
// the case (`differs: {mathjs: 'why', nerdamer: 'why'}`): the differences of the syntax are written down, not found
// by surprise. The result of each engine is added to the expected files. Run by generate.sh in a container, where
// ENGINES is the directory mathjs and nerdamer are installed in; never a dependency of the package.

import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const engines = createRequire(path.join(process.env.ENGINES, 'package.json'))
const math = engines('mathjs')
const nerdamer = engines('nerdamer/all.min')
const versions = {mathjs: engines('mathjs/package.json').version, nerdamer: engines('nerdamer/package.json').version}

const read = (file) => JSON.parse(readFileSync(path.join(HERE, file), 'utf8'))
const close = (value, expected) => {
    const re = Number(expected[0]), im = Number(expected[1])
    const scale = Math.max(1, Math.hypot(re, im))
    return Math.abs(value[0] - re) <= 1e-9 * scale && Math.abs(value[1] - im) <= 1e-9 * scale
}

//The value of a formula by an engine, as [re, im], or the reason it has none
const evaluate = {
    mathjs(text, point) {
        const scope = Object.fromEntries(Object.entries(point).map(([name, value]) => [name, Number(value)]))
        const value = math.evaluate(text, scope)
        if (typeof value === 'number') return [value, 0]
        if (value && typeof value.re === 'number') return [value.re, value.im]
        throw new Error(`not a number: ${math.format(value)}`)
    },
    nerdamer(text, point) {
        //Its decimals, read as a complex number (a function it does not know is left as a symbol: not a number); the
        //values given are a copy, nerdamer changes them
        const decimals = nerdamer(text, {...point}).evaluate().text('decimals')
        if (/[a-z]/i.test(decimals.replace(/\de[-+]?\d/g, '').replace(/\bi\b/g, ''))) throw new Error(`not a number: ${decimals}`)
        return evaluate.mathjs(decimals, {})
    }
}

const problems = []
const results = {}
for (const name of ['grammar', 'numbers']) {
    const cases = read(`cases/${name}.json`)
    const expected = read(`expected/${name}.json`)
    expected.cases.forEach((result, index) => {
        const source = cases[index]
        result.engines = {}
        for (const engine of Object.keys(evaluate)) {
            let outcome
            try {
                if (result.error) {
                    evaluate[engine](result.text, expected.points[0])
                    outcome = 'accepted, @lakutata/math refuses it'
                } else {
                    const points = result.values ? expected.points : [{}]
                    const values = result.values ?? [result.value]
                    outcome = points.every((point, at) => values[at] === null || close(evaluate[engine](result.text, point), values[at])) ? 'same' : 'different value'
                }
            } catch (error) {
                outcome = result.error ? 'same' : `error: ${String(error.message ?? error).split('\n')[0].slice(0, 120)}`
            }
            result.engines[engine] = outcome
            const noted = source.differs?.[engine]
            if (outcome !== 'same' && !noted) problems.push(`${name} ${JSON.stringify(result.text)}: ${engine} ${outcome}, not noted`)
            if (outcome === 'same' && noted) problems.push(`${name} ${JSON.stringify(result.text)}: ${engine} agrees, its note is stale`)
        }
        results[name] = expected
    })
    expected.generator = {...expected.generator, ...versions}
    writeFileSync(path.join(HERE, `expected/${name}.json`), JSON.stringify(expected, null, 1) + '\n')
}
//The number theory: the functions the engines have, on integers they hold exactly (their numbers are doubles);
//undefined where a function does not apply (mathjs's gcd of fewer than two numbers, its combinations of negative ones)
const numberTheory = {
    mathjs: {
        gcd: (values) => values.length >= 2 ? String(math.gcd(...values)) : undefined,
        lcm: (values) => values.length >= 2 ? String(math.lcm(...values)) : undefined,
        extendedGcd: (a, b) => math.xgcd(a, b).toArray().map(String),
        mod: (a, m) => String(math.mod(a, m)),
        modInverse: (a, m) => {
            const inverse = math.invmod(a, m)
            return Number.isNaN(inverse) ? null : String(inverse)
        },
        isPrime: (n) => math.isPrime(n),
        binomial: (n, k) => n >= 0 && k >= 0 && k <= n ? String(math.combinations(n, k)) : undefined,
        factorial: (n) => n >= 0 ? String(math.factorial(n)) : undefined,
        //Of a fraction: exact
        bernoulli: (n) => math.bernoulli(math.fraction(n)).toFraction()
    },
    nerdamer: {
        gcd: (values) => values.length >= 2 ? nerdamer(`gcd(${values.join(', ')})`).toString() : undefined,
        lcm: (values) => values.length >= 2 ? nerdamer(`lcm(${values.join(', ')})`).toString() : undefined,
        mod: (a, m) => nerdamer(`mod(${a}, ${m})`).toString()
    }
}
const safe = (value) => Array.isArray(value) ? value.every(safe) : typeof value !== 'string' || /\//.test(value) || Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER
{
    const cases = read('cases/ntheory.json')
    const expected = read('expected/ntheory.json')
    expected.cases.forEach((result, index) => {
        const source = cases[index]
        result.engines = {}
        for (const [engine, functions] of Object.entries(numberTheory)) {
            const operate = functions[result.op]
            if (!operate || result.error || !safe(result.args) || !safe(result.result ?? null)) continue
            const args = result.args.map((arg) => Array.isArray(arg) ? arg.map(Number) : Number(arg))
            let outcome
            try {
                const value = operate(...args)
                if (value === undefined) continue
                outcome = JSON.stringify(value) === JSON.stringify(result.result) ? 'same' : `different: ${JSON.stringify(value)}`
            } catch (error) {
                outcome = `error: ${String(error.message ?? error).split('\n')[0].slice(0, 120)}`
            }
            result.engines[engine] = outcome
            const noted = source.differs?.[engine]
            const label = `ntheory ${result.op}(${result.args.map((arg) => JSON.stringify(arg)).join(', ')})`
            if (outcome !== 'same' && !noted) problems.push(`${label}: ${engine} ${outcome}, not noted`)
            if (outcome === 'same' && noted) problems.push(`${label}: ${engine} agrees, its note is stale`)
        }
    })
    expected.generator = {...expected.generator, ...versions}
    writeFileSync(path.join(HERE, 'expected/ntheory.json'), JSON.stringify(expected, null, 1) + '\n')
}
console.log(`mathjs ${versions.mathjs}, nerdamer ${versions.nerdamer}: ${problems.length} differences not noted`)
if (problems.length) {
    console.log(problems.join('\n'))
    process.exitCode = 1
}
