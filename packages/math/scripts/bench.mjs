//The timings of the operations of @lakutata/math, for its development (not part of the package): the symbolic
//operations measured first (step 0 of the design; the factorizations, simplifications, limits, integrals, sums,
//inequalities and transforms since), the matrices, the statistics, the decimals, the units and the
//numeric solutions; and the same operations of mathjs and nerdamer where they have them, when ENGINES is a directory
//where they are installed (in a container: the timings are compared on the same machine and the same Node). Each
//timing is the median of 5 rounds; a round makes as many calls as take at least 50 ms. Run from the directory of the
//package, built:
//
//  node scripts/bench.mjs                        (ours only)
//  ENGINES=/engines node scripts/bench.mjs       (with mathjs and nerdamer)
//  node scripts/bench.mjs --filter units --json
import {createRequire} from 'node:module'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {constant, createMath, decimal, equation, expression, expressionMatrix, linalg, numeric, parse, stats, unit} from '../dist/esm/exports/Math.js'

const {values: options} = parseArgs({options: {filter: {type: 'string'}, json: {type: 'boolean'}}})
const engines = process.env.ENGINES ? createRequire(path.join(process.env.ENGINES, 'package.json')) : undefined
const mathjs = engines?.('mathjs')
const nerdamer = engines?.('nerdamer/all.min')

//The milliseconds of one call: the median of 5 rounds
function measure(call) {
    call()
    let calls = 1
    for (;;) {
        const start = performance.now()
        for (let i = 0; i < calls; i++) call()
        if (performance.now() - start >= 50) break
        calls *= 2
    }
    const rounds = []
    for (let round = 0; round < 5; round++) {
        const start = performance.now()
        for (let i = 0; i < calls; i++) call()
        rounds.push((performance.now() - start) / calls)
    }
    return rounds.sort((a, b) => a - b)[2]
}

//Values of a seed (the same in each engine)
function randoms(count, seed) {
    let state = seed >>> 0
    return Array.from({length: count}, () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296 * 20 - 10
    })
}
const square = (n, seed, dominant = false) => {
    const values = randoms(n * n, seed)
    return Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => values[i * n + j] + (dominant && i === j ? 10 * n : 0)))
}
const symmetric = (n, seed) => {
    const a = square(n, seed)
    return a.map((row, i) => row.map((value, j) => (value + a[j][i]) / 2))
}
const a200 = square(200, 1, true), b200 = square(200, 2), a100 = square(100, 3, true), s100 = symmetric(100, 4)
const vector200 = randoms(200, 5), million = randoms(1000000, 6), million64 = Float64Array.from(million)
const big = (precision) => mathjs.create(mathjs.all, {number: 'BigNumber', precision: precision})
const big1000 = mathjs ? big(1000) : undefined
const nerdamerMatrix = (rows) => `matrix(${rows.map((row) => `[${row.join(',')}]`).join(',')})`
const symbolic5 = [['a', 'b', 'c', 'd', 'e'], ['b', 'c', 'd', 'e', 'a'], ['c', 'd', 'e', 'a', 'b'], ['d', 'e', 'a', 'b', 'c'], ['e', 'a', 'b', 'c', 'd']]
const precise = createMath({precision: 1000})

