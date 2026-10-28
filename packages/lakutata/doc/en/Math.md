# Lakutata Math

The package `@lakutata/math` does mathematics in Node.js, both symbolic and numeric: algebra and calculus on formulas,
equations and inequalities, decimals of any precision, matrices, statistics and probability distributions, numeric
solutions, units, number theory. It is not part of `lakutata`, and it needs no application: its functions are imported
and called anywhere. What it is like:

- **Formulas are written as on paper**: `x^2 - 5x + 6`, `2(x + 1)`, `5!`, `sin(pi/6)`. A result is written the same
  way, so it can be read back, and in TeX for display.
- **Results are exact**: `0.1 + 0.2` is `3/10`, `sqrt(8)` is `2sqrt(2)`, the roots of `x^2 - 2` are `-sqrt(2)` and
  `sqrt(2)`. A number is computed only when one is asked for: a double, or as many correct decimal digits as wanted.
- **Symbolic and numeric in one package**: when an operation has no exact answer (an integral, the roots of a polynomial
  of degree five), the numeric methods take the same formula.
- **A native addon** does the work, built on SymEngine, Boost, Eigen and mpdecimal: it is compiled code, so it is fast.
  The long operations run in its own threads, with a time limit and a cancellation, so the event loop stays free.

The README of `@lakutata/math` describes every function and its options; this guide goes through what the package
computes, with an example of each kind.

```bash
npm install @lakutata/math
```

The addon is compiled when the package is installed, so the machine needs Python 3 and a C++17 compiler (the README
lists them for each system); it takes from about half a minute to a few minutes. The package manager has to run the
install script of the package: npm runs it, and may warn that the script is "not yet covered by allowScripts"
(`npm install-scripts approve @lakutata/math` records that you allow it); Bun and pnpm run it only for the packages they
are told to trust (`trustedDependencies` in the package.json for Bun, `pnpm approve-builds` for pnpm). Without the
addon, loading the package throws an error that tells how to build it.

## 1. Formulas and results

`expression()` reads a formula. A number next to a name or a parenthesis multiplies it (`2x`, `3(x + 1)`), `^` is a
power, and the constants (`pi`, `e`, `i`, `inf`) and the functions (`sin`, `ln`, `sqrt`, `gamma`, `erf`, `zeta`…) have
their usual names; the README lists them all. An expression does not change: each operation gives a new one.

```typescript
import {createMath, expression} from '@lakutata/math'

console.log(expression('0.1 + 0.2').toString())                  //3/10
console.log(expression('sqrt(8) + sin(pi/6)').toString())        //2sqrt(2) + 1/2
console.log(expression('3(x + 1)^2 - x').expand().toString())    //3x^2 + 5x + 3
console.log(expression('e^(-x^2/2)/sqrt(2pi)').toTeX())          //\frac{e^{-\frac{x^{2}}{2}} \sqrt{2}}{2 \sqrt{\pi}}
console.log(expression('cos(10^30)').toNumber(), Math.cos(1e30)) //-0.9959311944053957 -0.9999564608959665
console.log(expression('pi').toDecimal(50))                      //3.1415926535897932384626433832795028841971693993751
const finance = createMath({definitions: {'rate': '0.13', 'net(x)': 'x/(1 + rate)'}})
console.log(finance.expression('net(113)').toString())           //100
console.log(finance.expression('p - net(p)').diff('p').toString()) //13/113
```

- `toString()` gives a formula that `expression()` reads back, `toTeX()` its TeX (for KaTeX or MathJax).
- `toNumber()` gives the nearest double. It is computed from the decimals of the exact value, so all its digits are
  right, even where doubles have none: as a double, `1e30` is not exactly 10^30, and `Math.cos(1e30)` is the cosine of
  another number. `toDecimal(digits)` gives that many correct significant digits, as a string.
- `substitute({x: 2})` puts values in for the variables; the result stays exact.
- `createMath({definitions})` makes a scope of functions and constants written as formulas, with the same functions
  as the package. A formula sees through its definitions: derivatives and equations use them. The functions the package
  exports belong to `math`, a scope with no definitions.

