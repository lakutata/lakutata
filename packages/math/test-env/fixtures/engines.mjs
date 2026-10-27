// The formulas of the grammar and numbers cases evaluated by mathjs and nerdamer (1.x) at the sample points of SymPy's
// results (expected/*.json, written by reference.py first), and compared with them; the number theory, the functions of
// matrices, the statistics and the roots of polynomials too; the units are recorded for the tests. Each difference must
// be noted in the case (`differs: {mathjs: 'why', nerdamer: 'why'}`): the differences of the syntax are written down,
// not found by surprise. The result of each engine is added to the expected files. Run by generate.sh in a container,
// where ENGINES is the directory mathjs and nerdamer are installed in; never a dependency of the package.

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
        bernoulli: (n) => math.bernoulli(math.fraction(n)).toFraction(),
        permutations: (n, k) => String(k === undefined ? math.permutations(n) : math.permutations(n, k)),
        combinationsWithRepetition: (n, k) => String(math.combinationsWithRep(n, k)),
        multinomial: (counts) => String(math.multinomial(counts)),
        bell: (n) => String(math.bellNumbers(n)),
        catalan: (n) => String(math.catalan(n)),
        stirlingSecondKind: (n, k) => String(math.stirlingS2(n, k)),
        compositions: (n, k) => String(math.composition(n, k))
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
//The linear algebra: the functions of matrices mathjs has, against NumPy's and SciPy's results (expected/linalg.json,
//written by linalg.py first); lup by its permutation, read as the one of @lakutata/math (row i of P A is row p[i] of A)
//A dense array of a sparse matrix of a case, its entries of the same place added up
const denseOf = ({rows, columns, entries}) => {
    const array = Array.from({length: rows}, () => new Array(columns).fill(0))
    for (const [i, j, value] of entries) array[i][j] += value
    return array
}
const linearAlgebra = {
    sparseMultiply: ([a, b]) => math.multiply(math.sparse(denseOf(a)), math.sparse(denseOf(b))).toArray(),
    sparseSolve: ([a, b]) => math.lusolve(math.sparse(denseOf(a)), b).toArray(),
    exponential: ([a]) => math.expm(math.matrix(a)).toArray(),
    squareRoot: ([a]) => math.sqrtm(a),
    sylvester: ([a, b, c]) => math.sylvester(a, b, c),
    lyapunov: ([a, q]) => math.lyap(a, q),
    lu: ([a]) => {
        const {L, U, p} = math.lup(math.matrix(a))
        const product = math.multiply(L, U).toArray()
        const scale = Math.max(1, ...a.flat().map(Math.abs))
        return p.every((row, i) => product[i].every((value, j) => Math.abs(value - a[row][j]) <= 1e-9 * scale)) ? 'same' : 'another permutation'
    }
}
{
    const cases = read('cases/linalg.json')
    const expected = read('expected/linalg.json')
    expected.cases.forEach((result, index) => {
        const source = cases[index]
        const operate = linearAlgebra[result.op]
        if (!operate) return
        result.engines = {}
        let outcome
        try {
            const value = operate(result.args)
            if (result.error) {
                outcome = 'accepted, @lakutata/math refuses it'
            } else if (result.op === 'lu') {
                outcome = value
            } else {
                const ours = [value].flat(2), theirs = [result.result].flat(2)
                const scale = Math.max(1, ...theirs.map(Math.abs))
                outcome = ours.length === theirs.length && ours.every((element, i) => Math.abs(element - theirs[i]) <= 1e-9 * scale) ? 'same' : 'different value'
            }
        } catch (error) {
            outcome = result.error ? 'same' : `error: ${String(error.message ?? error).split('\n')[0].slice(0, 120)}`
        }
        result.engines.mathjs = outcome
        const noted = source.differs?.mathjs
        const label = `linalg ${result.op}(${JSON.stringify(result.args).slice(0, 60)})`
        if (outcome !== 'same' && !noted) problems.push(`${label}: mathjs ${outcome}, not noted`)
        if (outcome === 'same' && noted) problems.push(`${label}: mathjs agrees, its note is stale`)
    })
    expected.generator = {...expected.generator, mathjs: versions.mathjs}
    writeFileSync(path.join(HERE, 'expected/linalg.json'), JSON.stringify(expected, null, 1) + '\n')
}
//The statistics mathjs has, against the exact and the NumPy/SciPy results (expected/stats.json, written by stats.py
//first); its variances with the normalization of the case, its default being 'unbiased'
const statistics = {
    sum: ([x]) => math.sum(x),
    product: ([x]) => math.prod(x),
    cumulativeSum: ([x]) => math.cumsum(x),
    differences: ([x]) => math.diff(x),
    mean: ([x]) => math.mean(x),
    median: ([x]) => math.median(x),
    mode: ([x]) => math.mode(x),
    min: ([x]) => math.min(x),
    max: ([x]) => math.max(x),
    variance: ([x], normalization) => math.variance(x, normalization),
    standardDeviation: ([x], normalization) => math.std(x, normalization),
    medianAbsoluteDeviation: ([x]) => math.mad(x),
    quantile: ([x, p]) => math.quantileSeq(x, p),
    correlation: ([x, y]) => math.corr(x, y),
    klDivergence: ([p, q]) => math.kldivergence(p, q)
}
{
    const cases = read('cases/stats.json')
    const expected = read('expected/stats.json')
    expected.cases.forEach((result, index) => {
        const source = cases[index]
        const operate = statistics[result.op]
        if (!operate) return
        result.engines = {}
        let outcome
        try {
            const value = operate(result.args, result.normalization)
            if (result.error) {
                outcome = 'accepted, @lakutata/math refuses it'
            } else {
                //The numbers that are not finite are strings in the expected files
                const ours = [value].flat(), theirs = [result.result].flat().map(Number)
                const scale = Math.max(1, ...theirs.filter(Number.isFinite).map(Math.abs))
                const same = (element, i) => Object.is(element, theirs[i]) || element === theirs[i] || Math.abs(element - theirs[i]) <= 1e-12 * scale
                outcome = ours.length === theirs.length && ours.every(same) ? 'same' : `different: ${JSON.stringify(value).slice(0, 80)}`
            }
        } catch (error) {
            outcome = result.error ? 'same' : `error: ${String(error.message ?? error).split('\n')[0].slice(0, 120)}`
        }
        result.engines.mathjs = outcome
        const noted = source.differs?.mathjs
        const label = `stats ${result.op}(${JSON.stringify(result.args).slice(0, 60)})`
        if (outcome !== 'same' && !noted) problems.push(`${label}: mathjs ${outcome}, not noted`)
        if (outcome === 'same' && noted) problems.push(`${label}: mathjs agrees, its note is stale`)
    })
    expected.generator = {...expected.generator, mathjs: versions.mathjs}
    writeFileSync(path.join(HERE, 'expected/stats.json'), JSON.stringify(expected, null, 1) + '\n')
}
//The roots of the polynomials given by at most 4 coefficients, mathjs's polynomialRoot (from the constant term up, as
//ours), against NumPy's, both sorted by their real parts then their imaginary ones
{
    const cases = read('cases/numeric.json')
    const expected = read('expected/numeric.json')
    expected.cases.forEach((result, index) => {
        const source = cases[index]
        if (result.op !== 'polynomialRoots' || !result.coefficients || result.coefficients.length > 4) return
        result.engines = {}
        let outcome
        try {
            const roots = math.polynomialRoot(...result.coefficients).map((root) => typeof root === 'number' ? [root, 0] : [root.re, root.im])
            roots.sort((a, b) => a[0] - b[0] || a[1] - b[1])
            const theirs = result.result.re.map((re, i) => [re, result.result.im[i]])
            outcome = roots.length === theirs.length && roots.every(([re, im], i) => Math.abs(re - theirs[i][0]) <= 1e-9 * (1 + Math.abs(re)) && Math.abs(im - theirs[i][1]) <= 1e-9 * (1 + Math.abs(im))) ? 'same' : `different: ${JSON.stringify(roots)}`
        } catch (error) {
            outcome = `error: ${String(error.message ?? error).split('\n')[0].slice(0, 120)}`
        }
        result.engines.mathjs = outcome
        const noted = source.differs?.mathjs
        const label = `numeric polynomialRoots(${JSON.stringify(result.coefficients)})`
        if (outcome !== 'same' && !noted) problems.push(`${label}: mathjs ${outcome}, not noted`)
        if (outcome === 'same' && noted) problems.push(`${label}: mathjs agrees, its note is stale`)
    })
    expected.generator = {...expected.generator, mathjs: versions.mathjs}
    writeFileSync(path.join(HERE, 'expected/numeric.json'), JSON.stringify(expected, null, 1) + '\n')
}
//The units, recorded for the tests (they compare them with ours, and check the notes of the cases): for each unit of
//mathjs's table, its dimensions and the value in SI units of 1 of it with each prefix of its set (with the prefix and
//the unit mathjs reads the name as, when they are others); its results of the cases of units (expected/units.json,
//written by units.py first)
{
    const cases = read('cases/units.json').cases
    const expected = read('expected/units.json')
    const numeric = (value) => typeof value === 'number' ? value : {re: value.re, im: value.im}
    const table = {}
    for (const [name, definition] of Object.entries(math.Unit.UNITS)) {
        const names = {}
        for (const prefix of Object.keys(definition.prefixes)) {
            const unit = math.unit(1, prefix + name)
            const parsed = unit.units[0]
            const value = numeric(unit.toSI().toNumeric())
            names[prefix + name] = parsed.unit.name === name && parsed.prefix.name === prefix ? value : [value, parsed.prefix.name, parsed.unit.name]
        }
        table[name] = {dimensions: definition.base.dimensions, names: names}
    }
    const value = (unit) => ({value: numeric(unit.toNumeric()), units: unit.formatUnits()})
    const outcomes = {
        convert: (source) => ({value: numeric(math.evaluate(source.value).toNumeric(source.to))}),
        number: (source) => ({value: numeric(math.evaluate(source.value))}),
        si: (source) => value(math.evaluate(source.value).toSI()),
        best: (source) => value(source.units ? math.evaluate(source.value).toBest(source.units) : math.evaluate(source.value).toBest()),
        split: (source) => ({values: math.evaluate(source.value).splitUnit(source.units).map(value)}),
        error: (source) => ({result: math.format(math.evaluate(source.value))}),
        constant: (source) => ({value: numeric(typeof math[source.name] === 'number' ? math[source.name] : math[source.name].value)})
    }
    expected.cases.forEach((result, index) => {
        const source = cases[index]
        try {
            result.mathjs = outcomes[source.op](source)
        } catch (error) {
            result.mathjs = {error: String(error.message ?? error).split('\n')[0].slice(0, 120)}
        }
    })
    expected.mathjs = versions.mathjs
    expected.table = table
    writeFileSync(path.join(HERE, 'expected/units.json'), JSON.stringify(expected, null, 1).replace(/\[\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2, $3, $4, $5, $6, $7, $8, $9]') + '\n')
}
console.log(`mathjs ${versions.mathjs}, nerdamer ${versions.nerdamer}: ${problems.length} differences not noted`)
if (problems.length) {
    console.log(problems.join('\n'))
    process.exitCode = 1
}