//The operations: ours, and mathjs's and nerdamer's where they have the same one
const cases = [
    {name: 'symbolic: parse and derive x^2*sin(x)', ours: () => expression('x^2*sin(x)').diff('x').toString(), mathjs: () => mathjs.derivative('x^2*sin(x)', 'x').toString(), nerdamer: () => nerdamer.diff('x^2*sin(x)', 'x').toString()},
    {name: 'symbolic: parse and solve x^2 - 5x + 6 = 0', ours: () => equation('x^2 - 5x + 6 = 0').solve('x').map(String), nerdamer: () => nerdamer.solve('x^2-5x+6', 'x').toString()},
    {name: 'symbolic: expand (x+y+z+1)^8', ours: () => expression('(x+y+z+1)^8').expand().toString(), nerdamer: () => nerdamer.expand('(x+y+z+1)^8').toString()},
    {name: 'symbolic: expand (x+y+z+1)^20', ours: () => expression('(x+y+z+1)^20').expand().toString()},
    {name: 'symbolic: substitute and evaluate', ours: () => expression('x^3 - 2x*y + y^2').substitute({x: 1.5, y: -2}).toNumber(), mathjs: () => mathjs.evaluate('x^3 - 2x*y + y^2', {x: 1.5, y: -2}), nerdamer: () => nerdamer('x^3 - 2x*y + y^2', {x: 1.5, y: -2}).evaluate().text('decimals')},
    {name: 'symbolic: compile x^2*sin(x), 10^5 points', ours: (() => {
        const points = Float64Array.from(randoms(100000, 7))
        return () => expression('x^2*sin(x)').compile(['x']).batch(points)
    })(), mathjs: (() => {
        const points = randoms(100000, 7)
        return () => {
            const compiled = mathjs.compile('x^2*sin(x)')
            return points.map((x) => compiled.evaluate({x: x}))
        }
    })()},
    {name: 'symbolic: factor x^6 - y^6', ours: () => expression('x^6 - y^6').factor().toString(), nerdamer: () => nerdamer.factor('x^6-y^6').toString()},
    {name: 'symbolic: factor a multivariate product', ours: () => expression('(x^2*y + 3x - y^3 + 2)*(x*y^2 - 5y + x^3 - 1)*(x + y + 1)').expand().factor().toString()},
    {name: 'symbolic: apart 1/(x^3 + 1)', ours: () => expression('1/(x^3 + 1)').apart('x').toString(), nerdamer: () => nerdamer('partfrac(1/(x^3+1), x)').toString()},
    {name: 'symbolic: simplify sin(x)^4 - cos(x)^4', ours: () => expression('sin(x)^4 - cos(x)^4').simplify().toString(), nerdamer: () => nerdamer('simplify(sin(x)^4 - cos(x)^4)').toString()},
    {name: 'symbolic: simplify a fraction of trig polynomials', ours: () => expression('(sin(x)^2 + cos(x)^2 - 1)*(y*sin(x)^2*cos(x) - 3cos(x)) + sin(x)^2*cos(x)^2/(1 - cos(x))').simplify().toString()},
    {name: 'symbolic: limit (1 + 1/x)^x at inf', ours: () => expression('(1 + 1/x)^x').limit('x', 'inf').toString()},
    {name: 'symbolic: limit (sin(x) - x)/x^3 at 0', ours: () => expression('(sin(x) - x)/x^3').limit('x', 0).toString()},
    {name: 'symbolic: integrate x^2*e^x*sin(x)', ours: () => expression('x^2*e^x*sin(x)').integrate('x').toString(), nerdamer: () => nerdamer.integrate('x^2*e^x*sin(x)', 'x').toString()},
    {name: 'symbolic: integrate 1/(x^3 - 1)', ours: () => expression('1/(x^3 - 1)').integrate('x').toString(), nerdamer: () => nerdamer.integrate('1/(x^3-1)', 'x').toString()},
    {name: 'symbolic: integrate 1/(2 + cos(x)) on [0, 2pi]', ours: () => expression('1/(2 + cos(x))').integrate('x', 0, '2pi').toString()},
    {name: 'symbolic: sum k^2/3^k to inf (Gosper)', ours: () => expression('sum(k^2/3^k, k, 0, inf)').toString()},
    {name: 'symbolic: solve (x + 1)/(x - 2) >= 0', ours: () => parse('(x + 1)/(x - 2) >= 0').solve('x').toString()},
    {name: 'symbolic: inverse Laplace (2s + 3)/(s^2 + 4s + 13)', ours: () => expression('(2s + 3)/(s^2 + 4s + 13)').inverseLaplace('s', 't').toString()},
    {name: 'matrices of expressions: determinant 5x5 symbolic', ours: () => expressionMatrix(symbolic5).determinant().toString(), nerdamer: () => nerdamer(`determinant(${nerdamerMatrix(symbolic5)})`).toString()},
    {name: 'matrices of expressions: inverse [a, b; c, d]', ours: () => expressionMatrix('[a, b; c, d]').inverse().toString(), nerdamer: () => nerdamer('invert(matrix([a,b],[c,d]))').toString()},
    {name: 'linalg: multiply 200x200', ours: () => linalg.multiply(a200, b200), mathjs: () => mathjs.multiply(a200, b200)},
    {name: 'linalg: solve 200x200', ours: () => linalg.solve(a200, vector200), mathjs: () => mathjs.lusolve(a200, vector200)},
    {name: 'linalg: inverse 100x100', ours: () => linalg.inverse(a100), mathjs: () => mathjs.inv(a100)},
    {name: 'linalg: determinant 100x100', ours: () => linalg.determinant(a100), mathjs: () => mathjs.det(a100)},
    {name: 'linalg: symmetric eigenvalues 100x100', ours: () => linalg.symmetricEigen(s100), mathjs: () => mathjs.eigs(s100)},
    {name: 'stats: mean of 10^6', ours: () => stats.mean(million64), mathjs: () => mathjs.mean(million)},
    {name: 'stats: variance of 10^6', ours: () => stats.variance(million64), mathjs: () => mathjs.variance(million)},
    {name: 'stats: median of 10^6', ours: () => stats.median(million64), mathjs: () => mathjs.median(million)},
    {name: 'stats: normal cdf (mathjs: its erf)', ours: (() => {
        const normal = stats.normal({mean: 1, standardDeviation: 2})
        return () => normal.cdf(0.5)
    })(), mathjs: () => (1 + mathjs.erf((0.5 - 1) / (2 * Math.SQRT2))) / 2},
    {name: 'decimals: sqrt(2), 1000 digits', ours: () => precise.decimal(2).sqrt().toString(), mathjs: () => big1000.sqrt(big1000.bignumber(2)).toString()},
    {name: 'decimals: exp(1), 1000 digits', ours: () => precise.decimal(1).exp().toString(), mathjs: () => big1000.exp(big1000.bignumber(1)).toString()},
    {name: 'decimals: 0.1 + 0.2, 32 digits', ours: () => decimal('0.1').add('0.2').toString(), mathjs: (() => {
        const big32 = mathjs ? big(32) : undefined
        return () => big32.add(big32.bignumber('0.1'), big32.bignumber('0.2')).toString()
    })()},
    {name: 'units: 5 cm + 2 inch in mm', ours: () => unit('5 cm + 2 inch').to('mm').toString(), mathjs: () => mathjs.evaluate('5 cm + 2 inch').to('mm').toString()},
    {name: 'units: 100 km/h in m/s, a number', ours: () => unit('100 km/h').toNumber('m/s'), mathjs: () => mathjs.unit('100 km/h').toNumber('m/s')},
    {name: 'units: E = m c^2', ours: () => unit('2 kg').mul(constant('speedOfLight').pow(2)).to('J').toNumber(), mathjs: () => mathjs.multiply(mathjs.unit('2 kg'), mathjs.pow(mathjs.speedOfLight, 2)).toNumber('J')},
    {name: 'numeric: polynomial roots, degree 10', ours: () => numeric.polynomialRoots('x^10 - 3x^7 + x^2 - 1')},
    {name: 'numeric: root of cos(x) = x', ours: () => numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]})},
    {name: 'numeric: integral of sin(x)/x on [0, 10]', ours: () => numeric.integrate('sin(x)/x', 'x', [0, 10])},
    {name: 'numeric: ODE y\' = -2y on [0, 10]', ours: () => numeric.solveODE({derivatives: ['-2y'], states: ['y'], span: [0, 10], initial: [1]}), mathjs: () => mathjs.solveODE((t, y) => [-2 * y[0]], [0, 10], [1])}
]

