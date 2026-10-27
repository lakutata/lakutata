# @lakutata/math

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的符号数学包：公式按纸上的写法输入（`x^2 - 5x + 6`、`2(x + 1)`），可以展开、求导、解方程、求值，结果是精确的，也可以用指定精度的十进制数计算。计算由基于 [SymEngine](https://github.com/symengine/symengine) 和 [mpdecimal](https://www.bytereef.org/mpdecimal/) 的原生插件完成，原生插件在安装这个包时编译。耗时的运算还可以放到原生插件自己的线程里执行，并且可以设置时限、随时取消。`lakutata` 包没有重新导出这个包，请从 `@lakutata/math` 导入。

## 安装

```shell
npm install lakutata @lakutata/math
```

- 原生插件在安装时编译（node-gyp），所以机器上需要 Python 3 和支持 C++17 的编译器：macOS 上是 Xcode 的命令行工具，Linux 上是 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上是 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。编译需要半分钟到几分钟；编译失败时，安装也会失败。
- 包管理器需要执行这个包的安装脚本。npm 会执行，但可能提示这个脚本“not yet covered by allowScripts”：用 `npm install-scripts approve @lakutata/math` 记下你允许它执行。Bun 和 pnpm 只为信任的依赖执行，需要先允许它（Bun 在 package.json 的 `trustedDependencies` 里加上它，pnpm 用 `pnpm approve-builds`）；没有允许时，加载这个包会抛出错误，说明怎样编译原生插件。
- Node.js `^22.13.0 || >=24.11.0`。它的对等依赖 `@lakutata/core` 会随 `lakutata` 一起安装。

## 用法

### 组件

`Math` 是一个组件：用 `buildMathOptions()` 注册（需要不同的定义时，可以用不同的名字注册多份），也可以不注册，直接按默认选项注入（`@Inject(Math)`）。

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

不在应用里时（脚本、测试），从 `Container` 里取出组件：

```typescript
import {Container} from 'lakutata'
import {Math} from '@lakutata/math'

const container: Container = new Container()
await container.setNamed('math', Math, {precision: 50})
const math: Math = await container.get<Math>('math')
console.log(math.expression('pi').toDecimal())                           //3.1415926535897932384626433832795028841971693993751
await container.destroy()
```

### 公式的写法

| 写法 | 意思 |
|---|---|
| `2x`、`2(x + 1)`、`(x + 1)(x - 1)`、`x (y + 1)` | 省略乘号的乘法。名字后面紧跟 `(` 表示调用函数，要相乘请写 `a*(b + c)` |
| `x^2`、`x**2`、`2^3^2` | 乘方，从右往左算（`2^3^2` 是 `2^9`） |
| `5!` | 阶乘 |
| `0.1`、`1.5e3` | 精确的小数：`0.1` 就是 `1/10` |
| `pi`、`e`、`i`、`inf`（或 `oo`）、`nan`、`phi`（黄金分割）、`tau`（`2pi`）、`EulerGamma`、`Catalan` | 常数 |
| `sin`、`cos`、`tan`、`asin`、`sinh`……、`exp`、`ln`、`log(x)`（自然对数）、`log(x, b)`、`log10`、`log2`、`expm1`、`log1p`、`sqrt`、`cbrt`、`root(x, n)`、`hypot` | 函数 |
| `abs`、`sign`、`floor`、`ceil`、`trunc`、`round`、`mod(a, b)`、`min`、`max`、`gcd`、`lcm`、`re`、`im`、`arg`、`conj` | 取整、余数、最值和复数的实部虚部 |
| `gamma`、`loggamma`、`digamma`、`polygamma`、`lowergamma`、`uppergamma`、`beta`、`erf`、`erfc`、`zeta`、`lambertw`、`sinc`、`binomial`、`factorial` | 特殊函数 |
| `x^2 = 4` | 方程（`math.equation()` 或 `math.parse()`） |
| `x < 1`、`x >= 0` | 不等式，由 `math.parse()` 读取 |

`cbrt(x)` 和奇数次的 `root(x, n)` 对负实数取实数根（`cbrt(-8)` 是 `-2`，和 `Math.cbrt` 一样）；乘方取主值（`(-8)^(1/3)` 是 `1 + sqrt(3)i`，和 SymPy 一样）。`round` 遇到正好一半时向远离零的方向舍入（`round(-2.5)` 是 `-3`），`mod(a, b)` 的符号和 `b` 相同（`mod(-7, 3)` 是 `2`），`gcd` 和 `lcm` 只算整数。变量都当作复数：`re(x)` 保持原样。

函数名不带括号时当作变量（`gamma`、`beta`、`re`、`mod` 都是常见的量的名字），只有容易漏写括号的函数例外（三角和双曲函数、`exp`、`ln`、各种 `log`、`sqrt`、`cbrt`）：`sin x` 是错误，要写成 `sin(x)`。

结果也用同样的写法输出：`toString()` 得到的公式可以再交给 `math.expression()` 读回来，`toTeX()` 得到 LaTeX。语法错误会抛出 `MathSyntaxException`，它的 `position` 是出错字符的位置。

### 定义

组件的 `definitions` 是用公式写的函数和常数。组件创建以后它们不再改变，所以注入这个组件的每个类看到的定义都一样。需要临时加定义时用 `with()`，它不会改变组件：

```typescript
import type {Math} from '@lakutata/math'

function prices(math: Math): void {
    const scope = math.with({'net(x)': 'x / (1 + rate)', 'rate': '0.13'})
    console.log(scope.expression('net(113)').toString())                  //100
}
```

读取公式时定义就会展开，所以求导、解方程都能用上它们。

### 精确结果和数字

公式给出精确的结果：`0.1 + 0.2` 是 `3/10`，`sin(pi/6)` 是 `1/2`，`sqrt(8)` 是 `2sqrt(2)`。数乘以一个和时会乘进去：`2(x + 1)` 是 `2x + 2`。精确计算最多到约 31.5 万位：更大的幂保持幂的形式（`2^(10^7)`），阶乘最多算到 `20000!`，再大的保持 `gamma(n + 1)` 的形式。需要数字时：

- `toNumber()` 转成 JavaScript 的数字（值是复数时抛出 `MathDomainException`），`toComplex()` 得到 `{re, im}`。凡是 `toDecimal()` 能算的实数值，它们都先算出十进制值再转成数字，所以即使双精度计算已经没有一位有效数字（例如 `cos(10^30)`），得到的数字每一位都是对的；其余部分用双精度计算。两者都能计算实数和复数参数的特殊函数（伽马、zeta、Lambert W、多伽马、误差函数等）。
- `toDecimal(digits)` 得到指定有效位数、正确舍入的字符串（默认位数是组件的 `precision`），写法和 `Decimal` 相同（见下一节）：算出的 3 写成 `3`，不写成 `3.000…`。它会用更多位数重新计算，直到两次结果一致。能算四则运算、乘方和开方、`exp` 和 `ln`、三角函数和双曲函数及它们的反函数、取整函数、常数，以及实数参数的特殊函数：`gamma`、`loggamma`、`digamma`、`polygamma`、`beta`、`erf`、`erfc`、`zeta`（包括 Hurwitz zeta）、`lowergamma`、`uppergamma` 和 `lambertw`。多算 640 位仍然和 0 分不开的值，结果是 `0`（例如 `ln(6) - ln(2) - ln(3)`）；恰好在相邻两个这么多位的十进制数正中间的值，取末位是偶数的那个（`ln(8)/ln(4)` 等于 1.5，保留 1 位得 `2`）。
- `compile()` 为了速度用双精度计算：双精度已经没有有效数字的值，它也算不准。
- `toRectangular()` 给出表达式的实部和虚部（`{real, imaginary}`），`toPolar()` 给出它的模和辐角（`{modulus, argument}`）：`e^(i*pi/3)` 的实部和虚部是 `1/2` 和 `sqrt(3)/2`，模和辐角是 `1` 和 `pi/3`。变量当作复数，所以 `x` 的实部和虚部是 `re(x)` 和 `im(x)`。
- `compile(variables)` 把表达式编译成一个以数字为参数的函数，适合反复求值；`batch()` 一次算很多组数据：

```typescript
import type {Math} from '@lakutata/math'

function plot(math: Math): Float64Array {
    const f = math.expression('x^2 + sin(y)').compile(['x', 'y'])
    console.log(f(2, 0))                                                   //4
    return f.batch(Float64Array.of(1, 0, 2, 0, 3, 0))                      //[1, 4, 9]
}
```

### 十进制数

`math.decimal(value, {precision})` 得到一个 `Decimal`：有效数字最多 `precision` 位的十进制数（默认是组件的 `precision`，32 位），适合计算金额，或者需要很多位数的值。每次运算都把结果正确舍入到这个精度：取有这么多位的十进制数里最接近的一个；正好在两个之间的中点时，取末位是偶数的那个。十进制数不会改变：每次运算都得到一个新的。

- 值按写出来的样子读入：数字按它最短的写法读（`0.1` 就是 0.1，不是这个双精度数的二进制值），字符串按十进制数读（`'19.99'`、`'1.5e-7'`），bigint 精确读入。没有变量的表达式会先算出值，和 `toDecimal()` 一样：`math.decimal(math.expression('pi'), {precision: 50})`。
- 结果的精度和参与运算的那个十进制数相同：`a.add(b)` 的精度是 `a` 的。传给运算的值按它的全部位数读入。
- 运算有：`add`、`sub`、`mul`、`div`、`mod`（结果的符号和除数相同，和公式里的 `mod()` 一样）、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root(n)`、`exp`、`ln`、`log10`、`log(base)`、三角函数和双曲函数及它们的反函数、`atan2(x)`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round(places)`（正好在中点时向远离 0 的方向舍入，和公式里的 `round()` 一样）、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`。
- `toString()` 写出的数字不带末尾的 0：第一位数字在 10^-6 位到 10^(precision - 1) 位之间时用普通写法，否则用科学记数法（`1.5`、`0.000025`、`1.5e+25`、`1e-7`）。`toFixed(places)` 写出指定的小数位数（1.5 的 `toFixed(2)` 是 `1.50`），`toNumber()` 得到最接近的数字。十进制数在公式里也是精确的值：`math.expression(decimal)`。
- 这些运算在 JavaScript 线程里执行，没有时限。四则运算在任何精度下都很快，但函数算到几万位要几秒，特殊函数（`zeta`、`gamma`）算到几千位就要几秒：这种情况请用 `toDecimalAsync()` 计算表达式（可以设时限），再用结果得到十进制数。

```typescript
import type {Math} from '@lakutata/math'

function decimals(math: Math): void {
    console.log(math.decimal(0.1).add(0.2).toString())                           //0.3
    console.log(math.decimal('19.99').mul(3).toFixed(2))                         //59.97
    console.log(math.decimal(1, {precision: 5}).div(3).toString())               //0.33333
    console.log(math.decimal(2, {precision: 40}).sqrt().toString())              //1.41421356237309504880168872420969807857
}
```

### 生成代码

- `toJavaScript()` 和 `toC()` 把表达式写成 JavaScript 或 C（C99 和 `<math.h>`）的代码，变量直接用原来的名字：`x^2 - 5x + 6` 在 JavaScript 里写成 `Math.pow(x, 2) - 5*x + 6`，在 C 里写成 `pow(x, 2.0) - 5.0*x + 6.0`。生成的代码用双精度浮点数计算，而且只在实数范围内计算：表达式中某一部分的值是复数时，结果是 NaN（`compile()` 会在复数范围内计算这些部分）。用到目标语言没有的函数（例如 JavaScript 没有 `gamma` 和 `erf`，两种语言都没有 `zeta` 和 `lambertw`）、`2i` 这样的复数，或者变量名和目标语言的保留字或生成代码要用到的名字（如 `new`、`Math`、`pow`）相同时，抛出 `MathNotSupportedException`。
- `math.cse(expressions)` 找出几个表达式里重复出现或者共有的部分（公共子表达式消除）。它返回这些部分（`replacements`），每个部分有一个名字（`x0`、`x1`……，会跳过表达式里已有的变量名）和一个值，值里可以引用排在它前面的名字；还返回用这些名字改写后的表达式（`expressions`）。再配合 `toJavaScript()` 或 `toC()`，就能生成每个部分只算一次的代码。

```typescript
import type {Math} from '@lakutata/math'

function code(math: Math): string {
    const {replacements, expressions} = math.cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
    const lines: string[] = replacements.map(({name, value}) => `const ${name} = ${value.toJavaScript()}`)   //const x0 = x + y
    lines.push(`return [${expressions.map((expression) => expression.toJavaScript()).join(', ')}]`)          //return [x0 + Math.pow(Math.sin(x0), 2), Math.cos(x0)]
    return lines.join('\n')
}
```

### 解方程

- 对方程或表达式（表示它等于零）调用 `solve(variable)`，得到解的数组，每个解是一个表达式；它的 `kind` 说明解集的种类：`finite`（有限个）、`empty`（无解）、`all`（任意值）、`intervals`（区间），或者 `unsolved`/`other`（这个包解不出来的集合，用 `text` 描述）。四次及以下的方程给出精确解。`{domain: 'real'}` 只保留实数解。
- `math.solve(equations, variables)` 解线性方程组：无解时返回空数组，否则返回一组解，给出它能确定的每个变量的值（有无穷多组解时，用其他变量表示）。

```typescript
import type {Math} from '@lakutata/math'

function solve(math: Math): void {
    console.log(math.expression('x^4 - 1').solve('x').map(String))                    //['-1', '1', '-i', 'i']
    const [solution] = math.solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
    console.log(solution.x.toString(), solution.y.toString())                        //2 1
}
```

### 数论

`math.ntheory` 处理整数：参数是 bigint，或者安全整数范围内的 number；整数结果都是 bigint。

- 整除和模运算：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`，以及 `crt`（中国剩余定理，模数不必两两互质）。模 `m` 的结果和 `m` 同号，和 `mod` 一样：`mod(-7, 3)` 是 `2n`。
- 质数：`isPrime`（2^64 以下的结果是确定的，以上用 Baillie-PSW 检验，目前还没有发现能通过它的合数）、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`。
- 数列和组合数：`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`，以及给出精确分数（表达式）的 `bernoulli` 和 `harmonic`。`bernoulli(1)` 和 SymPy 一样是 `+1/2`。

值不存在时（没有逆元的数的 `modInverse`、没有原根的模数的 `primitiveRoot`、没有公共解的同余方程组的 `crt`），结果是 `undefined`。参数不在函数的定义域内时（`totient(0)`、`legendre(a, 9)`），抛出 `MathDomainException`。

`factor` 能立刻找出小的因数，20 位左右的数也分解得很快；但一个数如果有两个很大的质因数，可能要算好几天，这时请用 `factorAsync` 并设置时限。`isPrime`、`nextPrime`、`totient`、`mobius` 和 `primitiveRoot` 也有异步版本。`factorial` 最大能算到 `71000!` 左右；而公式里的 `factorial(n)` 在 n 超过 20000 时保持 `gamma(n + 1)` 的形式，这样表达式仍然能打印出来。

```typescript
import type {Math} from '@lakutata/math'

async function integers(math: Math): Promise<void> {
    console.log(math.ntheory.factor(360))                     //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
    console.log(math.ntheory.powMod(4, 13, 497))              //445n
    console.log(math.ntheory.crt([2, 3, 2], [3, 5, 7]))       //{remainder: 23n, modulus: 105n}
    console.log(await math.ntheory.factorAsync(2n ** 64n + 1n, {timeout: 5000}))
}
```

### 异步运算

可能耗时的运算都有异步版本：`expandAsync()`、`simplifyAsync()`、`diffAsync()`、`seriesAsync()`、`solveAsync()`、`toDecimalAsync()`、组件的 `solveAsync()` 和 `cseAsync()`，以及数论的异步版本。它们在原生插件自己的线程里执行，不占用 libuv 的线程池：线程数默认是 CPU 核数减一，也可以用环境变量 `LAKUTATA_MATH_THREADS` 指定。选项有 `timeout`（毫秒）和 `signal`（`AbortSignal`）：

- 到了时限，Promise 以 `MathTimeoutException` 拒绝；signal 取消时，以 `MathCancelledException` 拒绝。有检查点的运算（展开、十进制计算、线性方程组、数论）会在下一个检查点停下；其他运算会先算完，线程才空出来。
- 组件限制自己同时执行的运算数（`concurrency`）。组件销毁时会等正在执行的运算结束，最多等 `drainTimeout` 毫秒。

表达式最多嵌套 1000 层：更深的公式会被拒绝（`MathNotSupportedException`），以免运算时栈溢出。

### 打包

`lakutata package` 生成的包、可执行文件和安装程序会带上编译好的原生插件（`build/Release/math.node`），所以要在每个目标平台上先安装这个包，再在那里打包。

## API

| 导出 | 说明 |
|---|---|
| `Math` | 组件：`parse`、`expression`、`equation`、`decimal`、`with`、`solve`、`solveAsync`、`cse`、`cseAsync`、`ntheory` |
| `buildMathOptions`、`MathConfig` | 在组件配置里声明它，以及它的选项：`definitions`、`precision`、`timeout`、`concurrency`、`drainTimeout` |
| `MathScope`、`MathDefinitions` | `with()` 得到的范围，方法和组件相同（没有 `ntheory`）；定义（按签名给出的公式） |
| `Expression` | 表达式：`toString`、`toTeX`、`toNumber`、`toComplex`、`toDecimal`、`variables`、`equals`、`add`、`sub`、`mul`、`div`、`pow`、`neg`、`expand`、`simplify`、`diff`、`series`、`substitute`、`evaluate`、`solve`、`compile`，多项式（`coefficients`、`degree`、`leadingCoefficient`、`divide`），`numerator`、`denominator`、`rewrite`（改写成 `exp`、`sin`、`cos`），判断（`isZero`、`isPositive`、`isNegative`、`isInteger`、`isRational`、`isReal`、`isFinite`：不知道时为 `undefined`），`compare`、`toJavaScript`、`toC`、`toPolar`、`toRectangular`，以及各个异步版本 |
| `CommonSubexpressions`、`CseOptions` | `cse()` 的结果（`replacements`、`expressions`）和它的选项（`prefix`） |
| `PolarForm`、`RectangularForm` | 复数的极坐标形式（模 `modulus`、辐角 `argument`）和直角坐标形式（实部 `real`、虚部 `imaginary`） |
| `Equation`、`Inequality`、`InequalityRelation` | 方程（`left`、`right`、`difference`、`substitute`、`solve`、`solveAsync`），不等式（`left`、`right`、`relation`） |
| `Solutions`、`SolutionsKind`、`SolutionInterval`、`SolveOptions` | 方程的解：表达式的数组，带有 `kind`、`intervals` 和 `text`；解的范围 `domain` |
| `SystemSolution`、`SystemEquation` | 方程组的一组解（每个变量对应一个表达式），方程组里的一个方程 |
| `CompiledFunction` | 编译后的表达式：以数字为参数的函数，它的 `variables` 和 `batch` |
| `Decimal`、`DecimalValue`、`DecimalOptions` | 指定精度的十进制数（`math.decimal()`）：`precision`、`add`、`sub`、`mul`、`div`、`mod`、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root`、`exp`、`ln`、`log10`、`log`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`sinh`、`cosh`、`tanh`、`asinh`、`acosh`、`atanh`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round`、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`、`toString`、`toFixed`、`toNumber`、`toJSON`；需要十进制数的地方可以传入的值（十进制数、数字、bigint、写成字符串的十进制数）；`decimal()` 的选项（`precision`） |
| `NumberTheory`、`IntegerValue`、`PrimeFactor`、`ExtendedGcd`、`Congruence` | 数论（`math.ntheory`）：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`、`isPrime`、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`、`crt`、`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`、`bernoulli`、`harmonic`，以及各个异步版本；整数（bigint，或安全整数范围内的 number）；质因数和它的指数；`extendedGcd` 的结果；`crt` 的结果 |
| `AsyncOptions`、`Value` | 异步运算的选项（`timeout`、`signal`）；需要表达式的地方可以传入的值（表达式、数字、bigint、十进制数、公式） |

类型声明里有每个声明的说明和示例。

## 错误

| 错误 | 什么时候抛出 |
|---|---|
| `MathSyntaxException` | 公式写得不对（带有出错的 `position`），需要表达式的地方给了方程，或者反过来 |
| `MathUnknownFunctionException` | 公式调用的函数既不是内置函数，也没有定义，或者把常数写成了调用（`g(2)`），带有它的 `position` |
| `MathDefinitionException` | 定义无效：用了内置的名字、参数重复、定义之间循环引用、定义嵌套太深 |
| `MathDomainException` | 把复数当成数字取值，取无穷大、`complexInfinity`（除以零；`toNumber()` 里也包括除以一个无法和 0 区分的值）的值，数论函数的参数不在定义域内（`totient(0)`），或者十进制数不在函数的定义域内（负数开平方、`asin()` 的参数是 2、负数的非整数次幂） |
| `MathDivisionByZeroException` | 计算十进制值时遇到除以零（包括除以一个无法和 0 区分的值、0 的对数、0 的负数次幂、以 1 为底的对数、在函数的极点上求值：`gamma()` 的参数是 -2、`zeta()` 的参数是 1），或者模数是 0 |
| `MathNotSupportedException` | 这个包对这个表达式不做的运算：非线性方程组、无法编译的表达式、嵌套超过 1000 层的表达式、运算中遇到太大而无法精确计算的数、对非整数求 `gcd` 或 `lcm`、数论的结果超过 2^20 位（二进制）、`bernoulli(n)` 的 n 超过 2000、`harmonic(n)` 的 n 超过 50000、生成代码时遇到目标语言没有的函数、`2i` 这样的复数、和保留字重名的变量、求 n 不是整数的 `polygamma(n, x)` 的十进制值，或者十进制数的指数超出了范围（约 ±10^18，32 位系统上约 ±4.25 × 10^8；例如 `exp()` 的参数是 10^19，`toDecimal()` 里也一样） |
| `MathArgumentException` | 参数无效：需要数字的地方还有变量、名字不是变量、给的值个数不对、需要整数的地方给的不是整数、需要十进制数的地方给的不是十进制数、精度不在 1 到 100000 之间 |
| `MathTimeoutException`、`MathCancelledException` | 异步运算超过时限，或者被取消 |
| `MathException` | 以上所有错误的基类；原生插件内部错误时，它的 `errno` 是 `E_MATH_INTERNAL` |

## 另见

- [SymEngine](https://github.com/symengine/symengine)：原生插件所基于的符号计算引擎。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库和它们的许可证。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
