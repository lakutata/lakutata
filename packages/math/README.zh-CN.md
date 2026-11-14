# @lakutata/math

[English](README.md) | 中文

Node.js 的数学包。公式按纸面上的写法输入（`x^2 - 5x + 6`、`2(x + 1)`），可以展开、因式分解、化简、求导、解方程和求值，结果是精确的，也可以用指定精度的十进制数计算；此外可以求极限、求和与求积、解不等式，并支持分段函数；还提供数值矩阵和线性代数、统计和概率分布，以及数值求根。计算由基于 [SymEngine](https://github.com/symengine/symengine)、[Boost](https://www.boost.org)、[Eigen](https://eigen.tuxfamily.org) 和 [mpdecimal](https://www.bytereef.org/mpdecimal/) 的原生插件完成，原生插件在安装本包时编译。耗时的运算还可以放到原生插件自身的线程中执行，并可以设置时限、随时取消。本包属于 [Lakutata](https://github.com/lakutata/lakutata) 系列，但无需 Lakutata 应用，从 `@lakutata/math` 导入其函数即可直接使用。

## 安装

```shell
npm install @lakutata/math
```

- 原生插件在安装时编译（node-gyp），因此机器上需要安装 Python 3 和支持 C++17 的编译器：macOS 上为 Xcode 命令行工具，Linux 上为 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上为 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。编译需要半分钟到几分钟；编译失败时，安装也会失败。
- 包管理器需要执行本包的安装脚本。npm 会执行该脚本，但可能提示该脚本“not yet covered by allowScripts”，此时运行 `npm install-scripts approve @lakutata/math` 即可记录允许其执行。Bun 和 pnpm 只为明确信任的依赖执行安装脚本，需要先允许本包（Bun 在 package.json 的 `trustedDependencies` 中添加本包，pnpm 使用 `pnpm approve-builds`）；未允许时，加载本包会抛出错误，并说明原生插件的编译方法。
- Node.js `>=18.10.0`。
- 原生插件使用 Node-API，因此 Bun 和 Electron 主进程可以直接加载 node-gyp 为 Node.js 编译的插件，无需重新编译。在 Bun 中，如果在 worker 线程中的原生插件运算结束前终止该线程，整个进程会因 Node-API 致命错误而退出（这是 Bun 的缺陷）；Node.js 和 Electron 会丢弃这些运算。

## 用法

### 快速上手

本包导出的函数可以直接使用：`parse`、`expression`、`equation`、`decimal`、`matrix`、`expressionMatrix`、`jacobian`、`unit`、`constant`、`solve` 和 `cse`，以及命名空间 `ntheory`（数论）、`poly`（多项式）、`linalg`（线性代数）、`stats`（统计和概率）和 `numeric`（数值解、数值积分和微分方程）。这些函数和命名空间都属于 `math`，即以默认选项创建的范围。

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

### 选项

`createMath(options)` 以其他选项创建一个 `MathScope`，其函数与上面相同。选项有：`definitions`（用公式写的函数和常数，默认没有）、十进制数的 `precision`（默认 32 位有效数字）、异步运算的 `timeout`（毫秒，默认 0，即不限时）、异步运算的 `concurrency`（默认使用原生插件的全部线程），以及 `units`（添加到单位表中的单位，默认没有）。每个选项都有默认值，因此不带选项调用 `createMath()` 得到的范围与 `math` 相同。一个程序可以创建多个范围，分别使用不同的定义。

```typescript
import {createMath, type Equation, type Expression, type MathScope} from '@lakutata/math'

const physics: MathScope = createMath({definitions: {'g': 9.80665, 'fall(t)': 'g*t^2/2'}, precision: 50})
const height: Expression = physics.expression('h0 - fall(t)')
console.log(height.toString())                      //-196133t^2/40000 + h0
const landing: Equation = physics.equation('fall(t) = 100')
console.log(landing.solve('t', {domain: 'real'}).map((t: Expression): number => t.toNumber()))   //[-4.5160075575178755, 4.5160075575178755]
console.log(physics.expression('pi').toDecimal())   //3.1415926535897932384626433832795028841971693993751
const expanded: Expression = await physics.expression('(x + y + 1)^30').expandAsync({timeout: 1000})
console.log(expanded.variables())                   //['x', 'y']
```

### 公式的写法

| 写法 | 含义 |
|---|---|
| `2x`、`2(x + 1)`、`(x + 1)(x - 1)`、`x (y + 1)` | 省略乘号的乘法。名称后面紧跟 `(` 表示调用函数，如需相乘，请写 `a*(b + c)` |
| `x^2`、`x**2`、`2^3^2` | 乘方，从右向左计算（`2^3^2` 即 `2^9`） |
| `5!` | 阶乘 |
| `0.1`、`1.5e3` | 精确的小数：`0.1` 即 `1/10` |
| `pi`、`e`、`i`、`inf`（或 `oo`）、`nan`、`phi`（黄金分割）、`tau`（`2pi`）、`EulerGamma`、`Catalan` | 常数 |
| `sin`、`cos`、`tan`、`asin`、`sinh`……、`exp`、`ln`、`log(x)`（自然对数）、`log(x, b)`、`log10`、`log2`、`expm1`、`log1p`、`sqrt`、`cbrt`、`root(x, n)`、`hypot` | 函数 |
| `abs`、`sign`、`floor`、`ceil`、`trunc`、`round`、`mod(a, b)`、`min`、`max`、`gcd`、`lcm`、`re`、`im`、`arg`、`conj` | 取整、余数、最值和复数的实部虚部 |
| `gamma`、`loggamma`、`digamma`、`polygamma`、`lowergamma`、`uppergamma`、`beta`、`erf`、`erfc`、`zeta`、`lambertw`、`sinc`、`binomial`、`factorial` | 特殊函数 |
| `Si`、`Ci`、`Shi`、`Chi`、`Ei`、`li`、`fresnelS`、`fresnelC` | 积分型特殊函数：正弦积分、余弦积分、双曲正弦积分、双曲余弦积分、指数积分、对数积分、菲涅耳积分；参数为实数时，既可以求双精度值，也可以求十进制值 |
| `piecewise(x^2, x < 0, x)`、`step`、`rect`、`tri` | 分段函数：依次为各段的值和条件，最后是其他情况的值；`step`、`rect`、`tri` 也以分段函数的形式定义 |
| `sum(k^2, k, 1, n)`、`product(k, k, 1, n)` | 求和、求积：参数依次为通项、通项的变量，以及该变量的第一个值和最后一个值（整数、`-inf` 或 `inf`） |
| `x^2 = 4` | 方程（`equation()` 或 `parse()`） |
| `x < 1`、`x >= 0` | 不等式，由 `parse()` 读取 |
| `[1, 2; 3, 4]`、`[x; y]` | 矩阵：行之间用 `;` 分隔，元素之间用 `,` 分隔（`parse()` 得到 `ExpressionMatrix`）。矩阵可以相加、相乘（`[1, 2; 3, 4] * [x; y]`、`2[1, 2]`）、除以一个数、取整数次幂；`det`、`inv`、`transpose` 和 `trace` 的参数是矩阵 |

`cbrt(x)` 和奇数次的 `root(x, n)` 对负实数取实数根（`cbrt(-8)` 是 `-2`，与 `Math.cbrt` 相同）；乘方取主值（`(-8)^(1/3)` 是 `1 + sqrt(3)i`，与 SymPy 相同）。`round` 遇到恰好一半时向远离零的方向舍入（`round(-2.5)` 是 `-3`），`mod(a, b)` 的符号与 `b` 相同（`mod(-7, 3)` 是 `2`），`gcd` 和 `lcm` 只对整数计算。变量均视为复数，因此 `re(x)` 保持原样。

`piecewise(v1, c1, v2, c2, …, v)` 中，每个值在其条件成立、且前面的条件均不成立时取用；条件之后的最后一个值在所有条件均不成立时取用，缺少该值时，表达式在这些位置没有定义（`nan`）。条件是值的比较（`<`、`<=`、`>`、`>=`、`=`、`!=`；`0 <= x < 1` 即 `0 <= x and x < 1`），可以用 `and`、`or`、`not` 和括号组合；这三个词不能用作变量名。常数之间的比较精确判定（`piecewise(1, sqrt(2) < 3/2, 2)` 是 `1`），含变量的比较在给出变量的值（`substitute()`）后判定；比较中出现复数时抛出 `MathDomainException`。`step(x)` 在 0 以下为 0，在 0 处为 1/2，在 0 以上为 1（SymPy 的 `Heaviside`）；`rect(x)` 在 `|x| < 1/2` 时为 1，在 `|x| = 1/2` 处为 1/2，其余为 0；`tri(x)` 在 `|x| < 1` 时为 `1 - |x|`，其余为 0；以上均与 nerdamer 相同。分段函数逐段求导（`step(x)` 的导数是 0，因为没有狄拉克 δ 函数），可以编译，在 LaTeX 中写为 `cases`，在 JavaScript 和 C 中写为条件表达式；`numeric.integrate()` 在分段改变之处将区间分开。

```typescript
import {expression} from '@lakutata/math'

const f = expression('piecewise(x^2, x < 0, x)')
console.log(f.diff('x').toString())           //piecewise(2x, x < 0, 1)
console.log(f.substitute({x: -3}).toString()) //9
console.log(f.toTeX())                        //\begin{cases} x^{2} & \text{for}\: x < 0 \\ x & \text{otherwise} \end{cases}
```

`sum(f, k, a, b)` 和 `product(f, k, a, b)` 是 `f` 在 `k` 从 `a` 到 `b` 时的和与积，`a`、`b` 为整数、`-inf`、`inf`，或其他变量的表达式。`k` 是约束变量，不计入表达式的变量，`substitute()` 和 `diff()` 均不作用于该变量。与 SymPy 相同，`b = a - 1` 时和为 0（积为 1），`b < a - 1` 时结果为从 `b + 1` 到 `a - 1` 的和的相反数（积则取倒数）。上下限为相差不超过 1000 的整数时，逐项精确计算；否则寻找闭式：`k` 的多项式（`sum(k^2, k, 1, n)` 是 `n^3/3 + n^2/2 + n/6`）、几何级数（`sum(x^k, k, 0, n)` 是 `piecewise(n + 1, x = 1, (-x^(n + 1) + 1)/(-x + 1))`；上限为 `inf` 时，取其在 `abs(x) < 1` 时的值）、`1/(k + q)` 的幂（用 `zeta` 和 `polygamma` 表示：`sum(1/k^2, k, 1, inf)` 是 `pi^2/6`）、超几何项（Gosper 算法：`sum(k*2^k, k, 1, n)` 是 `2(n - 1)*2^n + 2`，`sum(1/(k*(k + 1)), k, 1, n)` 是 `n/(n + 1)`，`sum(k*k!, k, 1, n)` 是 `gamma(n + 2) - 1`；上限为 `inf` 时，取到 `n` 为止的部分和的极限，`sum(1/(k*(k + 1)), k, 1, inf)` 是 1；相邻两项之比含有其他变量时，给出该比值的绝对值小于 1 时的值：`sum(k*x^k, k, 0, inf)` 在 `abs(x) < 1` 时是 `x/(x - 1)^2`），和式按各项分别求和；幂的积，以及因式均为一次的多项式分式的积（用 `gamma` 表示：`product(1 - 1/k^2, k, 2, n)` 是 `(n + 1)/(2n)`）。到 `inf` 的和无限增大时，结果为 `inf` 或 `-inf`（`sum(2^k, k, 0, inf)`、`sum(k*k!, k, 1, inf)`）。其余情况保持 `sum(…)` 和 `product(…)` 的形式，上下限为整数时逐项求值（最多 10^4 项），且无法编译。

```typescript
import {expression} from '@lakutata/math'

console.log(expression('sum(k^2, k, 1, n)').toString())              //n^3/3 + n^2/2 + n/6
console.log(expression('sum(1/k^2, k, 1, inf)').toString())          //pi^2/6
console.log(expression('product(1 - 1/k^2, k, 2, n)').toString())    //(n + 1)/(2n)
console.log(expression('sum(sin(k*x), k, 1, n)').diff('x').toTeX()) //\sum_{k = 1}^{n} k \cos\left(k x\right)
```

函数名不带括号时视为变量（`gamma`、`beta`、`re`、`mod` 都是常见的量的名称），只有容易漏写括号的函数例外（三角和双曲函数、`exp`、`ln`、各种 `log`、`sqrt`、`cbrt`）。对于这些函数，`sin x` 是错误的写法，应写为 `sin(x)`。

结果也以同样的写法输出：`toString()` 得到的公式可以交给 `expression()` 重新读入，`toTeX()` 得到 LaTeX。语法错误会抛出 `MathSyntaxException`，其 `position` 为出错字符的位置。

### 定义

`createMath()` 的 `definitions` 是用公式写的函数和常数。范围创建之后，这些定义不再改变，因此程序中使用该范围的各处看到的定义都相同。需要临时添加定义时，请使用 `with()`，该方法不会改变原来的范围：

```typescript
import {math} from '@lakutata/math'

const scope = math.with({'net(x)': 'x / (1 + rate)', 'rate': '0.13'})
console.log(scope.expression('net(113)').toString())   //100
```

读取公式时定义即会展开，因此求导和解方程都能使用这些定义。

### 精确结果和数字

公式给出精确的结果：`0.1 + 0.2` 是 `3/10`，`sin(pi/6)` 是 `1/2`，`sqrt(8)` 是 `2sqrt(2)`。数乘以和式时会分配到各项（`2(x + 1)` 是 `2x + 2`），同一有理数次幂的整数会合并相乘（`sqrt(2)*sqrt(3)` 是 `sqrt(6)`），与 SymPy 相同。精确计算的上限约为 31.5 万位。更大的幂保持幂的形式（`2^(10^7)`），阶乘最多计算到 `20000!`，更大的阶乘保持 `gamma(n + 1)` 的形式。需要数字时：

- `toNumber()` 转换为 JavaScript 数字（值为复数时抛出 `MathDomainException`），`toComplex()` 得到 `{re, im}`。凡是 `toDecimal()` 或 `toComplexDecimal()` 能计算的值，这两个方法都会先算出十进制值再转换为数字，因此即使双精度计算已经没有一位有效数字（例如 `cos(10^30)`、`e^(i*10^30)`），得到的数字每一位仍然正确。两者也能计算复数参数的特殊函数（伽马、zeta、Lambert W、多伽马、误差函数等），这些函数以双精度计算，表达式的其余部分仍以十进制计算。
- `toDecimal(digits)` 得到指定有效位数、正确舍入的字符串（默认位数为范围的 `precision`），写法与 `Decimal` 相同（见下一节），例如算出的 3 写为 `3`，而不是 `3.000…`。该方法会用更多位数重新计算，直到两次结果一致。可计算的有四则运算、乘方和开方、`exp` 和 `ln`、三角函数和双曲函数及它们的反函数、取整函数、常数，以及实数参数的特殊函数：`gamma`、`loggamma`、`digamma`、`polygamma`、`beta`、`erf`、`erfc`、`zeta`（包括 Hurwitz zeta）、`lowergamma`、`uppergamma` 和 `lambertw`，以及积分型特殊函数 `Si`、`Ci`、`Shi`、`Chi`、`Ei`、`li`、`fresnelS` 和 `fresnelC`。多算 640 位仍无法与 0 区分的值，结果为 `0`（例如 `ln(6) - ln(2) - ln(3)`）；参数过大、该位数不足以确定结果的值，会按需多算一些位数，最多多算 50000 位（`sin(10^(10^4))` 需要多算 10^4 位）；恰好位于该位数的两个相邻十进制数正中间的值，取末位为偶数的那个（`ln(8)/ln(4)` 等于 1.5，保留 1 位得 `2`）。计算中出现复数、但值为实数时（`e^(i*pi)`、`-i*asinh(i)`），结果为 `toComplexDecimal()` 的实部；值为复数时抛出 `MathDomainException`。
- `toComplexDecimal(digits)` 得到复数值的实部和虚部 `{re, im}`，舍入方式与 `toDecimal()` 相同，实部和虚部各自保留指定的有效位数，例如 `(1 + i/10^25)^2 - 1` 的实部和虚部分别为 `-1e-50` 和 `2e-25`。`toDecimal()` 能计算的函数，该方法对复数参数同样能计算，取主值分支；落在割线上的值与 SymPy 取同一侧（`asin(2)` 是 `pi/2 - 1.3169…i`）。其中的特殊函数只接受实数参数。
- `compile()` 为了速度以双精度计算，因此对于双精度下已没有有效数字的值，编译后的函数同样无法算准。不含变量的部分先按精确的十进制算好，例如 `ln(erf(5))` 的每一位都正确，而从 `erf(5)` 的双精度值计算只剩 4 位有效数字。实数参数的特殊函数由 Boost.Math 计算（积分型特殊函数中，除 `Ei` 外均使用本包自身的级数和连分式），误差在最后一位的几个单位以内，且各个平台运行的是同一套代码（C 库的伽马函数在不同系统上各不相同）。
- `toRectangular()` 给出表达式的实部和虚部（`{real, imaginary}`），`toPolar()` 给出其模和辐角（`{modulus, argument}`）。例如 `e^(i*pi/3)` 的实部和虚部分别为 `1/2` 和 `sqrt(3)/2`，模和辐角分别为 `1` 和 `pi/3`。变量视为复数，因此 `x` 的实部和虚部为 `re(x)` 和 `im(x)`。
- `compile(variables)` 将表达式编译为以数字为参数的函数，适合反复求值；`batch()` 一次计算多组数据：

```typescript
import {expression} from '@lakutata/math'

const f = expression('x^2 + sin(y)').compile(['x', 'y'])
console.log(f(2, 0))                                      //4
console.log(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0)))   //Float64Array [1, 4, 9]
```

### 十进制数

`decimal(value, {precision})` 得到一个 `Decimal`，即有效数字最多 `precision` 位的十进制数（默认为范围的 `precision`，32 位），适合计算金额或需要很多位数的值。每次运算都将结果正确舍入到该精度，即取具有该位数的十进制数中最接近的一个；恰好位于两者中点时，取末位为偶数的那个。十进制数不可变，每次运算都得到一个新的十进制数。

- 值按书写形式读入：数字按其最短的写法读入（`0.1` 即 0.1，而不是该双精度数的二进制值），字符串按十进制数读入（`'19.99'`、`'1.5e-7'`），bigint 精确读入。没有变量的表达式会先算出值，与 `toDecimal()` 相同，例如 `decimal(expression('pi'), {precision: 50})`。
- 结果的精度与调用该运算的十进制数相同，例如 `a.add(b)` 的精度为 `a` 的精度。传给运算的值按其全部位数读入。
- 运算有：`add`、`sub`、`mul`、`div`、`mod`（结果的符号与除数相同，与公式中的 `mod()` 一致）、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root(n)`、`exp`、`ln`、`log10`、`log(base)`、三角函数和双曲函数及它们的反函数、`atan2(x)`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round(places)`（恰好位于中点时向远离 0 的方向舍入，与公式中的 `round()` 一致）、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`。
- `toString()` 写出的数字不带末尾的 0；首位数字在 10^-6 位到 10^(precision - 1) 位之间时使用普通写法，否则使用科学记数法（`1.5`、`0.000025`、`1.5e+25`、`1e-7`）。`toFixed(places)` 写出指定的小数位数（1.5 的 `toFixed(2)` 是 `1.50`），`toNumber()` 得到最接近的数字。十进制数在公式中也是精确的值，例如 `expression(decimal)`。
- 这些运算在 JavaScript 线程中执行，没有时限。四则运算在任何精度下都很快，但函数计算到几万位需要几秒，特殊函数（`zeta`、`gamma`）计算到几千位就需要几秒。这种情况下，请用 `toDecimalAsync()` 计算表达式（可以设置时限），再用其结果创建十进制数。

```typescript
import {decimal} from '@lakutata/math'

console.log(decimal(0.1).add(0.2).toString())                //0.3
console.log(decimal('19.99').mul(3).toFixed(2))              //59.97
console.log(decimal(1, {precision: 5}).div(3).toString())    //0.33333
console.log(decimal(2, {precision: 40}).sqrt().toString())   //1.41421356237309504880168872420969807857
```

### 生成代码

- `toJavaScript()` 和 `toC()` 将表达式写为 JavaScript 或 C（C99 和 `<math.h>`）代码，变量直接使用原来的名称。例如 `x^2 - 5x + 6` 在 JavaScript 中写为 `Math.pow(x, 2) - 5*x + 6`，在 C 中写为 `pow(x, 2.0) - 5.0*x + 6.0`。生成的代码以双精度浮点数计算，并且只在实数范围内计算，因此表达式中某一部分的值为复数时，结果为 NaN（`compile()` 会在复数范围内计算这些部分）。遇到目标语言没有的函数（例如 JavaScript 没有 `gamma` 和 `erf`，两种语言都没有 `zeta` 和 `lambertw`）、`2i` 这样的复数，或者变量名与目标语言的保留字或生成代码需要使用的名称（如 `new`、`Math`、`pow`）相同时，抛出 `MathNotSupportedException`。
- `cse(expressions)` 找出几个表达式中重复出现或共有的部分（公共子表达式消除）。该函数返回这些部分（`replacements`），每个部分有一个名称（`x0`、`x1`……，会跳过表达式中已有的变量名）和一个值，值中可以引用排在该部分之前的名称；同时返回用这些名称改写后的表达式（`expressions`）。再配合 `toJavaScript()` 或 `toC()`，即可生成每个部分只计算一次的代码。

```typescript
import {cse} from '@lakutata/math'

const {replacements, expressions} = cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
const lines: string[] = replacements.map(({name, value}) => `const ${name} = ${value.toJavaScript()}`)   //const x0 = x + y
lines.push(`return [${expressions.map((expression) => expression.toJavaScript()).join(', ')}]`)   //return [x0 + Math.pow(Math.sin(x0), 2), Math.cos(x0)]
console.log(lines.join('\n'))
```

### 解方程

- 对方程或表达式（表示该表达式等于零）调用 `solve(variable)`，得到解的数组，每个解是一个表达式。数组的 `kind` 说明解集的种类：`finite`（有限个）、`empty`（无解）、`all`（任意值）、`intervals`（区间），或 `unsolved`/`other`（本包无法解出的集合，用 `text` 描述）；`set` 是全部解组成的集合（见下文）。关于未知数的二次及以上的多项式先做因式分解：一次因式直接给出根，其余因式在四次以内给出精确解（`x^3 - 6x^2 + 11x - 6 = 0` 得到 1、2、3，而非卡尔达诺公式给出的根式；`x^2 - (a + b)x + a*b = 0` 得到 a 和 b），二项式 `a x^n + b` 不限次数（`x^5 = 2` 的五个根是 `2^(1/5)` 乘以 1 的五次方根）。`{domain: 'real'}` 只保留实数解。
- `solve(equations, variables)` 解线性方程组：无解时返回空数组，否则返回一组解，给出能确定的每个变量的值（有无穷多组解时，用其他变量表示）。
- 对不等式（`parse('x^2 < 4')`）调用 `solve(variable)`，得到其实数解，即一些区间和孤立的值。例如 `x^2*(x + 1) <= 0` 得到 `(-inf, -1] ∪ {0}`，区间以外的值（`0`）是数组中的元素。两边必须是该变量的有理系数多项式的分式，分母为零的点一定不是解（`1/(1 + 1/x) > 0` 排除 `-1` 和 `0`）。每个不可约因式的实根先用笛卡儿符号法则隔离，再与求出的精确根一一对应；根没有精确形式（`x^5 - x - 1`）、系数不是有理数（`sqrt(2)*x < 1`）、含有其他变量或其他函数时，抛出 `MathNotSupportedException`（根的数值可以用 `numeric.polynomialRoots()` 求得）。
- 数的集合（`MathSet`）由端点精确的实数区间和一些值组成，用 `interval(start, end, {startOpen, endOpen})` 和 `finiteSet(values)` 创建，解的 `set` 也是这样的集合。集合具有 `union`、`intersect`、`complement`（在实数范围内取补集）、`difference`、`contains`（无法确定时为 `undefined`）、`equals`、`isEmpty`、`toString`（`[0, 2) ∪ {3}`）和 `toTeX`。端点用 `compare()` 精确比较，无法排序的端点（含变量）抛出 `MathNotSupportedException`。对于本包无法解出的方程（`sin(x) = 0`），解集的种类为 `other`，集合运算不接受这样的解集。

```typescript
import {expression, finiteSet, type Inequality, interval, parse, solve} from '@lakutata/math'

console.log(expression('x^4 - 1').solve('x').map(String))   //['-1', '1', '-i', 'i']
const [solution] = solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
console.log(solution.x.toString(), solution.y.toString())   //2 1
console.log((parse('(x + 1)/(x - 2) >= 0') as Inequality).solve('x').toString()) //(-inf, -1] ∪ (2, inf)
const set = interval(0, 2, {endOpen: true}).union(finiteSet([3]))
console.log(set.complement().toString(), set.contains('sqrt(2)')) //(-inf, 0) ∪ [2, 3) ∪ (3, inf) true
```

### 极限

`limit(variable, point)` 用 Gruntz 算法（移植自 SymPy 的 `gruntz`）求表达式的极限。点可以是数、表达式、`inf` 或 `-inf`。在有限点处默认取两侧的极限，`{direction: '+'}` 或 `{direction: '-'}` 只取右极限或左极限。结果可以是 `inf` 或 `-inf`。两侧的极限不同，或表达式始终振荡（`sin(x)` 在 `inf` 处）时，极限不存在，会抛出 `MathDomainException` 并说明原因。

该算法能处理指数、对数、`x^x` 这样的幂、三角函数和双曲函数及其反函数，包括各种未定式（`0/0`、`inf/inf`、`0*inf`、`1^inf`、`inf - inf`）。`abs`、`sign`、`max`、`min`、`floor`、`ceil` 和 `piecewise` 按变量趋近的一侧确定取值。参数趋于无穷的 `sin` 和 `cos` 始终在 -1 和 1 之间，因此 `sin(x)/x` 在 `inf` 处是 0。积分型特殊函数在参数趋近的点展开为级数（`Si(x)/x` 在 0 处是 1；`Ci`、`Chi` 和 `Ei` 在 0 处保留各自的对数项），参数趋于无穷的 `Ei`、`Shi`、`Chi` 和 `li` 用 `Ei` 的渐近级数处理（`x*e^(-x)*Ei(x)` 在 `inf` 处是 1），`Si`、`Ci` 和菲涅耳积分取其在无穷远处的值。无法求出极限时抛出 `MathNotSupportedException`：极限取决于参数的符号（`exp(a*x)` 在 `inf` 处），算法不了解某个函数在无穷远处的行为（`gamma(x + 1)/x` 在 `inf` 处），或表达式中有未求出闭式的和或积。

```typescript
import {expression} from '@lakutata/math'

console.log(expression('sin(x)/x').limit('x', 0).toString())                  //1
console.log(expression('(1 + a/x)^x').limit('x', 'inf').toString())           //e^a
console.log(expression('x^x').limit('x', 0, {direction: '+'}).toString())     //1
console.log(expression('(2^x + 3^x)^(1/x)').limit('x', 'inf').toString())     //3
expression('1/x').limit('x', 0) //MathDomainException: 1/x has no limit at x = 0: -inf from below, inf from above
```

### 积分

`integrate(variable)` 求不定积分，结果不带积分常数；`integrate(variable, from, to)` 求定积分，上下限可以是 `inf` 和 `-inf`。与 SymPy 相同，`1/x` 的积分是 `ln(x)`，不加绝对值。原函数通过以下方法求得：

- 多项式分式先做部分分式（得到对数、`atan`、`atanh`，例如 `1/(x^2 + 2x + 5)` 的积分是 `atan((x + 1)/2)/2`）；
- 查积分表：以一次式为参数的初等函数、多项式除以二次式的平方根（`x^2/sqrt(x^2 + 1)` 的积分是 `(-asinh(x) + x*sqrt(x^2 + 1))/2`），以及 `e^(-x^2)`（用 `erf` 表示）；
- 换元（`2x*e^(x^2)` 的积分是 `e^(x^2)`）、分部积分（`x*e^x` 的积分是 `e^x*(x - 1)`）、正弦和余弦的幂与乘积，以及对正弦余弦的分式用 `t = tan(x/2)` 换元；
- 积分型特殊函数：`sin(x)/x` 的积分是 `Si(x)`，`e^x/x` 的积分是 `Ei(x)`，`1/ln(x)` 的积分是 `li(x)`，`sin(x^2)` 的积分是菲涅耳积分（见公式写法的表格）。

每个原函数在返回前都会通过求导验证。定积分用原函数在两端的极限计算；区间内被积函数有极点，或原函数有跳变时（换元产生的 `tan(x/2)`：`1/(2 + cos(x))` 在 `[0, 2pi]` 上的积分是 `2pi*sqrt(3)/3`），在这些点分段计算；结果为数值时，还会与 `numeric.integrate()` 的数值结果核对。积分无限增大时，结果为 `inf` 或 `-inf`（`1/x` 在 `[0, 1]` 上）；积分没有值时，抛出 `MathDomainException`（`1/x` 在 `[-1, 1]` 上）。

以下情况无法求出原函数，会抛出 `MathNotSupportedException`：分母只有借助代数数才能分解的分式（`1/(x^4 + 1)`），原函数既不是初等函数、也不能用上面这些特殊函数表示的函数，以及各项单独无法求出原函数的某些和式。与 SymPy 不同，无法求出的积分不会保留为未计算的调用，否则积分变量需要像 `sum(…)` 中那样作为约束变量。无论被积函数是什么，定积分总可以用 `numeric.integrate()` 进行数值计算。

`laplace('t', 's')` 求拉普拉斯变换，即 `f(t) e^(-s t)` 从 0 到 `inf` 的积分，不给出收敛所需的 `s` 的条件（与 SymPy 的 `noconds` 相同）。该方法查变换表（`t` 的幂、指数函数、正弦和余弦、双曲函数），并使用以下规则：和式逐项变换，乘 `e^(a t)` 对应 `s` 的平移，乘 `t^n` 对应对 `s` 求导。`inverseLaplace('s', 't')` 求 `t > 0` 时的逆变换：多项式分式先做部分分式，`s - a` 的幂用 `gamma` 表示，`e^(-c s) F(s)` 得到在 `t = c` 之前为 0 的分段函数。每个逆变换都会通过一次正变换验证。

```typescript
import {expression} from '@lakutata/math'

console.log(expression('x*e^x').integrate('x').toString())                      //e^x*(x - 1)
console.log(expression('1/(x^2 + 1)').integrate('x', '-inf', 'inf').toString()) //pi
console.log(expression('sin(x)/x').integrate('x', 0, 'inf').toString())         //pi/2
console.log(expression('t^2*e^(-3t)').laplace('t', 's').toString())             //2/(s + 3)^3
console.log(expression('1/(s^2 + 2s + 5)').inverseLaplace('s', 't').toString()) //e^(-t)*sin(2t)/2
```

### 数论

`ntheory` 处理整数，参数为 bigint 或安全整数范围内的 number；整数结果均为 bigint。

- 整除和模运算：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`，以及 `crt`（中国剩余定理，模数不必两两互质）。模 `m` 的结果与 `m` 同号，与 `mod` 相同，例如 `mod(-7, 3)` 是 `2n`。
- 质数：`isPrime`（2^64 以下的结果是确定的，以上使用 Baillie-PSW 检验，目前尚未发现能通过该检验的合数）、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`。
- 数列和组合数：`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`，以及给出精确分数（表达式）的 `bernoulli` 和 `harmonic`。`bernoulli(1)` 与 SymPy 相同，为 `+1/2`。
- 计数：`permutations(n, k)`（从 n 个元素中取 k 个的排列数）、`combinationsWithRepetition(n, k)`、`multinomial(counts)`、`bell(n)`（集合的划分数）、`catalan(n)`、`stirlingSecondKind(n, k)`（划分成 k 块的方法数）和 `compositions(n, k)`（写成 k 个正整数的有序和的方法数）。没有可计数的对象时（例如 `k > n` 时从 n 个元素中取 k 个），结果为 0（mathjs 会报错）。
- 连分数：`continuedFraction(value, {terms})` 给出实数的连分数 `a0 + 1/(a1 + 1/(a2 + …))` 的各项。有理数给出全部的项（JavaScript 的 number 按其打印出来的十进制数理解，例如 `0.1` 即 1/10），最后一项大于 1，与 SymPy 相同；其他值（`sqrt(2)`、`pi`）给出前 `terms` 项（默认 20 项），每一项都是确定的，因为计算使用该值的十进制数，位数不足以判定时会增加位数。如果某个值算到上千位仍无法与某个整数区分，连分数就在该项结束。`fromContinuedFraction(terms)` 由各项算出连分数的值，`convergents(terms)` 给出前几项的值（π 的 `22/7`、`355/113`），即最佳有理逼近；两者的结果都是精确分数（表达式）。

值不存在时（没有逆元的数的 `modInverse`、没有原根的模数的 `primitiveRoot`、没有公共解的同余方程组的 `crt`），结果为 `undefined`。参数不在函数的定义域内时（`totient(0)`、`legendre(a, 9)`），抛出 `MathDomainException`。

`factor` 能立即找出小的因数，20 位左右的数也能很快分解；但如果一个数有两个很大的质因数，分解可能需要好几天，此时请使用 `factorAsync` 并设置时限。`isPrime`、`nextPrime`、`totient`、`mobius` 和 `primitiveRoot` 也有异步版本。`factorial` 最大能计算到 `71000!` 左右；而公式中的 `factorial(n)` 在 n 超过 20000 时保持 `gamma(n + 1)` 的形式，以便表达式仍能打印出来。

```typescript
import {ntheory} from '@lakutata/math'

console.log(ntheory.factor(360))                 //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
console.log(ntheory.powMod(4, 13, 497))          //445n
console.log(ntheory.continuedFraction('pi', {terms: 6}))   //[3n, 7n, 15n, 1n, 292n, 1n]
console.log(ntheory.convergents([3, 7, 15, 1]).map(String)) //['3', '22/7', '333/106', '355/113']
console.log(ntheory.crt([2, 3, 2], [3, 5, 7]))   //{remainder: 23n, modulus: 105n}
console.log(await ntheory.factorAsync(2n ** 64n + 1n, {timeout: 5000}))
```

### 多项式

`poly`（`MathScope.poly`）对任意个变量的多项式做精确计算：`gcd(...values)` 和 `lcm(...values)`、`resultant(a, b, variable)` 和 `discriminant(p, variable)`、`factorList(p)` 和 `sqfList(p)`，以及它们的异步版本；表达式的 `factor()` 和 `sqf()` 给出该表达式的因式分解形式。多项式可以是表达式，也可以是公式。多项式的生成元是其中的符号，以及本身不是多项式的因子：`sin(x)`、`sqrt(2)`、`exp(x)`（`x^(3/2)` 是 `sqrt(x)` 的立方，`exp(2x)` 是 `exp(x)` 的平方）。生成元之间视为互不相关，因此 `sqrt(2)^2` 不会被视为 2。含有负幂，或系数为复数或不精确的数时，都不算多项式（抛出 `MathNotSupportedException`）；多项式的分式另有专门的运算，见下一节。

- 系数均为整数时在整数上计算，gcd 包含系数的公约数（`gcd(2x + 2, 4x + 4)` 是 `2x + 2`）；否则在有理数上计算，结果为首一多项式（`gcd(x/2 + 1/2, x + 1)` 是 `x + 1`）。首项系数均为正，与 SymPy 相同。参数只有数时，给出这些数的最大公约数和最小公倍数（`gcd(1/2, 1/3)` 是 `1/6`）。
- `factorList` 给出有理系数，以及在有理数上不可约的因子及其重数（`factorList('6x^2 - 6')` 是 6、`x - 1` 和 `x + 1`）；`sqfList` 给出无平方分解（Yun 算法）。`factor()` 将因子写为乘积，系数放在最前面（`3x*y + 6x + 3y + 6` 是 `3(x + 1)(y + 2)`），分式的分子和分母分别分解。对结果再做运算时，会回到公式通常的形式（`2(x + 1)` 加 1 得 `2x + 3`）。
- 算法参照 SymPy 用 C++ 重写：gcd 使用启发式 gcd（GCDHEU），失败时改用子结式 PRS；结式使用子结式 PRS；因式分解在单变量时使用 Zassenhaus 算法（`x^n - 1` 和 `x^n + 1` 的分圆因子直接给出），多变量时使用 Wang 算法。对于模每个素数都会分解成很多因子的多项式（如 Swinnerton-Dyer 多项式），分解时间随因子个数呈指数增长，此时请使用 `factorAsync()` 或 `factorListAsync()` 并设置时限。第一个多项式的次数较低时，结式会带上 SymPy 遗漏的符号 (-1)^(mn)（`resultant(x, x^3 + 1, x)` 是 1，SymPy 给出 -1）。
- 多项式按稠密形式存储：各变量的次数加一后的乘积不超过 10^6（`x^2000 y^2000 + 1` 抛出 `MathNotSupportedException`）。

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

### 多项式的分式

表达式的 `cancel()`、`together()`、`apart(variable)` 和 `completeSquare(variable)` 处理多项式的分式，生成元与 `poly` 相同：

- `cancel()` 将分子和分母同除以二者的 gcd。分子和分母都展开，首项系数为正，符号放在最前面（`(2x^2 - 2)/(x^2 - 2x + 1)` 是 `(2x + 2)/(x - 1)`，`(-x - 1)/(x - 1)` 是 `-(x + 1)/(x - 1)`）；分母只剩一个数时，将其乘入分子，与 SymPy 相同（`(x^2 - 1)/2` 是 `x^2/2 - 1/2`）。
- `together()` 将表达式通分为一个分式：分母中同一个底取最高次幂，数字取最小公倍数（`1/(2x) + 1/(3y)` 是 `(2x + 3y)/(6x*y)`），分子展开。该方法不寻找公因式（这由 `cancel()` 负责），也不处理函数的参数。
- `apart(variable)` 给出关于一个变量的部分分式，与 SymPy 的 `apart()` 相同：先是多项式部分，然后分母的每个不可约因式 `q`（k 次幂）给出分式 `h/q^j`（`j` 从 1 到 `k`），分子 `h` 的次数低于 `q`，每一项都做因式分解（`1/(x^3 + 1)` 是 `-(x - 2)/(3(x^2 - x + 1)) + 1/(3(x + 1))`）。其他变量视为参数（`1/((x + a)(x + b))` 是 `-1/((a + x)(a - b)) + 1/((a - b)(b + x))`）；含有该变量的函数（`sin(x)/x`）抛出 `MathNotSupportedException`。各分子的系数是一个线性方程组的解，由不产生分数的 Bareiss 消元法求出。
- `completeSquare(variable)` 将 `a x^2 + b x + c` 写为 `a(x + b/(2a))^2 + c - b^2/(4a)`（`2x^2 + 4x + 1` 是 `2(x + 1)^2 - 1`）；不是二次式时抛出 `MathNotSupportedException`。
- `apart()` 和 `completeSquare()` 的结果再加上其他项时，各项保持原有的写法；其他运算（乘以一个数、`expand()`）会回到公式通常的形式。`equals()` 会将差中的分式通分，因此能证明分式之间的恒等式（`(x^2 - 1)/(x - 1)` 等于 `x + 1`）。`cancel()` 和 `apart()` 有异步版本，因为多变量的 gcd 或因式分解可能很慢。

```typescript
import {expression} from '@lakutata/math'

console.log(expression('(x^2 - 1)/(x^2 + 2x + 1)').cancel().toString()) //(x - 1)/(x + 1)
console.log(expression('1/x + 1/(x + 1)').together().toString())         //(2x + 1)/(x*(x + 1))
console.log(expression('1/(x^3 + 1)').apart('x').toString())             //-(x - 2)/(3(x^2 - x + 1)) + 1/(3(x + 1))
console.log(expression('x^2 - 6x + 10').completeSquare('x').toString())  //(x - 3)^2 + 1
```

### 化简

`simplify()` 借助对变量的所有取值都成立的恒等式寻找表达式更短的形式，未找到更短的形式时原样返回。“更短”指运算更少，计数方法与 SymPy 的 `count_ops` 相同（每个加、减、乘、除、负号、乘方和函数各算一次）；运算数相同时，取文字更短的形式。尝试的形式有：

- 分式约分或因式分解、多项式展开：`(x^2 - 1)/(x - 1)` 是 `x + 1`，`(x + 1)^2 - x^2 - 2x` 是 1；
- 指数互为整数倍的指数函数，写为同一个指数函数的幂：`(e^(2x) - 1)/(e^x - 1)` 是 `e^x + 1`；
- 同一个角的倍角的正弦和余弦用 `sin^2 + cos^2 = 1` 化简，再写为倍角、半角或正切：`cos(x)^2 - sin(x)^2` 是 `cos(2x)`，`(1 - cos(2x))/2` 是 `sin(x)^2`，`sin(x)/cos(x)` 是 `tan(x)`；角的和会展开（`sin(x + y) - sin(x)cos(y)` 是 `cos(x)*sin(y)`）；
- 双曲函数用 `cosh^2 - sinh^2 = 1` 化简，也与指数互相转换：`cosh(x) + sinh(x)` 是 `e^x`，`(e^x + e^(-x))/2` 是 `cosh(x)`；
- 拆开数的嵌套平方根，并将分母中数的平方根移到分子：`sqrt(3 + 2sqrt(2))` 是 `sqrt(2) + 1`，`1/(1 + sqrt(2))` 是 `sqrt(2) - 1`；
- 正有理数的对数合并：`ln(2) + ln(3)` 是 `ln(6)`。

函数的参数和分段函数各段的值先化简（`e^(sin(x)^2 + cos(x)^2)` 是 `e`）；分段函数的条件，以及保持调用形式的和与积，不做改动。表达式中含有和式的 16 次以上的整数次幂，或含有指数的分子大于 256 的幂（`e^(6561/256)`）时，不展开，也不尝试分式形式。取决于变量符号的化简一律不做，因此 `sqrt(x^2)` 和 `ln(x*y)` 保持原样（只有 `x` 是实数时 `sqrt(x^2)` 才等于 `abs(x)`）。与 SymPy 相同，约分后的分式可能在原式没有定义的点上有值（`x + 1` 在 1 处）。结果不一定是最短的形式，也可能与 SymPy 的结果不同；对结果再次化简，结果不会改变。

```typescript
import {expression} from '@lakutata/math'

console.log(expression('sin(x)^4 - cos(x)^4').simplify().toString())       //-cos(2x)
console.log(expression('tan(x/2)*(1 + cos(x))').simplify().toString())     //sin(x)
console.log(expression('(exp(x) + exp(-x))/2').simplify().toString())      //cosh(x)
console.log(expression('1/(sqrt(3) - sqrt(2))').simplify().toString())     //sqrt(2) + sqrt(3)
```

### 矩阵和线性代数

`matrix(rows)` 得到一个数值（双精度）`Matrix`。矩阵的元素按行存放在一个 `Float64Array` 中（`data`），原生插件直接读取这块内存。矩阵的方法都返回新的矩阵：`get`、`set`（会修改矩阵本身）、`row`、`column`、`diagonal`、`submatrix`、`reshape`、`transpose`、`add`、`sub`、`mul`、`div`、`neg`、`multiplyElements`、`divideElements`、`powElements`、`map`、`trace`、`kron`、`equals`、`toArray` 和 `toString`（`[1, 2; 3, 4]`）。

`linalg` 提供基于 Eigen 的线性代数：

- 构造矩阵：`zeros`、`ones`、`identity`、`diagonal`、`fromRows`、`fromColumns`、`fromFunction`、`concat`，以及 `rotation`（平面上的旋转，或空间中绕某个轴的旋转）。
- 向量（`Float64Array`，或数字数组）：`dot`、`cross`、`outer`、`norm`。
- `multiply`、`solve`（使用部分选主元的 LU 分解）、`solveTriangular`、`leastSquares`（范数最小的最小二乘解，与 NumPy 的 `lstsq` 相同）、`inverse`、`determinant`、`singularValues`、`rank`（大于 NumPy 默认容差的奇异值的个数）、`condition`，以及矩阵的范数（`'fro'`、1、2、`Infinity`）。
- 分解：`lu`（`P A = L U`，`permutation[i]` 表示 `P A` 的第 i 行取自 A 的哪一行）、`qr` 和 `svd`（均为精简形式，列数为 `min(rows, columns)`）、`cholesky`、`eigen`（复数的特征值和特征向量，分成实部和虚部）、`symmetricEigen`、`schur`（实 Schur 形式），以及 `pseudoInverse`。`cholesky` 和 `symmetricEigen` 只读取矩阵的下三角，与 NumPy 相同。`qr`、`svd` 和 `eigen` 给出的向量，正负号由 Eigen 决定，其他库可能给出相反的符号。
- 矩阵函数和矩阵方程：`exponential`（`e^A`，与 mathjs 的 `expm` 相同）、`squareRoot`（主平方根，仅当主平方根为实矩阵时给出）、`sylvester`（求 `A X + X B = C` 的 X）和 `lyapunov`（求 `A P + P Aᵀ + Q = 0` 的 P，与 mathjs 的 `lyap` 和 MATLAB 相同；SciPy 的 `solve_continuous_lyapunov` 求解的是 `A X + X Aᴴ = Q`，因此需要传入 `-Q` 才能得到这里的 P）。

右端项为向量时，结果也是向量，例如 `solve(a, [5, 5])` 返回 `Float64Array`；右端项为矩阵（每一列是一个右端项）时，结果也是矩阵。`solve` 和 `inverse` 判断矩阵奇异的规则与 NumPy 相同：LU 分解中遇到恰好为 0 的主元才算奇异。接近奇异的矩阵会给出很大的值，而不会报错，其接近奇异的程度可以用 `condition()` 查看。

`linalg.sparse(rows, columns, entries)` 用条目 `[row, column, value]` 构造一个 `SparseMatrix`（同一位置的条目相加），`linalg.sparse(matrix)` 则取稠密矩阵中不为 0 的元素。稀疏矩阵按压缩行格式存储（CSR：`rowPointers`、`columnIndices`、`values`）。其方法有 `get`、`transpose`、`add`、`sub`、`neg`、`mul`（乘数字、向量、稠密矩阵或稀疏矩阵，乘稀疏矩阵时由 Eigen 计算）、`toDense` 和 `toEntries`。`solve` 传入稀疏矩阵时使用 Eigen 的稀疏 LU 分解（`SparseLU`，按 COLAMD 排序），无法用该方法分解的矩阵（例如有一行全为 0）视为奇异矩阵。`conjugateGradient`（用于对称正定矩阵）和 `biconjugateGradientStabilized`（BiCGSTAB，用于任意方阵）反复迭代，直到相对残差 `‖b - A x‖ / ‖b‖` 不超过 `tolerance`（默认 1e-10），最多迭代 `maxIterations` 次（默认为方程组规模的 10 倍）；`converged` 表示是否达到了容差，传入 `guess` 可以从上一次的解继续迭代。

大矩阵上耗时的运算都有异步版本（`solveAsync()`、`inverseAsync()`、`multiplyAsync()` 等），这些版本在调用时即复制参数。Eigen 的一次计算无法中途停止，因此超过时限或被取消时，Promise 会被拒绝，但线程要完成正在进行的这次计算后才会空闲。由几次计算组成的运算（`inverse()`、`leastSquares()`、`exponential()`）会在两次计算之间停止。

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

### 表达式矩阵

`expressionMatrix(value)` 得到一个 `ExpressionMatrix`，即元素为表达式的矩阵，可以由各行给出（`[['a', 'b'], ['c', 'd']]`），由公式给出（`'[1, x; x^2, 2]'`，`parse()` 也能读取这种公式），或由数值矩阵得到。表达式矩阵与表达式一样不可变：`with(row, column, value)` 得到替换了一个元素的新矩阵，`withRow()` 和 `withColumn()` 得到替换了一行或一列的新矩阵。

- 元素和运算：`get`、`toArray`、`row`、`column`、`submatrix`、`transpose`、`add`、`sub`、`mul`（乘以矩阵或表达式）、`div`（除以表达式）、`multiplyElements`、`pow`（整数次幂，负数是逆矩阵的幂）和 `trace`，以及逐元素的 `diff`、`substitute`、`expand`、`simplify`、`cancel`。`toMatrix()` 得到各元素数值组成的数值矩阵，`toString()` 得到该矩阵的公式，`toTeX()` 得到 `bmatrix`。`jacobian(expressions, variables)` 得到几个表达式的雅可比矩阵。
- 线性代数运算都是精确的：方阵且非奇异时的 `determinant`、`inverse`、`solve`（奇异时抛出 `MathDomainException`），`rref`（简化行阶梯形和主元所在的列），`rank`、`nullspace`、`characteristicPolynomial`、`eigenvalues`（带重数）和 `eigenvectors`。纯数字矩阵用精确的有理数消元。对于含变量的矩阵，行列式和特征多项式用 Berkowitz 算法计算，逆矩阵由伴随矩阵得到，因此每个元素都是一个多项式分式，分子分母的公因式不会约去。`cancel()` 可以约去这些公因式，`equals()` 能比较分式（逆矩阵乘以原矩阵等于单位矩阵）。
- 判断元素是否为 0：展开后为 0 的元素为 0；常数用十进制数判断，无法与 0 区分的常数为 0；含变量的元素对变量的所有取值都为 0 时才算 0（在两组取值上精确计算）。与 SymPy 相同，只在变量取某些值时为 0 的主元按非 0 处理。特征值是特征多项式的根，先尝试对角线上的元素，其余部分先做因式分解（`[a, b; b, a]` 的特征值是 `a + b` 和 `a - b`），在四次以内给出精确值；其他情况抛出 `MathNotSupportedException`，数值可以用 `linalg.eigen()` 求得。

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

### 单位

`unit(value)` 得到一个 `Unit`，即带单位的值，可以由单位公式给出（`'5 cm + 2 inch'`、`'9.8 m/s^2'`），也可以由数和单位给出（`unit(5, 'cm')`）。单位公式中的名称都是单位，可以带前缀（`km`、`mA`、`kilometer`），此外只有 `pi`、`e` 和 `i`；数后面跟单位表示以这些单位计量的值，几个名称连写表示相乘（`kg m^2/s^2`）。单位公式与 `parse()` 的公式相互独立，因为在 `parse()` 中 `m`、`s`、`g` 都是变量。单位表来自 mathjs（251 个单位及其前缀），数值均为精确值；`createMath({units})` 可以添加其他单位。

- 值的数值部分（`value`）是精确的表达式，单位的换算关系也是精确的：`unit('1 inch').to('cm')` 恰好是 `2.54 cm`，`unit('90 deg').to('rad')` 是 `(pi/2) rad`。`toNumber(units?)` 给出普通数字，`toDecimal()` 给出十进制数，`toString()` 给出 `unit()` 能重新读入的文字。
- `to(units)` 换算为量纲相同的单位；`toSI()` 换算为该量的 SI 单位（`J`、`Pa`），否则将每个单位分别换算为 SI 单位；`toBest(units?)` 在给出的单位之间，或在原单位的各个前缀之间，选择最合适的单位（`5000 m` 变成 `5 km`）；`split(units)` 除最后一个单位外，每个单位取整数部分（`1.5 h` 分成 `1 h` 和 `30 min`）。
- `add` 和 `sub` 的结果使用左侧值的单位。`mul` 和 `div` 将单位相乘或相除，如果右侧的单位与左侧某个单位是同一种量，就先换算为左侧的单位（`5 cm * 2 m` 得 `1000 cm^2`）；量纲全部约去时，得到不带单位的数。此外还有 `pow`（指数须使各量纲的次数仍为整数）、`sqrt`、`neg`、`abs`、`equals`、`compare`。单位公式中可以使用 `sqrt`、`sin`、`cos`、`tan`（参数为角度或数）以及 `exp`、`log`、`ln`（参数为数）。量纲不同的值不能相加，也不能互相换算，否则会抛出 `MathUnitException`。
- 带偏移的温度（`degC`、`degF`）可以换算和比较，但不能相加、相乘或相除，需要先换算为 `K`（否则抛出 `MathUnitException`）。在复合单位中（`degC/m`），这类温度表示温差，不带偏移。前缀作用于温度的数值，例如 `1 mdegC` 即 0.001 degC。
- `constant(name)` 给出带单位的物理常数：mathjs 的 52 个常数，数值取自 CODATA 2022。SI 精确定义的常数以及由这些常数算出的常数都是精确值（`reducedPlanckConstant` 是 `h/(2pi)`）。
- 与 mathjs 的不同之处：值保持原来的单位，输出时不会自动更换前缀（如需更换，请使用 `toBest()`），单位也不会自动换成导出单位（`N m` 仍是 `N m`，`toSI()` 才给出 `J`）；带偏移的温度不能相加；mathjs 取近似值或沿用旧定义的单位（`eV`、`hp`、`psi`、`torr`、`mmHg`、`acre`、`kip`）在本包中按定义取精确值。

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

### 统计

`stats` 在原生插件中计算一组数值（数字数组或 `Float64Array`）的统计量：`sum`（会补偿舍入误差，例如 `[1e16, 1, -1e16]` 的和是 1）、`product`、`cumulativeSum`、`differences`、`mean`、`median`、`mode`（出现次数最多的全部值，按升序排列）、`min`、`max`、`variance`、`standardDeviation`、`medianAbsoluteDeviation`、`quantile`、`covariance`、`correlation`（皮尔逊相关系数）、`zScores` 和 `klDivergence`（KL 散度，使用自然对数，两个分布会先各自归一化到和为 1）。

方差默认以离差平方和除以 n，即将这组值视为总体，与 NumPy 相同。`{normalization: 'unbiased'}` 改为除以 n - 1（将这组值视为样本，这是 mathjs 的默认做法），`'biased'` 则除以 n + 1；`standardDeviation`、`covariance` 和 `zScores` 也接受该选项。方差和协方差分两遍计算，因此数值带有很大的偏移量时也不会因相减而损失精度，例如 `[1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]` 的方差是 22.5。分位数在相邻的两个值之间做线性插值，与 NumPy 的默认方法和 mathjs 的 `quantileSeq` 相同。数值中有 NaN 时，结果为 NaN；对空数组求没有定义的统计量（均值、中位数、方差等）会抛出 `MathArgumentException`，而空数组的和为 0，积为 1。

```typescript
import {stats} from '@lakutata/math'

const values = [2, 4, 4, 4, 5, 5, 7, 9]
console.log(stats.mean(values))                                             //5
console.log(stats.standardDeviation(values))                                //2
console.log(stats.standardDeviation(values, {normalization: 'unbiased'}))   //2.138089935299395
console.log(stats.quantile(values, [0.25, 0.75]))                           //Float64Array [4, 5.5]
console.log(stats.correlation(values, [1, 3, 2, 5, 4, 6, 8, 7]))            //0.8455943246644705
```

### 概率分布

`stats` 还提供 24 种概率分布，由 Boost.Math 计算，参数按名称传入，例如 `stats.gamma({shape: 2.5, scale: 1.5})`。不同的库对同一个分布的参数化方式各不相同，因此用名称说明每个参数的含义；下表列出了这些参数在 SciPy 中的对应写法。`Distribution` 具有 `pdf`（离散分布为概率质量）、`cdf`、`survival`、`quantile` 和 `survivalQuantile`（SciPy 的 `isf`），均可以传入一个值或一组值；此外还有 `mean`、`variance`、`standardDeviation`、`median`、`mode`、`skewness`、`excessKurtosis`、`support`，以及 `sample`。

| 分布 | 参数（默认值） | SciPy |
| --- | --- | --- |
| `normal` | `mean`（0）、`standardDeviation`（1） | `norm(loc=mean, scale=standardDeviation)` |
| `lognormal` | `logMean`（0）、`logStandardDeviation`（1），对数的均值和标准差 | `lognorm(s=logStandardDeviation, scale=exp(logMean))` |
| `uniform` | `lower`（0）、`upper`（1） | `uniform(loc=lower, scale=upper - lower)` |
| `exponential` | `rate`（1） | `expon(scale=1/rate)` |
| `gamma` | `shape`、`scale`（1） | `gamma(a=shape, scale=scale)` |
| `beta` | `alpha`、`beta` | `beta(a=alpha, b=beta)` |
| `chiSquared` | `degrees` | `chi2(df=degrees)` |
| `studentT` | `degrees` | `t(df=degrees)` |
| `fisherF` | `numeratorDegrees`、`denominatorDegrees` | `f(dfn=numeratorDegrees, dfd=denominatorDegrees)` |
| `cauchy`、`laplace`、`logistic`、`gumbel` | `location`（0）、`scale`（1） | `cauchy`、`laplace`、`logistic`、`gumbel_r`（`loc=location, scale=scale`） |
| `weibull` | `shape`、`scale`（1） | `weibull_min(c=shape, scale=scale)` |
| `pareto` | `scale`、`shape` | `pareto(b=shape, scale=scale)` |
| `rayleigh` | `scale`（1） | `rayleigh(scale=scale)` |
| `triangular` | `lower`、`mode`、`upper` | `triang(c=(mode - lower)/(upper - lower), loc=lower, scale=upper - lower)` |
| `inverseGamma` | `shape`、`scale`（1） | `invgamma(a=shape, scale=scale)` |
| `bernoulli` | `probability` | `bernoulli(p=probability)` |
| `binomial` | `trials`、`probability` | `binom(n=trials, p=probability)` |
| `poisson` | `mean` | `poisson(mu=mean)` |
| `geometric` | `probability`：到第一次成功为止的试验次数，从 1 开始 | `geom(p=probability)` |
| `negativeBinomial` | `successes`、`probability`：第 `successes` 次成功之前的失败次数 | `nbinom(n=successes, p=probability)` |
| `hypergeometric` | `total`、`successes`、`draws` | `hypergeom(M=total, n=successes, N=draws)` |

这些分布的约定与 SciPy 一致：在支撑集以外，密度为 0，cdf 为 0 或 1；离散分布在整数之间的概率质量为 0，cdf 取下方相邻整数的值；p 的分位数是满足 `cdf(k) >= p` 的最小整数 k。离散分布 0 的分位数和 1 的生存分位数都是支撑集的下界（SciPy 给出的是下界减 1）。发散的均值或方差为 `Infinity`（例如自由度为 2 的 t 分布的方差）；发散的偏度或超额峰度为 NaN，与不存在的矩相同（例如柯西分布的均值）。参数无效时抛出 `MathArgumentException`。

`stats.random(seed)` 得到一个 `RandomGenerator`（xoshiro256**），该生成器具有 `next()`、`uniform(count)`、`integers(count, lower, upper)`（取值范围是 `[lower, upper)`）和 `clone()`；`sample(count, random)` 用其生成的均匀随机数对 cdf 求逆来抽样。同一个种子每次都得到相同的序列。均匀随机数和整数在各个平台上完全相同，而分布的样本需要经过 C 库的函数计算，在不同平台上最后几位可能不同。未提供种子时，生成器从系统的随机数获取种子。该生成器不适合用于密码学。

```typescript
import {stats} from '@lakutata/math'

const normal = stats.normal({mean: 1, standardDeviation: 2})
console.log(normal.cdf(1))              //0.5
console.log(normal.quantile(0.975))     //4.919927969080108
const binomial = stats.binomial({trials: 10, probability: 0.3})
console.log(binomial.pdf([2, 3]))       //Float64Array [0.23347444050000024, 0.2668279319999998]
console.log(binomial.quantile(0.5))     //3
const random = stats.random(42)
console.log(normal.sample(3, random))   //种子 42 每次都得到同样的三个样本
console.log(random.integers(5, 1, 7))   //掷五次骰子
```

### 数值解

`numeric` 求方程的数值解，适用于 `solve()` 无法求出精确解或只需要数值的情况。原生插件将表达式编译为双精度计算，并给出各个方法所需的导数。

- `polynomialRoots(polynomial, variable)` 求多项式在复数范围内的全部根，结果为 `{re, im}`，重根按重数重复出现，先按实部、再按虚部排序。该函数求平衡后伴随矩阵的特征值，再用牛顿法修正（与 NumPy 的 `roots` 相同）。多项式可以是表达式，也可以是从常数项开始的系数，与 mathjs 的 `polynomialRoot` 相同（NumPy 的 `roots` 从最高次项开始）。m 重根的精度约为机器精度的 m 次方根。
- `findRoot(equation, variable, options)` 求函数（`x^3 - 2x - 5`，即等于 0）或方程（`cos(x) = x`）的一个根。给出函数在两端符号相反的区间 `bracket` `[a, b]` 时，使用 TOMS 748 算法，根一定在区间内；给出初始值 `guess` 时，使用牛顿法。区间两端符号相同，或函数在区间内不是实数时，抛出 `MathDomainException`。
- `solveSystem(equations, variables, guess, options)` 从初始值出发解非线性方程组，使用带线搜索的牛顿法，牛顿法无法继续时改用 Levenberg-Marquardt 法。方程多于变量时，求残差最小的点（最小二乘）。

迭代方法在步长相对于解小于 `tolerance`（默认 1e-12）时停止（与 SciPy 的 `fsolve` 相同），或在迭代 `maxIterations` 次（默认 100）后停止。不收敛时不会抛出异常，而是在结果中注明（`converged`），同时给出迭代次数 `iterations` 和残差 `residual`（根处函数值的绝对值，对于方程组则是残差的范数）。每个运算都有异步版本（`findRootAsync()` 等）。

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.polynomialRoots('x^3 - 6x^2 + 11x - 6'))                   //{re: Float64Array [1, 2, 3], im: Float64Array [0, 0, 0]}
//[1, 0, 1]：1 + x^2 的系数，从常数项开始
console.log(numeric.polynomialRoots([1, 0, 1]))                                //{re: Float64Array [0, 0], im: Float64Array [-1, 1]}
console.log(numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root)       //0.7390851332151606
console.log(numeric.findRoot('x^3 - 2x - 5', 'x', {guess: 2}).root)            //2.0945514815423265
const {solution, converged} = numeric.solveSystem(['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y'], [2, 0])
console.log(solution, converged)                                               //Float64Array [1.9318516525781366, 0.5176380902050416] true
```

### 数值积分

`numeric.integrate(function, variable, [a, b], options)` 求函数在区间上的积分，结果为 `{value, error, converged}`。端点可以是无穷（`-Infinity`、`Infinity`）；从 b 积分到 a 时，结果取相反数。

- 使用 QUADPACK 的 QAGS 算法计算，与 SciPy 的 `quad` 相同：将误差最大的区间对半分，用 21 点的 Gauss-Kronrod 公式计算，并在奇点附近对结果序列做外推；半直线和整条实轴先变换到有限区间。如果这样仍未达到舍入误差的精度，就再用双指数积分（tanh-sinh、exp-sinh、sinh-sinh）计算一次，取更准确的结果。在不为 0 的端点附近，函数改写为到端点距离的函数（`x = 1 - u` 时 `1 - x^2` 是 `2u - u^2`），因此端点上的奇点（`1/sqrt(1 - x^2)` 在 `[-1, 1]` 上）也能计算到舍入误差的精度。
- `points` 给出区间内函数奇异或跳变的点，区间在这些点分开计算。外推往往能自行找到这样的点，但给出 `points` 计算得更快、更准，误差估计也可靠，因为奇点在区间内部时，外推的误差估计可能偏小（QUADPACK 也是如此）。函数在某个求积节点上为无穷大时，区间也会在该节点处分开。如果函数分母中关于积分变量的多项式因子在区间内部有实根，且函数在趋近该根时增大（可去奇点除外，例如 `sin(x)/x` 在 0 处），区间也在根处分开。跨过极点的积分是发散的，结果标为不收敛，而不会将柯西主值当作积分（`1/x` 在 `[-1, 2]` 上）。如果根来自有理系数的一次或二次因子，则无论根在区间内部还是端点上，函数都按到根的精确距离计算，十进制数无法做到这一点（`cbrt(x + 1/14)/(x + 1/14)` 的根 -1/14）。关于积分变量的多项式分式先约去公因式，例如 `(x^2 - 1)/(x - 1)` 在 `[0, 2]` 上的积分是 4，否则求积节点会在 1 处遇到 0/0。
- `tolerance` 限制误差估计的大小（相对于 `|f|` 的积分），默认约为 1.5e-8（机器精度的平方根，与 SciPy 相同），实际结果通常比估计准确得多。对于发散、无休止振荡或双精度无法分辨的积分，给出最佳估计，并将 `converged` 设为 `false`；函数在区间内不是实数时，抛出 `MathDomainException`。`integrateAsync()` 在原生插件的线程中执行。

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.integrate('x^2', 'x', [0, 3]))                                     //{value: 9, error: 9.992007221626409e-14, converged: true}
console.log(numeric.integrate('1/sqrt(1 - x^2)', 'x', [-1, 1]).value)                  //3.141592653589794
console.log(numeric.integrate('exp(-x^2)', 'x', [-Infinity, Infinity]).value)          //1.7724538509055159
console.log(numeric.integrate('1/sqrt(abs(x - 1))', 'x', [0, 2], {points: [1]}).value) //4
console.log(numeric.integrate('sin(x)/x', 'x', [0, Infinity]).converged)               //false
```

### 微分方程

`numeric.solveODE({derivatives, states, time, span, initial}, options)` 求常微分方程或方程组 y' = f(t, y) 的数值解。各状态的导数是时间（默认名为 `t`）和各状态的表达式，求解从区间起点的初值开始，到终点为止（终点在起点之前时反向求解）。高阶方程写为方程组，例如 x'' = -x 写为 x' = v、v' = -x。

- `method: 'rk45'`（默认）是 Dormand 和 Prince 的 5 阶显式 Runge-Kutta 方法，与 SciPy 的 RK45 和 MATLAB 的 ode45 相同。`method: 'radau'` 是 5 阶隐式方法 Radau IIA，与 SciPy 的 Radau 相同，用于刚性方程（各分量衰减快慢相差悬殊，例如化学反应、mu 很大的 Van der Pol 振子）。该方法使用导数的精确雅可比矩阵，在这类方程上所需的步数少得多。
- 步长根据上一步的误差选取，与 SciPy 的 `solve_ivp` 相同，使每一步的误差不超过 `relativeTolerance`（默认 1e-6）乘以状态的大小，再加上 `absoluteTolerance`（默认 1e-9）。SciPy 和 MATLAB 的默认值为 1e-3 和 1e-6，只能保证约三位有效数字；区间很长时，终点的误差可能大于每一步的容差。
- 结果包括时间 `t`（从起点开始的每一步，或指定的 `points`）和状态 `y`，其中 `y` 是一个 `Matrix`，每个时间一行，每个状态一列。`points` 处的值由每一步的连续扩展算出，步长不会因此缩短。求解在到达终点之前停止时（解无界增长使步长变得过小，或超过 `maxSteps` 步，默认 100000 步），`completed` 为 `false`，`message` 说明原因，结果给出停止之前的解。`solveODEAsync()` 在原生插件的线程中执行。

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

### 异步运算

可能耗时的运算都有异步版本：`expandAsync()`、`simplifyAsync()`、`diffAsync()`、`seriesAsync()`、`limitAsync()`、`integrateAsync()`、`laplaceAsync()`、`inverseLaplaceAsync()`、`solveAsync()`、`toDecimalAsync()`、`toComplexDecimalAsync()`、`solveAsync()` 和 `cseAsync()`，以及数论、线性代数和数值解的异步版本。这些异步版本在原生插件自身的线程中执行，不占用 libuv 的线程池；线程数默认为 CPU 核数减一，也可以用环境变量 `LAKUTATA_MATH_THREADS` 指定。选项有 `timeout`（毫秒）和 `signal`（`AbortSignal`）：

- 到达时限时，Promise 以 `MathTimeoutException` 拒绝；通过 signal 取消时，以 `MathCancelledException` 拒绝。运算会在下一个检查点停止。原生插件的算法在各个步骤之间都会检查是否已被取消（展开的各项、十进制数级数的各项、消元的各列、数值方法和数论的各次迭代、化简、极限和积分的各次尝试等）。单个步骤会执行到底，线程要到那时才会空闲，例如 Eigen 的一次计算（一次分解、一次矩阵乘法），以及 SymEngine 中除展开以外的一次运算（求导、级数）。
- `createMath()` 创建的范围会限制其同时执行的运算数（`concurrency`），其余运算排队等待。如果程序在运算结束前退出，这些运算的结果会被丢弃。

表达式最多嵌套 1000 层，更深的公式会被拒绝（`MathNotSupportedException`），以免运算时栈溢出。

### 打包

`lakutata package` 生成的包、可执行文件和安装程序都包含编译好的原生插件（`build/Release/math.node`），因此请在每个目标平台上先安装本包，再在该平台上打包。

## API

| 导出 | 说明 |
|---|---|
| `parse`、`expression`、`equation`、`decimal`、`matrix`、`expressionMatrix`、`jacobian`、`interval`、`finiteSet`、`unit`、`constant`、`solve`、`solveAsync`、`cse`、`cseAsync`、`ntheory`、`poly`、`linalg`、`stats`、`numeric` | `math` 的函数和命名空间，可以直接使用 |
| `math`、`createMath`、`MathOptions` | 默认选项的范围；用其他选项（`definitions`、`precision`、`timeout`、`concurrency`、`units`）创建范围的函数，以及该函数的选项 |
| `MathScope`、`MathDefinitions` | 由定义和设置组成的范围（`createMath()`、`with()`）：`parse`、`expression`、`equation`、`decimal`、`matrix`、`expressionMatrix`、`jacobian`、`interval`、`finiteSet`、`unit`、`constant`、`with`、`solve`、`solveAsync`、`cse`、`cseAsync`、`ntheory`、`poly`、`linalg`、`stats`、`numeric`；定义（按签名给出的公式） |
| `Expression` | 表达式：`toString`、`toTeX`、`toNumber`、`toComplex`、`toDecimal`、`toComplexDecimal`、`variables`、`equals`、`add`、`sub`、`mul`、`div`、`pow`、`neg`、`expand`、`simplify`、`diff`、`series`、`limit`、`integrate`、`laplace`、`inverseLaplace`、`substitute`、`evaluate`、`solve`、`compile`，多项式（`coefficients`、`degree`、`leadingCoefficient`、`divide`），`factor`、`sqf`，分式（`cancel`、`together`、`apart`、`completeSquare`），`numerator`、`denominator`、`rewrite`（改写为 `exp`、`sin`、`cos`），判断（`isZero`、`isPositive`、`isNegative`、`isInteger`、`isRational`、`isReal`、`isFinite`：无法确定时为 `undefined`），`compare`、`toJavaScript`、`toC`、`toPolar`、`toRectangular`，以及各个异步版本 |
| `CommonSubexpressions`、`CseOptions` | `cse()` 的结果（`replacements`、`expressions`）及其选项（`prefix`） |
| `PolarForm`、`RectangularForm` | 复数的极坐标形式（模 `modulus`、辐角 `argument`）和直角坐标形式（实部 `real`、虚部 `imaginary`） |
| `Equation`、`Inequality`、`InequalityRelation` | 方程（`left`、`right`、`difference`、`substitute`、`solve`、`solveAsync`），不等式（`left`、`right`、`relation`、`solve`、`solveAsync`） |
| `Solutions`、`SolutionsKind`、`SolveOptions` | 方程或不等式的解：表达式的数组，带有 `kind`、`set` 和 `text`；解的范围 `domain` |
| `MathSet`、`MathSetKind`、`SetInterval`、`IntervalOptions` | 数的集合（`interval()`、`finiteSet()`、解的 `set`）：`kind`、`values`、`intervals`、`text`、`union`、`intersect`、`complement`、`difference`、`contains`、`equals`、`isEmpty`、`toString`、`toTeX`；集合的种类；集合中的一个区间；区间的端点是否排除 |
| `SystemSolution`、`SystemEquation` | 方程组的一组解（每个变量对应一个表达式），方程组中的一个方程 |
| `CompiledFunction` | 编译后的表达式：以数字为参数的函数，及其 `variables` 和 `batch` |
| `Decimal`、`DecimalValue`、`DecimalOptions` | 指定精度的十进制数（`decimal()`）：`precision`、`add`、`sub`、`mul`、`div`、`mod`、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root`、`exp`、`ln`、`log10`、`log`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`sinh`、`cosh`、`tanh`、`asinh`、`acosh`、`atanh`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round`、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`、`toString`、`toFixed`、`toNumber`、`toJSON`；需要十进制数的地方可以传入的值（十进制数、数字、bigint、写成字符串的十进制数）；`decimal()` 的选项（`precision`） |
| `Matrix`、`MatrixValue`、`VectorValue` | 数值矩阵（`matrix()`）：`rows`、`columns`、`data`、`get`、`set`、`row`、`column`、`diagonal`、`submatrix`、`reshape`、`transpose`、`add`、`sub`、`mul`、`div`、`neg`、`multiplyElements`、`divideElements`、`powElements`、`map`、`trace`、`kron`、`equals`、`clone`、`toArray`、`toJSON`、`toString`；需要矩阵的地方可以传入的值（矩阵，或矩阵的各行）；需要向量的地方可以传入的值（`Float64Array`，或数字数组） |
| `ExpressionMatrix`、`ExpressionMatrixValue`、`RowEchelonForm`、`Eigenvector` | 表达式矩阵（`expressionMatrix()`、`parse()`）：`rows`、`columns`、`get`、`toArray`、`with`、`withRow`、`withColumn`、`row`、`column`、`submatrix`、`transpose`、`neg`、`add`、`sub`、`mul`、`div`、`multiplyElements`、`pow`、`trace`、`determinant`、`inverse`、`solve`、`rref`、`rank`、`nullspace`、`characteristicPolynomial`、`eigenvalues`、`eigenvectors`、`diff`、`substitute`、`expand`、`simplify`、`cancel`、`equals`、`toMatrix`、`toString`、`toTeX`，以及 `determinantAsync`、`inverseAsync`、`solveAsync`、`eigenvectorsAsync`；可用作表达式矩阵的值；简化行阶梯形及其主元；特征值及其重数和特征向量 |
| `Unit`、`UnitValue`、`UnitDimensions`、`CustomUnit`、`CustomUnits`、`PhysicalConstant` | 带单位的值（`unit()`、`constant()`）：`value`、`units`、`dimensions`、`hasDimensionsOf`、`to`、`toSI`、`toBest`、`split`、`add`、`sub`、`mul`、`div`、`pow`、`sqrt`、`neg`、`abs`、`equals`、`compare`、`toNumber`、`toDecimal`、`toString`、`toJSON`、`toTeX`；可作为带单位的值给出的参数；各基本量的次数；`createMath()` 的一个单位（`definition`、`prefixes`、`aliases`、`offset`）和该选项的全部单位；物理常数的名称 |
| `LinearAlgebra`、`NormKind` | 线性代数（`linalg`）：`zeros`、`ones`、`identity`、`diagonal`、`fromRows`、`fromColumns`、`fromFunction`、`concat`、`rotation`、`dot`、`cross`、`outer`、`norm`、`multiply`、`solve`、`solveTriangular`、`leastSquares`、`inverse`、`determinant`、`singularValues`、`rank`、`condition`、`lu`、`qr`、`cholesky`、`svd`、`eigen`、`symmetricEigen`、`schur`、`pseudoInverse`、`exponential`、`squareRoot`、`sylvester`、`lyapunov`、`sparse`、`conjugateGradient`、`biconjugateGradientStabilized`，以及各个异步版本；范数的种类 |
| `Statistics`、`Normalization`、`NormalizationOptions` | 统计（`stats`）：`sum`、`product`、`cumulativeSum`、`differences`、`mean`、`median`、`mode`、`min`、`max`、`variance`、`standardDeviation`、`medianAbsoluteDeviation`、`quantile`、`covariance`、`correlation`、`zScores`、`klDivergence`、各个分布（`normal` … `hypergeometric`、`distribution`）和 `random`；方差的除数（`'uncorrected'`、`'unbiased'`、`'biased'`）和选择除数的选项 |
| `Distribution`、`DistributionName`、`DistributionParameters` | 概率分布：`pdf`、`cdf`、`survival`、`quantile`、`survivalQuantile`、`sample`、`parameters`、`kind`、`support`、`mean`、`variance`、`standardDeviation`、`median`、`mode`、`skewness`、`excessKurtosis`；分布的名称；按名称给出的参数 |
| `RandomGenerator` | 按种子生成随机数的生成器（xoshiro256**）：`next`、`uniform`、`integers`、`clone` |
| `SparseMatrix`、`SparseEntry` | 按压缩行存储的稀疏矩阵（`linalg.sparse()`）：`rowPointers`、`columnIndices`、`values`、`nonZeros`、`get`、`transpose`、`add`、`sub`、`neg`、`mul`、`toDense`、`toEntries`；条目 `[row, column, value]` |
| `IterativeOptions`、`IterativeSolution` | 迭代求解器的选项（`tolerance`、`maxIterations`、`guess`）和结果（`solution`、`iterations`、`error`、`converged`） |
| `LuDecomposition`、`QrDecomposition`、`SingularValueDecomposition`、`EigenDecomposition`、`SymmetricEigenDecomposition`、`SchurDecomposition`、`ComplexVector`、`ComplexMatrix` | 各种分解的结果：`{lower, upper, permutation}`、`{q, r}`、`{u, singularValues, v}`、`{values, vectors}`（复数为 `{re, im}`）、`{values, vectors}`、`{u, t}` |
| `NumberTheory`、`IntegerValue`、`ContinuedFractionOptions`、`PrimeFactor`、`ExtendedGcd`、`Congruence` | 数论（`ntheory`）：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`、`isPrime`、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`、`crt`、`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`、`bernoulli`、`harmonic`、`permutations`、`combinationsWithRepetition`、`multinomial`、`bell`、`catalan`、`stirlingSecondKind`、`compositions`、`continuedFraction`、`fromContinuedFraction`、`convergents`，以及各个异步版本；整数（bigint，或安全整数范围内的 number）；质因数及其指数；`extendedGcd` 的结果；`crt` 的结果；连分数的最多项数 |
| `Polynomials`、`FactorList`、`PolynomialFactor` | 多项式（`poly`）：`gcd`、`lcm`、`resultant`、`discriminant`、`factorList`、`sqfList`，以及异步版本；多项式写为系数乘以各因子的形式，一个因子及其重数 |
| `Numeric`、`FindRootOptions`、`IterationOptions`、`RootResult`、`SystemRootResult`、`IntegrateOptions`、`IntegralResult` | 数值解和数值积分（`numeric`）：`polynomialRoots`、`findRoot`、`solveSystem`、`integrate` 及其异步版本；这些函数的选项（`bracket`、`guess`、`tolerance`、`maxIterations`、`points`）和结果（`root` 或 `solution`、`converged`、`iterations`、`residual`；`value`、`error`、`converged`） |
| `ODEProblem`、`ODEOptions`、`ODEResult` | 微分方程（`numeric.solveODE`、`solveODEAsync`）：导数、状态、时间、区间和初值；方法（`rk45`、`radau`）、容差、`maxStep`、`points`、`maxSteps`；时间 `t`、状态 `y`、`steps`、`rejected`、`evaluations`、`jacobians`、`completed`、`message` |
| `AsyncOptions`、`Value` | 异步运算的选项（`timeout`、`signal`）；需要表达式的地方可以传入的值（表达式、数字、bigint、十进制数、公式） |