const results = []
for (const operation of cases) {
    if (options.filter && !operation.name.includes(options.filter)) continue
    const result = {name: operation.name, ours: measure(operation.ours)}
    if (mathjs && operation.mathjs) result.mathjs = measure(operation.mathjs)
    if (nerdamer && operation.nerdamer) result.nerdamer = measure(operation.nerdamer)
    results.push(result)
    if (!options.json) {
        const text = (ms) => (ms === undefined ? '' : ms >= 1 ? `${ms.toFixed(2)} ms` : `${(ms * 1000).toFixed(2)} µs`)
        const ratio = (theirs) => (theirs === undefined ? '' : ` (${(theirs / result.ours).toFixed(1)}x)`)
        const others = mathjs ? `   mathjs ${(text(result.mathjs) + ratio(result.mathjs)).padEnd(22)} nerdamer ${text(result.nerdamer)}${ratio(result.nerdamer)}` : ''
        console.log(`${operation.name.padEnd(52)} ${text(result.ours).padStart(12)}${others}`)
    }
}
if (options.json) console.log(JSON.stringify({node: process.version, platform: `${process.platform} ${process.arch}`, engines: mathjs ? {mathjs: engines('mathjs/package.json').version, nerdamer: engines('nerdamer/package.json').version} : undefined, results: results}, null, 1))