## 2. Algebra and calculus

```typescript
import {expression} from '@lakutata/math'

console.log(expression('x^6 - y^6').factor().toString())                         //(x^2 - x*y + y^2)(x + y)(x - y)(x^2 + x*y + y^2)
console.log(expression('(x^2 - 1)/(x^2 + 2x + 1)').cancel().toString())          //(x - 1)/(x + 1)
console.log(expression('sin(x)^4 - cos(x)^4').simplify().toString())             //-cos(2x)
console.log(expression('x^2*sin(x)').diff('x').toString())                       //2x*sin(x) + x^2*cos(x)
console.log(expression('x*e^x').integrate('x').toString())                       //e^x*(x - 1)
console.log(expression('1/(x^2 + 1)').integrate('x', '-inf', 'inf').toString())  //pi
console.log(expression('(1 + a/x)^x').limit('x', 'inf').toString())              //e^a
console.log(expression('e^x').series('x', 0, 4).toString())                      //x^3/6 + x^2/2 + x + 1
console.log(expression('sum(k^2, k, 1, n)').toString())                          //n^3/3 + n^2/2 + n/6
console.log(expression('t^2*e^(-3t)').laplace('t', 's').toString())              //2/(s + 3)^3
```

- **Polynomials and fractions**: `expand`, `factor` (over the rationals, in any number of variables), `cancel`,
  `together`, `apart` (partial fractions) and `completeSquare`.
- **Simplification**: `simplify()` looks for a shorter form, by identities that hold for every value of the variables
  (trigonometric, hyperbolic, exponential, nested roots); nothing that depends on the signs of the variables, so
  `sqrt(x^2)` stays as it is.
- **Integrals**: by partial fractions, a table, substitution, integration by parts, and the special functions of
  integrals (`sin(x)/x` gives `Si(x)`). Each antiderivative is checked by its derivative before it is returned. A
  definite integral is split at the poles inside its interval; it is `inf` where it grows without bound.
- **Limits** by Gruntz's algorithm, from both sides or from one, at a point or at infinity, with the indeterminate
  forms (`0/0`, `1^inf`, `inf - inf`…).
- **Series** (`series(variable, point, order)`), **sums and products** in closed form (`sum(1/k^2, k, 1, inf)` is
  `pi^2/6`), **piecewise** expressions (`piecewise(x^2, x < 0, x)`), and the **Laplace transform** and its inverse.

Most of these operations have an asynchronous version (section 11).

## 3. Equations and inequalities

```typescript
import {equation, type Inequality, parse, solve} from '@lakutata/math'

console.log(equation('x^3 - 6x^2 + 11x - 6 = 0').solve('x').map(String))              //['1', '2', '3']
console.log(equation('x^4 = 16').solve('x').map(String))                              //['-2', '2', '-2i', '2i']
console.log(equation('x^4 = 16').solve('x', {domain: 'real'}).map(String))            //['-2', '2']
console.log(equation('x^2 - (a + b)x + a*b = 0').solve('x').map(String))              //['a', 'b']
const [solution] = solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
console.log(solution.x.toString(), solution.y.toString())                             //2 1
console.log((parse('(x + 1)/(x - 2) >= 0') as Inequality).solve('x').set.toString())  //(-inf, -1] ∪ (2, inf)
```

- A polynomial equation is factored first, so its roots come out simple (1, 2, 3, not the radicals of Cardano's
  formula); the factors are solved exactly up to degree four, and `a x^n + b` of any degree. The solutions are complex
  numbers unless `{domain: 'real'}` is given.
- `solve(equations, variables)` solves a system of linear equations, in terms of the free variables when it has
  infinitely many solutions.
- An inequality of fractions of polynomials gives its real solutions as a set of intervals and values (`MathSet`), with
  union, intersection, complement and membership.

## 4. Decimals

`decimal()` gives a decimal number with a chosen precision (32 significant digits by default, up to 100000): for amounts
of money, or for values that need many digits. Each operation rounds its result correctly, halves to even.

