# @lakutata/math

English | [中文](README.zh-CN.md)

Mathematics for Node.js: formulas written the way they are on paper (`x^2 - 5x + 6`, `2(x + 1)`), expanded,
differentiated, solved and evaluated with exact numbers or with decimals of a chosen precision; numeric matrices and
linear algebra, statistics and probability distributions, numeric roots. The work is done by a native addon built on
[SymEngine](https://github.com/symengine/symengine), [Boost](https://www.boost.org),
[Eigen](https://eigen.tuxfamily.org) and [mpdecimal](https://www.bytereef.org/mpdecimal/), compiled when the package is
installed. The long operations can run in the addon's own threads, with a time limit and a cancellation. It belongs to
the [lakutata](https://github.com/lakutata/lakutata) family but needs no lakutata application. Its functions work on
their own: import them from `@lakutata/math` and call them.

## Installation

```shell
npm install @lakutata/math
```

- The addon is compiled during the installation (node-gyp), so the machine needs Python 3 and a C++17 compiler: the
  Command Line Tools of Xcode on macOS, `build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, the Build
  Tools of Visual Studio ("Desktop development with C++") on Windows. Compiling takes from about half a minute to a few
  minutes. If it fails, the installation fails.
- The package manager has to run the install script of the package. npm runs it, and may warn that the script is "not
  yet covered by allowScripts": `npm install-scripts approve @lakutata/math` records that you allow it. Bun and pnpm run
  it only for the dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error telling how to build the addon.
- Node.js `^22.13.0 || >=24.11.0`.

## Usage

### Getting started

The package exports its functions ready to use: `parse`, `expression`, `equation`, `decimal`, `matrix`,
`expressionMatrix`, `jacobian`, `unit`, `constant`, `solve` and `cse`, with the namespaces `ntheory` (number theory),
`poly` (polynomials), `linalg` (linear algebra), `stats` (statistics and probability) and `numeric` (numeric solutions,
integrals and differential equations). They belong to `math`, the scope made with the default options.

```typescript
import {decimal, equation, expression, linalg, stats} from '@lakutata/math'

const height = expression('h0 - 9.80665*t^2/2')
console.log(height.diff('t').toString())                           //-196133t/20000
console.log(height.substitute({h0: 100, t: 2}).toNumber())         //80.3867
console.log(equation('x^2 - 5x + 6 = 0').solve('x').map(String))   //['2', '3']
console.log(decimal('0.1').add('0.2').toString())                  //0.3
console.log(linalg.solve([[4, 1], [2, 3]], [5, 5]))                //Float64Array [1, 1]
console.log(stats.mean([2, 4, 4, 4, 5, 5, 7, 9]))                  //5
```

### Options

`createMath(options)` makes a `MathScope` with other options and the same functions: its `definitions` (functions and
constants written as formulas, none by default), the `precision` of its decimals (32 significant digits by default), the
`timeout` of its asynchronous operations (milliseconds, 0 for none by default), their `concurrency` (all the threads of
the addon by default) and its `units` (units added to the table, none by default). Every option has a default value, so
`createMath()` alone is the same as `math`. A program may make several, for several sets of definitions.

```typescript
import {createMath, type Equation, type Expression, type MathScope} from '@lakutata/math'

const physics: MathScope = createMath({definitions: {'g': 9.80665, 'fall(t)': 'g*t^2/2'}, precision: 50})
const height: Expression = physics.expression('h0 - fall(t)')
console.log(height.toString())                      //-196133t^2/40000 + h0
const landing: Equation = physics.equation('fall(t) = 100')
console.log(landing.solve('t', {domain: 'real'}).map((t: Expression): number => t.toNumber()))   //[-4.516007557517875, 4.516007557517875]
console.log(physics.expression('pi').toDecimal())   //3.1415926535897932384626433832795028841971693993751
const expanded: Expression = await physics.expression('(x + y + 1)^30').expandAsync({timeout: 1000})
console.log(expanded.variables())                   //['x', 'y']
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
| `piecewise(x^2, x < 0, x)`, `step`, `rect`, `tri` | A piecewise expression: values with their conditions, then the value where none holds; `step`, `rect` and `tri` are written as one |
| `sum(k^2, k, 1, n)`, `product(k, k, 1, n)` | A sum, a product: the term, its variable, the first and the last value (integers, `-inf` or `inf`) |
| `x^2 = 4` | An equation (`equation()`, or `parse()`) |
| `x < 1`, `x >= 0` | An inequality, read by `parse()` |
| `[1, 2; 3, 4]`, `[x; y]` | A matrix: its rows separated by `;`, its elements by `,` (`parse()` gives an `ExpressionMatrix`). Matrices are added, multiplied (`[1, 2; 3, 4] * [x; y]`, `2[1, 2]`), divided by a number and raised to integer powers; `det`, `inv`, `transpose` and `trace` take a matrix |

`cbrt(x)` and `root(x, n)` with an odd `n` give the real root of a negative real number (`cbrt(-8)` is `-2`, as
`Math.cbrt`); a fractional power gives the principal value (`(-8)^(1/3)` is `1 + sqrt(3)i`, as SymPy). `round` rounds
the halves away from zero (`round(-2.5)` is `-3`), `mod(a, b)` has the sign of `b` (`mod(-7, 3)` is `2`), `gcd` and
`lcm` take integers. A variable may be a complex number, so `re(x)` stays as written.

In `piecewise(v1, c1, v2, c2, …, v)`, each value applies where its condition holds and no earlier one does; the last
value, after the conditions, applies where no condition holds, and without it the expression is undefined there (`nan`).
A condition compares values (`<`, `<=`, `>`, `>=`, `=`, `!=`; `0 <= x < 1` is `0 <= x and x < 1`), with `and`, `or`,
`not` and parentheses; these three words cannot be variables. The comparisons of constants are decided exactly
(`piecewise(1, sqrt(2) < 3/2, 2)` is `1`), comparisons with variables are decided once the variables have values
(`substitute()`); a complex value in a comparison throws `MathDomainException`. `step(x)` is 0 below 0, 1/2 at 0 and 1
above (SymPy's `Heaviside`), `rect(x)` is 1 for `|x| < 1/2`, 1/2 at `|x| = 1/2` and 0 beyond, and `tri(x)` is `1 - |x|`
for `|x| < 1` and 0 beyond — nerdamer's definitions. A piecewise expression is derived case by case (the derivative of
`step(x)` is 0: there is no Dirac delta), compiled, written in LaTeX with `cases` and in JavaScript and C with
conditional expressions; `numeric.integrate()` splits the interval where the case changes.

```typescript
import {expression} from '@lakutata/math'

const f = expression('piecewise(x^2, x < 0, x)')
console.log(f.diff('x').toString())           //piecewise(2x, x < 0, 1)
console.log(f.substitute({x: -3}).toString()) //9
console.log(f.toTeX())                        //\begin{cases} x^{2} & \text{for}\: x < 0 \\ x & \text{otherwise} \end{cases}
```

`sum(f, k, a, b)` and `product(f, k, a, b)` are the sum and the product of `f` for `k` from `a` to `b`; `a` and `b` are
integers, `-inf` or `inf`, or expressions of other variables. `k` is bound: it is not a variable of the expression, and
`substitute()` and `diff()` leave it alone. As in SymPy, `b = a - 1` gives 0 (1 for a product), and `b < a - 1` the sum
from `b + 1` to `a - 1` with the sign changed (the reciprocal of the product). Between integers at most 1000 apart, the
terms are computed one by one, exactly. Otherwise a closed form is looked for: the sum of a polynomial in `k` (`sum(k^2,
k, 1, n)` is `n^3/3 + n^2/2 + n/6`), of a geometric series (`sum(x^k, k, 0, n)` is `piecewise(n + 1, x = 1, (-x^(n + 1)
+ 1)/(-x + 1))`; to `inf`, its value where `abs(x) < 1`), of a power of `1/(k + q)` (with `zeta` and `polygamma`:
`sum(1/k^2, k, 1, inf)` is `pi^2/6`), or of a sum of these, term by term; the product of powers, or of a fraction of
polynomials with linear factors (with `gamma`: `product(1 - 1/k^2, k, 2, n)` is `(n + 1)/(2n)`). The others stay as
`sum(…)` and `product(…)`: their values are computed term by term between integers, up to 10^4 terms, and they cannot be
compiled.

```typescript
import {expression} from '@lakutata/math'

console.log(expression('sum(k^2, k, 1, n)').toString())              //n^3/3 + n^2/2 + n/6
console.log(expression('sum(1/k^2, k, 1, inf)').toString())          //pi^2/6
console.log(expression('product(1 - 1/k^2, k, 2, n)').toString())    //(n + 1)/(2n)
console.log(expression('sum(sin(k*x), k, 1, n)').diff('x').toTeX()) //\sum_{k = 1}^{n} k \cos\left(k x\right)
```

Without parentheses, the name of a function is a variable (`gamma`, `beta`, `re`, `mod` are common names of
quantities), except the ones often written without parentheses by mistake — the trigonometric and hyperbolic
functions, `exp`, `ln`, `log` and its variants, `sqrt`, `cbrt`: `sin x` is an error, write `sin(x)`.

The results are written the same way: `toString()` gives a formula that `expression()` reads back, and `toTeX()`
gives its LaTeX. A syntax error is a `MathSyntaxException` with the `position` of the character where it is found.

### Definitions

The `definitions` of `createMath()` are functions and constants written as formulas. They do not change once the scope
is made, so every part of a program that uses it sees the same ones. `with()` adds more for a while, without changing
it:

```typescript
import {math} from '@lakutata/math'

const scope = math.with({'net(x)': 'x / (1 + rate)', 'rate': '0.13'})
console.log(scope.expression('net(113)').toString())   //100
```

Definitions are expanded when a formula is read, so derivatives and equations see through them.

### Exact results and numbers

A formula gives exact results: `0.1 + 0.2` is `3/10`, `sin(pi/6)` is `1/2`, `sqrt(8)` is `2sqrt(2)`. A number times a
sum is multiplied out (`2(x + 1)` is `2x + 2`), and integers to the same rational power are multiplied together
(`sqrt(2)*sqrt(3)` is `sqrt(6)`), as in SymPy. Exact numbers are computed up to about 315,000 digits: a larger power
stays a power (`2^(10^7)`), and a factorial above `20000!` stays as `gamma(n + 1)`. Then:

- `toNumber()` gives a number of JavaScript (`MathDomainException` for a complex value), `toComplex()` gives `{re, im}`.
  They compute the values from their decimals where `toDecimal()` or `toComplexDecimal()` computes them, so that all the
  digits of a number are right, also where doubles have none (`cos(10^30)`, `e^(i*10^30)`). Both compute the special
  functions (gamma, zeta, Lambert W, polygamma, erf…) of complex arguments too, in doubles, while the rest of the
  expression stays in decimals.
- `toDecimal(digits)` gives a string with that many significant digits, correctly rounded (the `precision` of the
  scope by default), written as `Decimal` writes its digits (see below): `3`, not `3.000…`. The value is computed
  again with more digits until two results agree. It computes the arithmetic, powers and roots, `exp` and `ln`, the
  trigonometric and hyperbolic functions and their inverses, the rounding functions, the constants, and the special
  functions of real arguments: `gamma`, `loggamma`, `digamma`, `polygamma`, `beta`, `erf`, `erfc`, `zeta` (Riemann's and
  Hurwitz's), `lowergamma`, `uppergamma` and `lambertw`. A value that cannot be told from 0, even with 640 more digits,
  is `0` (`ln(6) - ln(2) - ln(3)`); a value whose argument is too large for the digits is computed with as many more
  digits as it needs, up to 50000 (`sin(10^(10^4))` needs 10^4); a value exactly halfway between two decimals of that
  many digits is rounded to the even one (`ln(8)/ln(4)`, which is 1.5, gives `2` to one digit). A real value with
  complex parts (`e^(i*pi)`, `-i*asinh(i)`) is the real part of `toComplexDecimal()`; a complex value throws
  `MathDomainException`.
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
import {expression} from '@lakutata/math'

const f = expression('x^2 + sin(y)').compile(['x', 'y'])
console.log(f(2, 0))                                      //4
console.log(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0)))   //Float64Array [1, 4, 9]
```

### Decimals

`decimal(value, {precision})` gives a `Decimal`: a decimal number with at most `precision` significant digits
(by default the `precision` of the scope, 32), for amounts of money, or for values that need many digits. Each
operation rounds its result correctly to that precision: to the nearest decimal with that many digits, halves to even.
A decimal does not change: each operation gives a new one.

- Values are read as they are written: a number by its shortest representation (`0.1` is 0.1, not the binary value of
  the double), a string as a decimal number (`'19.99'`, `'1.5e-7'`), a bigint exactly. An expression without variables
  is computed, as `toDecimal()` does: `decimal(expression('pi'), {precision: 50})`.
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
  gives the nearest number. A decimal is also an exact value in formulas: `expression(decimal)`.
- The operations run on the JavaScript thread, without a time limit. Arithmetic is fast at any precision, but the
  functions take seconds at tens of thousands of digits, and the special functions (`zeta`, `gamma`) at thousands: for
  those, compute an expression with `toDecimalAsync()`, which has a time limit, and make a decimal of its result.

```typescript
import {decimal} from '@lakutata/math'

console.log(decimal(0.1).add(0.2).toString())                //0.3
console.log(decimal('19.99').mul(3).toFixed(2))              //59.97
console.log(decimal(1, {precision: 5}).div(3).toString())    //0.33333
console.log(decimal(2, {precision: 40}).sqrt().toString())   //1.41421356237309504880168872420969807857
```

### Code generation

- `toJavaScript()` and `toC()` turn an expression into JavaScript or C code (C99 with `<math.h>`) that keeps the
  variable names: `x^2 - 5x + 6` becomes `Math.pow(x, 2) - 5*x + 6` in JavaScript and `pow(x, 2.0) - 5.0*x + 6.0` in C.
  The code computes in double precision, with real numbers only: wherever part of the expression has a complex value,
  the result is NaN (`compile()` computes such parts in the complex numbers). A function the language does not have
  (such as `gamma` and `erf` in JavaScript, `zeta` and `lambertw` in both), a complex number such as `2i`, or a variable
  whose name is a reserved word of the language or a name the code uses (`new`, `Math`, `pow`) throws
  `MathNotSupportedException`.
- `cse(expressions)` finds the parts that the expressions repeat or share (common subexpression elimination). It
  returns them as `replacements`, each with a name (`x0`, `x1`…, skipping names the variables already use) and a value
  that may refer to earlier names, together with the `expressions` rewritten with those names. Printed with
  `toJavaScript()` or `toC()`, the result is code that computes each part only once.

```typescript
import {cse} from '@lakutata/math'

const {replacements, expressions} = cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
const lines: string[] = replacements.map(({name, value}) => `const ${name} = ${value.toJavaScript()}`)   //const x0 = x + y
lines.push(`return [${expressions.map((expression) => expression.toJavaScript()).join(', ')}]`)   //return [x0 + Math.pow(Math.sin(x0), 2), Math.cos(x0)]
console.log(lines.join('\n'))
```

### Solving

- `solve(variable)` on an equation or an expression (equal to zero) gives the solutions as an array of expressions, with
  their `kind` (`finite`, `empty`, `all`, `intervals`, or `unsolved`/`other` for a set the package does not solve, which
  its `text` describes) and all of them as a set (`set`, see below). A polynomial in the variable of degree two or more
  is factored first: a linear factor gives its root at once, and the others are solved exactly to degree four (`x^3 -
  6x^2 + 11x - 6 = 0` gives 1, 2 and 3, not the radicals of Cardano's formula; `x^2 - (a + b)x + a*b = 0` gives a and
  b), and a binomial `a x^n + b` of any degree (`x^5 = 2` gives `2^(1/5)` times the fifth roots of 1). `{domain:
  'real'}` keeps the real solutions.
- `solve(equations, variables)` solves a system of linear equations: an empty array when it has no solution,
  otherwise one solution with the value of each variable it determines (in terms of the others when there are
  infinitely many).
- `solve(variable)` on an inequality (`parse('x^2 < 4')`) gives its real solutions as a set of intervals and values
  (`x^2*(x + 1) <= 0` gives `(-inf, -1] ∪ {0}`); the array holds the values outside the intervals (`0`). Both sides must
  be fractions of polynomials in the variable with rational coefficients; a zero of a denominator is never a solution
  (`1/(1 + 1/x) > 0` excludes `-1` and `0`). The real roots of each irreducible factor are isolated by Descartes' rule
  of signs, then matched with the exact roots found for it; a root without an exact form (`x^5 - x - 1`), a coefficient
  that is not rational (`sqrt(2)*x < 1`), another variable or another function throws `MathNotSupportedException`
  (`numeric.polynomialRoots()` gives the values of the roots).
- A set of numbers (`MathSet`) holds intervals of real numbers with exact ends, and values: `interval(start, end,
  {startOpen, endOpen})` and `finiteSet(values)` make one, and the `set` of solutions is one. It has `union`,
  `intersect`, `complement` (in the real numbers), `difference`, `contains` (`undefined` when not known), `equals`,
  `isEmpty`, `toString` (`[0, 2) ∪ {3}`) and `toTeX`. The ends are compared exactly (`compare()`); ends that cannot be
  ordered, as those with variables, throw `MathNotSupportedException`. The set of the solutions of an equation the
  package does not solve (`sin(x) = 0`) has the kind `other`, which the operations do not take.

```typescript
import {expression, finiteSet, type Inequality, interval, parse, solve} from '@lakutata/math'

console.log(expression('x^4 - 1').solve('x').map(String))   //['-1', '1', '-i', 'i']
const [solution] = solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
console.log(solution.x.toString(), solution.y.toString())   //2 1
console.log((parse('(x + 1)/(x - 2) >= 0') as Inequality).solve('x').toString()) //(-inf, -1] ∪ (2, inf)
const set = interval(0, 2, {endOpen: true}).union(finiteSet([3]))
console.log(set.complement().toString(), set.contains('sqrt(2)')) //(-inf, 0) ∪ [2, 3) ∪ (3, inf) true
```

### Number theory

`ntheory` works on integers: bigints, or numbers that are safe integers. Its integer results are bigints.

- Divisibility and modular arithmetic: `gcd`, `lcm`, `extendedGcd`, `mod`, `modInverse`, `powMod`, and `crt` (the
  Chinese remainder theorem; the moduli need not be coprime). A result modulo `m` has the sign of `m`, as
  `mod(-7, 3)`, which is `2n`.
- Primes: `isPrime` (deterministic below 2^64; above, the Baillie-PSW test, which no known composite number passes),
  `nextPrime`, `factor`, `totient`, `mobius`, `primitiveRoot`, `legendre`, `jacobi`.
- Sequences and combinatorial numbers: `fibonacci`, `lucas`, `binomial`, `factorial`, `doubleFactorial`, with
  `bernoulli` and `harmonic` as exact fractions (expressions). `bernoulli(1)` is `+1/2`, as in SymPy.
- Counting: `permutations(n, k)` (the arrangements of k of n items), `combinationsWithRepetition(n, k)`,
  `multinomial(counts)`, `bell(n)` (the partitions of a set of n items), `catalan(n)`, `stirlingSecondKind(n, k)` (its
  partitions into k blocks) and `compositions(n, k)` (the ways to write n as an ordered sum of k positive integers).
  Where there is nothing to count (k of n items with `k > n`), the count is 0 (mathjs throws).
- Continued fractions: `continuedFraction(value, {terms})` gives the terms of the continued fraction of a real number,
  `a0 + 1/(a1 + 1/(a2 + …))`: all of them for a rational number (a number of JavaScript is the decimal it prints as:
  `0.1` is 1/10), the last one above 1, as SymPy; the first terms of another value, as many as `terms` asks (20 by
  default) (`sqrt(2)`, `pi`), each one certain, computed from its decimals with more digits until they settle each one.
  A value that cannot be told from an integer even with thousands of digits ends the continued fraction there.
  `fromContinuedFraction(terms)` gives the value of a list of terms, and `convergents(terms)` the values of its first
  terms, one by one (`22/7`, `355/113` for pi), the best rational approximations of the value; both are exact fractions
  (expressions).

When a value does not exist (`modInverse` of a number with no inverse, `primitiveRoot` of a modulus with none, `crt` of
congruences with no common solution), the result is `undefined`. An argument outside the domain of a function
(`totient(0)`, `legendre(a, 9)`) throws `MathDomainException`.

`factor` finds small factors at once and factors numbers of up to about 20 digits quickly, but a number with two large
prime factors can take days: use `factorAsync` with a time limit. `isPrime`, `nextPrime`, `totient`, `mobius` and
`primitiveRoot` have asynchronous versions too. `factorial` computes up to about `71000!`, while in a formula
`factorial(n)` above 20000 stays `gamma(n + 1)`, so that the expression can still be printed.

```typescript
import {ntheory} from '@lakutata/math'

console.log(ntheory.factor(360))                 //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
console.log(ntheory.powMod(4, 13, 497))          //445n
console.log(ntheory.continuedFraction('pi', {terms: 6}))   //[3n, 7n, 15n, 1n, 292n, 1n]
console.log(ntheory.convergents([3, 7, 15, 1]).map(String)) //['3', '22/7', '333/106', '355/113']
console.log(ntheory.crt([2, 3, 2], [3, 5, 7]))   //{remainder: 23n, modulus: 105n}
console.log(await ntheory.factorAsync(2n ** 64n + 1n, {timeout: 5000}))
```

### Polynomials

`poly` (`MathScope.poly`) works on polynomials exactly, in any number of variables: `gcd(...values)` and
`lcm(...values)`, `resultant(a, b, variable)` and `discriminant(p, variable)`, `factorList(p)` and `sqfList(p)`, and
their asynchronous versions; `factor()` and `sqf()` of an expression give its factored form. A polynomial is an
expression or a formula. Its generators are its symbols and its factors that are not polynomials themselves: `sin(x)`,
`sqrt(2)`, `exp(x)` (`x^(3/2)` is the cube of `sqrt(x)`, `exp(2x)` the square of `exp(x)`). They are independent of each
other: `sqrt(2)^2` is not read as 2. An expression with a negative power, or with a coefficient that is complex or not
exact, is not a polynomial (`MathNotSupportedException`); fractions of polynomials have the operations of the next
section.

- The results are over the integers when every coefficient is an integer, with the gcd of the contents in a gcd (`gcd(2x
  + 2, 4x + 4)` is `2x + 2`), and over the rationals otherwise (monic: `gcd(x/2 + 1/2, x + 1)` is `x + 1`). Their
  leading coefficients are positive, as in SymPy. Numbers alone have the gcd and the lcm of numbers (`gcd(1/2, 1/3)` is
  `1/6`).
- `factorList` gives the rational coefficient and the irreducible factors over the rationals with their multiplicities
  (`factorList('6x^2 - 6')` is 6, `x - 1` and `x + 1`); `sqfList` gives the square-free decomposition (Yun's algorithm).
  `factor()` writes them as a product with the coefficient in front (`3x*y + 6x + 3y + 6` is `3(x + 1)(y + 2)`); a
  fraction has its numerator and its denominator factored. An operation on the result gives the usual form of the
  formulas again (`2(x + 1)` plus 1 is `2x + 3`).
- The algorithms are SymPy's, written again in C++: the heuristic gcd (GCDHEU), and the subresultant PRS when it fails;
  the resultant by the subresultant PRS; the factorization by Zassenhaus' algorithm in one variable (the cyclotomic
  factors of `x^n - 1` and `x^n + 1` at once) and Wang's in several. A polynomial with many factors modulo every prime
  (Swinnerton-Dyer's) takes a time exponential in their number: factor it with `factorAsync()` or `factorListAsync()`
  and a time limit. When the first polynomial has the lower degree, the resultant has the sign (-1)^(mn) that SymPy
  leaves out (`resultant(x, x^3 + 1, x)` is 1, not SymPy's -1).
- A polynomial is held in its dense form: the product over its variables of its degree plus one is at most 10^6 (`x^2000
  y^2000 + 1` throws `MathNotSupportedException`).

```typescript
import {expression, poly} from '@lakutata/math'

console.log(poly.gcd('x^4 - 1', 'x^6 - 1').toString())                 //x^2 - 1
console.log(poly.gcd('(x - 1)*(y - 2)', '(x - 1)*(x + y)').toString())  //x - 1
console.log(poly.lcm('2x + 2', '4x - 4').toString())                    //4x^2 - 4
console.log(poly.resultant('x^2 + y', 'x - y', 'x').toString())         //y^2 + y
console.log(poly.discriminant('a*x^2 + b*x + c', 'x').toString())       //-4a*c + b^2
console.log(expression('3x*y + 6x + 3y + 6').factor().toString())       //3(x + 1)(y + 2)
console.log(expression('x^6 - y^6').factor().toString())                //(x^2 - x*y + y^2)(x + y)(x - y)(x^2 + x*y + y^2)
```

### Fractions of polynomials

`cancel()`, `together()`, `apart(variable)` and `completeSquare(variable)` of an expression work on fractions of
polynomials, with the generators of `poly`:

- `cancel()` divides the numerator and the denominator by their gcd. Both are expanded, with positive leading
  coefficients, and the sign goes in front (`(2x^2 - 2)/(x^2 - 2x + 1)` is `(2x + 2)/(x - 1)`, `(-x - 1)/(x - 1)` is
  `-(x + 1)/(x - 1)`); a denominator that is a number is multiplied in, as in SymPy (`(x^2 - 1)/2` is `x^2/2 - 1/2`).
- `together()` writes the expression over one denominator: each base of the denominators to its greatest power, and the
  lcm of their numbers (`1/(2x) + 1/(3y)` is `(2x + 3y)/(6x*y)`), with the numerator expanded. It does not look for
  common factors (that is `cancel()`), and it does not go into the arguments of functions.
- `apart(variable)` gives the partial fractions in a variable, as SymPy's `apart()`: the polynomial part, then, for each
  irreducible factor `q` of the denominator to the power `k`, the fractions `h/q^j` (`j` from 1 to `k`) with numerators
  of lower degree than `q`, each one factored (`1/(x^3 + 1)` is `-(x - 2)/(3(x^2 - x + 1)) + 1/(3(x + 1))`). The other
  variables are parameters (`1/((x + a)(x + b))` is `-1/((a + x)(a - b)) + 1/((a - b)(b + x))`); a function of the
  variable (`sin(x)/x`) throws `MathNotSupportedException`. The numerators come from a linear system in their
  coefficients, solved without fractions (Bareiss' elimination).
- `completeSquare(variable)` writes `a x^2 + b x + c` as `a(x + b/(2a))^2 + c - b^2/(4a)` (`2x^2 + 4x + 1` is `2(x +
  1)^2 - 1`); a polynomial of another degree throws `MathNotSupportedException`.
- The terms of a result of `apart()` or `completeSquare()` keep their written form when terms are added to it; otherwise
  an operation on a result (a product by a number, `expand()`) gives the usual form of the formulas again. `equals()`
  puts the fractions of a difference over one denominator, so that it proves identities between fractions (`(x^2 - 1)/(x
  - 1)` equals `x + 1`). `cancel()` and `apart()` have asynchronous versions: a gcd or a factorization in several
  variables can take long.

```typescript
import {expression} from '@lakutata/math'

console.log(expression('(x^2 - 1)/(x^2 + 2x + 1)').cancel().toString()) //(x - 1)/(x + 1)
console.log(expression('1/x + 1/(x + 1)').together().toString())         //(2x + 1)/(x*(x + 1))
console.log(expression('1/(x^3 + 1)').apart('x').toString())             //-(x - 2)/(3(x^2 - x + 1)) + 1/(3(x + 1))
console.log(expression('x^2 - 6x + 10').completeSquare('x').toString())  //(x - 3)^2 + 1
```

### Matrices and linear algebra

`matrix(rows)` gives a `Matrix` of numbers (doubles). Its elements are in a `Float64Array`, row by row (`data`),
which the addon reads in place. Its methods give new matrices: `get`, `set` (which changes the matrix), `row`, `column`,
`diagonal`, `submatrix`, `reshape`, `transpose`, `add`, `sub`, `mul`, `div`, `neg`, `multiplyElements`,
`divideElements`, `powElements`, `map`, `trace`, `kron`, `equals`, `toArray` and `toString` (`[1, 2; 3, 4]`).

`linalg` holds the linear algebra, computed by Eigen:

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

`linalg.sparse(rows, columns, entries)` makes a `SparseMatrix` of the entries given, `[row, column, value]` (the
entries at the same place are added up), and `linalg.sparse(matrix)` one from the elements of a dense matrix that
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
import {linalg, matrix} from '@lakutata/math'

const a = matrix([[4, 1], [2, 3]])
console.log(linalg.solve(a, [5, 5]))                                 //Float64Array [1, 1]
console.log(linalg.inverse(a).toString())                            //[0.3, -0.1; -0.2, 0.4]
console.log(linalg.determinant(a))                                   //10
console.log(a.mul(a).toString())                                     //[18, 7; 14, 11]
console.log(linalg.leastSquares([[1, 1], [1, 2], [1, 3]], [1, 2, 2]))
const big = linalg.fromFunction(1000, 1000, (i, j) => (i === j ? 1000 : 1 / (1 + i + j)))
const inverse = await linalg.inverseAsync(big, {timeout: 5000})
console.log(inverse.get(0, 0))
const sparse = linalg.sparse(3, 3, [[0, 0, 2], [0, 1, -1], [1, 0, -1], [1, 1, 2], [2, 2, 2]])
console.log(linalg.solve(sparse, [1, 1, 2]))                         //Float64Array [1, 1, 1]
console.log(linalg.conjugateGradient(sparse, [1, 1, 2]).converged)   //true
```

### Matrices of expressions

`expressionMatrix(value)` gives an `ExpressionMatrix`, a matrix whose elements are expressions: of its rows (`[['a',
'b'], ['c', 'd']]`), of a formula (`'[1, x; x^2, 2]'`, which `parse()` reads too), or of a matrix of numbers. Like an
expression, it does not change: `with(row, column, value)` gives a matrix with an element replaced; `withRow()` and
`withColumn()` give one with a row or a column replaced.

- Its elements and its arithmetic: `get`, `toArray`, `row`, `column`, `submatrix`, `transpose`, `add`, `sub`, `mul` (by
  a matrix or an expression), `div` (by an expression), `multiplyElements`, `pow` (to an integer; a negative one gives a
  power of the inverse) and `trace`, with `diff`, `substitute`, `expand`, `simplify` and `cancel` element by element.
  `toMatrix()` gives the matrix of numbers of its values, `toString()` its formula, `toTeX()` a `bmatrix`.
  `jacobian(expressions, variables)` gives the Jacobian matrix of expressions.
- Its linear algebra is exact: `determinant`, `inverse` and `solve` of a square matrix that is not singular
  (`MathDomainException` otherwise), `rref` (the reduced row echelon form and the columns of its pivots), `rank`,
  `nullspace`, `characteristicPolynomial`, `eigenvalues` (with their multiplicities) and `eigenvectors`. A matrix of
  numbers is eliminated with exact rationals. For a matrix with variables, the determinant and the characteristic
  polynomial come from Berkowitz's algorithm and the inverse from the adjugate, so that each element is a single
  fraction of polynomials, whose common factors are not cancelled: `cancel()` cancels them, and `equals()` compares
  fractions (the inverse times the matrix equals the identity).
- An element counts as 0 when it is 0 once expanded; as a constant, when its decimals cannot tell it from 0; with
  variables, when it is 0 for every value of them (it is computed exactly at two values). As in SymPy, a pivot that is 0
  only for some values of the variables counts as not 0. The eigenvalues are the roots of the characteristic polynomial:
  the elements of the diagonal that are roots first, then the roots of what is left, factored (`[a, b; b, a]` has `a +
  b` and `a - b`) and exact to degree four; other eigenvalues throw `MathNotSupportedException`, and `linalg.eigen()`
  gives them as numbers.

```typescript
import {expressionMatrix, jacobian, parse} from '@lakutata/math'

const m = expressionMatrix([['a', 'b'], ['c', 'd']])
console.log(m.determinant().toString())                     //a*d - b*c
console.log(m.inverse().toString())                         //[d/(a*d - b*c), -b/(a*d - b*c); -c/(a*d - b*c), a/(a*d - b*c)]
console.log(m.inverse().mul(m).cancel().toString())         //[1, 0; 0, 1]
console.log(parse('[1, 2; 3, 4] * [x; y]').toString())      //[x + 2y; 3x + 4y]
console.log(expressionMatrix('[2, 1; 1, 2]').eigenvectors().map(({value, vectors}) => [value.toString(), vectors.map(String)])) //[['1', ['[-1; 1]']], ['3', ['[1; 1]']]]
console.log(jacobian(['x^2*y', 'x + sin(y)'], ['x', 'y']).toString()) //[2x*y, x^2; 1, cos(y)]
```

### Units

`unit(value)` gives a `Unit`, a value with units: of a formula of units (`'5 cm + 2 inch'`, `'9.8 m/s^2'`), or of a
number and its units (`unit(5, 'cm')`). The names of a formula of units are units, with their prefixes (`km`, `mA`,
`kilometer`), and `pi`, `e` and `i`; a number followed by units is a quantity in those units, and names one after the
other are multiplied (`kg m^2/s^2`). These formulas are kept apart from those of `parse()`, where `m`, `s` and `g` are
variables. The table of units is mathjs's (251 units with their prefixes), with its values written exactly;
`createMath({units})` adds others.

- The number of a value (`value`) is an exact expression, and so are the values of the units: `unit('1 inch').to('cm')`
  is exactly `2.54 cm`, `unit('90 deg').to('rad')` is `(pi/2) rad`. `toNumber(units?)` gives it as a number,
  `toDecimal()` as decimals, `toString()` as `unit()` reads it.
- `to(units)` converts to units of the same dimensions; `toSI()` gives the SI unit of the quantity (`J`, `Pa`), or else
  each unit in SI units; `toBest(units?)` the unit that reads best, among the units given or the prefixes of its unit
  (`5000 m` is `5 km`); `split(units)` the integer part in each unit but the last (`1.5 h` is `1 h` and `30 min`).
- `add` and `sub` give the result in the units of the left value. `mul` and `div` multiply the units, a unit on the
  right being converted to the unit of the same quantity on the left (`5 cm * 2 m` is `1000 cm^2`), and give a number
  without units when the dimensions cancel. There are also `pow` (to a number that keeps the powers of the dimensions
  integers), `sqrt`, `neg`, `abs`, `equals` and `compare`. The formulas of units know `sqrt`, `sin`, `cos` and `tan` (of
  angles or numbers), `exp`, `log` and `ln` (of numbers). Values of dimensions that differ cannot be added or converted:
  `MathUnitException`.
- A temperature with an offset (`degC`, `degF`) is converted and compared, but not added, multiplied or divided: convert
  it to `K` first (`MathUnitException` otherwise). In compound units (`degC/m`) it is a difference of temperatures,
  without the offset. A prefix applies to its number: `1 mdegC` is 0.001 degC.
- `constant(name)` gives a physical constant with its units: the 52 constants of mathjs, with the values of CODATA 2022.
  Those that the SI defines exactly, and those computed from them, are exact (`reducedPlanckConstant` is `h/(2pi)`).
- Unlike mathjs, a value keeps its units: no other prefix is chosen when it is printed (`toBest()` chooses one), and
  units are not replaced by a derived unit (`N m` stays `N m`; `toSI()` gives `J`). Temperatures with an offset are not
  added, and the units whose values mathjs rounds or takes from an earlier definition (`eV`, `hp`, `psi`, `torr`,
  `mmHg`, `acre`, `kip`) have the values of their definitions.

```typescript
import {constant, createMath, unit} from '@lakutata/math'

console.log(unit('5 cm + 2 inch').toString())                         //10.08 cm
console.log(unit('100 km/h').to('m/s').toString())                    //(250/9) m / s
console.log(unit('20 degC').to('degF').toString())                    //68 degF
console.log(unit('1.5 h').split(['h', 'min']).map(String))            //['1 h', '30 min']
console.log(constant('boltzmann').mul('300 K').to('eV').toDecimal(6))  //0.025852 eV
const nautical = createMath({units: {knot: {definition: '1852 m/h', aliases: ['knots']}}})
console.log(nautical.unit('20 knots').to('km/h').toString())          //37.04 km / h
```

### Statistics

`stats` computes statistics of values (arrays of numbers, or `Float64Array`s) in the addon: `sum` (compensated for
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
import {stats} from '@lakutata/math'

const values = [2, 4, 4, 4, 5, 5, 7, 9]
console.log(stats.mean(values))                                             //5
console.log(stats.standardDeviation(values))                                //2
console.log(stats.standardDeviation(values, {normalization: 'unbiased'}))   //2.138089935299395
console.log(stats.quantile(values, [0.25, 0.75]))                           //Float64Array [4, 5.5]
console.log(stats.correlation(values, [1, 3, 2, 5, 4, 6, 8, 7]))            //0.8455943246644705
```

### Probability distributions

`stats` also has 24 probability distributions, computed by Boost.Math, each built from its parameters, given by
their names: `stats.gamma({shape: 2.5, scale: 1.5})`. Libraries parameterize them differently, so the names say
which parameters are meant; the table gives the equivalents in SciPy. A `Distribution` has `pdf` (the probability mass
of a discrete distribution), `cdf`, `survival`, `quantile` and `survivalQuantile` (SciPy's `isf`), each taking a value
or values; `mean`, `variance`, `standardDeviation`, `median`, `mode`, `skewness`, `excessKurtosis` and `support`; and
`sample`.

| Distribution | Parameters (default) | SciPy |
| --- | --- | --- |
| `normal` | `mean` (0), `standardDeviation` (1) | `norm(loc=mean, scale=standardDeviation)` |
| `lognormal` | `logMean` (0), `logStandardDeviation` (1), of the logarithm | `lognorm(s=logStandardDeviation, scale=exp(logMean))` |
| `uniform` | `lower` (0), `upper` (1) | `uniform(loc=lower, scale=upper - lower)` |
| `exponential` | `rate` (1) | `expon(scale=1/rate)` |
| `gamma` | `shape`, `scale` (1) | `gamma(a=shape, scale=scale)` |
| `beta` | `alpha`, `beta` | `beta(a=alpha, b=beta)` |
| `chiSquared` | `degrees` | `chi2(df=degrees)` |
| `studentT` | `degrees` | `t(df=degrees)` |
| `fisherF` | `numeratorDegrees`, `denominatorDegrees` | `f(dfn=numeratorDegrees, dfd=denominatorDegrees)` |
| `cauchy`, `laplace`, `logistic`, `gumbel` | `location` (0), `scale` (1) | `cauchy`, `laplace`, `logistic`, `gumbel_r` (`loc=location, scale=scale`) |
| `weibull` | `shape`, `scale` (1) | `weibull_min(c=shape, scale=scale)` |
| `pareto` | `scale`, `shape` | `pareto(b=shape, scale=scale)` |
| `rayleigh` | `scale` (1) | `rayleigh(scale=scale)` |
| `triangular` | `lower`, `mode`, `upper` | `triang(c=(mode - lower)/(upper - lower), loc=lower, scale=upper - lower)` |
| `inverseGamma` | `shape`, `scale` (1) | `invgamma(a=shape, scale=scale)` |
| `bernoulli` | `probability` | `bernoulli(p=probability)` |
| `binomial` | `trials`, `probability` | `binom(n=trials, p=probability)` |
| `poisson` | `mean` | `poisson(mu=mean)` |
| `geometric` | `probability`: the number of trials up to the first success, from 1 | `geom(p=probability)` |
| `negativeBinomial` | `successes`, `probability`: the number of failures before the `successes`-th success | `nbinom(n=successes, p=probability)` |
| `hypergeometric` | `total`, `successes`, `draws` | `hypergeom(M=total, n=successes, N=draws)` |

The distributions follow SciPy: outside its support, a distribution has a density of 0 and a cdf of 0 or 1; a discrete
one has a mass of 0 between its integers, and there its cdf is that of the integer below; its quantile of p is the
smallest integer k with `cdf(k) >= p`. A discrete distribution's quantile of 0 and its survival quantile of 1 are the
lower bound of its support (SciPy gives one below it). A mean or a variance that diverges is `Infinity` (the variance of
Student's t with 2 degrees of freedom); a skewness or an excess kurtosis that diverges is NaN, as a moment that does not
exist (the mean of Cauchy's). Parameters that are not valid throw `MathArgumentException`.

`stats.random(seed)` gives a `RandomGenerator` (xoshiro256**) with `next()`, `uniform(count)`, `integers(count,
lower, upper)` (of `[lower, upper)`) and `clone()`; `sample(count, random)` draws by inverting the cdf at its uniform
numbers. A seed draws the same sequence each time. Its uniform numbers and integers are the same on every platform,
while the samples of a distribution go through functions of the C library and may differ in their last digits from one
platform to another. Without a seed, the generator takes one from the random numbers of the system. It is not meant for
cryptography.

```typescript
import {stats} from '@lakutata/math'

const normal = stats.normal({mean: 1, standardDeviation: 2})
console.log(normal.cdf(1))              //0.5
console.log(normal.quantile(0.975))     //4.919927969080108
const binomial = stats.binomial({trials: 10, probability: 0.3})
console.log(binomial.pdf([2, 3]))       //Float64Array [0.23347444050000024, 0.2668279319999998]
console.log(binomial.quantile(0.5))     //3
const random = stats.random(42)
console.log(normal.sample(3, random))   //the same three samples each time, of the seed 42
console.log(random.integers(5, 1, 7))   //five dice
```

### Numeric solutions

`numeric` finds the solutions of equations as numbers, where `solve()` has no exact solution or where numbers are
enough. The addon compiles the expressions to doubles, with the derivatives the methods need.

- `polynomialRoots(polynomial, variable)` gives all the roots of a polynomial in the complex numbers, as `{re, im}`,
  with their multiplicities, sorted by their real parts, then by their imaginary parts: the eigenvalues of its companion
  matrix, refined by Newton's method (as NumPy's `roots`). The polynomial is an expression, or its coefficients from the
  constant term up, as mathjs's `polynomialRoot` (NumPy's `roots` takes them from the highest power down). A root of
  multiplicity m is accurate to about the m-th root of the machine epsilon.
- `findRoot(equation, variable, options)` finds a root of a function (`x^3 - 2x - 5`, equal to 0) or of an equation
  (`cos(x) = x`): in a `bracket` `[a, b]` where the function changes its sign, by TOMS 748 (which keeps the root in the
  bracket), or from a `guess`, by Newton's method. A bracket where the sign does not change, or where the function is
  not real, throws `MathDomainException`.
- `solveSystem(equations, variables, guess, options)` solves a system of nonlinear equations from a guess, by Newton's
  method with a line search, and by the steps of Levenberg and Marquardt where Newton's steps fail. With more equations
  than variables, it finds the point where the residuals are smallest (least squares).

The iterative methods stop when a step becomes smaller than the `tolerance` (1e-12 by default) relative to the solution,
as SciPy's `fsolve` does, or after `maxIterations` (100 by default). They do not throw when they do not converge: the
result says so (`converged`), with the number of `iterations` and the `residual` (the absolute value of the function at
the root, the norm of the residuals of a system). Each operation has an asynchronous version (`findRootAsync()`…).

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.polynomialRoots('x^3 - 6x^2 + 11x - 6'))                   //{re: Float64Array [1, 2, 3], im: Float64Array [0, 0, 0]}
console.log(numeric.polynomialRoots([1, 0, 1]))                                //{re: Float64Array [0, 0], im: Float64Array [-1, 1]}: 1 + x^2
console.log(numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root)       //0.7390851332151606
console.log(numeric.findRoot('x^3 - 2x - 5', 'x', {guess: 2}).root)            //2.0945514815423265
const {solution, converged} = numeric.solveSystem(['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y'], [2, 0])
console.log(solution, converged)                                               //Float64Array [1.9318516525781366, 0.5176380902050416] true
```

### Numeric integrals

`numeric.integrate(function, variable, [a, b], options)` gives the integral of a function over an interval, as `{value,
error, converged}`. The ends may be infinite (`-Infinity`, `Infinity`); with its ends reversed (`[3, 0]`), it is
negated.

- It is computed by QUADPACK's QAGS, as SciPy's `quad` computes it: the Gauss-Kronrod rule of 21 points on intervals
  halved where the error is largest, the results extrapolated near a singularity, a half line or the real line mapped
  onto a finite interval. Unless that reaches the roundings, a double-exponential quadrature (tanh-sinh, exp-sinh,
  sinh-sinh) computes it too, and the more accurate result is kept. Next to an end that is not 0, the function is
  rewritten in terms of its distance from it (`1 - x^2` at `x = 1 - u` is `2u - u^2`), so that a singularity there
  (`1/sqrt(1 - x^2)` on `[-1, 1]`) is computed to the roundings.
- `points` gives the points inside the interval where the function is singular or jumps: the interval is split there.
  The extrapolation often finds such a point by itself, but giving it makes the integral faster and more accurate, and
  its error estimate reliable: for a singularity inside the interval, the extrapolation's error estimate may be too
  small, as in QUADPACK. Where the function is infinite at a point where the rules evaluate it, the interval is split
  there anyway. The interval is also split at each real root, inside it, of a factor of the denominator of the function
  that is a polynomial (where the numerator is not 0): an integral across a pole diverges, and is not converged, instead
  of being taken as its principal value (`1/x` on `[-1, 2]`). A fraction of polynomials in the variable has its common
  factors cancelled first: `(x^2 - 1)/(x - 1)` on `[0, 2]` is 4, where the rules would meet 0/0 at 1.
- `tolerance` bounds the estimate of the error, relative to the integral of `|f|`: about 1.5e-8 by default (the square
  root of the machine epsilon, as in SciPy), and the result is usually much more accurate than its estimate. An integral
  that diverges, that oscillates without end, or that doubles cannot resolve gives its best estimate with `converged:
  false`; a function that is not real inside the interval throws `MathDomainException`. `integrateAsync()` runs in the
  threads of the addon.

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.integrate('x^2', 'x', [0, 3]))                                     //{value: 9, error: 9.992007221626409e-14, converged: true}
console.log(numeric.integrate('1/sqrt(1 - x^2)', 'x', [-1, 1]).value)                  //3.141592653589794
console.log(numeric.integrate('exp(-x^2)', 'x', [-Infinity, Infinity]).value)          //1.7724538509055159
console.log(numeric.integrate('1/sqrt(abs(x - 1))', 'x', [0, 2], {points: [1]}).value) //4
console.log(numeric.integrate('sin(x)/x', 'x', [0, Infinity]).converged)               //false
```

### Differential equations

`numeric.solveODE({derivatives, states, time, span, initial}, options)` solves an ordinary differential equation, or a
system of them, y' = f(t, y): the derivatives of the states are expressions of the time (`t` by default) and of the
states; the states are followed from their values at the start of the span to its end (backward when the end is before
the start). An equation of a higher order is written as a system: x'' = -x is x' = v, v' = -x.

- `method: 'rk45'` (by default) is Dormand and Prince's explicit Runge-Kutta method of order 5, as SciPy's RK45 and
  MATLAB's ode45. `method: 'radau'` is the implicit method Radau IIA of order 5, as SciPy's Radau, for stiff equations
  (where components decay at very different rates, such as a chemical reaction or Van der Pol's oscillator with a large
  mu): it takes the exact Jacobian of the derivatives, and needs far fewer steps on such equations.
- The step is chosen from the error of the last one, as SciPy's `solve_ivp` chooses it, to keep the error of each step
  within `relativeTolerance` (1e-6 by default) times the states plus `absoluteTolerance` (1e-9). SciPy and MATLAB
  default to 1e-3 and 1e-6, which leave about three correct digits; the error at the end of a long span can be larger
  than the tolerance of a step.
- The result has the times `t` (every step from the start, or the `points` asked) and the states `y`, a `Matrix` with a
  row for each time and a column for each state; the solution at the `points` is computed by the continuous extensions
  of the steps, without shortening them. Where the solution stops before the end of the span (it grows without bound, so
  the step becomes too small; more than `maxSteps` steps, 100000 by default), `completed` is false, `message` says why,
  and the solution is given up to there. `solveODEAsync()` runs in the threads of the addon.

```typescript
import {numeric} from '@lakutata/math'

const decay = numeric.solveODE({derivatives: '-2y', states: 'y', span: [0, 1], initial: 1}, {points: [0.5, 1]})
console.log(decay.y.data)                                      //Float64Array [0.3678795037443847, 0.13533535227865426]
const predators = numeric.solveODE({derivatives: ['1.5x - x*y', '-3y + x*y'], states: ['x', 'y'], span: [0, 15], initial: [10, 5]}, {points: [5, 10, 15]})
console.log(predators.y.toString())                            //[0.26418560018756804, 3.1341398128097984; 0.28720983158008045, 0.4497817486332696; 0.7137350135355639, 0.07540900832629659]
const stiff = numeric.solveODE({derivatives: ['v', '1000(1 - x^2)v - x'], states: ['x', 'v'], span: [0, 3000], initial: [2, 0]}, {method: 'radau'})
console.log(stiff.completed, stiff.steps)                      //true 1296
const blowUp = numeric.solveODE({derivatives: 'y^2', states: 'y', span: [0, 2], initial: 1})
console.log(blowUp.completed, blowUp.message)                  //false The step became too small at t = 1.0000002858952532
```

### Asynchronous operations

The operations that can take long have an asynchronous version: `expandAsync()`, `simplifyAsync()`, `diffAsync()`,
`seriesAsync()`, `solveAsync()`, `toDecimalAsync()`, `toComplexDecimalAsync()` of the expressions, `solveAsync()` and
`cseAsync()`, and those of the number theory, of the linear algebra and of the numeric solutions. They run in the
threads of the addon, not in the thread pool of libuv: as many threads as the processor has cores, minus one, or the
number in the environment variable `LAKUTATA_MATH_THREADS`. Their options are `timeout` (milliseconds) and `signal` (an
`AbortSignal`):

- At the time limit the promise is rejected with `MathTimeoutException`, and with `MathCancelledException` when the
  signal aborts. Operations with checkpoints (expansions, decimals, linear systems, the number theory) stop at the next
  one; the others run to the end before their thread is free again.
- A scope of `createMath()` limits how many of its operations run at the same time (`concurrency`): the others wait
  their turn. If the program exits while some are running, their results are dropped.

The expressions are nested 1000 levels deep at most: a deeper formula is refused with `MathNotSupportedException`
before its operations could overflow the stack.

### Packaging

The bundles, the executables and the installers made by `lakutata package` carry the compiled addon
(`build/Release/math.node`): build them on each target platform, after installing the package there.

## API

| Export | What it is |
|---|---|
| `parse`, `expression`, `equation`, `decimal`, `matrix`, `expressionMatrix`, `jacobian`, `interval`, `finiteSet`, `unit`, `constant`, `solve`, `solveAsync`, `cse`, `cseAsync`, `ntheory`, `poly`, `linalg`, `stats`, `numeric` | The functions and the namespaces of `math`, ready to use |
| `math`, `createMath`, `MathOptions` | The scope of the default options; a scope of other options (`definitions`, `precision`, `timeout`, `concurrency`, `units`), and its options |
| `MathScope`, `MathDefinitions` | A scope of definitions and settings (`createMath()`, `with()`): `parse`, `expression`, `equation`, `decimal`, `matrix`, `expressionMatrix`, `jacobian`, `interval`, `finiteSet`, `unit`, `constant`, `with`, `solve`, `solveAsync`, `cse`, `cseAsync`, `ntheory`, `poly`, `linalg`, `stats`, `numeric`; the definitions (a body by signature) |
| `Expression` | An expression: `toString`, `toTeX`, `toNumber`, `toComplex`, `toDecimal`, `toComplexDecimal`, `variables`, `equals`, `add`, `sub`, `mul`, `div`, `pow`, `neg`, `expand`, `simplify`, `diff`, `series`, `substitute`, `evaluate`, `solve`, `compile`, the polynomials (`coefficients`, `degree`, `leadingCoefficient`, `divide`), `factor`, `sqf`, the fractions (`cancel`, `together`, `apart`, `completeSquare`), `numerator`, `denominator`, `rewrite` (`exp`, `sin`, `cos`), the predicates (`isZero`, `isPositive`, `isNegative`, `isInteger`, `isRational`, `isReal`, `isFinite`: `undefined` when not known), `compare`, `toJavaScript`, `toC`, `toPolar`, `toRectangular`, and the asynchronous versions |
| `Decimal`, `DecimalValue`, `DecimalOptions` | A decimal of a precision (`decimal()`): `precision`, `add`, `sub`, `mul`, `div`, `mod`, `pow`, `neg`, `abs`, `sqrt`, `cbrt`, `root`, `exp`, `ln`, `log10`, `log`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `gamma`, `loggamma`, `digamma`, `erf`, `erfc`, `zeta`, `lambertw`, `floor`, `ceil`, `trunc`, `round`, `compare`, `equals`, `isZero`, `isPositive`, `isNegative`, `isInteger`, `toString`, `toFixed`, `toNumber`, `toJSON`; what is given where a decimal is expected (a decimal, a number, a bigint, a decimal number written as a string); the option of `decimal()` (`precision`) |
| `Matrix`, `MatrixValue`, `VectorValue` | A matrix of numbers (`matrix()`): `rows`, `columns`, `data`, `get`, `set`, `row`, `column`, `diagonal`, `submatrix`, `reshape`, `transpose`, `add`, `sub`, `mul`, `div`, `neg`, `multiplyElements`, `divideElements`, `powElements`, `map`, `trace`, `kron`, `equals`, `clone`, `toArray`, `toJSON`, `toString`; what is given where a matrix is expected (a matrix, or its rows); where a vector is (a `Float64Array`, or an array of numbers) |
| `ExpressionMatrix`, `ExpressionMatrixValue`, `RowEchelonForm`, `Eigenvector` | A matrix of expressions (`expressionMatrix()`, `parse()`): `rows`, `columns`, `get`, `toArray`, `with`, `withRow`, `withColumn`, `row`, `column`, `submatrix`, `transpose`, `neg`, `add`, `sub`, `mul`, `div`, `multiplyElements`, `pow`, `trace`, `determinant`, `inverse`, `solve`, `rref`, `rank`, `nullspace`, `characteristicPolynomial`, `eigenvalues`, `eigenvectors`, `diff`, `substitute`, `expand`, `simplify`, `cancel`, `equals`, `toMatrix`, `toString`, `toTeX`, and `determinantAsync`, `inverseAsync`, `solveAsync`, `eigenvectorsAsync`; what is given for one; a reduced row echelon form and its pivots; an eigenvalue, its multiplicity and its eigenvectors |
| `Unit`, `UnitValue`, `UnitDimensions`, `CustomUnit`, `CustomUnits`, `PhysicalConstant` | A value with units (`unit()`, `constant()`): `value`, `units`, `dimensions`, `hasDimensionsOf`, `to`, `toSI`, `toBest`, `split`, `add`, `sub`, `mul`, `div`, `pow`, `sqrt`, `neg`, `abs`, `equals`, `compare`, `toNumber`, `toDecimal`, `toString`, `toJSON`, `toTeX`; what is given for one; the powers of its base quantities; a unit of `createMath()` (`definition`, `prefixes`, `aliases`, `offset`) and the units of its option; the names of the physical constants |
| `LinearAlgebra`, `NormKind` | The linear algebra (`linalg`): `zeros`, `ones`, `identity`, `diagonal`, `fromRows`, `fromColumns`, `fromFunction`, `concat`, `rotation`, `dot`, `cross`, `outer`, `norm`, `multiply`, `solve`, `solveTriangular`, `leastSquares`, `inverse`, `determinant`, `singularValues`, `rank`, `condition`, `lu`, `qr`, `cholesky`, `svd`, `eigen`, `symmetricEigen`, `schur`, `pseudoInverse`, `exponential`, `squareRoot`, `sylvester`, `lyapunov`, `sparse`, `conjugateGradient`, `biconjugateGradientStabilized`, and the asynchronous versions; the kinds of norms |
| `Statistics`, `Normalization`, `NormalizationOptions` | The statistics (`stats`): `sum`, `product`, `cumulativeSum`, `differences`, `mean`, `median`, `mode`, `min`, `max`, `variance`, `standardDeviation`, `medianAbsoluteDeviation`, `quantile`, `covariance`, `correlation`, `zScores`, `klDivergence`, the distributions (`normal` … `hypergeometric`, `distribution`) and `random`; the divisors of a variance (`'uncorrected'`, `'unbiased'`, `'biased'`) and the option that chooses one |
| `Distribution`, `DistributionName`, `DistributionParameters` | A probability distribution: `pdf`, `cdf`, `survival`, `quantile`, `survivalQuantile`, `sample`, `parameters`, `kind`, `support`, `mean`, `variance`, `standardDeviation`, `median`, `mode`, `skewness`, `excessKurtosis`; the names of the distributions; their parameters by their names |
| `RandomGenerator` | A generator of random numbers (xoshiro256**) of a seed: `next`, `uniform`, `integers`, `clone` |
| `SparseMatrix`, `SparseEntry` | A sparse matrix in compressed rows (`linalg.sparse()`): `rowPointers`, `columnIndices`, `values`, `nonZeros`, `get`, `transpose`, `add`, `sub`, `neg`, `mul`, `toDense`, `toEntries`; an entry `[row, column, value]` |
| `IterativeOptions`, `IterativeSolution` | The options of the iterative solvers (`tolerance`, `maxIterations`, `guess`) and their result (`solution`, `iterations`, `error`, `converged`) |
| `LuDecomposition`, `QrDecomposition`, `SingularValueDecomposition`, `EigenDecomposition`, `SymmetricEigenDecomposition`, `SchurDecomposition`, `ComplexVector`, `ComplexMatrix` | The results of the decompositions: `{lower, upper, permutation}`, `{q, r}`, `{u, singularValues, v}`, `{values, vectors}` (complex: `{re, im}`), `{values, vectors}`, `{u, t}` |
| `CommonSubexpressions`, `CseOptions` | The result of `cse()` (`replacements`, `expressions`) and its option (`prefix`) |
| `PolarForm`, `RectangularForm` | The polar form (`modulus`, `argument`) and the rectangular form (`real`, `imaginary`) of a complex value |
| `Equation`, `Inequality`, `InequalityRelation` | An equation (`left`, `right`, `difference`, `substitute`, `solve`, `solveAsync`), an inequality (`left`, `right`, `relation`, `solve`, `solveAsync`) |
| `Solutions`, `SolutionsKind`, `SolveOptions` | The solutions of an equation or of an inequality: an array of expressions with their `kind`, their `set` and `text`; the `domain` of the solutions |
| `MathSet`, `MathSetKind`, `SetInterval`, `IntervalOptions` | A set of numbers (`interval()`, `finiteSet()`, the `set` of solutions): `kind`, `values`, `intervals`, `text`, `union`, `intersect`, `complement`, `difference`, `contains`, `equals`, `isEmpty`, `toString`, `toTeX`; what it is; an interval of it; whether the ends of an interval are excluded |
| `SystemSolution`, `SystemEquation` | A solution of a system (an expression by variable), an equation of a system |
| `CompiledFunction` | A compiled expression: a function of numbers, its `variables`, `batch` |
| `NumberTheory`, `IntegerValue`, `ContinuedFractionOptions`, `PrimeFactor`, `ExtendedGcd`, `Congruence` | The number theory (`ntheory`): `gcd`, `lcm`, `extendedGcd`, `mod`, `modInverse`, `powMod`, `isPrime`, `nextPrime`, `factor`, `totient`, `mobius`, `primitiveRoot`, `legendre`, `jacobi`, `crt`, `fibonacci`, `lucas`, `binomial`, `factorial`, `doubleFactorial`, `bernoulli`, `harmonic`, `permutations`, `combinationsWithRepetition`, `multinomial`, `bell`, `catalan`, `stirlingSecondKind`, `compositions`, `continuedFraction`, `fromContinuedFraction`, `convergents`, and the asynchronous versions; an integer (a bigint, or a number that is a safe integer); a prime factor and its exponent; the result of `extendedGcd`; the result of `crt`; the largest number of terms of a continued fraction |
| `Polynomials`, `FactorList`, `PolynomialFactor` | The polynomials (`poly`): `gcd`, `lcm`, `resultant`, `discriminant`, `factorList`, `sqfList`, and the asynchronous versions; a polynomial as a coefficient times factors, a factor and its multiplicity |
| `Numeric`, `FindRootOptions`, `IterationOptions`, `RootResult`, `SystemRootResult`, `IntegrateOptions`, `IntegralResult` | The numeric solutions and integrals (`numeric`): `polynomialRoots`, `findRoot`, `solveSystem`, `integrate` and their asynchronous versions; their options (`bracket`, `guess`, `tolerance`, `maxIterations`, `points`) and their results (`root` or `solution`, `converged`, `iterations`, `residual`; `value`, `error`, `converged`) |
| `ODEProblem`, `ODEOptions`, `ODEResult` | The differential equations (`numeric.solveODE`, `solveODEAsync`): the derivatives, the states, the time, the span and the initial values; the method (`rk45`, `radau`), the tolerances, `maxStep`, `points`, `maxSteps`; the times `t`, the states `y`, `steps`, `rejected`, `evaluations`, `jacobians`, `completed`, `message` |
| `AsyncOptions`, `Value` | The options of the asynchronous operations (`timeout`, `signal`); what is given where an expression is expected (an expression, a number, a bigint, a decimal, a formula) |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `MathSyntaxException` | A formula is not written correctly (with the `position` of the error), an equation or a matrix is given where an expression is expected, or the other way round, a matrix and a number added, a matrix where a function takes numbers |
| `MathUnitException` | Values with units of dimensions that differ added, compared or converted, a unit that is not known (with its `position`), a temperature with an offset added, multiplied or divided, a power that leaves the powers of the dimensions not integers, `sin()` of a value that is neither an angle nor a number |
| `MathUnknownFunctionException` | A formula calls a function that is neither built in nor defined, or a constant written as a call (`g(2)`), with its `position` |
| `MathDefinitionException` | A definition is not valid: a built-in name, a parameter given twice, definitions referring to each other in a cycle, a definition nested too deep, a definition that is a matrix; a unit of `createMath()` that is not valid: a name that is already a unit, alone or with a prefix, a definition of unknown units, units defined in terms of each other in a cycle |
| `MathDomainException` | A complex value asked as a number, the value of an infinity or of `complexInfinity` (a division by zero, also by a value not shown to differ from 0 in `toNumber()`), an integer outside the domain of a function of the number theory (`totient(0)`), a singular matrix where an inverse is needed (`solve()`, `inverse()`), a matrix given to `cholesky()` that is not positive definite, a matrix given to `squareRoot()` whose principal square root is not real or does not exist, a Sylvester or Lyapunov equation without a unique solution, a decimal outside the domain of a function (the square root of a negative decimal, `asin()` of 2, a negative decimal to a non-integer power), a bracket of `findRoot()` where the function does not change its sign or is not real, a function or equations that are not real at the guess of `findRoot()` or `solveSystem()`, a function that is not real inside the interval of `integrate()`, derivatives that are not real at the start of `solveODE()`, the continued fraction of a complex value, a matrix of expressions that is singular (`inverse()`, `solve()`, `inv()`) |
| `MathDivisionByZeroException` | A division by zero met while computing decimals (also by a value not shown to differ from 0, the logarithm of 0, 0 to a negative power, a logarithm in base 1, a function at one of its poles: `gamma()` of -2, `zeta()` of 1), a modulus of 0, terms of a continued fraction that divide by zero |
| `MathNotSupportedException` | An operation the package does not do for this expression: a nonlinear system, an expression that cannot be compiled, an expression nested more than 1000 levels deep, an exact number too large to compute met by an operation, `gcd` or `lcm` of numbers that are not integers, a result of the number theory of more than 2^20 bits, `bernoulli(n)` and `bell(n)` above 2000, `harmonic(n)` above 50000, `stirlingSecondKind(n, k)` with `n` above 50000 or `n k` above 6250000, code with a function the language does not have, a complex number such as `2i`, a variable named like a reserved word of the language, eigenvalues whose computation does not converge, the decimals of `polygamma(n, x)` when `n` is not an integer, a decimal whose exponent is beyond the range of decimals (about ±10^18, ±4.25 × 10^8 on 32-bit systems: `exp()` of 10^19, also in `toDecimal()`), or a decimal value that needs more than 50000 digits beyond the ones asked (`sin(10^(10^6))`), the eigenvalues of a matrix of expressions that are not found exactly, a matrix raised to a power that is not an integer, an equation or an inequality of matrices, a polynomial of `poly` with a negative power, a complex or inexact coefficient, or degrees too high together for its dense form |
| `MathArgumentException` | An argument that is not valid: variables left where a number is asked, a name that is not a variable, the wrong number of values, a value that is not an integer where one is asked, a value that is not a decimal number where one is asked, a precision outside 1 to 100000, an interval, points or a tolerance of `integrate()` that are not valid, a problem or options of `solveODE()` that are not valid, a continued fraction of a value with variables, terms that are not integers, matrices or vectors of the wrong dimensions, a sparse matrix whose structure is not valid (also when its arrays were changed after it was made), no values where a statistic has none, parameters of a distribution that are not valid, a probability of a quantile outside 0 to 1, negative probabilities for `klDivergence`, the gcd or the lcm of no polynomial, a variable of `poly` that is not a name, a number where units alone are expected (`to('2 cm')`), the name of a physical constant that is not one, the options of `createMath()` that are not valid |
| `MathTimeoutException`, `MathCancelledException` | An asynchronous operation past its time limit, or cancelled |
| `MathException` | The base of all of them; its `errno` is `E_MATH_INTERNAL` for an internal error of the addon |

## See also

- [SymEngine](https://github.com/symengine/symengine): the symbolic engine the addon is built on.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon and their licenses.
