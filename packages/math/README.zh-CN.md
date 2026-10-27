# @lakutata/math

[English](README.md) | 中文

Node.js 的数学包：公式按纸上的写法输入（`x^2 - 5x + 6`、`2(x + 1)`），可以展开、求导、解方程、求值，结果是精确的，也可以用指定精度的十进制数计算；还有数值矩阵和线性代数、统计和概率分布、数值求根。计算由基于 [SymEngine](https://github.com/symengine/symengine)、[Boost](https://www.boost.org)、[Eigen](https://eigen.tuxfamily.org) 和 [mpdecimal](https://www.bytereef.org/mpdecimal/) 的原生插件完成，原生插件在安装这个包时编译。耗时的运算还可以放到原生插件自己的线程里执行，并且可以设置时限、随时取消。它属于 [lakutata](https://github.com/lakutata/lakutata) 系列，但不需要 lakutata 应用：从 `@lakutata/math` 导入它的函数就能直接使用。

## 安装

```shell
npm install @lakutata/math
```

- 原生插件在安装时编译（node-gyp），所以机器上需要 Python 3 和支持 C++17 的编译器：macOS 上是 Xcode 的命令行工具，Linux 上是 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上是 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。编译需要半分钟到几分钟；编译失败时，安装也会失败。
- 包管理器需要执行这个包的安装脚本。npm 会执行，但可能提示这个脚本“not yet covered by allowScripts”：用 `npm install-scripts approve @lakutata/math` 记下你允许它执行。Bun 和 pnpm 只为信任的依赖执行，需要先允许它（Bun 在 package.json 的 `trustedDependencies` 里加上它，pnpm 用 `pnpm approve-builds`）；没有允许时，加载这个包会抛出错误，说明怎样编译原生插件。
- Node.js `^22.13.0 || >=24.11.0`。

## 用法

### 快速上手

这个包导出的函数可以直接使用：`parse`、`expression`、`equation`、`decimal`、`matrix`、`expressionMatrix`、`jacobian`、`unit`、`constant`、`solve` 和 `cse`，以及命名空间 `ntheory`（数论）、`linalg`（线性代数）、`stats`（统计和概率）和 `numeric`（数值解、数值积分和微分方程）。它们都属于 `math`，也就是用默认选项创建的范围。

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

`createMath(options)` 用别的选项创建一个 `MathScope`，它的函数和上面相同。选项有：`definitions`（用公式写的函数和常数，默认没有）、十进制数的 `precision`（默认 32 位有效数字）、异步运算的 `timeout`（毫秒，默认 0，即不限时）、它们的 `concurrency`（默认用原生插件的全部线程），以及 `units`（添加到单位表里的单位，默认没有）。每个选项都有默认值，所以单独调用 `createMath()` 得到的范围和 `math` 一样。一个程序可以创建多个范围，分别使用不同的定义。

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
| `x^2 = 4` | 方程（`equation()` 或 `parse()`） |
| `x < 1`、`x >= 0` | 不等式，由 `parse()` 读取 |
| `[1, 2; 3, 4]`、`[x; y]` | 矩阵：行之间用 `;` 分隔，元素之间用 `,` 分隔（`parse()` 得到 `ExpressionMatrix`）。矩阵可以相加、相乘（`[1, 2; 3, 4] * [x; y]`、`2[1, 2]`）、除以一个数、取整数次幂；`det`、`inv`、`transpose` 和 `trace` 的参数是矩阵 |

`cbrt(x)` 和奇数次的 `root(x, n)` 对负实数取实数根（`cbrt(-8)` 是 `-2`，和 `Math.cbrt` 一样）；乘方取主值（`(-8)^(1/3)` 是 `1 + sqrt(3)i`，和 SymPy 一样）。`round` 遇到正好一半时向远离零的方向舍入（`round(-2.5)` 是 `-3`），`mod(a, b)` 的符号和 `b` 相同（`mod(-7, 3)` 是 `2`），`gcd` 和 `lcm` 只算整数。变量都当作复数：`re(x)` 保持原样。

函数名不带括号时当作变量（`gamma`、`beta`、`re`、`mod` 都是常见的量的名字），只有容易漏写括号的函数例外（三角和双曲函数、`exp`、`ln`、各种 `log`、`sqrt`、`cbrt`）：`sin x` 是错误，要写成 `sin(x)`。

结果也用同样的写法输出：`toString()` 得到的公式可以再交给 `expression()` 读回来，`toTeX()` 得到 LaTeX。语法错误会抛出 `MathSyntaxException`，它的 `position` 是出错字符的位置。

### 定义

`createMath()` 的 `definitions` 是用公式写的函数和常数。范围创建以后它们不再改变，所以程序里用这个范围的各个地方看到的定义都一样。需要临时加定义时用 `with()`，它不会改变原来的范围：

```typescript
import {math} from '@lakutata/math'

const scope = math.with({'net(x)': 'x / (1 + rate)', 'rate': '0.13'})
console.log(scope.expression('net(113)').toString())   //100
```

读取公式时定义就会展开，所以求导、解方程都能用上它们。

### 精确结果和数字

公式给出精确的结果：`0.1 + 0.2` 是 `3/10`，`sin(pi/6)` 是 `1/2`，`sqrt(8)` 是 `2sqrt(2)`。数乘以一个和时会乘进去：`2(x + 1)` 是 `2x + 2`。精确计算最多到约 31.5 万位：更大的幂保持幂的形式（`2^(10^7)`），阶乘最多算到 `20000!`，再大的保持 `gamma(n + 1)` 的形式。需要数字时：

- `toNumber()` 转成 JavaScript 的数字（值是复数时抛出 `MathDomainException`），`toComplex()` 得到 `{re, im}`。凡是 `toDecimal()` 或 `toComplexDecimal()` 能算的值，它们都先算出十进制值再转成数字，所以即使双精度计算已经没有一位有效数字（例如 `cos(10^30)`、`e^(i*10^30)`），得到的数字每一位都是对的。两者也能计算复数参数的特殊函数（伽马、zeta、Lambert W、多伽马、误差函数等），这些函数用双精度计算，表达式的其余部分仍用十进制计算。
- `toDecimal(digits)` 得到指定有效位数、正确舍入的字符串（默认位数是范围的 `precision`），写法和 `Decimal` 相同（见下一节）：算出的 3 写成 `3`，不写成 `3.000…`。它会用更多位数重新计算，直到两次结果一致。能算四则运算、乘方和开方、`exp` 和 `ln`、三角函数和双曲函数及它们的反函数、取整函数、常数，以及实数参数的特殊函数：`gamma`、`loggamma`、`digamma`、`polygamma`、`beta`、`erf`、`erfc`、`zeta`（包括 Hurwitz zeta）、`lowergamma`、`uppergamma` 和 `lambertw`。多算 640 位仍然和 0 分不开的值，结果是 `0`（例如 `ln(6) - ln(2) - ln(3)`）；参数太大、这么多位不够用的值，会按需要再多算一些位数，最多多算 50000 位（`sin(10^(10^4))` 要多算 10^4 位）；恰好在相邻两个这么多位的十进制数正中间的值，取末位是偶数的那个（`ln(8)/ln(4)` 等于 1.5，保留 1 位得 `2`）。计算中有复数、但值是实数的（`e^(i*pi)`、`-i*asinh(i)`），结果是 `toComplexDecimal()` 的实部；值是复数时抛出 `MathDomainException`。
- `toComplexDecimal(digits)` 得到复数值的实部和虚部 `{re, im}`，舍入方式和 `toDecimal()` 相同，实部和虚部各自保留指定的有效位数：`(1 + i/10^25)^2 - 1` 的实部和虚部是 `-1e-50` 和 `2e-25`。`toDecimal()` 能算的函数，它对复数参数也能算，取主值分支；落在割线上的值，和 SymPy 取同一侧（`asin(2)` 是 `pi/2 - 1.3169…i`）。其中的特殊函数只接受实数参数。
- `compile()` 为了速度用双精度计算：双精度已经没有有效数字的值，它也算不准。实数参数的特殊函数由 Boost.Math 计算，误差在最后一位的几个单位以内，各个平台上跑的是同一套代码（C 库的伽马函数在不同系统上各不相同）。
- `toRectangular()` 给出表达式的实部和虚部（`{real, imaginary}`），`toPolar()` 给出它的模和辐角（`{modulus, argument}`）：`e^(i*pi/3)` 的实部和虚部是 `1/2` 和 `sqrt(3)/2`，模和辐角是 `1` 和 `pi/3`。变量当作复数，所以 `x` 的实部和虚部是 `re(x)` 和 `im(x)`。
- `compile(variables)` 把表达式编译成一个以数字为参数的函数，适合反复求值；`batch()` 一次算很多组数据：

```typescript
import {expression} from '@lakutata/math'

const f = expression('x^2 + sin(y)').compile(['x', 'y'])
console.log(f(2, 0))                                      //4
console.log(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0)))   //Float64Array [1, 4, 9]
```

### 十进制数

`decimal(value, {precision})` 得到一个 `Decimal`：有效数字最多 `precision` 位的十进制数（默认是范围的 `precision`，32 位），适合计算金额，或者需要很多位数的值。每次运算都把结果正确舍入到这个精度：取有这么多位的十进制数里最接近的一个；正好在两个之间的中点时，取末位是偶数的那个。十进制数不会改变：每次运算都得到一个新的。

- 值按写出来的样子读入：数字按它最短的写法读（`0.1` 就是 0.1，不是这个双精度数的二进制值），字符串按十进制数读（`'19.99'`、`'1.5e-7'`），bigint 精确读入。没有变量的表达式会先算出值，和 `toDecimal()` 一样：`decimal(expression('pi'), {precision: 50})`。
- 结果的精度和参与运算的那个十进制数相同：`a.add(b)` 的精度是 `a` 的。传给运算的值按它的全部位数读入。
- 运算有：`add`、`sub`、`mul`、`div`、`mod`（结果的符号和除数相同，和公式里的 `mod()` 一样）、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root(n)`、`exp`、`ln`、`log10`、`log(base)`、三角函数和双曲函数及它们的反函数、`atan2(x)`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round(places)`（正好在中点时向远离 0 的方向舍入，和公式里的 `round()` 一样）、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`。
- `toString()` 写出的数字不带末尾的 0：第一位数字在 10^-6 位到 10^(precision - 1) 位之间时用普通写法，否则用科学记数法（`1.5`、`0.000025`、`1.5e+25`、`1e-7`）。`toFixed(places)` 写出指定的小数位数（1.5 的 `toFixed(2)` 是 `1.50`），`toNumber()` 得到最接近的数字。十进制数在公式里也是精确的值：`expression(decimal)`。
- 这些运算在 JavaScript 线程里执行，没有时限。四则运算在任何精度下都很快，但函数算到几万位要几秒，特殊函数（`zeta`、`gamma`）算到几千位就要几秒：这种情况请用 `toDecimalAsync()` 计算表达式（可以设时限），再用结果得到十进制数。

```typescript
import {decimal} from '@lakutata/math'

console.log(decimal(0.1).add(0.2).toString())                //0.3
console.log(decimal('19.99').mul(3).toFixed(2))              //59.97
console.log(decimal(1, {precision: 5}).div(3).toString())    //0.33333
console.log(decimal(2, {precision: 40}).sqrt().toString())   //1.41421356237309504880168872420969807857
```

### 生成代码

- `toJavaScript()` 和 `toC()` 把表达式写成 JavaScript 或 C（C99 和 `<math.h>`）的代码，变量直接用原来的名字：`x^2 - 5x + 6` 在 JavaScript 里写成 `Math.pow(x, 2) - 5*x + 6`，在 C 里写成 `pow(x, 2.0) - 5.0*x + 6.0`。生成的代码用双精度浮点数计算，而且只在实数范围内计算：表达式中某一部分的值是复数时，结果是 NaN（`compile()` 会在复数范围内计算这些部分）。用到目标语言没有的函数（例如 JavaScript 没有 `gamma` 和 `erf`，两种语言都没有 `zeta` 和 `lambertw`）、`2i` 这样的复数，或者变量名和目标语言的保留字或生成代码要用到的名字（如 `new`、`Math`、`pow`）相同时，抛出 `MathNotSupportedException`。
- `cse(expressions)` 找出几个表达式里重复出现或者共有的部分（公共子表达式消除）。它返回这些部分（`replacements`），每个部分有一个名字（`x0`、`x1`……，会跳过表达式里已有的变量名）和一个值，值里可以引用排在它前面的名字；还返回用这些名字改写后的表达式（`expressions`）。再配合 `toJavaScript()` 或 `toC()`，就能生成每个部分只算一次的代码。

```typescript
import {cse} from '@lakutata/math'

const {replacements, expressions} = cse(['sin(x + y)^2 + x + y', 'cos(x + y)'])
const lines: string[] = replacements.map(({name, value}) => `const ${name} = ${value.toJavaScript()}`)   //const x0 = x + y
lines.push(`return [${expressions.map((expression) => expression.toJavaScript()).join(', ')}]`)   //return [x0 + Math.pow(Math.sin(x0), 2), Math.cos(x0)]
console.log(lines.join('\n'))
```

### 解方程

- 对方程或表达式（表示它等于零）调用 `solve(variable)`，得到解的数组，每个解是一个表达式；它的 `kind` 说明解集的种类：`finite`（有限个）、`empty`（无解）、`all`（任意值）、`intervals`（区间），或者 `unsolved`/`other`（这个包解不出来的集合，用 `text` 描述）。系数是有理数的多项式方程先找出全部有理根（`x^3 - 6x^2 + 11x - 6 = 0` 得到 1、2、3，而不是卡尔达诺公式的根式），剩下的部分在四次以内给出精确解。`{domain: 'real'}` 只保留实数解。
- `solve(equations, variables)` 解线性方程组：无解时返回空数组，否则返回一组解，给出它能确定的每个变量的值（有无穷多组解时，用其他变量表示）。

```typescript
import {expression, solve} from '@lakutata/math'

console.log(expression('x^4 - 1').solve('x').map(String))   //['-1', '1', '-i', 'i']
const [solution] = solve(['x + y = 3', 'x - y = 1'], ['x', 'y'])
console.log(solution.x.toString(), solution.y.toString())   //2 1
```

### 数论

`ntheory` 处理整数：参数是 bigint，或者安全整数范围内的 number；整数结果都是 bigint。

- 整除和模运算：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`，以及 `crt`（中国剩余定理，模数不必两两互质）。模 `m` 的结果和 `m` 同号，和 `mod` 一样：`mod(-7, 3)` 是 `2n`。
- 质数：`isPrime`（2^64 以下的结果是确定的，以上用 Baillie-PSW 检验，目前还没有发现能通过它的合数）、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`。
- 数列和组合数：`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`，以及给出精确分数（表达式）的 `bernoulli` 和 `harmonic`。`bernoulli(1)` 和 SymPy 一样是 `+1/2`。
- 计数：`permutations(n, k)`（从 n 个元素中取 k 个的排列数）、`combinationsWithRepetition(n, k)`、`multinomial(counts)`、`bell(n)`（集合的划分数）、`catalan(n)`、`stirlingSecondKind(n, k)`（划分成 k 块的方法数）和 `compositions(n, k)`（写成 k 个正整数的有序和的方法数）。没有东西可数时（例如 `k > n` 时从 n 个元素中取 k 个），结果是 0（mathjs 会报错）。
- 连分数：`continuedFraction(value, {terms})` 给出实数的连分数 `a0 + 1/(a1 + 1/(a2 + …))` 的各项：有理数给出全部的项（JavaScript 的 number 按它打印出来的十进制数理解：`0.1` 就是 1/10），最后一项大于 1，和 SymPy 相同；其他的值（`sqrt(2)`、`pi`）给出前 `terms` 项（默认 20 项），每一项都是确定的：用这个值的十进制数计算，位数不够判定时就增加位数。即使算到上千位仍和某个整数分不开的值，连分数就在那一项结束。`fromContinuedFraction(terms)` 由各项算出连分数的值，`convergents(terms)` 给出前几项的值（π 的 `22/7`、`355/113`），也就是最佳有理逼近；两者都是精确分数（表达式）。

值不存在时（没有逆元的数的 `modInverse`、没有原根的模数的 `primitiveRoot`、没有公共解的同余方程组的 `crt`），结果是 `undefined`。参数不在函数的定义域内时（`totient(0)`、`legendre(a, 9)`），抛出 `MathDomainException`。

`factor` 能立刻找出小的因数，20 位左右的数也分解得很快；但一个数如果有两个很大的质因数，可能要算好几天，这时请用 `factorAsync` 并设置时限。`isPrime`、`nextPrime`、`totient`、`mobius` 和 `primitiveRoot` 也有异步版本。`factorial` 最大能算到 `71000!` 左右；而公式里的 `factorial(n)` 在 n 超过 20000 时保持 `gamma(n + 1)` 的形式，这样表达式仍然能打印出来。

```typescript
import {ntheory} from '@lakutata/math'

console.log(ntheory.factor(360))                 //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
console.log(ntheory.powMod(4, 13, 497))          //445n
console.log(ntheory.continuedFraction('pi', {terms: 6}))   //[3n, 7n, 15n, 1n, 292n, 1n]
console.log(ntheory.convergents([3, 7, 15, 1]).map(String)) //['3', '22/7', '333/106', '355/113']
console.log(ntheory.crt([2, 3, 2], [3, 5, 7]))   //{remainder: 23n, modulus: 105n}
console.log(await ntheory.factorAsync(2n ** 64n + 1n, {timeout: 5000}))
```

### 矩阵和线性代数

`matrix(rows)` 得到一个数值（双精度）`Matrix`。它的元素按行存放在一个 `Float64Array` 里（`data`），原生插件直接读取这块内存。它的方法都返回新的矩阵：`get`、`set`（会修改矩阵本身）、`row`、`column`、`diagonal`、`submatrix`、`reshape`、`transpose`、`add`、`sub`、`mul`、`div`、`neg`、`multiplyElements`、`divideElements`、`powElements`、`map`、`trace`、`kron`、`equals`、`toArray` 和 `toString`（`[1, 2; 3, 4]`）。

`linalg` 提供基于 Eigen 的线性代数：

- 构造矩阵：`zeros`、`ones`、`identity`、`diagonal`、`fromRows`、`fromColumns`、`fromFunction`、`concat`，以及 `rotation`（平面上的旋转，或空间里绕某个轴的旋转）。
- 向量（`Float64Array`，或数字数组）：`dot`、`cross`、`outer`、`norm`。
- `multiply`、`solve`（用部分选主元的 LU 分解）、`solveTriangular`、`leastSquares`（范数最小的最小二乘解，和 NumPy 的 `lstsq` 一样）、`inverse`、`determinant`、`singularValues`、`rank`（大于 NumPy 默认容差的奇异值的个数）、`condition`，以及矩阵的范数（`'fro'`、1、2、`Infinity`）。
- 分解：`lu`（`P A = L U`，`permutation[i]` 是 `P A` 的第 i 行取自 A 的哪一行）、`qr` 和 `svd`（都是精简形式，列数是 `min(rows, columns)`）、`cholesky`、`eigen`（复数的特征值和特征向量，分成实部和虚部）、`symmetricEigen`、`schur`（实 Schur 形式），以及 `pseudoInverse`。`cholesky` 和 `symmetricEigen` 只读矩阵的下三角，和 NumPy 一样。`qr`、`svd` 和 `eigen` 给出的向量，正负号由 Eigen 决定，别的库可能给出相反的符号。
- 矩阵函数和矩阵方程：`exponential`（`e^A`，和 mathjs 的 `expm` 一样）、`squareRoot`（主平方根，只在它是实矩阵时给出）、`sylvester`（求 `A X + X B = C` 的 X）和 `lyapunov`（求 `A P + P Aᵀ + Q = 0` 的 P，和 mathjs 的 `lyap`、MATLAB 的一样；SciPy 的 `solve_continuous_lyapunov` 解的是 `A X + X Aᴴ = Q`，所以要传入 `-Q` 才得到这里的 P）。

右端项传入向量就得到向量：`solve(a, [5, 5])` 返回 `Float64Array`；传入矩阵（每一列是一个右端项）就得到矩阵。`solve` 和 `inverse` 判断矩阵奇异的规则和 NumPy 一样：LU 分解中遇到恰好为 0 的主元才算奇异；接近奇异的矩阵会给出很大的值，而不是报错，接近奇异的程度可以用 `condition()` 查看。

`linalg.sparse(rows, columns, entries)` 用条目 `[row, column, value]` 构造一个 `SparseMatrix`（同一位置的条目相加），`linalg.sparse(matrix)` 则取稠密矩阵中不为 0 的元素。它按压缩行格式存储（CSR：`rowPointers`、`columnIndices`、`values`）。它的方法有 `get`、`transpose`、`add`、`sub`、`neg`、`mul`（乘数字、向量、稠密矩阵或稀疏矩阵，乘稀疏矩阵时由 Eigen 计算）、`toDense` 和 `toEntries`。`solve` 传入稀疏矩阵时使用 Eigen 的稀疏 LU 分解（`SparseLU`，按 COLAMD 排序）：它无法分解的矩阵（例如有一行全是 0）就是奇异的。`conjugateGradient`（用于对称正定矩阵）和 `biconjugateGradientStabilized`（BiCGSTAB，用于任意方阵）反复迭代，直到相对残差 `‖b - A x‖ / ‖b‖` 不超过 `tolerance`（默认 1e-10），最多迭代 `maxIterations` 次（默认是方程组规模的 10 倍）；`converged` 表示是否达到了容差，传入 `guess` 可以从上一次的解继续迭代。

大矩阵上耗时的运算都有异步版本（`solveAsync()`、`inverseAsync()`、`multiplyAsync()` 等），它们在调用时就复制好参数。Eigen 的计算不能中途停下：超过时限或被取消时，Promise 会被拒绝，但线程要把这次计算做完才能空出来。

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

`expressionMatrix(value)` 得到一个 `ExpressionMatrix`，即元素是表达式的矩阵：可以由各行给出（`[['a', 'b'], ['c', 'd']]`），由公式给出（`'[1, x; x^2, 2]'`，`parse()` 也能读这种公式），或者由数值矩阵得到。它和表达式一样不会改变：`with(row, column, value)` 得到替换了一个元素的新矩阵。

- 元素和运算：`get`、`toArray`、`row`、`column`、`submatrix`、`transpose`、`add`、`sub`、`mul`（乘以矩阵或表达式）、`div`（除以表达式）、`multiplyElements`、`pow`（整数次幂，负数是逆矩阵的幂）和 `trace`，以及逐元素的 `diff`、`substitute`、`expand`、`simplify`。`toMatrix()` 得到各元素数值组成的数值矩阵，`toString()` 得到它的公式，`toTeX()` 得到 `bmatrix`。`jacobian(expressions, variables)` 得到几个表达式的雅可比矩阵。
- 线性代数都是精确的：方阵且非奇异时的 `determinant`、`inverse`、`solve`（奇异时抛出 `MathDomainException`），`rref`（简化行阶梯形和主元所在的列），`rank`、`nullspace`、`characteristicPolynomial`、`eigenvalues`（带重数）和 `eigenvectors`。纯数字矩阵用精确的有理数消元。含变量的矩阵，行列式和特征多项式用 Berkowitz 算法计算，逆矩阵由伴随矩阵得到，所以每个元素都是一个多项式分式，分子分母的公因式不会约去。
- 判断元素是否为 0：展开后为 0 的是 0；常数用十进制数判断，和 0 分不开的是 0；含变量的元素对变量的所有取值都为 0 才算 0（在两组取值上精确计算）。和 SymPy 一样，只在变量取某些值时为 0 的主元按非 0 处理。特征值是特征多项式的根：先试对角线上的元素，再找有理根，剩下的部分在四次以内给出精确值；其他情况抛出 `MathNotSupportedException`，数值可以用 `linalg.eigen()` 求。

```typescript
import {expressionMatrix, jacobian, parse} from '@lakutata/math'

const m = expressionMatrix([['a', 'b'], ['c', 'd']])
console.log(m.determinant().toString())                     //a*d - b*c
console.log(m.inverse().toString())                         //[d/(a*d - b*c), -b/(a*d - b*c); -c/(a*d - b*c), a/(a*d - b*c)]
console.log(parse('[1, 2; 3, 4] * [x; y]').toString())      //[x + 2y; 3x + 4y]
console.log(expressionMatrix('[2, 1; 1, 2]').eigenvectors().map(({value, vectors}) => [value.toString(), vectors.map(String)])) //[['1', ['[-1; 1]']], ['3', ['[1; 1]']]]
console.log(jacobian(['x^2*y', 'x + sin(y)'], ['x', 'y']).toString()) //[2x*y, x^2; 1, cos(y)]
```

### 单位

`unit(value)` 得到一个 `Unit`，即带单位的值：可以由单位公式给出（`'5 cm + 2 inch'`、`'9.8 m/s^2'`），也可以由数和单位给出（`unit(5, 'cm')`）。单位公式里的名字都是单位，可以带前缀（`km`、`mA`、`kilometer`），此外只有 `pi`、`e` 和 `i`；数后面跟着单位表示以这些单位计的值，几个名字连写表示相乘（`kg m^2/s^2`）。单位公式和 `parse()` 的公式是分开的，因为在 `parse()` 里 `m`、`s`、`g` 都是变量。单位表来自 mathjs（251 个单位和它们的前缀），数值都写成精确值；`createMath({units})` 可以添加别的单位。

- 值的数（`value`）是精确的表达式，单位的换算关系也是精确的：`unit('1 inch').to('cm')` 正好是 `2.54 cm`，`unit('90 deg').to('rad')` 是 `(pi/2) rad`。`toNumber(units?)` 给出普通数字，`toDecimal()` 给出十进制数，`toString()` 给出 `unit()` 能读回的文字。
- `to(units)` 换算成量纲相同的单位；`toSI()` 换算成这个量的 SI 单位（`J`、`Pa`），没有的话把每个单位分别换成 SI 单位；`toBest(units?)` 在给出的单位之间，或者在原单位的各个前缀之间，选最合适的单位（`5000 m` 变成 `5 km`）；`split(units)` 除最后一个单位外，每个单位取整数部分（`1.5 h` 分成 `1 h` 和 `30 min`）。
- `add` 和 `sub` 的结果用左边的值的单位。`mul` 和 `div` 把单位相乘或相除，右边的单位如果和左边某个单位是同一种量，就先换算成左边的单位（`5 cm * 2 m` 得 `1000 cm^2`）；量纲全部约掉时得到不带单位的数。此外还有 `pow`（指数要使各量纲的次数仍是整数）、`sqrt`、`neg`、`abs`、`equals`、`compare`。单位公式里可以用 `sqrt`、`sin`、`cos`、`tan`（参数是角度或数）以及 `exp`、`log`、`ln`（参数是数）。量纲不同的值不能相加，也不能互相换算，会抛出 `MathUnitException`。
- 带偏移的温度（`degC`、`degF`）可以换算和比较，但不能相加、相乘或相除，要先换算成 `K`（否则抛出 `MathUnitException`）。在复合单位里（`degC/m`）它表示温差，不带偏移。前缀作用在它的数上：`1 mdegC` 就是 0.001 degC。
- `constant(name)` 给出带单位的物理常数：mathjs 的 52 个常数，数值取 CODATA 2022。SI 精确定义的常数以及由它们算出的常数都是精确值（`reducedPlanckConstant` 是 `h/(2pi)`）。
- 和 mathjs 不同的地方：值保持原来的单位，输出时不会自动换前缀（要换用 `toBest()`），单位也不会自动换成导出单位（`N m` 仍是 `N m`，`toSI()` 才给出 `J`）；带偏移的温度不能相加；mathjs 取了近似值或沿用旧定义的单位（`eV`、`hp`、`psi`、`torr`、`mmHg`、`acre`、`kip`）在这里按定义取精确值。

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

`stats` 在原生插件里计算一组数值（数字数组或 `Float64Array`）的统计量：`sum`（会补偿舍入误差：`[1e16, 1, -1e16]` 的和是 1）、`product`、`cumulativeSum`、`differences`、`mean`、`median`、`mode`（出现次数最多的全部值，按升序排列）、`min`、`max`、`variance`、`standardDeviation`、`medianAbsoluteDeviation`、`quantile`、`covariance`、`correlation`（皮尔逊相关系数）、`zScores` 和 `klDivergence`（KL 散度，用自然对数，两个分布会先各自归一化到和为 1）。

方差默认用离差平方和除以 n，也就是把这组值当作总体，和 NumPy 一样。`{normalization: 'unbiased'}` 改为除以 n - 1（把这组值当作样本，这是 mathjs 的默认做法），`'biased'` 则除以 n + 1；`standardDeviation`、`covariance` 和 `zScores` 也接受这个选项。方差和协方差分两遍计算，数值带有很大的偏移量时也不会因相减而失去精度：`[1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]` 的方差是 22.5。分位数在相邻的两个值之间做线性插值，和 NumPy 的默认方法、mathjs 的 `quantileSeq` 一样。数值里有 NaN 时结果是 NaN；对空数组求没有定义的统计量（均值、中位数、方差等）会抛出 `MathArgumentException`，而空数组的和是 0，积是 1。

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

`stats` 还提供 24 种概率分布，由 Boost.Math 计算，参数按名字传入：`stats.gamma({shape: 2.5, scale: 1.5})`。不同的库对同一个分布的参数化方式各不相同，所以用名字说明每个参数是什么；下表列出了在 SciPy 里的对应写法。`Distribution` 有 `pdf`（离散分布是概率质量）、`cdf`、`survival`、`quantile` 和 `survivalQuantile`（SciPy 的 `isf`），都可以传入一个值或一组值；还有 `mean`、`variance`、`standardDeviation`、`median`、`mode`、`skewness`、`excessKurtosis`、`support`，以及 `sample`。

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

这些分布的约定和 SciPy 一致：在支撑集以外，密度是 0，cdf 是 0 或 1；离散分布在整数之间的概率质量是 0，cdf 取下面那个整数的值；p 的分位数是满足 `cdf(k) >= p` 的最小整数 k。离散分布 0 的分位数和 1 的生存分位数都是支撑集的下界（SciPy 给的是下界减 1）。发散的均值或方差是 `Infinity`（例如自由度为 2 的 t 分布的方差）；发散的偏度或超额峰度是 NaN，和不存在的矩一样（例如柯西分布的均值）。参数无效时抛出 `MathArgumentException`。

`stats.random(seed)` 得到一个 `RandomGenerator`（xoshiro256**），它有 `next()`、`uniform(count)`、`integers(count, lower, upper)`（取值范围是 `[lower, upper)`）和 `clone()`；`sample(count, random)` 用它生成的均匀随机数对 cdf 求逆来抽样。同一个种子每次都得到同样的序列。均匀随机数和整数在各个平台上完全相同，而分布的样本要经过 C 库的函数计算，在不同平台上最后几位可能不同。不给种子时，生成器从系统的随机数取种子。它不适合用于密码学。

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

`numeric` 求方程的数值解，适合 `solve()` 求不出精确解，或者只需要数值的情况。原生插件把表达式编译成双精度计算，并给出各个方法需要的导数。

- `polynomialRoots(polynomial, variable)` 求多项式在复数范围内的全部根，结果是 `{re, im}`，重根按重数重复出现，先按实部、再按虚部排序。它求的是平衡后伴随矩阵的特征值，再用牛顿法修正（和 NumPy 的 `roots` 一样）。多项式可以是表达式，也可以是从常数项开始的系数，和 mathjs 的 `polynomialRoot` 一样（NumPy 的 `roots` 从最高次项开始）。m 重根的精度大约是机器精度的 m 次方根。
- `findRoot(equation, variable, options)` 求函数（`x^3 - 2x - 5`，即等于 0）或方程（`cos(x) = x`）的一个根：给出函数在两端符号相反的区间 `bracket` `[a, b]` 时用 TOMS 748 算法，根一定在区间内；给出初始值 `guess` 时用牛顿法。区间两端符号相同，或者函数在区间里不是实数时，抛出 `MathDomainException`。
- `solveSystem(equations, variables, guess, options)` 从初始值出发解非线性方程组：用带线搜索的牛顿法，牛顿法走不下去时改用 Levenberg-Marquardt 法。方程比变量多时，求的是残差最小的点（最小二乘）。

迭代方法在步长相对解小于 `tolerance`（默认 1e-12）时停止，和 SciPy 的 `fsolve` 一样，或者在迭代 `maxIterations` 次（默认 100）后停止。不收敛时不会抛出错误，而是在结果里说明（`converged`），同时给出迭代次数 `iterations` 和残差 `residual`（根处函数值的绝对值，方程组则是残差的范数）。每个运算都有异步版本（`findRootAsync()` 等）。

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.polynomialRoots('x^3 - 6x^2 + 11x - 6'))                   //{re: Float64Array [1, 2, 3], im: Float64Array [0, 0, 0]}
console.log(numeric.polynomialRoots([1, 0, 1]))                                //{re: Float64Array [0, 0], im: Float64Array [-1, 1]}: 1 + x^2
console.log(numeric.findRoot('cos(x) = x', 'x', {bracket: [0, 1]}).root)       //0.7390851332151606
console.log(numeric.findRoot('x^3 - 2x - 5', 'x', {guess: 2}).root)            //2.0945514815423265
const {solution, converged} = numeric.solveSystem(['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y'], [2, 0])
console.log(solution, converged)                                               //Float64Array [1.9318516525781366, 0.5176380902050416] true
```

### 数值积分

`numeric.integrate(function, variable, [a, b], options)` 求函数在区间上的积分，结果是 `{value, error, converged}`。端点可以是无穷（`-Infinity`、`Infinity`）；从 b 积到 a 时结果取反。

- 用 QUADPACK 的 QAGS 算法计算，和 SciPy 的 `quad` 相同：把误差最大的区间对半分，用 21 点的 Gauss-Kronrod 公式计算，在奇点附近对结果序列做外推；半直线和整条实轴先变换到有限区间。如果这样还没算到舍入误差的程度，就再用双指数积分（tanh-sinh、exp-sinh、sinh-sinh）算一次，取更准确的结果。在不为 0 的端点附近，函数改写成到端点距离的函数（`x = 1 - u` 时 `1 - x^2` 是 `2u - u^2`），所以端点上的奇点（`1/sqrt(1 - x^2)` 在 `[-1, 1]` 上）也能算到舍入误差的程度。
- `points` 给出区间内函数奇异或跳变的点，区间在这些点分开计算。外推往往能自己找到这样的点，但给出 `points` 算得更快、更准，误差估计也可靠：奇点在区间内部时，外推的误差估计可能偏小，QUADPACK 也是这样。函数在某个求积节点上是无穷大时，区间也会在那里分开。
- `tolerance` 限制误差估计的大小（相对于 `|f|` 的积分）：默认约 1.5e-8（机器精度的平方根，和 SciPy 相同），实际结果通常比估计准确得多。发散、无休止振荡，或者双精度分辨不了的积分，给出最好的估计，并且 `converged` 为 `false`；函数在区间内不是实数时抛出 `MathDomainException`。`integrateAsync()` 在原生插件的线程里执行。

```typescript
import {numeric} from '@lakutata/math'

console.log(numeric.integrate('x^2', 'x', [0, 3]))                                     //{value: 9, error: 9.992007221626409e-14, converged: true}
console.log(numeric.integrate('1/sqrt(1 - x^2)', 'x', [-1, 1]).value)                  //3.141592653589794
console.log(numeric.integrate('exp(-x^2)', 'x', [-Infinity, Infinity]).value)          //1.7724538509055159
console.log(numeric.integrate('1/sqrt(abs(x - 1))', 'x', [0, 2], {points: [1]}).value) //4
console.log(numeric.integrate('sin(x)/x', 'x', [0, Infinity]).converged)               //false
```

### 微分方程

`numeric.solveODE({derivatives, states, time, span, initial}, options)` 求常微分方程或方程组 y' = f(t, y) 的数值解：各状态的导数是时间（默认叫 `t`）和各状态的表达式，从区间起点的初值一直解到终点（终点在起点之前时倒着解）。高阶方程写成方程组：x'' = -x 写成 x' = v、v' = -x。

- `method: 'rk45'`（默认）是 Dormand 和 Prince 的 5 阶显式 Runge-Kutta 方法，和 SciPy 的 RK45、MATLAB 的 ode45 相同。`method: 'radau'` 是 5 阶隐式方法 Radau IIA，和 SciPy 的 Radau 相同，用于刚性方程（各分量衰减快慢相差悬殊，例如化学反应、mu 很大的 Van der Pol 振子）：它使用导数的精确雅可比矩阵，在这类方程上需要的步数少得多。
- 步长根据上一步的误差选取，和 SciPy 的 `solve_ivp` 相同，使每一步的误差不超过 `relativeTolerance`（默认 1e-6）乘以状态的大小，再加上 `absoluteTolerance`（默认 1e-9）。SciPy 和 MATLAB 的默认值是 1e-3 和 1e-6，只能保证大约三位有效数字；区间很长时，终点的误差可能比每一步的容差大。
- 结果包括时间 `t`（从起点开始的每一步，或者指定的 `points`）和状态 `y`：`y` 是一个 `Matrix`，每个时间一行，每个状态一列。`points` 处的值由每一步的连续扩展算出，不会因此缩短步长。解在终点之前停下时（解无界增长使步长变得太小，或者超过 `maxSteps` 步，默认 100000 步），`completed` 为 `false`，`message` 说明原因，结果给出到停下为止的解。`solveODEAsync()` 在原生插件的线程里执行。

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

可能耗时的运算都有异步版本：`expandAsync()`、`simplifyAsync()`、`diffAsync()`、`seriesAsync()`、`solveAsync()`、`toDecimalAsync()`、`toComplexDecimalAsync()`、`solveAsync()` 和 `cseAsync()`，以及数论、线性代数和数值解的异步版本。它们在原生插件自己的线程里执行，不占用 libuv 的线程池：线程数默认是 CPU 核数减一，也可以用环境变量 `LAKUTATA_MATH_THREADS` 指定。选项有 `timeout`（毫秒）和 `signal`（`AbortSignal`）：

- 到了时限，Promise 以 `MathTimeoutException` 拒绝；signal 取消时，以 `MathCancelledException` 拒绝。有检查点的运算（展开、十进制计算、线性方程组、数论）会在下一个检查点停下；其他运算会先算完，线程才空出来。
- `createMath()` 创建的范围限制自己同时执行的运算数（`concurrency`），其余的运算排队等待。如果程序在运算还没结束时退出，这些运算的结果会被丢弃。

表达式最多嵌套 1000 层：更深的公式会被拒绝（`MathNotSupportedException`），以免运算时栈溢出。

### 打包

`lakutata package` 生成的包、可执行文件和安装程序会带上编译好的原生插件（`build/Release/math.node`），所以要在每个目标平台上先安装这个包，再在那里打包。

## API

| 导出 | 说明 |
|---|---|
| `parse`、`expression`、`equation`、`decimal`、`matrix`、`expressionMatrix`、`jacobian`、`unit`、`constant`、`solve`、`solveAsync`、`cse`、`cseAsync`、`ntheory`、`linalg`、`stats`、`numeric` | `math` 的函数和命名空间，可以直接使用 |
| `math`、`createMath`、`MathOptions` | 默认选项的范围；用别的选项（`definitions`、`precision`、`timeout`、`concurrency`、`units`）创建范围的函数，以及它的选项 |
| `MathScope`、`MathDefinitions` | 由定义和设置组成的范围（`createMath()`、`with()`）：`parse`、`expression`、`equation`、`decimal`、`matrix`、`expressionMatrix`、`jacobian`、`unit`、`constant`、`with`、`solve`、`solveAsync`、`cse`、`cseAsync`、`ntheory`、`linalg`、`stats`、`numeric`；定义（按签名给出的公式） |
| `Expression` | 表达式：`toString`、`toTeX`、`toNumber`、`toComplex`、`toDecimal`、`toComplexDecimal`、`variables`、`equals`、`add`、`sub`、`mul`、`div`、`pow`、`neg`、`expand`、`simplify`、`diff`、`series`、`substitute`、`evaluate`、`solve`、`compile`，多项式（`coefficients`、`degree`、`leadingCoefficient`、`divide`），`numerator`、`denominator`、`rewrite`（改写成 `exp`、`sin`、`cos`），判断（`isZero`、`isPositive`、`isNegative`、`isInteger`、`isRational`、`isReal`、`isFinite`：不知道时为 `undefined`），`compare`、`toJavaScript`、`toC`、`toPolar`、`toRectangular`，以及各个异步版本 |
| `CommonSubexpressions`、`CseOptions` | `cse()` 的结果（`replacements`、`expressions`）和它的选项（`prefix`） |
| `PolarForm`、`RectangularForm` | 复数的极坐标形式（模 `modulus`、辐角 `argument`）和直角坐标形式（实部 `real`、虚部 `imaginary`） |
| `Equation`、`Inequality`、`InequalityRelation` | 方程（`left`、`right`、`difference`、`substitute`、`solve`、`solveAsync`），不等式（`left`、`right`、`relation`） |
| `Solutions`、`SolutionsKind`、`SolutionInterval`、`SolveOptions` | 方程的解：表达式的数组，带有 `kind`、`intervals` 和 `text`；解的范围 `domain` |
| `SystemSolution`、`SystemEquation` | 方程组的一组解（每个变量对应一个表达式），方程组里的一个方程 |
| `CompiledFunction` | 编译后的表达式：以数字为参数的函数，它的 `variables` 和 `batch` |
| `Decimal`、`DecimalValue`、`DecimalOptions` | 指定精度的十进制数（`decimal()`）：`precision`、`add`、`sub`、`mul`、`div`、`mod`、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root`、`exp`、`ln`、`log10`、`log`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`sinh`、`cosh`、`tanh`、`asinh`、`acosh`、`atanh`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round`、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`、`toString`、`toFixed`、`toNumber`、`toJSON`；需要十进制数的地方可以传入的值（十进制数、数字、bigint、写成字符串的十进制数）；`decimal()` 的选项（`precision`） |
| `Matrix`、`MatrixValue`、`VectorValue` | 数值矩阵（`matrix()`）：`rows`、`columns`、`data`、`get`、`set`、`row`、`column`、`diagonal`、`submatrix`、`reshape`、`transpose`、`add`、`sub`、`mul`、`div`、`neg`、`multiplyElements`、`divideElements`、`powElements`、`map`、`trace`、`kron`、`equals`、`clone`、`toArray`、`toJSON`、`toString`；需要矩阵的地方可以传入的值（矩阵，或它的各行）；需要向量的地方可以传入的值（`Float64Array`，或数字数组） |
| `ExpressionMatrix`、`ExpressionMatrixValue`、`RowEchelonForm`、`Eigenvector` | 表达式矩阵（`expressionMatrix()`、`parse()`）：`rows`、`columns`、`get`、`toArray`、`with`、`row`、`column`、`submatrix`、`transpose`、`neg`、`add`、`sub`、`mul`、`div`、`multiplyElements`、`pow`、`trace`、`determinant`、`inverse`、`solve`、`rref`、`rank`、`nullspace`、`characteristicPolynomial`、`eigenvalues`、`eigenvectors`、`diff`、`substitute`、`expand`、`simplify`、`equals`、`toMatrix`、`toString`、`toTeX`，以及 `determinantAsync`、`inverseAsync`、`solveAsync`、`eigenvectorsAsync`；能当作表达式矩阵的值；简化行阶梯形和它的主元；特征值、它的重数和特征向量 |
| `Unit`、`UnitValue`、`UnitDimensions`、`CustomUnit`、`CustomUnits`、`PhysicalConstant` | 带单位的值（`unit()`、`constant()`）：`value`、`units`、`dimensions`、`hasDimensionsOf`、`to`、`toSI`、`toBest`、`split`、`add`、`sub`、`mul`、`div`、`pow`、`sqrt`、`neg`、`abs`、`equals`、`compare`、`toNumber`、`toDecimal`、`toString`、`toJSON`、`toTeX`；能当作带单位的值给出的参数；各基本量的次数；`createMath()` 的一个单位（`definition`、`prefixes`、`aliases`、`offset`）和这个选项的全部单位；物理常数的名字 |
| `LinearAlgebra`、`NormKind` | 线性代数（`linalg`）：`zeros`、`ones`、`identity`、`diagonal`、`fromRows`、`fromColumns`、`fromFunction`、`concat`、`rotation`、`dot`、`cross`、`outer`、`norm`、`multiply`、`solve`、`solveTriangular`、`leastSquares`、`inverse`、`determinant`、`singularValues`、`rank`、`condition`、`lu`、`qr`、`cholesky`、`svd`、`eigen`、`symmetricEigen`、`schur`、`pseudoInverse`、`exponential`、`squareRoot`、`sylvester`、`lyapunov`、`sparse`、`conjugateGradient`、`biconjugateGradientStabilized`，以及各个异步版本；范数的种类 |
| `Statistics`、`Normalization`、`NormalizationOptions` | 统计（`stats`）：`sum`、`product`、`cumulativeSum`、`differences`、`mean`、`median`、`mode`、`min`、`max`、`variance`、`standardDeviation`、`medianAbsoluteDeviation`、`quantile`、`covariance`、`correlation`、`zScores`、`klDivergence`、各个分布（`normal` … `hypergeometric`、`distribution`）和 `random`；方差的除数（`'uncorrected'`、`'unbiased'`、`'biased'`）和选择它的选项 |
| `Distribution`、`DistributionName`、`DistributionParameters` | 概率分布：`pdf`、`cdf`、`survival`、`quantile`、`survivalQuantile`、`sample`、`parameters`、`kind`、`support`、`mean`、`variance`、`standardDeviation`、`median`、`mode`、`skewness`、`excessKurtosis`；分布的名字；按名字给出的参数 |
| `RandomGenerator` | 按种子生成随机数的生成器（xoshiro256**）：`next`、`uniform`、`integers`、`clone` |
| `SparseMatrix`、`SparseEntry` | 按压缩行存储的稀疏矩阵（`linalg.sparse()`）：`rowPointers`、`columnIndices`、`values`、`nonZeros`、`get`、`transpose`、`add`、`sub`、`neg`、`mul`、`toDense`、`toEntries`；条目 `[row, column, value]` |
| `IterativeOptions`、`IterativeSolution` | 迭代求解器的选项（`tolerance`、`maxIterations`、`guess`）和结果（`solution`、`iterations`、`error`、`converged`） |
| `LuDecomposition`、`QrDecomposition`、`SingularValueDecomposition`、`EigenDecomposition`、`SymmetricEigenDecomposition`、`SchurDecomposition`、`ComplexVector`、`ComplexMatrix` | 各种分解的结果：`{lower, upper, permutation}`、`{q, r}`、`{u, singularValues, v}`、`{values, vectors}`（复数为 `{re, im}`）、`{values, vectors}`、`{u, t}` |
| `NumberTheory`、`IntegerValue`、`ContinuedFractionOptions`、`PrimeFactor`、`ExtendedGcd`、`Congruence` | 数论（`ntheory`）：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`、`isPrime`、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`、`crt`、`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`、`bernoulli`、`harmonic`、`permutations`、`combinationsWithRepetition`、`multinomial`、`bell`、`catalan`、`stirlingSecondKind`、`compositions`、`continuedFraction`、`fromContinuedFraction`、`convergents`，以及各个异步版本；整数（bigint，或安全整数范围内的 number）；质因数和它的指数；`extendedGcd` 的结果；`crt` 的结果；连分数的最多项数 |
| `Numeric`、`FindRootOptions`、`IterationOptions`、`RootResult`、`SystemRootResult`、`IntegrateOptions`、`IntegralResult` | 数值解和数值积分（`numeric`）：`polynomialRoots`、`findRoot`、`solveSystem`、`integrate` 和它们的异步版本；它们的选项（`bracket`、`guess`、`tolerance`、`maxIterations`、`points`）和结果（`root` 或 `solution`、`converged`、`iterations`、`residual`；`value`、`error`、`converged`） |
| `ODEProblem`、`ODEOptions`、`ODEResult` | 微分方程（`numeric.solveODE`、`solveODEAsync`）：导数、状态、时间、区间和初值；方法（`rk45`、`radau`）、容差、`maxStep`、`points`、`maxSteps`；时间 `t`、状态 `y`、`steps`、`rejected`、`evaluations`、`jacobians`、`completed`、`message` |
| `AsyncOptions`、`Value` | 异步运算的选项（`timeout`、`signal`）；需要表达式的地方可以传入的值（表达式、数字、bigint、十进制数、公式） |

类型声明里有每个声明的说明和示例。

## 错误

| 错误 | 什么时候抛出 |
|---|---|
| `MathSyntaxException` | 公式写得不对（带有出错的 `position`），需要表达式的地方给了方程或矩阵，或者反过来，矩阵和数相加，只接受数的函数用在了矩阵上 |
| `MathUnitException` | 量纲不同的带单位的值相加、比较或换算，不认识的单位（带有它的 `position`），带偏移的温度相加、相乘或相除，乘方后量纲的次数不是整数，`sin()` 的参数既不是角度也不是数 |
| `MathUnknownFunctionException` | 公式调用的函数既不是内置函数，也没有定义，或者把常数写成了调用（`g(2)`），带有它的 `position` |
| `MathDefinitionException` | 定义无效：用了内置的名字、参数重复、定义之间循环引用、定义嵌套太深、定义是一个矩阵；`createMath()` 的单位无效：名字已经是单位（单独或者加上前缀），定义里有不认识的单位，单位之间循环定义 |
| `MathDomainException` | 把复数当成数字取值，取无穷大、`complexInfinity`（除以零；`toNumber()` 里也包括除以一个无法和 0 区分的值）的值，数论函数的参数不在定义域内（`totient(0)`），需要求逆的地方矩阵是奇异的（`solve()`、`inverse()`），`cholesky()` 的矩阵不是正定的，`squareRoot()` 的矩阵的主平方根不是实矩阵或者不存在，Sylvester 或 Lyapunov 方程没有唯一解，或者十进制数不在函数的定义域内（负数开平方、`asin()` 的参数是 2、负数的非整数次幂），`findRoot()` 的区间两端符号相同或者函数在区间里不是实数，函数或方程组在 `findRoot()`、`solveSystem()` 的初始值处不是实数，`integrate()` 的函数在区间内不是实数，`solveODE()` 的导数在起点不是实数，对复数求连分数，表达式矩阵是奇异的（`inverse()`、`solve()`、`inv()`） |
| `MathDivisionByZeroException` | 计算十进制值时遇到除以零（包括除以一个无法和 0 区分的值、0 的对数、0 的负数次幂、以 1 为底的对数、在函数的极点上求值：`gamma()` 的参数是 -2、`zeta()` 的参数是 1），模数是 0，或者连分数的各项导致除以零 |
| `MathNotSupportedException` | 这个包对这个表达式不做的运算：非线性方程组、无法编译的表达式、嵌套超过 1000 层的表达式、运算中遇到太大而无法精确计算的数、对非整数求 `gcd` 或 `lcm`、数论的结果超过 2^20 位（二进制）、`bernoulli(n)` 和 `bell(n)` 的 n 超过 2000、`harmonic(n)` 的 n 超过 50000、`stirlingSecondKind(n, k)` 的 n 超过 50000 或 n k 超过 6250000、生成代码时遇到目标语言没有的函数、`2i` 这样的复数、和保留字重名的变量、特征值的计算不收敛、求 n 不是整数的 `polygamma(n, x)` 的十进制值、十进制数的指数超出了范围（约 ±10^18，32 位系统上约 ±4.25 × 10^8；例如 `exp()` 的参数是 10^19，`toDecimal()` 里也一样），或者十进制值要比要求的位数多算超过 50000 位（`sin(10^(10^6))`），表达式矩阵的特征值求不出精确值，矩阵的幂不是整数，矩阵的方程或不等式 |
| `MathArgumentException` | 参数无效：需要数字的地方还有变量、名字不是变量、给的值个数不对、需要整数的地方给的不是整数、需要十进制数的地方给的不是十进制数、精度不在 1 到 100000 之间、`integrate()` 的区间、分点或容差无效、`solveODE()` 的问题或选项无效、对含有变量的值求连分数、连分数的项不是整数、矩阵或向量的维数不对、稀疏矩阵的结构无效（包括构造之后数组被改动的情况）、对空数组求没有定义的统计量、分布的参数无效、分位数的概率不在 0 到 1 之间、`klDivergence` 的概率是负数，只需要单位的地方给了数（`to('2 cm')`），物理常数的名字不对，`createMath()` 的选项无效 |
| `MathTimeoutException`、`MathCancelledException` | 异步运算超过时限，或者被取消 |
| `MathException` | 以上所有错误的基类；原生插件内部错误时，它的 `errno` 是 `E_MATH_INTERNAL` |

## 另见

- [SymEngine](https://github.com/symengine/symengine)：原生插件所基于的符号计算引擎。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库和它们的许可证。