```typescript
import {decimal, expression} from '@lakutata/math'

console.log(decimal(0.1).add(0.2).toString())                  //0.3
console.log(decimal('19.99').mul(3).toFixed(2))                //59.97
console.log(decimal(1, {precision: 50}).div(7).toString())     //0.14285714285714285714285714285714285714285714285714
console.log(decimal(2, {precision: 40}).sqrt().toString())     //1.41421356237309504880168872420969807857
console.log(expression('gamma(1/3)').toDecimal(40))            //2.678938534707747633655692940974677644129
console.log(expression('e^(pi*sqrt(163))').toDecimal(40))      //262537412640768743.9999999999992500725972
```

- A number is read as it is written (`0.1` is one tenth, not the binary value of the double), a string as a decimal
  number (`'19.99'`), a bigint exactly.
- Besides the arithmetic, decimals have roots, `exp` and the logarithms, the trigonometric and hyperbolic functions,
  `gamma`, `erf`, `zeta`, `lambertw` and the rounding functions. `toDecimal()` of an expression computes the same
  functions and more special ones (`polygamma`, `beta`, `Si`, `Ei`…).
- `toDecimal()` computes the value again with more digits until two results agree, so every digit it gives is right:
  `e^(pi*sqrt(163))` is not an integer, though its first twelve decimals are nines.

## 5. Matrices

There are two kinds of matrices: of numbers, for computing, and of expressions, for exact linear algebra.

```typescript
import {expressionMatrix, linalg, matrix} from '@lakutata/math'

const a = matrix([[4, 1], [2, 3]])
console.log(linalg.solve(a, [5, 5]))                         //Float64Array(2) [1, 1]
console.log(linalg.inverse(a).toString(), linalg.determinant(a)) //[0.3, -0.1; -0.2, 0.4] 10
const m = expressionMatrix('[a, b; c, d]')
console.log(m.determinant().toString())                      //a*d - b*c
console.log(m.inverse().toString())                          //[d/(a*d - b*c), -b/(a*d - b*c); -c/(a*d - b*c), a/(a*d - b*c)]
console.log(expressionMatrix('[2, 1; 1, 2]').eigenvalues().map(({value, multiplicity}) => [value.toString(), multiplicity])) //[['1', 1], ['3', 1]]
```

- `matrix()` holds doubles in a `Float64Array`, and `linalg` computes with Eigen: systems, least squares, inverses,
  determinants, the decompositions (LU, QR, SVD, Cholesky, eigenvalues, Schur), the exponential and the square root of
  a matrix, Sylvester and Lyapunov equations, and sparse matrices with their direct and iterative solvers.
- `expressionMatrix()` holds expressions: determinants, inverses, systems, reduced row echelon forms, null spaces,
  characteristic polynomials, eigenvalues and eigenvectors, all exact, also with variables. `jacobian()` gives the
  Jacobian matrix of expressions.

## 6. Statistics and probability

```typescript
import {stats} from '@lakutata/math'

const values = [2, 4, 4, 4, 5, 5, 7, 9]
console.log(stats.mean(values), stats.median(values), stats.standardDeviation(values)) //5 4.5 2
console.log(stats.quantile(values, [0.25, 0.75]))                  //Float64Array(2) [4, 5.5]
const iq = stats.normal({mean: 100, standardDeviation: 15})
console.log(iq.cdf(130) - iq.cdf(70))                              //0.9544997361036416
console.log(iq.quantile(0.975))                                    //129.3994597681008
console.log(stats.binomial({trials: 10, probability: 0.3}).pdf(3)) //0.2668279319999998
console.log(stats.random(42).integers(5, 1, 7))                    //Float64Array(5) [1, 1, 6, 6, 5]
```

- The statistics of values: sums (compensated for their roundings), means, medians, modes, variances (of a population
  by default, of a sample with `{normalization: 'unbiased'}`), quantiles, covariances, correlations, z-scores.
