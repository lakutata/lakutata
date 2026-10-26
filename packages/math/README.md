# @lakutata/math

English | [中文](README.zh-CN.md)

Symbolic mathematics for the [lakutata](https://github.com/lakutata/lakutata) framework: formulas written the way they
are on paper (`x^2 - 5x + 6`, `2(x + 1)`), expanded, derived, solved and evaluated with exact numbers. The work is done
by a native addon built on [SymEngine](https://github.com/symengine/symengine), compiled when the package is installed.
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
| `pi`, `e`, `i`, `inf` (or `oo`), `nan` | Constants |
| `sin`, `cos`, `tan`, `asin`, `sinh`…, `exp`, `ln`, `log(x)` (natural), `log(x, b)`, `log10`, `log2`, `sqrt`, `cbrt`, `root(x, n)`, `abs`, `sign`, `floor`, `ceil`, `trunc`, `min`, `max`, `gamma`, `beta`, `erf`, `zeta`, `binomial`, `factorial`… | Functions |
| `x^2 = 4` | An equation (`math.equation()`, or `math.parse()`) |
| `x < 1`, `x >= 0` | An inequality, read by `math.parse()` |

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

- `toNumber()` gives a number of JavaScript (`MathDomainException` for a complex value), `toComplex()` gives
  `{re, im}`. Both compute the special functions (gamma, zeta, Lambert W, polygamma, erf…) of real and complex
  arguments.
- `toDecimal(digits)` gives a string with that many significant digits, correctly rounded (the `precision` of the
  component by default).
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

### Asynchronous operations

The operations that can take long have an asynchronous version: `expandAsync()`, `simplifyAsync()`, `diffAsync()`,
`seriesAsync()`, `solveAsync()`, `toDecimalAsync()`, and `solveAsync()` of the component. They run in the threads of the
addon, not in the thread pool of libuv: as many threads as the processor has cores, minus one, or the number in the
environment variable `LAKUTATA_MATH_THREADS`. Their options are `timeout` (milliseconds) and `signal` (an
`AbortSignal`):

- At the time limit the promise is rejected with `MathTimeoutException`, and with `MathCancelledException` when the
  signal aborts. Operations with checkpoints (expansions, decimals, linear systems) stop at the next one; the others
  run to the end before their thread is free again.
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
| `Math` | The component: `parse`, `expression`, `equation`, `with`, `solve`, `solveAsync` |
| `buildMathOptions`, `MathConfig` | Its declaration in the components, and its options: `definitions`, `precision`, `timeout`, `concurrency`, `drainTimeout` |
| `MathScope`, `MathDefinitions` | The scope given by `with()`, with the methods of the component; the definitions (a body by signature) |
| `Expression` | An expression: `toString`, `toTeX`, `toNumber`, `toComplex`, `toDecimal`, `variables`, `equals`, `add`, `sub`, `mul`, `div`, `pow`, `neg`, `expand`, `simplify`, `diff`, `series`, `substitute`, `evaluate`, `solve`, `compile`, and the asynchronous versions |
| `Equation`, `Inequality`, `InequalityRelation` | An equation (`left`, `right`, `difference`, `substitute`, `solve`, `solveAsync`), an inequality (`left`, `right`, `relation`) |
| `Solutions`, `SolutionsKind`, `SolutionInterval`, `SolveOptions` | The solutions of an equation: an array of expressions with their `kind`, `intervals` and `text`; the `domain` of the solutions |
| `SystemSolution`, `SystemEquation` | A solution of a system (an expression by variable), an equation of a system |
| `CompiledFunction` | A compiled expression: a function of numbers, its `variables`, `batch` |
| `AsyncOptions`, `Value` | The options of the asynchronous operations (`timeout`, `signal`); what is given where an expression is expected (an expression, a number, a bigint, a formula) |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `MathSyntaxException` | A formula is not written correctly (with the `position` of the error), an equation is given where an expression is expected, or the other way round |
| `MathUnknownFunctionException` | A formula calls a function that is neither built in nor defined (with its `position`) |
| `MathDefinitionException` | A definition is not valid: a built-in name, a parameter given twice, definitions referring to each other in a cycle, a definition nested too deep |
| `MathDomainException` | A complex value asked as a number, the value of an infinity or of `complexInfinity` (a division by zero) |
| `MathDivisionByZeroException` | A division by zero met while computing decimals |
| `MathNotSupportedException` | An operation the package does not do for this expression: a nonlinear system, an expression that cannot be compiled, an expression nested more than 1000 levels deep, an exact number too large to compute met by an operation |
| `MathArgumentException` | An argument that is not valid: variables left where a number is asked, a name that is not a variable, the wrong number of values |
| `MathTimeoutException`, `MathCancelledException` | An asynchronous operation past its time limit, or cancelled |
| `MathException` | The base of all of them; its `errno` is `E_MATH_INTERNAL` for an internal error of the addon |

## See also

- [SymEngine](https://github.com/symengine/symengine): the symbolic engine the addon is built on.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon and their licenses.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