类型声明中的每一项都附有说明和示例。

## 错误

| 错误 | 抛出时机 |
|---|---|
| `MathSyntaxException` | 公式有误（带有出错的 `position`），需要表达式的地方给出了方程或矩阵（或者反过来），矩阵与数相加，只接受数的函数用于矩阵 |
| `MathUnitException` | 量纲不同的带单位的值相加、比较或换算，无法识别的单位（带有该单位的 `position`），带偏移的温度相加、相乘或相除，乘方后量纲的次数不是整数，`sin()` 的参数既不是角度也不是数 |
| `MathUnknownFunctionException` | 公式调用的函数既不是内置函数，也未定义，或者将常数写成了调用（`g(2)`）；异常带有该调用的 `position` |
| `MathDefinitionException` | 定义无效：使用了内置的名称、参数重复、定义之间循环引用、定义嵌套过深、定义是一个矩阵；`createMath()` 的单位无效：名称已经是单位（单独或加上前缀）、定义中有无法识别的单位、单位之间循环定义 |
| `MathDomainException` | 将复数当作数字取值，取无穷大、`complexInfinity`（除以零；`toNumber()` 中也包括除以一个无法与 0 区分的值）的值，数论函数的参数不在定义域内（`totient(0)`），需要求逆的地方矩阵是奇异的（`solve()`、`inverse()`），`cholesky()` 的矩阵不是正定的，`squareRoot()` 的矩阵的主平方根不是实矩阵或不存在，Sylvester 或 Lyapunov 方程没有唯一解，或者十进制数不在函数的定义域内（负数开平方、`asin()` 的参数是 2、负数的非整数次幂），`findRoot()` 的区间两端符号相同或者函数在区间内不是实数，函数或方程组在 `findRoot()`、`solveSystem()` 的初始值处不是实数，`integrate()` 的函数在区间内不是实数，`solveODE()` 的导数在起点不是实数，对复数求连分数，表达式矩阵是奇异的（`inverse()`、`solve()`、`inv()`），表达式在某点没有极限（两侧的极限不同，或者始终振荡），没有值的定积分（`1/x` 在 `[-1, 1]` 上） |
| `MathDivisionByZeroException` | 计算十进制值时遇到除以零（包括除以一个无法与 0 区分的值、0 的对数、0 的负数次幂、以 1 为底的对数、在函数的极点上求值：`gamma()` 的参数是 -2、`zeta()` 的参数是 1），模数是 0，或者连分数的各项导致除以零 |
| `MathNotSupportedException` | 本包不支持对该表达式执行的运算：非线性方程组、无法编译的表达式、嵌套超过 1000 层的表达式、运算中遇到太大而无法精确计算的数、对非整数求 `gcd` 或 `lcm`、数论的结果超过 2^20 位（二进制）、`bernoulli(n)` 和 `bell(n)` 的 n 超过 2000、`harmonic(n)` 的 n 超过 50000、`stirlingSecondKind(n, k)` 的 n 超过 50000 或 n k 超过 6250000、生成代码时遇到目标语言没有的函数、`2i` 这样的复数、与保留字重名的变量、特征值的计算不收敛、求 n 不是整数的 `polygamma(n, x)` 的十进制值、十进制数的指数超出了范围（约 ±10^18，32 位系统上约 ±4.25 × 10^8；例如 `exp()` 的参数是 10^19，`toDecimal()` 中也是如此），或者十进制值要比要求的位数多算超过 50000 位（`sin(10^(10^6))`），表达式矩阵的特征值无法求出精确值，矩阵的幂不是整数，矩阵的方程或不等式，`poly` 的多项式含负幂、系数是复数或不精确的数，或者各次数合起来对稠密形式太高，无法求出的极限，无法求出的积分、拉普拉斯变换和逆变换，积分型特殊函数值为复数时的十进制值（`Ci(-1)`），`toComplexDecimal()` 无法计算的复数参数的函数的十进制值（`gamma(1 + i)`；`toDecimal()` 中也是如此，即使值实际上是实数：`re(gamma(1 + i))`） |
| `MathArgumentException` | 参数无效：需要数字的地方仍有变量、名称不是变量、给出的值个数不对、需要整数的地方给出的不是整数、需要十进制数的地方给出的不是十进制数、精度不在 1 到 100000 之间、`integrate()` 的区间、分点或容差无效、`solveODE()` 的问题或选项无效、对含有变量的值求连分数、连分数的项不是整数、矩阵或向量的维数不对、稀疏矩阵的结构无效（包括构造之后数组被改动的情况）、对空数组求没有定义的统计量、分布的参数无效、分位数的概率不在 0 到 1 之间、`klDivergence` 的概率是负数，没有给出多项式就求 gcd 或 lcm，`poly` 的变量不是名称，只需要单位的地方给出了数（`to('2 cm')`），物理常数的名称不对，`createMath()` 的选项无效 |
| `MathTimeoutException`、`MathCancelledException` | 异步运算超过时限或被取消 |
| `MathException` | 以上所有错误的基类；原生插件发生内部错误时，其 `errno` 为 `E_MATH_INTERNAL` |

## 另见

- [SymEngine](https://github.com/symengine/symengine)：原生插件所基于的符号计算引擎。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库及其许可证。