- 24 probability distributions, computed by Boost.Math, with their density, cdf, quantiles, moments and samples. Their
  parameters are given by name (`{shape, scale}`), since libraries parameterize them differently; the README gives the
  equivalents in SciPy.
- `stats.random(seed)` gives a generator (xoshiro256**): from the same seed, it draws the same uniform numbers and
  integers, on every platform. It is not meant for cryptography.

## 7. Numeric solutions

When an equation or an integral has no exact solution, or numbers are enough, `numeric` takes the same formulas:

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root)          //0.7390851332151606
console.log(numeric.findRoot('x^5 - x - 1', 'x', {bracket: [1, 2]}).root)         //1.167303978261426
const {solution, converged} = numeric.solveSystem(['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y'], [2, 0])
console.log(solution, converged)                                                  //Float64Array(2) [1.9318516525781366, 0.5176380902050416] true
console.log(numeric.integrate('e^(-x^2)*ln(1 + x)', 'x', [0, Infinity]).value)    //0.36623762882311717
const decay = numeric.solveODE({derivatives: '-2y', states: 'y', span: [0, 1], initial: 1}, {points: [0.5, 1]})
console.log(decay.y.data)                                                         //Float64Array(2) [0.3678795037443847, 0.13533535227865426]
```

- `polynomialRoots` gives all the roots of a polynomial, complex ones too; `findRoot` a root in a bracket or from a
  guess; `solveSystem` a solution of nonlinear equations.
- `integrate` computes a definite integral by QUADPACK's method (as SciPy's `quad`), on infinite intervals too, and
  with singularities at the ends or at given points.
- `solveODE` solves ordinary differential equations and systems of them, by an explicit Runge-Kutta method (as SciPy's
  RK45) or, for stiff equations, by Radau IIA.
- When a method does not converge, its result says so (`converged`, `completed`) instead of throwing.

## 8. Units and physical constants

```typescript
import {constant, unit} from '@lakutata/math'

console.log(unit('5 cm + 2 inch').toString())                          //10.08 cm
console.log(unit('100 km/h').to('m/s').toString())                     //(250/9) m / s
console.log(unit('20 degC').to('degF').toString())                     //68 degF
console.log(unit('1.5 h').split(['h', 'min']).map(String))             //['1 h', '30 min']
console.log(constant('boltzmann').mul('300 K').to('eV').toDecimal(6))  //0.025852 eV
```

The table of units is that of mathjs (251 units, with their prefixes), with exact values: `1 inch` is exactly `2.54 cm`.
Values of different dimensions cannot be added or converted. `constant()` gives the 52 physical constants of mathjs,
with the values of CODATA 2022, and `createMath({units})` adds units of your own.

## 9. Number theory and polynomials

```typescript
import {ntheory, poly} from '@lakutata/math'

console.log(ntheory.factor(360))                                                  //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
console.log(ntheory.isPrime(2n ** 61n - 1n))                                      //true
console.log(ntheory.convergents(ntheory.continuedFraction('pi', {terms: 4})).map(String)) //['3', '22/7', '333/106', '355/113']
console.log(poly.gcd('x^4 - 1', 'x^6 - 1').toString())                            //x^2 - 1
console.log(poly.discriminant('a*x^2 + b*x + c', 'x').toString())                 //-4a*c + b^2
```

`ntheory` works on integers (bigints): divisibility, modular arithmetic, the Chinese remainder theorem, primes and
factors, sequences and counting, continued fractions. `poly` works on polynomials in any number of variables: their
greatest common divisors and least common multiples, resultants, discriminants and factors.

## 10. Formulas as functions

An expression evaluated many times is compiled into a function of numbers, or written as code:

```typescript
import {expression} from '@lakutata/math'

