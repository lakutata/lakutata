import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createMath, MathArgumentException, MathCancelledException, MathDomainException, MathNotSupportedException, type MathScope, MathSyntaxException} from '../exports/Math.js'

describe('The numeric solutions', (): void => {
    const math: MathScope = createMath()

    it('give the roots of polynomials, complex and multiple, sorted', async (): Promise<void> => {
        assert.deepStrictEqual(math.numeric.polynomialRoots('x^3 - 6x^2 + 11x - 6'), {re: Float64Array.of(1, 2, 3), im: Float64Array.of(0, 0, 0)})
        assert.deepStrictEqual(math.numeric.polynomialRoots('x^2 + 1'), {re: Float64Array.of(0, 0), im: Float64Array.of(-1, 1)})
        //From the constant term up; the roots at 0 exactly
        assert.deepStrictEqual(math.numeric.polynomialRoots([0, 0, -1, 0, 1]), {re: Float64Array.of(-1, 0, 0, 1), im: Float64Array.of(0, 0, 0, 0)})
        assert.deepStrictEqual(math.numeric.polynomialRoots('t^2 - 4', 't').re, Float64Array.of(-2, 2))
        assert.deepStrictEqual(math.numeric.polynomialRoots('5', 'x'), {re: new Float64Array(0), im: new Float64Array(0)})
        const triple = math.numeric.polynomialRoots('(x - 1)^3')
        assert.ok(triple.re.every((re: number): boolean => globalThis.Math.abs(re - 1) < 1e-4))
        assert.deepStrictEqual((await math.numeric.polynomialRootsAsync('x^2 - 1')).re, Float64Array.of(-1, 1))
    })

    it('find a root in a bracket, or from a guess', async (): Promise<void> => {
        const cosine = math.numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]})
        assert.ok(cosine.converged && globalThis.Math.abs(cosine.root - 0.7390851332151607) < 1e-15 && cosine.residual < 1e-15)
        assert.strictEqual(math.numeric.findRoot('x^2 - 2', 'x', {guess: 1}).root, globalThis.Math.SQRT2)
        //Damped: Newton's plain steps from 10 leave the root of atan
        assert.strictEqual(math.numeric.findRoot('atan(x)', 'x', {guess: 10}).root, 0)
        //A multiple root, a root at 0: bisections finish what TOMS 748 does slowly
        assert.ok(math.numeric.findRoot('(x - 1)^3', 'x', {bracket: [0, 3]}).converged)
        assert.ok(math.numeric.findRoot('x^5', 'x', {bracket: [-1, 2]}).converged)
        //A sign change at a pole: its residual tells it
        assert.ok(math.numeric.findRoot('1/x', 'x', {bracket: [-1, 2]}).residual > 1e6)
        //No root from the guess: not converged, its residual 1
        const none = math.numeric.findRoot('x^2 + 1', 'x', {guess: 0.5})
        assert.ok(!none.converged && none.residual >= 1)
        assert.ok(globalThis.Math.abs((await math.numeric.findRootAsync('x^3 - x - 2', 'x', {bracket: [1, 2]})).root - 1.5213797068045676) < 1e-15)
        assert.strictEqual(math.numeric.findRoot('x - 1', 'x', {bracket: [0, 3], maxIterations: 0}).converged, false)
    })

    it('solve systems of equations, and of more equations than variables by least squares', async (): Promise<void> => {
        const circle = math.numeric.solveSystem(['x^2 + y^2 = 4', 'x = y'], ['x', 'y'], [1, 1])
        assert.ok(circle.converged && circle.solution.every((value: number): boolean => globalThis.Math.abs(value - globalThis.Math.SQRT2) < 1e-15))
        //Rosenbrock's: Levenberg-Marquardt where Newton's steps fail
        assert.deepStrictEqual(Array.from(math.numeric.solveSystem(['10*(y - x^2)', '1 - x'], ['x', 'y'], [-1.2, 1]).solution), [1, 1])
        const squares = math.numeric.solveSystem(['x - 1', 'x - 3'], ['x'], [0])
        assert.ok(squares.converged && globalThis.Math.abs(squares.solution[0] - 2) < 1e-9 && globalThis.Math.abs(squares.residual - globalThis.Math.SQRT2) < 1e-9)
        //Near the smallest residuals, the steps that leave them the same: the least squares to the last digits
        const line = math.numeric.solveSystem(['x + y = 2', 'x - y = 0', 'x + 2y = 3.3'], ['x', 'y'], [0, 0])
        assert.ok(line.converged && globalThis.Math.abs(line.solution[0] - 73 / 70) < 1e-14 && globalThis.Math.abs(line.solution[1] - 76 / 70) < 1e-14, String(line.solution))
        const none = math.numeric.solveSystem(['x^2 + 1'], ['x'], [1])
        assert.ok(!none.converged && none.residual >= 1)
        assert.ok((await math.numeric.solveSystemAsync(['x + y = 3', 'x - y = 1'], ['x', 'y'], [0, 0])).converged)
    })

    it('integrate on finite intervals, half lines and the real line, singular at an end or at points given', async (): Promise<void> => {
        const near = (value: number, expected: number): boolean => globalThis.Math.abs(value - expected) <= 1e-14 * (1 + globalThis.Math.abs(expected))
        assert.strictEqual(math.numeric.integrate('x^2', 'x', [0, 3]).value, 9)
        //From b to a, negated; from a to a, 0
        assert.strictEqual(math.numeric.integrate('x^2', 'x', [3, 0]).value, -9)
        assert.deepStrictEqual(math.numeric.integrate('x', 'x', [2, 2]), {value: 0, error: 0, converged: true})
        //Singular at an end: the double-exponential quadrature, at the distance from an end that is not 0
        assert.ok(near(math.numeric.integrate('1/sqrt(x)', 'x', [0, 1]).value, 2))
        //Inside the interval, extrapolated as QUADPACK's QAGS does
        const strong = math.numeric.integrate('x^(-0.99)', 'x', [0, 1])
        assert.ok(strong.converged && globalThis.Math.abs(strong.value - 100) < 1e-11, JSON.stringify(strong))
        assert.ok(near(math.numeric.integrate('1/sqrt(1 - x^2)', 'x', [-1, 1]).value, globalThis.Math.PI))
        assert.ok(near(math.numeric.integrate('1/sqrt(abs(x - 1))', 'x', [0, 2], {points: [1]}).value, 4))
        //Infinite ends: x^3 e^-x is not inf times 0 (its points do not go beyond its decay)
        assert.ok(near(math.numeric.integrate('x^3*exp(-x)', 'x', [0, Infinity]).value, 6))
        assert.ok(near(math.numeric.integrate('exp(-x^2)', 'x', [-Infinity, Infinity]).value, globalThis.Math.sqrt(globalThis.Math.PI)))
        assert.ok(near(math.numeric.integrate('exp(x)', 'x', [-Infinity, 0]).value, 1))
        //An integral of 0: the tolerance is relative to the integral of |f|
        const zero = math.numeric.integrate('sin(x)', 'x', [-globalThis.Math.PI, globalThis.Math.PI])
        assert.ok(zero.converged && globalThis.Math.abs(zero.value) < 1e-15)
        //Infinite at a point of the rules (the middle of [0, 1/2]): split there, as by the points
        assert.ok(near(math.numeric.integrate('1/sqrt(abs(x - 0.25))', 'x', [0, 1]).value, globalThis.Math.sqrt(3) + 1))
        //Not convergent: the estimate, not converged
        assert.strictEqual(math.numeric.integrate('1/x', 'x', [0, 1]).converged, false)
        assert.strictEqual(math.numeric.integrate('1/(x - 0.5)^2', 'x', [0, 1]).converged, false)
        assert.strictEqual(math.numeric.integrate('sin(x)/x', 'x', [0, Infinity]).converged, false)
        //A larger tolerance: fewer intervals, a larger error
        const coarse = math.numeric.integrate('1/(1e-4 + x^2)', 'x', [-1, 1], {tolerance: 1e-3})
        assert.ok(coarse.converged && coarse.error <= 1e-3 * 312.2)
        assert.ok(near((await math.numeric.integrateAsync('x^2', 'x', [0, 3])).value, 9))
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(math.numeric.integrateAsync('x^2', 'x', [0, 1], {signal: controller.signal}), MathCancelledException)
    })

    it('throw the exceptions of the package', (): void => {
        for (const [operation, exception] of [
            [(): unknown => math.numeric.polynomialRoots('sin(x)'), MathNotSupportedException],
            [(): unknown => math.numeric.polynomialRoots('x*y'), MathArgumentException],
            [(): unknown => math.numeric.polynomialRoots('x*y', 'x'), MathArgumentException],
            [(): unknown => math.numeric.polynomialRoots('0', 'x'), MathDomainException],
            [(): unknown => math.numeric.polynomialRoots([1, Infinity]), MathArgumentException],
            [(): unknown => math.numeric.findRoot('x^2 + 1', 'x', {bracket: [-1, 1]}), MathDomainException],
            [(): unknown => math.numeric.findRoot('sqrt(x) - 1/2', 'x', {bracket: [-1, 1]}), MathDomainException],
            [(): unknown => math.numeric.findRoot('x', 'x', {}), MathArgumentException],
            [(): unknown => math.numeric.findRoot('x', 'x', {bracket: [1, 0]}), MathArgumentException],
            [(): unknown => math.numeric.findRoot('x + y', 'x', {guess: 0}), MathArgumentException],
            [(): unknown => math.numeric.findRoot('sqrt(x)', 'x', {guess: -1}), MathDomainException],
            [(): unknown => math.numeric.solveSystem(['x'], ['x', 'y'], [1]), MathArgumentException],
            [(): unknown => math.numeric.solveSystem(['log(x)'], ['x'], [-1]), MathDomainException],
            //Not real inside the interval (but next to an end, where the roundings give 0/0)
            [(): unknown => math.numeric.integrate('sqrt(x - 0.3)', 'x', [0, 1]), MathDomainException],
            [(): unknown => math.numeric.integrate('x*y', 'x', [0, 1]), MathArgumentException],
            [(): unknown => math.numeric.integrate('x', 'x', [0, 1], {tolerance: 1}), MathArgumentException],
            [(): unknown => math.numeric.integrate('x', 'x', [0, 1], {points: [2]}), MathArgumentException],
            [(): unknown => math.numeric.integrate('x', 'x', [0, NaN]), MathArgumentException],
            [(): unknown => math.numeric.integrate('x = 1', 'x', [0, 1]), MathSyntaxException]
        ] as [() => unknown, typeof MathArgumentException][]) assert.throws(operation, exception)
    })
})
