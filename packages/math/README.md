# @lakutata/math

English | [中文](README.zh-CN.md)

Symbolic mathematics for the [lakutata](https://github.com/lakutata/lakutata) framework: formulas written the way they
are on paper (`x^2 - 5x + 6`, `2(x + 1)`), expanded, derived, solved and evaluated with exact numbers or with decimals
of a chosen precision. The work is done by a native addon built on [SymEngine](https://github.com/symengine/symengine)
and [mpdecimal](https://www.bytereef.org/mpdecimal/), compiled when the package is installed.
The long operations can run in the addon's own threads, with a time limit and a cancellation. The `lakutata` package
does not re-export this package: import it from `@lakutata/math`.

## Installation

```shell
npm install lakutata @lakutata/math
```

- The addon is compiled during the installation (node-gyp), so the machine needs Python 3 and a C++17 compiler: the
  Command Line Tools of Xcode on macOS, `build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, the Build
  Tools of Visual Studio ("Desktop development with C++") on Windows. Compiling takes from about half a minute to a few
  minutes. If it fails, the installation fails.
- The package manager has to run the install script of the package. npm runs it, and may warn that the script is "not
  yet covered by allowScripts": `npm install-scripts approve @lakutata/math` records that you allow it. Bun and pnpm run
  it only for the dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error telling how to build the addon.
- Node.js `^22.13.0 || >=24.11.0`. Its peer dependency `@lakutata/core` is installed with `lakutata`.

## Usage

### The component

`Math` is a component: register it with `buildMathOptions()` (several times under different names for different
definitions), or inject it without registering it to get its default options (`@Inject(Math)`).

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildMathOptions, type Equation, type Expression, Math} from '@lakutata/math'

class Physics extends Component {
    @Inject('math')
    protected readonly math: Math

    public async demo(): Promise<void> {
        const height: Expression = this.math.expression('h0 - fall(t)')
        console.log(height.toString())                                  //-196133t^2/40000 + h0
        console.log(height.diff('t').toString())                         //-196133t/20000
        console.log(height.substitute({h0: 100, t: 2}).toNumber())        //80.3867
        const landing: Equation = this.math.equation('fall(t) = 100')
        console.log(landing.solve('t', {domain: 'real'}).map((t: Expression): number => t.toNumber())) //[-4.516007557517875, 4.516007557517875]
        const expanded: Expression = await this.math.expression('(x + y + 1)^30').expandAsync({timeout: 1000})
        console.log(expanded.variables())                                 //['x', 'y']
    }
}

Application.run(() => ({
    id: 'physics.app',
    name: 'Physics',
    components: {
        math: buildMathOptions({definitions: {'g': 9.80665, 'fall(t)': 'g*t^2/2'}}),
        physics: {class: Physics}
    }
}))
```

Without an application (a script, a test), get the component from a `Container`:

```typescript
import {Container} from 'lakutata'
import {Math} from '@lakutata/math'

const container: Container = new Container()
await container.setNamed('math', Math, {precision: 50})
const math: Math = await container.get<Math>('math')
console.log(math.expression('pi').toDecimal())                           //3.1415926535897932384626433832795028841971693993751
await container.destroy()
```

### Formulas

| Written | Meaning |
|---|---|
| `2x`, `2(x + 1)`, `(x + 1)(x - 1)`, `x (y + 1)` | Products without `*`. A name directly followed by `(` is a function: write `a*(b + c)` to multiply |
| `x^2`, `x**2`, `2^3^2` | Powers, from the right (`2^3^2` is `2^9`) |
| `5!` | Factorial |
| `0.1`, `1.5e3` | Exact decimals: `0.1` is `1/10` |
| `pi`, `e`, `i`, `inf` (or `oo`), `nan`, `phi` (golden ratio), `tau` (`2pi`), `EulerGamma`, `Catalan` | Constants |
| `sin`, `cos`, `tan`, `asin`, `sinh`…, `exp`, `ln`, `log(x)` (natural), `log(x, b)`, `log10`, `log2`, `expm1`, `log1p`, `sqrt`, `cbrt`, `root(x, n)`, `hypot` | Functions |
| `abs`, `sign`, `floor`, `ceil`, `trunc`, `round`, `mod(a, b)`, `min`, `max`, `gcd`, `lcm`, `re`, `im`, `arg`, `conj` | Rounding, remainders, extrema, the parts of complex numbers |
| `gamma`, `loggamma`, `digamma`, `polygamma`, `lowergamma`, `uppergamma`, `beta`, `erf`, `erfc`, `zeta`, `lambertw`, `sinc`, `binomial`, `factorial` | Special functions |
| `x^2 = 4` | An equation (`math.equation()`, or `math.parse()`) |
| `x < 1`, `x >= 0` | An inequality, read by `math.parse()` |

`cbrt(x)` and `root(x, n)` with an odd `n` give the real root of a negative real number (`cbrt(-8)` is `-2`, as
`Math.cbrt`); a fractional power gives the principal value (`(-8)^(1/3)` is `1 + sqrt(3)i`, as SymPy). `round` rounds
the halves away from zero (`round(-2.5)` is `-3`), `mod(a, b)` has the sign of `b` (`mod(-7, 3)` is `2`), `gcd` and
`lcm` take integers. A variable may be a complex number, so `re(x)` stays as written.

Without parentheses, the name of a function is a variable (`gamma`, `beta`, `re`, `mod` are common names of
quantities), except the ones often written without parentheses by mistake — the trigonometric and hyperbolic
functions, `exp`, `ln`, `log` and its variants, `sqrt`, `cbrt`: `sin x` is an error, write `sin(x)`.

The results are written the same way: `toString()` gives a formula that `math.expression()` reads back, and `toTeX()`
gives its LaTeX. A syntax error is a `MathSyntaxException` with the `position` of the character where it is found.

### Definitions

The `definitions` of the component are functions and constants written as formulas. They do not change once the
component is created, so every class that injects the component sees the same ones. `with()` adds more for a while,
without changing the component:

```typescript
import type {Math} from '@lakutata/math'

function prices(math: Math): void {
    const scope = math.with({'net(x)': 'x / (1 + rate)', 'rate': '0.13'})
    console.log(scope.expression('net(113)').toString())                  //100
}
```

Definitions are expanded when a formula is read, so derivatives and equations see through them.

### Exact results and numbers

A formula gives exact results: `0.1 + 0.2` is `3/10`, `sin(pi/6)` is `1/2`, `sqrt(8)` is `2sqrt(2)`. A number times
a sum is multiplied out: `2(x + 1)` is `2x + 2`. Exact numbers are computed up to about 315,000 digits: a larger power
stays a power (`2^(10^7)`), and a factorial above `20000!` stays as `gamma(n + 1)`. Then:

- `toNumber()` gives a number of JavaScript (`MathDomainException` for a complex value), `toComplex()` gives `{re, im}`.
  They compute the values from their decimals where `toDecimal()` or `toComplexDecimal()` computes them, so that all the
  digits of a number are right, also where doubles have none (`cos(10^30)`, `e^(i*10^30)`). Both compute the special
  functions (gamma, zeta, Lambert W, polygamma, erf…) of complex arguments too, in doubles, while the rest of the
  expression stays in decimals.
- `toDecimal(digits)` gives a string with that many significant digits, correctly rounded (the `precision` of the
  component by default), written as `Decimal` writes its digits (see below): `3`, not `3.000…`. The value is computed
  again with more digits until two results agree. It computes the arithmetic, powers and roots, `exp` and `ln`, the
  trigonometric and hyperbolic functions and their inverses, the rounding functions, the constants, and the special
  functions of real arguments: `gamma`, `loggamma`, `digamma`, `polygamma`, `beta`, `erf`, `erfc`, `zeta` (Riemann's and
  Hurwitz's), `lowergamma`, `uppergamma` and `lambertw`. A value that cannot be told from 0, even with 640 more digits,
  is `0` (`ln(6) - ln(2) - ln(3)`); a value whose argument is too large for the digits is computed with as many more
  digits as it needs, up to 50000 (`sin(10^(10^4))` needs 10^4); a value exactly halfway between two decimals of that
  many digits is rounded to the even one (`ln(8)/ln(4)`, which is 1.5, gives `2` to one digit).
- `toComplexDecimal(digits)` gives the two parts of a complex value, `{re, im}`, as strings rounded as `toDecimal()`
  rounds, each part to that many significant digits of its own: the parts of `(1 + i/10^25)^2 - 1` are `-1e-50` and
  `2e-25`. It computes the functions `toDecimal()` computes, of complex arguments too, with their principal branches; on
  a branch cut, a value takes the side SymPy gives it (`asin(2)` is `pi/2 - 1.3169…i`). Its special functions take real
  arguments only.
- `compile()` computes in doubles, for speed: where doubles have no digit of a value, the compiled function has none
  either. Its special functions of real arguments are computed by Boost.Math, within a few units of the last place,
  with the same code on every platform (each C library has a gamma function of its own).
- `toRectangular()` gives the real and the imaginary parts of an expression (`{real, imaginary}`), `toPolar()` its
  modulus and its argument (`{modulus, argument}`): for `e^(i*pi/3)`, the parts are `1/2` and `sqrt(3)/2`, the modulus
  `1` and the argument `pi/3`. The variables are complex numbers, so the parts of `x` are `re(x)` and `im(x)`.
- `compile(variables)` turns an expression into a function of numbers, for evaluating it many times, with `batch()`
  for many rows in one call:

```typescript
import type {Math} from '@lakutata/math'

function plot(math: Math): Float64Array {
    const f = math.expression('x^2 + sin(y)').compile(['x', 'y'])
    console.log(f(2, 0))                                                   //4
    return f.batch(Float64Array.of(1, 0, 2, 0, 3, 0))                      //[1, 4, 9]
}
```

### Decimals

`math.decimal(value, {precision})` gives a `Decimal`: a decimal number with at most `precision` significant digits
(by default the `precision` of the component, 32), for amounts of money, or for values that need many digits. Each
operation rounds its result correctly to that precision: to the nearest decimal with that many digits, halves to even.
A decimal does not change: each operation gives a new one.

- Values are read as they are written: a number by its shortest representation (`0.1` is 0.1, not the binary value of
  the double), a string as a decimal number (`'19.99'`, `'1.5e-7'`), a bigint exactly. An expression without variables
  is computed, as `toDecimal()` does: `math.decimal(math.expression('pi'), {precision: 50})`.
- A result has the precision of the decimal it is computed from: `a.add(b)` has the precision of `a`. The values given
  to an operation are read with all their digits.
- The operations: `add`, `sub`, `mul`, `div`, `mod` (with the sign of the divisor, as `mod()` in formulas), `pow`,
  `neg`, `abs`, `sqrt`, `cbrt`, `root(n)`, `exp`, `ln`, `log10`, `log(base)`, the trigonometric and hyperbolic
  functions and their inverses, `atan2(x)`, `gamma`, `loggamma`, `digamma`, `erf`, `erfc`, `zeta`, `lambertw`,
  `floor`, `ceil`, `trunc`, `round(places)` (halves away from zero, as `round()` in formulas), `compare`, `equals`,
  `isZero`, `isPositive`, `isNegative`, `isInteger`.
- `toString()` writes the digits without trailing zeros, in fixed-point notation when the first digit is between the
  10^-6 place and the 10^(precision - 1) place, in scientific notation otherwise (`1.5`, `0.000025`, `1.5e+25`, `1e-7`).
  `toFixed(places)` writes a given number of places after the point (`toFixed(2)` of 1.5 is `1.50`), and `toNumber()`
  gives the nearest number. A decimal is also an exact value in formulas: `math.expression(decimal)`.
- The operations run on the JavaScript thread, without a time limit. Arithmetic is fast at any precision, but the
  functions take seconds at tens of thousands of digits, and the special functions (`zeta`, `gamma`) at thousands: for
  those, compute an expression with `toDecimalAsync()`, which has a time limit, and make a decimal of its result.

```typescript
import type {Math} from '@lakutata/math'

function decimals(math: Math): void {
    console.log(math.decimal(0.1).add(0.2).toString())                           //0.3
    console.log(math.decimal('19.99').mul(3).toFixed(2))                         //59.97
    console.log(math.decimal(1, {precision: 5}).div(3).toString())               //0.33333
    console.log(math.decimal(2, {precision: 40}).sqrt().toString())              //1.41421356237309504880168872420969807857
}
```

### Code generation

- `toJavaScript()` and `toC()` turn an expression into JavaScript or C code (C99 with `<math.h>`) that keeps the
  variable names: `x^2 - 5x + 6` becomes `Math.pow(x, 2) - 5*x + 6` in JavaScript and `pow(x, 2.0) - 5.0*x + 6.0` in C.
  The code computes in double precision, with real numbers only: wherever part of the expression has a complex value,
  the result is NaN (`compile()` computes such parts in the complex numbers). A function the language does not have
  (such as `gamma` and `erf` in JavaScript, `zeta` and `lambertw` in both), a complex number such as `2i`, or a variable
  whose name is a reserved word of the language or a name the code uses (`new`, `Math`, `pow`) throws
  `MathNotSupportedException`.
- `math.cse(expressions)` finds the parts that the expressions repeat or share (common subexpression elimination). It
  returns them as `replacements`, each with a name (`x0`, `x1`…, skipping names the variables already use) and a value
  that may refer to earlier names, together with the `expressions` rewritten with those names. Printed with
  `toJavaScript()` or `toC()`, the result is code that computes each part only once.

```typescript
import type {Math} from '@lakutata/math'

function code(math: Math): string {
    const {replacements, expressions} = math.cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
    const lines: string[] = replacements.map(({name, value}) => `const ${name} = ${value.toJavaScript()}`)   //const x0 = x + y
    lines.push(`return [${expressions.map((expression) => expression.toJavaScript()).join(', ')}]`)          //return [x0 + Math.pow(Math.sin(x0), 2), Math.cos(x0)]
    return lines.join('\n')
}
```

### Solving

- `solve(variable)` on an equation or an expression (equal to zero) gives the solutions as an array of expressions,
  with their `kind`: `finite`, `empty`, `all`, `intervals`, or `unsolved`/`other` for a set the package does not solve
  (its `text` describes it). Equations of degree four at most are solved exactly. `{domain: 'real'}` keeps the real
  solutions.
- `math.solve(equations, variables)` solves a system of linear equations: an empty array when it has no solution,
  otherwise one solution with the value of each variable it determines (in terms of the others when there are
  infinitely many).

```typescript
import type {Math} from '@lakutata/math'

function solve(math: Math): void {
    console.log(math.expression('x^4 - 1').solve('x').map(String))                    //['-1', '1', '-i', 'i']
    const [solution] = math.solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
    console.log(solution.x.toString(), solution.y.toString())                        //2 1
}
```

### Number theory

`math.ntheory` works on integers: bigints, or numbers that are safe integers. Its integer results are bigints.

- Divisibility and modular arithmetic: `gcd`, `lcm`, `extendedGcd`, `mod`, `modInverse`, `powMod`, and `crt` (the
  Chinese remainder theorem; the moduli need not be coprime). A result modulo `m` has the sign of `m`, as
  `mod(-7, 3)`, which is `2n`.
- Primes: `isPrime` (deterministic below 2^64; above, the Baillie-PSW test, which no known composite number passes),
  `nextPrime`, `factor`, `totient`, `mobius`, `primitiveRoot`, `legendre`, `jacobi`.
- Sequences and combinatorial numbers: `fibonacci`, `lucas`, `binomial`, `factorial`, `doubleFactorial`, with
  `bernoulli` and `harmonic` as exact fractions (expressions). `bernoulli(1)` is `+1/2`, as in SymPy.

When a value does not exist (`modInverse` of a number with no inverse, `primitiveRoot` of a modulus with none, `crt` of
congruences with no common solution), the result is `undefined`. An argument outside the domain of a function
(`totient(0)`, `legendre(a, 9)`) throws `MathDomainException`.

`factor` finds small factors at once and factors numbers of up to about 20 digits quickly, but a number with two large
prime factors can take days: use `factorAsync` with a time limit. `isPrime`, `nextPrime`, `totient`, `mobius` and
`primitiveRoot` have asynchronous versions too. `factorial` computes up to about `71000!`, while in a formula
`factorial(n)` above 20000 stays `gamma(n + 1)`, so that the expression can still be printed.

```typescript
import type {Math} from '@lakutata/math'

async function integers(math: Math): Promise<void> {
    console.log(math.ntheory.factor(360))                     //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
    console.log(math.ntheory.powMod(4, 13, 497))              //445n
    console.log(math.ntheory.crt([2, 3, 2], [3, 5, 7]))       //{remainder: 23n, modulus: 105n}
    console.log(await math.ntheory.factorAsync(2n ** 64n + 1n, {timeout: 5000}))
}
```

### Matrices and linear algebra

`math.matrix(rows)` gives a `Matrix` of numbers (doubles). Its elements are in a `Float64Array`, row by row (`data`),
which the addon reads in place. Its methods give new matrices: `get`, `set` (which changes the matrix), `row`, `column`,
`diagonal`, `submatrix`, `reshape`, `transpose`, `add`, `sub`, `mul`, `div`, `neg`, `multiplyElements`,
`divideElements`, `powElements`, `map`, `trace`, `kron`, `equals`, `toArray` and `toString` (`[1, 2; 3, 4]`).

`math.linalg` holds the linear algebra, computed by Eigen:

- Matrices: `zeros`, `ones`, `identity`, `diagonal`, `fromRows`, `fromColumns`, `fromFunction`, `concat`, and
  `rotation` (in the plane, or about an axis in space).
- Vectors (`Float64Array`s, or arrays of numbers): `dot`, `cross`, `outer`, `norm`.
- `multiply`, `solve` (by LU decomposition with partial pivoting), `solveTriangular`, `leastSquares` (the solution of
  least norm, as NumPy's `lstsq`), `inverse`, `determinant`, `singularValues`, `rank` (the singular values above
  NumPy's default tolerance), `condition`, and the norms of matrices (`'fro'`, 1, 2, `Infinity`).
- Decompositions: `lu` (`P A = L U`; `permutation[i]` is the row of A that becomes row i of `P A`), `qr` and `svd` (both
  thin, with `min(rows, columns)` columns), `cholesky`, `eigen` (complex eigenvalues and eigenvectors, as real and
  imaginary parts), `symmetricEigen`, `schur` (the real Schur form), and `pseudoInverse`. `cholesky` and
  `symmetricEigen` read only the lower triangle of the matrix, as NumPy does. The signs of the columns of Q, of the
  singular vectors and of the eigenvectors are Eigen's: another library may negate them.
- Functions of matrices and matrix equations: `exponential` (`e^A`, as mathjs's `expm`), `squareRoot` (the principal
  square root, where it is real), `sylvester` (the X of `A X + X B = C`) and `lyapunov` (the P of `A P + P Aᵀ + Q = 0`,
  as mathjs's `lyap` and MATLAB's; SciPy's `solve_continuous_lyapunov` solves `A X + X Aᴴ = Q`, so this P is its
  solution for `-Q`).

A vector given as the right side gives a vector: `solve(a, [5, 5])` is a `Float64Array`, while a matrix (one right side
per column) gives a matrix. For `solve` and `inverse`, a matrix is singular when its LU decomposition meets a pivot of
exactly 0, as in NumPy: a nearly singular matrix gives large values instead, and `condition()` shows how close to
singular it is.

`math.linalg.sparse(rows, columns, entries)` makes a `SparseMatrix` of the entries given, `[row, column, value]` (the
entries at the same place are added up), and `math.linalg.sparse(matrix)` one from the elements of a dense matrix that
are not 0. A `SparseMatrix` stores its entries in compressed rows (CSR: `rowPointers`, `columnIndices`, `values`). Its
methods are `get`, `transpose`, `add`, `sub`, `neg`, `mul` (by a number, a vector, a dense matrix, or a sparse matrix,
the last computed by Eigen), `toDense` and `toEntries`. `solve` with a sparse matrix uses the sparse LU decomposition of
Eigen (`SparseLU`, with the COLAMD ordering): a matrix it cannot factorize, such as one with a row of zeros, is
singular. `conjugateGradient` (for a symmetric positive definite matrix, not checked) and
`biconjugateGradientStabilized` (BiCGSTAB, for any square matrix) iterate until the relative residual `‖b - A x‖ / ‖b‖`
falls to `tolerance` (1e-10 by default), within `maxIterations` iterations (10 times the size of the system by default);
`converged` tells whether they did, and a `guess` lets a call go on from the solution of an earlier one.

The operations that take long on large matrices have asynchronous versions (`solveAsync()`, `inverseAsync()`,
`multiplyAsync()`…), which copy their arguments when they are called. Eigen's computations cannot be interrupted: past
the time limit or when the operation is cancelled, the promise is rejected, but its thread finishes the work before it
is free again.

```typescript
import type {Math} from '@lakutata/math'

async function systems(math: Math): Promise<void> {
    const a = math.matrix([[4, 1], [2, 3]])
    console.log(math.linalg.solve(a, [5, 5]))                 //Float64Array [1, 1]
    console.log(math.linalg.inverse(a).toString())            //[0.3, -0.1; -0.2, 0.4]
    console.log(math.linalg.determinant(a))                   //10
    console.log(a.mul(a).toString())                          //[18, 7; 14, 11]
    console.log(math.linalg.leastSquares([[1, 1], [1, 2], [1, 3]], [1, 2, 2]))
    const big = math.linalg.fromFunction(1000, 1000, (i, j) => (i === j ? 1000 : 1 / (1 + i + j)))
    const inverse = await math.linalg.inverseAsync(big, {timeout: 5000})
    console.log(inverse.get(0, 0))
    const sparse = math.linalg.sparse(3, 3, [[0, 0, 2], [0, 1, -1], [1, 0, -1], [1, 1, 2], [2, 2, 2]])
    console.log(math.linalg.solve(sparse, [1, 1, 2]))         //Float64Array [1, 1, 1]
    console.log(math.linalg.conjugateGradient(sparse, [1, 1, 2]).converged)   //true
}
```

### Statistics

`math.stats` computes statistics of values (arrays of numbers, or `Float64Array`s) in the addon: `sum` (compensated for
its roundings: the sum of `[1e16, 1, -1e16]` is 1), `product`, `cumulativeSum`, `differences`, `mean`, `median`, `mode`
(all the values that occur most often, ascending), `min`, `max`, `variance`, `standardDeviation`,
`medianAbsoluteDeviation`, `quantile`, `covariance`, `correlation` (Pearson's), `zScores` and `klDivergence` (the
Kullback-Leibler divergence, with the natural logarithm, of distributions that are first scaled to sums of 1).

A variance divides the sum of the squared deviations from the mean by n by default: the values are the whole population,
as in NumPy. `{normalization: 'unbiased'}` divides it by n - 1 (the values are a sample, the default of mathjs), and
`'biased'` by n + 1; `standardDeviation`, `covariance` and `zScores` take the same option. Variances and covariances are
computed in two passes, so they keep their digits under a large offset: the variance of `[1e9 + 4, 1e9 + 7, 1e9 + 13,
1e9 + 16]` is 22.5. A quantile interpolates linearly between the two values around it, as NumPy's default method and
mathjs's `quantileSeq` do. A NaN among the values gives NaN. Of no values, the statistics that have none (the mean, the
median, the variance…) throw `MathArgumentException`, while the sum is 0 and the product 1.

```typescript
import type {Math} from '@lakutata/math'

function statistics(math: Math): void {
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    console.log(math.stats.mean(values))                                           //5
    console.log(math.stats.standardDeviation(values))                              //2
    console.log(math.stats.standardDeviation(values, {normalization: 'unbiased'})) //2.138089935299395
    console.log(math.stats.quantile(values, [0.25, 0.75]))                         //Float64Array [4, 5.5]
    console.log(math.stats.correlation(values, [1, 3, 2, 5, 4, 6, 8, 7]))          //0.8455943246644705
}
```

### Asynchronous operations

The operations that can take long have an asynchronous version: `expandAsync()`, `simplifyAsync()`, `diffAsync()`,
`seriesAsync()`, `solveAsync()`, `toDecimalAsync()`, `toComplexDecimalAsync()`, `solveAsync()` and `cseAsync()` of the
component, and those of the number theory and of the linear algebra. They run in the threads of the addon, not in the
thread pool of libuv: as many threads as the processor has cores, minus one, or the number in the environment variable
`LAKUTATA_MATH_THREADS`. Their options are `timeout` (milliseconds) and `signal` (an `AbortSignal`):

- At the time limit the promise is rejected with `MathTimeoutException`, and with `MathCancelledException` when the
  signal aborts. Operations with checkpoints (expansions, decimals, linear systems, the number theory) stop at the next
  one; the others run to the end before their thread is free again.
- The component limits how many of its operations run at the same time (`concurrency`). Its destruction waits for the
  ones running, at most `drainTimeout` milliseconds.

The expressions are nested 1000 levels deep at most: a deeper formula is refused with `MathNotSupportedException`
before its operations could overflow the stack.

### Packaging

The bundles, the executables and the installers made by `lakutata package` carry the compiled addon
(`build/Release/math.node`): build them on each target platform, after installing the package there.

## API

| Export | What it is |
|---|---|
| `Math` | The component: `parse`, `expression`, `equation`, `decimal`, `matrix`, `with`, `solve`, `solveAsync`, `cse`, `cseAsync`, `ntheory`, `linalg`, `stats` |
| `buildMathOptions`, `MathConfig` | Its declaration in the components, and its options: `definitions`, `precision`, `timeout`, `concurrency`, `drainTimeout` |
| `MathScope`, `MathDefinitions` | The scope given by `with()`, with the methods of the component except `ntheory`, `linalg` and `stats`; the definitions (a body by signature) |
| `Expression` | An expression: `toString`, `toTeX`, `toNumber`, `toComplex`, `toDecimal`, `toComplexDecimal`, `variables`, `equals`, `add`, `sub`, `mul`, `div`, `pow`, `neg`, `expand`, `simplify`, `diff`, `series`, `substitute`, `evaluate`, `solve`, `compile`, the polynomials (`coefficients`, `degree`, `leadingCoefficient`, `divide`), `numerator`, `denominator`, `rewrite` (`exp`, `sin`, `cos`), the predicates (`isZero`, `isPositive`, `isNegative`, `isInteger`, `isRational`, `isReal`, `isFinite`: `undefined` when not known), `compare`, `toJavaScript`, `toC`, `toPolar`, `toRectangular`, and the asynchronous versions |
| `Decimal`, `DecimalValue`, `DecimalOptions` | A decimal of a precision (`math.decimal()`): `precision`, `add`, `sub`, `mul`, `div`, `mod`, `pow`, `neg`, `abs`, `sqrt`, `cbrt`, `root`, `exp`, `ln`, `log10`, `log`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `gamma`, `loggamma`, `digamma`, `erf`, `erfc`, `zeta`, `lambertw`, `floor`, `ceil`, `trunc`, `round`, `compare`, `equals`, `isZero`, `isPositive`, `isNegative`, `isInteger`, `toString`, `toFixed`, `toNumber`, `toJSON`; what is given where a decimal is expected (a decimal, a number, a bigint, a decimal number written as a string); the option of `decimal()` (`precision`) |
| `Matrix`, `MatrixValue`, `VectorValue` | A matrix of numbers (`math.matrix()`): `rows`, `columns`, `data`, `get`, `set`, `row`, `column`, `diagonal`, `submatrix`, `reshape`, `transpose`, `add`, `sub`, `mul`, `div`, `neg`, `multiplyElements`, `divideElements`, `powElements`, `map`, `trace`, `kron`, `equals`, `clone`, `toArray`, `toJSON`, `toString`; what is given where a matrix is expected (a matrix, or its rows); where a vector is (a `Float64Array`, or an array of numbers) |
| `LinearAlgebra`, `NormKind` | The linear algebra (`math.linalg`): `zeros`, `ones`, `identity`, `diagonal`, `fromRows`, `fromColumns`, `fromFunction`, `concat`, `rotation`, `dot`, `cross`, `outer`, `norm`, `multiply`, `solve`, `solveTriangular`, `leastSquares`, `inverse`, `determinant`, `singularValues`, `rank`, `condition`, `lu`, `qr`, `cholesky`, `svd`, `eigen`, `symmetricEigen`, `schur`, `pseudoInverse`, `exponential`, `squareRoot`, `sylvester`, `lyapunov`, `sparse`, `conjugateGradient`, `biconjugateGradientStabilized`, and the asynchronous versions; the kinds of norms |
| `Statistics`, `Normalization`, `NormalizationOptions` | The statistics (`math.stats`): `sum`, `product`, `cumulativeSum`, `differences`, `mean`, `median`, `mode`, `min`, `max`, `variance`, `standardDeviation`, `medianAbsoluteDeviation`, `quantile`, `covariance`, `correlation`, `zScores`, `klDivergence`; the divisors of a variance (`'uncorrected'`, `'unbiased'`, `'biased'`) and the option that chooses one |
| `SparseMatrix`, `SparseEntry` | A sparse matrix in compressed rows (`math.linalg.sparse()`): `rowPointers`, `columnIndices`, `values`, `nonZeros`, `get`, `transpose`, `add`, `sub`, `neg`, `mul`, `toDense`, `toEntries`; an entry `[row, column, value]` |
| `IterativeOptions`, `IterativeSolution` | The options of the iterative solvers (`tolerance`, `maxIterations`, `guess`) and their result (`solution`, `iterations`, `error`, `converged`) |
| `LuDecomposition`, `QrDecomposition`, `SingularValueDecomposition`, `EigenDecomposition`, `SymmetricEigenDecomposition`, `SchurDecomposition`, `ComplexVector`, `ComplexMatrix` | The results of the decompositions: `{lower, upper, permutation}`, `{q, r}`, `{u, singularValues, v}`, `{values, vectors}` (complex: `{re, im}`), `{values, vectors}`, `{u, t}` |
| `CommonSubexpressions`, `CseOptions` | The result of `cse()` (`replacements`, `expressions`) and its option (`prefix`) |
| `PolarForm`, `RectangularForm` | The polar form (`modulus`, `argument`) and the rectangular form (`real`, `imaginary`) of a complex value |
| `Equation`, `Inequality`, `InequalityRelation` | An equation (`left`, `right`, `difference`, `substitute`, `solve`, `solveAsync`), an inequality (`left`, `right`, `relation`) |
| `Solutions`, `SolutionsKind`, `SolutionInterval`, `SolveOptions` | The solutions of an equation: an array of expressions with their `kind`, `intervals` and `text`; the `domain` of the solutions |
| `SystemSolution`, `SystemEquation` | A solution of a system (an expression by variable), an equation of a system |
| `CompiledFunction` | A compiled expression: a function of numbers, its `variables`, `batch` |
| `NumberTheory`, `IntegerValue`, `PrimeFactor`, `ExtendedGcd`, `Congruence` | The number theory (`math.ntheory`): `gcd`, `lcm`, `extendedGcd`, `mod`, `modInverse`, `powMod`, `isPrime`, `nextPrime`, `factor`, `totient`, `mobius`, `primitiveRoot`, `legendre`, `jacobi`, `crt`, `fibonacci`, `lucas`, `binomial`, `factorial`, `doubleFactorial`, `bernoulli`, `harmonic`, and the asynchronous versions; an integer (a bigint, or a number that is a safe integer); a prime factor and its exponent; the result of `extendedGcd`; the result of `crt` |
| `AsyncOptions`, `Value` | The options of the asynchronous operations (`timeout`, `signal`); what is given where an expression is expected (an expression, a number, a bigint, a decimal, a formula) |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `MathSyntaxException` | A formula is not written correctly (with the `position` of the error), an equation is given where an expression is expected, or the other way round |
| `MathUnknownFunctionException` | A formula calls a function that is neither built in nor defined, or a constant written as a call (`g(2)`), with its `position` |
| `MathDefinitionException` | A definition is not valid: a built-in name, a parameter given twice, definitions referring to each other in a cycle, a definition nested too deep |
| `MathDomainException` | A complex value asked as a number, the value of an infinity or of `complexInfinity` (a division by zero, also by a value not shown to differ from 0 in `toNumber()`), an integer outside the domain of a function of the number theory (`totient(0)`), a singular matrix where an inverse is needed (`solve()`, `inverse()`), a matrix given to `cholesky()` that is not positive definite, a matrix given to `squareRoot()` whose principal square root is not real or does not exist, a Sylvester or Lyapunov equation without a unique solution, a decimal outside the domain of a function (the square root of a negative decimal, `asin()` of 2, a negative decimal to a non-integer power) |
| `MathDivisionByZeroException` | A division by zero met while computing decimals (also by a value not shown to differ from 0, the logarithm of 0, 0 to a negative power, a logarithm in base 1, a function at one of its poles: `gamma()` of -2, `zeta()` of 1), a modulus of 0 |
| `MathNotSupportedException` | An operation the package does not do for this expression: a nonlinear system, an expression that cannot be compiled, an expression nested more than 1000 levels deep, an exact number too large to compute met by an operation, `gcd` or `lcm` of numbers that are not integers, a result of the number theory of more than 2^20 bits, `bernoulli(n)` above 2000, `harmonic(n)` above 50000, code with a function the language does not have, a complex number such as `2i`, a variable named like a reserved word of the language, eigenvalues whose computation does not converge, the decimals of `polygamma(n, x)` when `n` is not an integer, a decimal whose exponent is beyond the range of decimals (about ±10^18, ±4.25 × 10^8 on 32-bit systems: `exp()` of 10^19, also in `toDecimal()`), or a decimal value that needs more than 50000 digits beyond the ones asked (`sin(10^(10^6))`) |
| `MathArgumentException` | An argument that is not valid: variables left where a number is asked, a name that is not a variable, the wrong number of values, a value that is not an integer where one is asked, a value that is not a decimal number where one is asked, a precision outside 1 to 100000, matrices or vectors of the wrong dimensions, a sparse matrix whose structure is not valid (also when its arrays were changed after it was made), no values where a statistic has none, a probability of a quantile outside 0 to 1, negative probabilities for `klDivergence` |
| `MathTimeoutException`, `MathCancelledException` | An asynchronous operation past its time limit, or cancelled |
| `MathException` | The base of all of them; its `errno` is `E_MATH_INTERNAL` for an internal error of the addon |

## See also

- [SymEngine](https://github.com/symengine/symengine): the symbolic engine the addon is built on.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon and their licenses.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