const f = expression('x^2 + sin(y)').compile(['x', 'y'])
console.log(f(2, 0))                                      //4
console.log(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0)))   //Float64Array(3) [1, 4, 9]
console.log(expression('x^2 - 5x + 6').toJavaScript())    //Math.pow(x, 2) - 5*x + 6
console.log(expression('sqrt(x^2 + y^2)').toC())          //sqrt(pow(x, 2.0) + pow(y, 2.0))
```

`batch()` evaluates many rows of values in one call. `cse()` finds the parts that expressions share, so that the code
written from them computes each part once.

## 11. Long operations

The operations run in the thread of JavaScript, and some of them can take long: the expansion of a large power, an
integral, thousands of digits, the factors of a large number. While one runs, the event loop waits. The operations that
can take long have an asynchronous version (`expandAsync()`, `simplifyAsync()`, `integrateAsync()`, `solveAsync()`,
`toDecimalAsync()`… and those of `linalg`, `ntheory`, `poly` and `numeric`), which runs in the threads of the addon:

```typescript
import {createMath, MathTimeoutException} from '@lakutata/math'

const scope = createMath({timeout: 2000, concurrency: 4})
const expanded = await scope.expression('(x + y + 1)^30').expandAsync()
console.log(expanded.variables())                         //['x', 'y']
try {
    await scope.expression('(x + y + z + 1)^500').expandAsync({timeout: 100})
} catch (error) {
    console.log(error instanceof MathTimeoutException)    //true
}
const controller: AbortController = new AbortController()
setTimeout((): void => controller.abort(), 50)
await scope.expression('(x + y + z + 1)^500').expandAsync({signal: controller.signal}).catch((error: Error): void => console.log(error.name)) //MathCancelledException
```

- The addon has as many threads as the processor has cores, minus one, or the number in the environment variable
  `LAKUTATA_MATH_THREADS`. They are not the thread pool of libuv, so the files and the DNS lookups of the program do not
  wait for them.
- `timeout` (an option of `createMath()`, or of one call; none by default) rejects the operation with
  `MathTimeoutException`, and an aborted `signal` with `MathCancelledException`. The time spent waiting for a free
  thread does not count.
- A cancelled operation stops at the next point where it checks for a cancellation, between the steps of its work. A
  single step (a decomposition by Eigen, a large product) runs to its end, and the thread is free only then: the
  promise is rejected at the time limit, while the work may go on for a while.
- `concurrency` (an option of `createMath()`) limits how many operations of a scope run at the same time; the others
  wait their turn.

## 12. In an application

A controller calls the package as any other code does. With a formula from a client, use an asynchronous operation and
the `signal` of the request: when the client leaves, the operation is cancelled.

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {POST} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {createMath, type MathScope, type Solutions} from '@lakutata/math'

const scope: MathScope = createMath({timeout: 2000})

class SolveDTO extends DTO {
    @Expect(DTO.String().max(1000).required())
    public equation: string
}

class SolveController extends Controller {
    @POST('/solve', SolveDTO)
    public async solve(input: SolveDTO): Promise<{ solutions: Solutions, set: string }> {
        const solutions: Solutions = await scope.equation(input.equation).solveAsync('x', {signal: this.signal})
        return {solutions: solutions, set: solutions.set.toString()}
    }
}

Application.run(() => ({
    id: 'solver.app',
    name: 'Solver',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [SolveController],
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl -X POST localhost:8080/solve -H 'Content-Type: application/json' -d '{"equation":"x^2 - 5x + 6 = 0"}'
{"solutions":["2","3"],"set":"{2, 3}"}
$ curl -X POST localhost:8080/solve -H 'Content-Type: application/json' -d '{"equation":"x^2 - 5x +* 6 = 0"}'
{"errno":"E_MATH_SYNTAX","errMsg":"Unexpected *"}
```

- The exceptions of the package have no `statusCode`, so the wrong formula above is answered with the status 500 and
  `{"errno": "E_MATH_SYNTAX", …}`. To answer the errors in the formulas of the clients with 400, catch `MathException`
  in the action and throw an exception of the application (see [Exceptions](Exceptions.md)); leave `E_MATH_INTERNAL`, an
  internal error of the addon, as it is.
- The length of a formula does not bound the work it takes: `(x + 1)^100000` is short. The time limit does.
- The values of the package become JSON through their `toJSON()`: an expression, an equation, a decimal and a value
  with units give their text, solutions an array of texts, a matrix its rows. A vector is a `Float64Array`, which
  `JSON.stringify()` writes as an object (`{"0": 1, "1": 1}`): send `Array.from(vector)`.
