import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    Equation,
    Expression,
    Inequality,
    Math,
    MathArgumentException,
    MathCancelledException,
    MathDefinitionException,
    MathDivisionByZeroException,
    MathDomainException,
    MathException,
    MathNotSupportedException,
    MathSyntaxException,
    MathTimeoutException,
    MathUnknownFunctionException,
    Solutions
} from '../exports/Math.js'

describe('The formulas', (): void => {
    let container: Container
    let math: Math

    before(async (): Promise<void> => {
        container = new Container()
        await container.setNamed('math', Math, {definitions: {'f(x)': 'x^2 + 1', 'g': 9.80665, 'h(x, y)': 'f(x) + y'}, precision: 20})
        math = await container.get<Math>('math')
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    it('parse and print as they are written', (): void => {
        const cases: [string, string, string][] = [
            ['x^2 - 5x + 6', 'x^2 - 5x + 6', 'x^{2} - 5 x + 6'],
            ['(x + 1)(x - 1)', '(x - 1)(x + 1)', '\\left(x - 1\\right) \\left(x + 1\\right)'],
            ['2(x+1)^2', '2(x + 1)^2', '2 \\left(x + 1\\right)^{2}'],
            ['2^3^2', '512', '512'],
            ['0.1 + 0.2', '3/10', '\\frac{3}{10}'],
            ['sin(pi/6)', '1/2', '\\frac{1}{2}'],
            ['(x+1)/(x-1)', '(x + 1)/(x - 1)', '\\frac{x + 1}{x - 1}'],
            ['1/(2x)', '1/(2x)', '\\frac{1}{2 x}'],
            ['x^(1/3)', 'x^(1/3)', '\\sqrt[3]{x}'],
            ['3i + 2', '2 + 3i', '2 + 3 i'],
            ['5!', '120', '120'],
            ['abs(x) + floor(y)', 'abs(x) + floor(y)', '\\left|x\\right| + \\left\\lfloor y \\right\\rfloor'],
            ['1.5e3 + 2.5e-1', '6001/4', '\\frac{6001}{4}']
        ]
        for (const [text, printed, tex] of cases) {
            const expression: Expression = math.expression(text)
            assert.strictEqual(expression.toString(), printed, text)
            assert.strictEqual(expression.toTeX(), tex, text)
            assert.ok(math.expression(printed).equals(expression), `${printed} parsed again`)
        }
    })

    it('tell expressions, equations and inequalities apart', (): void => {
        assert.ok(math.parse('x + 1') instanceof Expression)
        const equation = math.parse('x^2 = 4')
        assert.ok(equation instanceof Equation)
        assert.strictEqual(equation.toString(), 'x^2 = 4')
        const inequality = math.parse('x^2 <= 4')
        assert.ok(inequality instanceof Inequality)
        assert.strictEqual(inequality.relation, '<=')
        assert.strictEqual(inequality.toTeX(), 'x^{2} \\leq 4')
        assert.throws((): unknown => math.expression('x = 1'), MathSyntaxException)
        assert.throws((): unknown => math.equation('x + 1'), MathSyntaxException)
    })

    it('throw exceptions with the position of the error', (): void => {
        const cases: [string, new (...args: never[]) => MathException, number][] = [
            ['2 3', MathSyntaxException, 2],
            ['(x +', MathSyntaxException, 4],
            ['', MathSyntaxException, 0],
            ['foo(x)', MathUnknownFunctionException, 0],
            ['x != 2', MathNotSupportedException, 2]
        ]
        for (const [text, exception, position] of cases) {
            assert.throws((): unknown => math.parse(text), (error: unknown): boolean => {
                assert.ok(error instanceof exception, `${text}: ${String(error)}`)
                assert.strictEqual((error as MathException).position, position, text)
                return true
            })
        }
        assert.throws((): unknown => math.parse('sin'), (error: unknown): boolean => error instanceof MathSyntaxException && (error as MathException).errno === 'E_MATH_SYNTAX')
    })

    it('use the definitions of the component, and the ones of with() for a while', (): void => {
        assert.strictEqual(math.expression('f(3) + f(y)').toString(), 'y^2 + 11')
        assert.strictEqual(math.expression('h(2, z)').toString(), 'z + 5')
        assert.strictEqual(math.expression('f(x)').diff('x').toString(), '2x')
        assert.strictEqual(math.expression('g').toNumber(), 9.80665)
        const scope = math.with({'k(x)': 'f(x) + 1', 'g': 10})
        assert.strictEqual(scope.expression('k(2)').toString(), '6')
        assert.strictEqual(scope.expression('g*2').toString(), '20')
        assert.strictEqual(scope.with({'m': 'k(1)'}).expression('m').toString(), '3')
        assert.throws((): unknown => math.expression('k(2)'), MathUnknownFunctionException)
        assert.throws((): unknown => math.with({'sin(x)': 'x'}), MathDefinitionException)
        assert.throws((): unknown => math.with({'a(x)': 'b(x)', 'b(x)': 'a(x)'}), MathDefinitionException)
    })

    it('expand, derive, substitute, evaluate and give series', (): void => {
        assert.strictEqual(math.expression('(x + 1)^3').expand().toString(), 'x^3 + 3x^2 + 3x + 1')
        assert.strictEqual(math.expression('x^2*sin(x)').diff('x').toString(), '2x*sin(x) + x^2*cos(x)')
        assert.strictEqual(math.expression('x^4').diff('x', 2).toString(), '12x^2')
        assert.strictEqual(math.expression('x^2 + y').substitute({x: 0.5, y: 't + 1'}).toString(), 't + 5/4')
        assert.strictEqual(math.expression('x^2 - 5x + 6').evaluate({x: 4}).toNumber(), 2)
        assert.strictEqual(math.expression('sin(x)').series('x', 0, 6).toString(), 'x^5/120 - x^3/6 + x')
        assert.strictEqual(math.expression('x').add(1).mul('x - 1').expand().toString(), 'x^2 - 1')
        assert.strictEqual(math.expression(0.1).toString(), '1/10')
        assert.deepStrictEqual(math.expression('x*y + sin(z)').variables(), ['x', 'y', 'z'])
        assert.ok(math.expression('(x + 1)^2').equals('x^2 + 2x + 1'))
        assert.ok(!math.expression('x').equals('y'))
    })

    it('give numbers, complex numbers and decimals', (): void => {
        assert.strictEqual(math.expression('sin(pi/6)').toNumber(), 0.5)
        assert.deepStrictEqual(math.expression('sqrt(-4)').toComplex(), {re: 0, im: 2})
        assert.throws((): unknown => math.expression('sqrt(-4)').toNumber(), MathDomainException)
        assert.throws((): unknown => math.expression('x + 1').toNumber(), MathArgumentException)
        assert.strictEqual(math.expression('inf').toNumber(), Infinity)
        assert.ok(Number.isNaN(math.expression('nan').toNumber()))
        assert.strictEqual(math.expression('1/0').toString(), 'complexInfinity')
        assert.throws((): unknown => math.expression('1/0').toNumber(), MathDomainException)
        assert.strictEqual(math.expression('pi').toDecimal(), '3.1415926535897932385')
        assert.strictEqual(math.expression('sqrt(2)').toDecimal(30), '1.41421356237309504880168872421')
        assert.strictEqual(math.expression('1/3').toDecimal(10), '0.3333333333')
    })

    it('solve equations in the complex numbers or the real ones', (): void => {
        const solutions: Solutions = math.equation('x^2 - 5x + 6 = 0').solve('x')
        assert.ok(solutions instanceof Solutions)
        assert.strictEqual(solutions.kind, 'finite')
        assert.deepStrictEqual(solutions.map(String), ['2', '3'])
        assert.deepStrictEqual(math.expression('x^4 - 1').solve('x').map(String), ['-1', '1', '-i', 'i'])
        assert.deepStrictEqual(math.expression('x^4 - 1').solve('x', {domain: 'real'}).map(String), ['-1', '1'])
        assert.strictEqual(math.expression('x^2 + 1').solve('x', {domain: 'real'}).kind, 'empty')
        assert.strictEqual(math.equation('x = x').solve('x').kind, 'all')
    })

    it('solve systems of linear equations', (): void => {
        const [solution] = math.solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
        assert.strictEqual(solution.x.toString(), '2')
        assert.strictEqual(solution.y.toString(), '1')
        assert.deepStrictEqual(math.solve(['x + y = 3', 'x + y = 4'], ['x', 'y']), [])
        assert.strictEqual(math.solve(['x + y = 3', '2x + 2y = 6'], ['x', 'y'])[0].x.toString(), '-y + 3')
        assert.throws((): unknown => math.solve(['x*y = 1', 'x = y'], ['x', 'y']), MathNotSupportedException)
        assert.throws((): unknown => math.solve(['sin(x) + y = 0', 'x = y'], ['x', 'y']), MathNotSupportedException)
    })

    it('compile formulas into functions of numbers', (): void => {
        const f = math.expression('x^2 + sin(y)').compile(['x', 'y'])
        assert.strictEqual(f(2, 0), 4)
        assert.deepStrictEqual(f.variables, ['x', 'y'])
        assert.deepStrictEqual(Array.from(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0))), [1, 4, 9])
        assert.throws((): unknown => math.expression('x + y').compile(['x']), MathArgumentException)
        assert.throws((): unknown => f(1), MathArgumentException)
    })

    it('give the real roots, the rounding, the remainders and the parts of complex numbers as documented', (): void => {
        assert.strictEqual(math.expression('cbrt(-8)').toString(), '-2')
        assert.strictEqual(math.expression('cbrt(x)').substitute({x: -8}).toString(), '-2')
        assert.strictEqual(math.expression('(-8)^(1/3)').toString(), '2(-1)^(1/3)')
        assert.strictEqual(math.expression('round(-2.5) + round(2.5)').toString(), '0')
        assert.strictEqual(math.expression('mod(-7, 3)').toString(), '2')
        assert.ok(Number.isNaN(math.expression('arg(0)').toNumber()))
        assert.strictEqual(math.expression('re(x + 2i*y)').toString(), '-2im(y) + re(x)')
        assert.strictEqual(math.expression('phi^2 - phi').toNumber(), 1)
        //Without parentheses, the names of most functions are variables; the ones written so by mistake are an error
        assert.deepStrictEqual(math.expression('gamma + re + mod').variables(), ['gamma', 'mod', 're'])
        assert.throws((): unknown => math.expression('sin + 1'), MathSyntaxException)
        //A complex value on the way to a real one, compiled
        assert.ok(globalThis.Math.abs(math.expression('im(sqrt(y)*y)').compile(['y'])(-1.3) + 1.4822280526288794) < 1e-12)
    })

    it('tell what they know of an expression, compare it, rewrite it and split it into a fraction', (): void => {
        assert.strictEqual(math.expression('pi - 3').isPositive(), true)
        assert.strictEqual(math.expression('x').isPositive(), undefined)
        assert.strictEqual(math.expression('sqrt(2)').isInteger(), false)
        assert.strictEqual(math.expression('2^10').isInteger(), true)
        assert.strictEqual(math.expression('i').isReal(), false)
        assert.strictEqual(math.expression('e').isRational(), false)
        assert.strictEqual(math.expression('1/0').isFinite(), false)
        //Close to zero without being shown to be zero: not known, never a wrong answer
        assert.strictEqual(math.expression('sin(pi/7)^2 + cos(pi/7)^2 - 1').isZero(), undefined)
        assert.strictEqual(math.expression('pi').compare('22/7'), -1)
        assert.strictEqual(math.expression('(x + 1)^2').compare('x^2 + 2x + 1'), 0)
        assert.strictEqual(math.expression('x').compare('y'), undefined)
        //Too close for the doubles: by the decimals of 60 digits; equal values not shown equal stay not known
        assert.strictEqual(math.expression('pi').compare('3.14159265358979323846'), 1)
        assert.strictEqual(math.expression('pi').compare('3.14159265358979323847'), -1)
        assert.strictEqual(math.expression('ln(6)').compare('ln(2) + ln(3)'), undefined)
        assert.strictEqual(math.expression('cosh(x)').rewrite('exp').toString(), 'e^(-x)/2 + e^x/2')
        assert.strictEqual(math.expression('sin(x)').rewrite('cos').toString(), 'cos(x - pi/2)')
        //A rewritten expression is differentiated and expanded into a series like any other
        assert.strictEqual(math.expression('sin(x)').rewrite('cos').diff('x').toString(), '-sin(x - pi/2)')
        assert.strictEqual(math.expression('sin(x)').rewrite('cos').series('x', 0, 4).toString(), '-x^3/6 + x')
        const fraction: Expression = math.expression('(x + 1)/(x - 1) + 1/y')
        const at: Record<string, number> = {x: 2, y: 3}
        assert.strictEqual(fraction.numerator().div(fraction.denominator()).substitute(at).toString(), fraction.substitute(at).toString())
        //A power that is not an integer one is not split over a fraction whose denominator may be negative
        assert.strictEqual(math.expression('sqrt(a/y)').denominator().toString(), '1')
        assert.throws((): unknown => math.expression('1/x').coefficients('x'), MathNotSupportedException)
        assert.throws((): unknown => math.expression('x^2').divide(0, 'x'), MathDivisionByZeroException)
    })

    it('write the code of an expression in JavaScript and in C, and share its common subexpressions', async (): Promise<void> => {
        assert.strictEqual(math.expression('x^2 - 5x + 6').toJavaScript(), 'Math.pow(x, 2) - 5*x + 6')
        assert.strictEqual(math.expression('x^2 - 5x + 6').toC(), 'pow(x, 2.0) - 5.0*x + 6.0')
        //A rational is a division of doubles in C, not of integers
        assert.strictEqual(math.expression('x/3 + 1/3').toC(), 'x/3.0 + 1.0/3.0')
        const f = new Function('x', 'y', `return ${math.expression('round(x) + mod(x, y) + cbrt(x) + root(x, 5) + sign(y)').toJavaScript()}`)
        //round(-2.5) is -3, mod(-2.5, 2) is 1.5, cbrt and root(x, 5) of a negative number are real
        assert.ok(globalThis.Math.abs(f(-2.5, 2) - (-3 + 1.5 - globalThis.Math.cbrt(2.5) - globalThis.Math.pow(2.5, 1 / 5) + 1)) < 1e-12)
        //x^(1/3) is the principal root: NaN for a negative x in the real numbers
        assert.ok(Number.isNaN(new Function('x', `return ${math.expression('x^(1/3)').toJavaScript()}`)(-8)))
        assert.strictEqual(math.expression('gamma(x) + erf(x)').toC(), 'erf(x) + tgamma(x)')
        assert.throws((): unknown => math.expression('gamma(x)').toJavaScript(), MathNotSupportedException)
        assert.throws((): unknown => math.expression('x + 2i').toC(), MathNotSupportedException)
        assert.throws((): unknown => math.expression('Math*x').toJavaScript(), MathNotSupportedException)
        const {replacements, expressions} = math.cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
        assert.deepStrictEqual(replacements.map(({name, value}): string => `${name} = ${value.toString()}`), ['x0 = x + y'])
        assert.deepStrictEqual(expressions.map(String), ['x0 + sin(x0)^2', 'cos(x0)'])
        //The names skip the variables of the expressions
        assert.deepStrictEqual((await math.cseAsync(['(x0 + y)^2 + exp(x0 + y)'], {prefix: 'x'})).replacements.map(({name}): string => name), ['x1'])
        assert.throws((): unknown => math.cse(['x'], {prefix: '1a'}), MathArgumentException)
    })

    it('give the polar and the rectangular forms of complex numbers', (): void => {
        const polar = math.expression('3 + 4i').toPolar()
        assert.deepStrictEqual([polar.modulus.toString(), polar.argument.toString()], ['5', 'atan(4/3)'])
        const turned = math.expression('-2*e^(i*pi/4)').toPolar()
        assert.deepStrictEqual([turned.modulus.toString(), turned.argument.toString()], ['2', '-3pi/4'])
        const rectangular = math.expression('e^(i*pi/3)').toRectangular()
        assert.deepStrictEqual([rectangular.real.toString(), rectangular.imaginary.toString()], ['1/2', 'sqrt(3)/2'])
        const variable = math.expression('(1 + i)*x').toRectangular()
        assert.deepStrictEqual([variable.real.toString(), variable.imaginary.toString()], ['-im(x) + re(x)', 'im(x) + re(x)'])
        //A negative real number is on the upper side of the cut, also through a function computed in the complex
        //numbers (atan of a real number there had an imaginary part of 5.55e-17)
        assert.strictEqual(math.expression('arg(1/atan(-2/5))').toNumber(), globalThis.Math.PI)
    })

    it('give the values of the decimals, their zeros and jumps, and the sides of the branch cuts of SymPy', (): void => {
        //Correctly rounded where doubles have no digit; 0 and the jumps decided within the error of the value
        assert.strictEqual(math.expression('cos(10^30)').toNumber(), -0.9959311944053957)
        assert.strictEqual(math.expression('ln(6) - ln(2) - ln(3)').toDecimal(30), '0')
        assert.strictEqual(math.expression('floor(ln(8)/ln(2))').toDecimal(10), '3')
        assert.strictEqual(math.expression('EulerGamma').toDecimal(30), '0.577215664901532860606512090082')
        assert.throws((): unknown => math.expression('1/(ln(6) - ln(2) - ln(3))').toNumber(), MathDomainException)
        assert.throws((): unknown => math.expression('arg(ln(6) - ln(2) - ln(3))').toDecimal(10), MathDomainException)
        //A part with no real value: min() is NaN, so the compiled function computes in the complex numbers
        assert.ok(globalThis.Math.abs(math.expression('min(x^x, re(e^sqrt(y)))').compile(['x', 'y'])(0.7, -0.7) - 0.6699461865679736) < 1e-12)
        //On the branch cuts, the values of SymPy (counter-clockwise continuous), exact and compiled
        const cuts: [string, number, number, number][] = [
            ['asin(x)', 2, globalThis.Math.PI / 2, -1.3169578969248166], ['asin(x)', -2, -globalThis.Math.PI / 2, 1.3169578969248166],
            ['acos(x)', 2, 0, 1.3169578969248166], ['acos(x)', -2, globalThis.Math.PI, -1.3169578969248166],
            ['atan(i*x)', 2, globalThis.Math.PI / 2, 0.5493061443340548], ['atan(i*x)', -2, -globalThis.Math.PI / 2, -0.5493061443340548],
            ['asinh(i*x)', 2, 1.3169578969248166, globalThis.Math.PI / 2], ['asinh(i*x)', -2, -1.3169578969248166, -globalThis.Math.PI / 2],
            ['atanh(x)', 2, 0.5493061443340548, globalThis.Math.PI / 2], ['atanh(x)', -2, -0.5493061443340548, -globalThis.Math.PI / 2],
            ['acosh(x)', -2, 1.3169578969248166, globalThis.Math.PI]
        ]
        for (const [text, x, re, im] of cuts) {
            const exact = math.expression(text).substitute({x: x}).toComplex()
            const real: number = math.expression(`re(${text})`).compile(['x'])(x)
            const imaginary: number = math.expression(`im(${text})`).compile(['x'])(x)
            for (const [label, a, b] of [['exact', exact.re, exact.im], ['compiled', real, imaginary]] as [string, number, number][]) {
                assert.ok(globalThis.Math.abs(a - re) < 1e-12 && globalThis.Math.abs(b - im) < 1e-12, `${text} at ${x} ${label}: ${a} + ${b}i`)
            }
        }
    })

    it('refuse the expressions nested more than 1000 levels deep, before they fill the stack', async (): Promise<void> => {
        const nested = (depth: number): string => 'sin('.repeat(depth) + 'x' + ')'.repeat(depth)
        const deepest: Expression = math.expression(nested(1000))
        assert.strictEqual(deepest.substitute({x: 'y'}).variables()[0], 'y')
        assert.ok((await deepest.expandAsync()).equals(deepest))
        assert.ok(deepest.toString().startsWith('sin(sin('))
        assert.throws((): unknown => math.expression(nested(1001)), MathNotSupportedException)
        assert.throws((): unknown => math.expression('('.repeat(100000) + 'x' + ')'.repeat(100000)), MathNotSupportedException)
        assert.throws((): unknown => math.expression('-'.repeat(100000) + 'x'), MathNotSupportedException)
        assert.throws((): unknown => deepest.substitute({x: 'sin(x)'}), MathNotSupportedException)
        const composed: Record<string, string> = {'f1(x)': 'sin(sin(x))'}
        for (let index: number = 2; index <= 30; index++) composed[`f${index}(x)`] = `f${index - 1}(f${index - 1}(x))`
        assert.throws((): unknown => math.with(composed), MathDefinitionException)
    })

    it('run the asynchronous operations in the threads of the addon, with a time limit and a cancellation', async (): Promise<void> => {
        assert.strictEqual((await math.expression('(x + 1)^5').expandAsync()).toString(), 'x^5 + 5x^4 + 10x^3 + 10x^2 + 5x + 1')
        assert.deepStrictEqual((await math.equation('x^2 = 4').solveAsync('x')).map(String), ['-2', '2'])
        assert.strictEqual((await math.solveAsync(['x + y = 3', 'x - y = 1'], ['x', 'y']))[0].x.toString(), '2')
        const pi: Expression = math.expression('pi')
        await assert.rejects(pi.toDecimalAsync(20000, {timeout: 20}), MathTimeoutException)
        const controller: AbortController = new AbortController()
        const running: Promise<string> = pi.toDecimalAsync(20000, {signal: controller.signal})
        setTimeout((): void => controller.abort(), 20)
        await assert.rejects(running, MathCancelledException)
        await assert.rejects(pi.toDecimalAsync(10, {signal: AbortSignal.abort()}), MathCancelledException)
        await assert.rejects(math.expression('x').diffAsync('pi'), MathArgumentException)
        const results: string[] = await Promise.all(Array.from({length: 32}, (_: unknown, index: number): Promise<string> => math.expression(`(x + ${index})^2`).expandAsync().then(String)))
        assert.strictEqual(results[3], 'x^2 + 6x + 9')
    })
})