- The bundles, the executables and the installers made by `lakutata package` carry the compiled addon
  (`build/Release/math.node`). Build them on each target platform, after installing the package there; the rules of
  the native addons apply (see [Packaging](Packaging.md) and [NativeAddons](NativeAddons.md)).
- The package runs in Node.js `^22.13.0 || >=24.11.0`, in Bun and in the main process of Electron, which load the
  addon compiled for Node.js; not in the renderers of Electron nor in the browsers. In Bun, terminating a worker thread
  while operations of the addon still run in it ends the whole process with a fatal error of Node-API (a bug of Bun
  1.4).

## 13. How it is checked, and what it does not do

The tests of the package compare its results on about 2500 cases with those of SymPy and mpmath (the formulas, the
decimals, the units), of NumPy and SciPy (the matrices, the statistics, the distributions, the numeric solutions), and
of mathjs and nerdamer; they run on macOS (arm64: Node.js 24, Bun 1.4, Electron 44), on Linux (arm64, glibc and musl:
Node.js 24, Bun 1.4) and on Windows 11 (arm64: Node.js 24).

What it does not do, whether by design or not yet:

- An integral whose fraction needs algebraic numbers to factor its denominator (`1/(x^4 + 1)`), or whose antiderivative
  is neither elementary nor one of the special functions of integrals, throws `MathNotSupportedException`; it is not
  kept as an unevaluated integral. `numeric.integrate()` computes the definite integral.
- `solve()` solves one equation, or a system of linear equations; a system of nonlinear equations is for
  `numeric.solveSystem()`. An equation with infinitely many solutions, such as `sin(x) = 0`, gives no array of them: its
  `set` only describes them (`{2pi*n + pi | n integer} or {2pi*n | n integer}`), and the operations of the sets do not
  take it.
- An inequality must be made of fractions of polynomials with rational coefficients.
- The exact eigenvalues of a matrix of expressions are found up to degree four; `linalg.eigen()` gives them as numbers.
- Nothing that depends on the signs of the variables: `sqrt(x^2)` is not `abs(x)`, and a limit that depends on the
  sign of a parameter (`exp(a*x)` at `inf`) is not found.
- Exact numbers have at most about 315000 digits: a larger power stays a power (`2^(10^7)`).

## 14. Exceptions

All of them extend `MathException`. The errors in a formula carry the `position` of the character where they are found.
The README of the package lists every case.

| Exception | `errno` | When |
|---|---|---|
| `MathSyntaxException` | `E_MATH_SYNTAX` | A formula is not written correctly, an equation is given where an expression is expected, or the other way round |
| `MathUnknownFunctionException` | `E_MATH_UNKNOWN_FUNCTION` | A formula calls a function that is neither built in nor defined |
| `MathDefinitionException` | `E_MATH_DEFINITION` | A definition or a unit of `createMath()` is not valid |
| `MathUnitException` | `E_MATH_UNIT` | Units of different dimensions added, compared or converted; a unit that is not known |
| `MathDomainException` | `E_MATH_DOMAIN` | A value outside the domain of a function: a complex value asked as a number, a singular matrix inverted, a limit that does not exist |
| `MathDivisionByZeroException` | `E_MATH_DIVISION_BY_ZERO` | A division by zero while computing decimals, a modulus of 0 |
| `MathNotSupportedException` | `E_MATH_NOT_SUPPORTED` | An operation the package does not do for this formula (section 13) |
| `MathArgumentException` | `E_MATH_ARGUMENT` | An argument that is not valid: variables left where a number is asked, matrices of the wrong dimensions |
| `MathTimeoutException`, `MathCancelledException` | `E_MATH_TIMEOUT`, `E_MATH_CANCELLED` | An asynchronous operation past its time limit, or cancelled |
| `MathException` | `E_MATH_INTERNAL` | An internal error of the addon |
