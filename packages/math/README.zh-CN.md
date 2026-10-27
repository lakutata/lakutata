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

- `toNumber()` 转成 JavaScript 的数字（值是复数时抛出 `MathDomainException`），`toComplex()` 得到 `{re, im}`。凡是 `toDecimal()` 或 `toComplexDecimal()` 能算的值，它们都先算出十进制值再转成数字，所以即使双精度计算已经没有一位有效数字（例如 `cos(10^30)`、`e^(i*10^30)`），得到的数字每一位都是对的。两者也能计算复数参数的特殊函数（伽马、zeta、Lambert W、多伽马、误差函数等），这些函数用双精度计算，表达式的其余部分仍用十进制计算。
- `toDecimal(digits)` 得到指定有效位数、正确舍入的字符串（默认位数是组件的 `precision`），写法和 `Decimal` 相同（见下一节）：算出的 3 写成 `3`，不写成 `3.000…`。它会用更多位数重新计算，直到两次结果一致。能算四则运算、乘方和开方、`exp` 和 `ln`、三角函数和双曲函数及它们的反函数、取整函数、常数，以及实数参数的特殊函数：`gamma`、`loggamma`、`digamma`、`polygamma`、`beta`、`erf`、`erfc`、`zeta`（包括 Hurwitz zeta）、`lowergamma`、`uppergamma` 和 `lambertw`。多算 640 位仍然和 0 分不开的值，结果是 `0`（例如 `ln(6) - ln(2) - ln(3)`）；参数太大、这么多位不够用的值，会按需要再多算一些位数，最多多算 50000 位（`sin(10^(10^4))` 要多算 10^4 位）；恰好在相邻两个这么多位的十进制数正中间的值，取末位是偶数的那个（`ln(8)/ln(4)` 等于 1.5，保留 1 位得 `2`）。
- `toComplexDecimal(digits)` 得到复数值的实部和虚部 `{re, im}`，舍入方式和 `toDecimal()` 相同，实部和虚部各自保留指定的有效位数：`(1 + i/10^25)^2 - 1` 的实部和虚部是 `-1e-50` 和 `2e-25`。`toDecimal()` 能算的函数，它对复数参数也能算，取主值分支；落在割线上的值，和 SymPy 取同一侧（`asin(2)` 是 `pi/2 - 1.3169…i`）。其中的特殊函数只接受实数参数。
- `compile()` 为了速度用双精度计算：双精度已经没有有效数字的值，它也算不准。实数参数的特殊函数由 Boost.Math 计算，误差在最后一位的几个单位以内，各个平台上跑的是同一套代码（C 库的伽马函数在不同系统上各不相同）。
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
- 计数：`permutations(n, k)`（从 n 个元素中取 k 个的排列数）、`combinationsWithRepetition(n, k)`、`multinomial(counts)`、`bell(n)`（集合的划分数）、`catalan(n)`、`stirlingSecondKind(n, k)`（划分成 k 块的方法数）和 `compositions(n, k)`（写成 k 个正整数的有序和的方法数）。没有东西可数时（例如 `k > n` 时从 n 个元素中取 k 个），结果是 0（mathjs 会报错）。

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

### 矩阵和线性代数

`math.matrix(rows)` 得到一个数值（双精度）`Matrix`。它的元素按行存放在一个 `Float64Array` 里（`data`），原生插件直接读取这块内存。它的方法都返回新的矩阵：`get`、`set`（会修改矩阵本身）、`row`、`column`、`diagonal`、`submatrix`、`reshape`、`transpose`、`add`、`sub`、`mul`、`div`、`neg`、`multiplyElements`、`divideElements`、`powElements`、`map`、`trace`、`kron`、`equals`、`toArray` 和 `toString`（`[1, 2; 3, 4]`）。

`math.linalg` 提供基于 Eigen 的线性代数：

- 构造矩阵：`zeros`、`ones`、`identity`、`diagonal`、`fromRows`、`fromColumns`、`fromFunction`、`concat`，以及 `rotation`（平面上的旋转，或空间里绕某个轴的旋转）。
- 向量（`Float64Array`，或数字数组）：`dot`、`cross`、`outer`、`norm`。
- `multiply`、`solve`（用部分选主元的 LU 分解）、`solveTriangular`、`leastSquares`（范数最小的最小二乘解，和 NumPy 的 `lstsq` 一样）、`inverse`、`determinant`、`singularValues`、`rank`（大于 NumPy 默认容差的奇异值的个数）、`condition`，以及矩阵的范数（`'fro'`、1、2、`Infinity`）。
- 分解：`lu`（`P A = L U`，`permutation[i]` 是 `P A` 的第 i 行取自 A 的哪一行）、`qr` 和 `svd`（都是精简形式，列数是 `min(rows, columns)`）、`cholesky`、`eigen`（复数的特征值和特征向量，分成实部和虚部）、`symmetricEigen`、`schur`（实 Schur 形式），以及 `pseudoInverse`。`cholesky` 和 `symmetricEigen` 只读矩阵的下三角，和 NumPy 一样。`qr`、`svd` 和 `eigen` 给出的向量，正负号由 Eigen 决定，别的库可能给出相反的符号。
- 矩阵函数和矩阵方程：`exponential`（`e^A`，和 mathjs 的 `expm` 一样）、`squareRoot`（主平方根，只在它是实矩阵时给出）、`sylvester`（求 `A X + X B = C` 的 X）和 `lyapunov`（求 `A P + P Aᵀ + Q = 0` 的 P，和 mathjs 的 `lyap`、MATLAB 的一样；SciPy 的 `solve_continuous_lyapunov` 解的是 `A X + X Aᴴ = Q`，所以要传入 `-Q` 才得到这里的 P）。

右端项传入向量就得到向量：`solve(a, [5, 5])` 返回 `Float64Array`；传入矩阵（每一列是一个右端项）就得到矩阵。`solve` 和 `inverse` 判断矩阵奇异的规则和 NumPy 一样：LU 分解中遇到恰好为 0 的主元才算奇异；接近奇异的矩阵会给出很大的值，而不是报错，接近奇异的程度可以用 `condition()` 查看。

`math.linalg.sparse(rows, columns, entries)` 用条目 `[row, column, value]` 构造一个 `SparseMatrix`（同一位置的条目相加），`math.linalg.sparse(matrix)` 则取稠密矩阵中不为 0 的元素。它按压缩行格式存储（CSR：`rowPointers`、`columnIndices`、`values`）。它的方法有 `get`、`transpose`、`add`、`sub`、`neg`、`mul`（乘数字、向量、稠密矩阵或稀疏矩阵，乘稀疏矩阵时由 Eigen 计算）、`toDense` 和 `toEntries`。`solve` 传入稀疏矩阵时使用 Eigen 的稀疏 LU 分解（`SparseLU`，按 COLAMD 排序）：它无法分解的矩阵（例如有一行全是 0）就是奇异的。`conjugateGradient`（用于对称正定矩阵）和 `biconjugateGradientStabilized`（BiCGSTAB，用于任意方阵）反复迭代，直到相对残差 `‖b - A x‖ / ‖b‖` 不超过 `tolerance`（默认 1e-10），最多迭代 `maxIterations` 次（默认是方程组规模的 10 倍）；`converged` 表示是否达到了容差，传入 `guess` 可以从上一次的解继续迭代。

大矩阵上耗时的运算都有异步版本（`solveAsync()`、`inverseAsync()`、`multiplyAsync()` 等），它们在调用时就复制好参数。Eigen 的计算不能中途停下：超过时限或被取消时，Promise 会被拒绝，但线程要把这次计算做完才能空出来。

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

### 统计

`math.stats` 在原生插件里计算一组数值（数字数组或 `Float64Array`）的统计量：`sum`（会补偿舍入误差：`[1e16, 1, -1e16]` 的和是 1）、`product`、`cumulativeSum`、`differences`、`mean`、`median`、`mode`（出现次数最多的全部值，按升序排列）、`min`、`max`、`variance`、`standardDeviation`、`medianAbsoluteDeviation`、`quantile`、`covariance`、`correlation`（皮尔逊相关系数）、`zScores` 和 `klDivergence`（KL 散度，用自然对数，两个分布会先各自归一化到和为 1）。

方差默认用离差平方和除以 n，也就是把这组值当作总体，和 NumPy 一样。`{normalization: 'unbiased'}` 改为除以 n - 1（把这组值当作样本，这是 mathjs 的默认做法），`'biased'` 则除以 n + 1；`standardDeviation`、`covariance` 和 `zScores` 也接受这个选项。方差和协方差分两遍计算，数值带有很大的偏移量时也不会因相减而失去精度：`[1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]` 的方差是 22.5。分位数在相邻的两个值之间做线性插值，和 NumPy 的默认方法、mathjs 的 `quantileSeq` 一样。数值里有 NaN 时结果是 NaN；对空数组求没有定义的统计量（均值、中位数、方差等）会抛出 `MathArgumentException`，而空数组的和是 0，积是 1。

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

### 概率分布

`math.stats` 还提供 24 种概率分布，由 Boost.Math 计算，参数按名字传入：`math.stats.gamma({shape: 2.5, scale: 1.5})`。不同的库对同一个分布的参数化方式各不相同，所以用名字说明每个参数是什么；下表列出了在 SciPy 里的对应写法。`Distribution` 有 `pdf`（离散分布是概率质量）、`cdf`、`survival`、`quantile` 和 `survivalQuantile`（SciPy 的 `isf`），都可以传入一个值或一组值；还有 `mean`、`variance`、`standardDeviation`、`median`、`mode`、`skewness`、`excessKurtosis`、`support`，以及 `sample`。

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

`math.stats.random(seed)` 得到一个 `RandomGenerator`（xoshiro256**），它有 `next()`、`uniform(count)`、`integers(count, lower, upper)`（取值范围是 `[lower, upper)`）和 `clone()`；`sample(count, random)` 用它生成的均匀随机数对 cdf 求逆来抽样。同一个种子每次都得到同样的序列。均匀随机数和整数在各个平台上完全相同，而分布的样本要经过 C 库的函数计算，在不同平台上最后几位可能不同。不给种子时，生成器从系统的随机数取种子。它不适合用于密码学。

```typescript
import type {Math} from '@lakutata/math'

function probability(math: Math): void {
    const normal = math.stats.normal({mean: 1, standardDeviation: 2})
    console.log(normal.cdf(1))                                     //0.5
    console.log(normal.quantile(0.975))                            //4.919927969080108
    const binomial = math.stats.binomial({trials: 10, probability: 0.3})
    console.log(binomial.pdf([2, 3]))                              //Float64Array [0.23347444050000024, 0.2668279319999998]
    console.log(binomial.quantile(0.5))                            //3
    const random = math.stats.random(42)
    console.log(normal.sample(3, random))                          //种子 42 每次都得到同样的三个样本
    console.log(random.integers(5, 1, 7))                          //掷五次骰子
}
```

### 异步运算

可能耗时的运算都有异步版本：`expandAsync()`、`simplifyAsync()`、`diffAsync()`、`seriesAsync()`、`solveAsync()`、`toDecimalAsync()`、`toComplexDecimalAsync()`、组件的 `solveAsync()` 和 `cseAsync()`，以及数论和线性代数的异步版本。它们在原生插件自己的线程里执行，不占用 libuv 的线程池：线程数默认是 CPU 核数减一，也可以用环境变量 `LAKUTATA_MATH_THREADS` 指定。选项有 `timeout`（毫秒）和 `signal`（`AbortSignal`）：

- 到了时限，Promise 以 `MathTimeoutException` 拒绝；signal 取消时，以 `MathCancelledException` 拒绝。有检查点的运算（展开、十进制计算、线性方程组、数论）会在下一个检查点停下；其他运算会先算完，线程才空出来。
- 组件限制自己同时执行的运算数（`concurrency`）。组件销毁时会等正在执行的运算结束，最多等 `drainTimeout` 毫秒。

表达式最多嵌套 1000 层：更深的公式会被拒绝（`MathNotSupportedException`），以免运算时栈溢出。

### 打包

`lakutata package` 生成的包、可执行文件和安装程序会带上编译好的原生插件（`build/Release/math.node`），所以要在每个目标平台上先安装这个包，再在那里打包。

## API

| 导出 | 说明 |
|---|---|
| `Math` | 组件：`parse`、`expression`、`equation`、`decimal`、`matrix`、`with`、`solve`、`solveAsync`、`cse`、`cseAsync`、`ntheory`、`linalg`、`stats` |
| `buildMathOptions`、`MathConfig` | 在组件配置里声明它，以及它的选项：`definitions`、`precision`、`timeout`、`concurrency`、`drainTimeout` |
| `MathScope`、`MathDefinitions` | `with()` 得到的范围，方法和组件相同（没有 `ntheory`、`linalg` 和 `stats`）；定义（按签名给出的公式） |
| `Expression` | 表达式：`toString`、`toTeX`、`toNumber`、`toComplex`、`toDecimal`、`toComplexDecimal`、`variables`、`equals`、`add`、`sub`、`mul`、`div`、`pow`、`neg`、`expand`、`simplify`、`diff`、`series`、`substitute`、`evaluate`、`solve`、`compile`，多项式（`coefficients`、`degree`、`leadingCoefficient`、`divide`），`numerator`、`denominator`、`rewrite`（改写成 `exp`、`sin`、`cos`），判断（`isZero`、`isPositive`、`isNegative`、`isInteger`、`isRational`、`isReal`、`isFinite`：不知道时为 `undefined`），`compare`、`toJavaScript`、`toC`、`toPolar`、`toRectangular`，以及各个异步版本 |
| `CommonSubexpressions`、`CseOptions` | `cse()` 的结果（`replacements`、`expressions`）和它的选项（`prefix`） |
| `PolarForm`、`RectangularForm` | 复数的极坐标形式（模 `modulus`、辐角 `argument`）和直角坐标形式（实部 `real`、虚部 `imaginary`） |
| `Equation`、`Inequality`、`InequalityRelation` | 方程（`left`、`right`、`difference`、`substitute`、`solve`、`solveAsync`），不等式（`left`、`right`、`relation`） |
| `Solutions`、`SolutionsKind`、`SolutionInterval`、`SolveOptions` | 方程的解：表达式的数组，带有 `kind`、`intervals` 和 `text`；解的范围 `domain` |
| `SystemSolution`、`SystemEquation` | 方程组的一组解（每个变量对应一个表达式），方程组里的一个方程 |
| `CompiledFunction` | 编译后的表达式：以数字为参数的函数，它的 `variables` 和 `batch` |
| `Decimal`、`DecimalValue`、`DecimalOptions` | 指定精度的十进制数（`math.decimal()`）：`precision`、`add`、`sub`、`mul`、`div`、`mod`、`pow`、`neg`、`abs`、`sqrt`、`cbrt`、`root`、`exp`、`ln`、`log10`、`log`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`sinh`、`cosh`、`tanh`、`asinh`、`acosh`、`atanh`、`gamma`、`loggamma`、`digamma`、`erf`、`erfc`、`zeta`、`lambertw`、`floor`、`ceil`、`trunc`、`round`、`compare`、`equals`、`isZero`、`isPositive`、`isNegative`、`isInteger`、`toString`、`toFixed`、`toNumber`、`toJSON`；需要十进制数的地方可以传入的值（十进制数、数字、bigint、写成字符串的十进制数）；`decimal()` 的选项（`precision`） |
| `Matrix`、`MatrixValue`、`VectorValue` | 数值矩阵（`math.matrix()`）：`rows`、`columns`、`data`、`get`、`set`、`row`、`column`、`diagonal`、`submatrix`、`reshape`、`transpose`、`add`、`sub`、`mul`、`div`、`neg`、`multiplyElements`、`divideElements`、`powElements`、`map`、`trace`、`kron`、`equals`、`clone`、`toArray`、`toJSON`、`toString`；需要矩阵的地方可以传入的值（矩阵，或它的各行）；需要向量的地方可以传入的值（`Float64Array`，或数字数组） |
| `LinearAlgebra`、`NormKind` | 线性代数（`math.linalg`）：`zeros`、`ones`、`identity`、`diagonal`、`fromRows`、`fromColumns`、`fromFunction`、`concat`、`rotation`、`dot`、`cross`、`outer`、`norm`、`multiply`、`solve`、`solveTriangular`、`leastSquares`、`inverse`、`determinant`、`singularValues`、`rank`、`condition`、`lu`、`qr`、`cholesky`、`svd`、`eigen`、`symmetricEigen`、`schur`、`pseudoInverse`、`exponential`、`squareRoot`、`sylvester`、`lyapunov`、`sparse`、`conjugateGradient`、`biconjugateGradientStabilized`，以及各个异步版本；范数的种类 |
| `Statistics`、`Normalization`、`NormalizationOptions` | 统计（`math.stats`）：`sum`、`product`、`cumulativeSum`、`differences`、`mean`、`median`、`mode`、`min`、`max`、`variance`、`standardDeviation`、`medianAbsoluteDeviation`、`quantile`、`covariance`、`correlation`、`zScores`、`klDivergence`、各个分布（`normal` … `hypergeometric`、`distribution`）和 `random`；方差的除数（`'uncorrected'`、`'unbiased'`、`'biased'`）和选择它的选项 |
| `Distribution`、`DistributionName`、`DistributionParameters` | 概率分布：`pdf`、`cdf`、`survival`、`quantile`、`survivalQuantile`、`sample`、`parameters`、`kind`、`support`、`mean`、`variance`、`standardDeviation`、`median`、`mode`、`skewness`、`excessKurtosis`；分布的名字；按名字给出的参数 |
| `RandomGenerator` | 按种子生成随机数的生成器（xoshiro256**）：`next`、`uniform`、`integers`、`clone` |
| `SparseMatrix`、`SparseEntry` | 按压缩行存储的稀疏矩阵（`math.linalg.sparse()`）：`rowPointers`、`columnIndices`、`values`、`nonZeros`、`get`、`transpose`、`add`、`sub`、`neg`、`mul`、`toDense`、`toEntries`；条目 `[row, column, value]` |
| `IterativeOptions`、`IterativeSolution` | 迭代求解器的选项（`tolerance`、`maxIterations`、`guess`）和结果（`solution`、`iterations`、`error`、`converged`） |
| `LuDecomposition`、`QrDecomposition`、`SingularValueDecomposition`、`EigenDecomposition`、`SymmetricEigenDecomposition`、`SchurDecomposition`、`ComplexVector`、`ComplexMatrix` | 各种分解的结果：`{lower, upper, permutation}`、`{q, r}`、`{u, singularValues, v}`、`{values, vectors}`（复数为 `{re, im}`）、`{values, vectors}`、`{u, t}` |
| `NumberTheory`、`IntegerValue`、`PrimeFactor`、`ExtendedGcd`、`Congruence` | 数论（`math.ntheory`）：`gcd`、`lcm`、`extendedGcd`、`mod`、`modInverse`、`powMod`、`isPrime`、`nextPrime`、`factor`、`totient`、`mobius`、`primitiveRoot`、`legendre`、`jacobi`、`crt`、`fibonacci`、`lucas`、`binomial`、`factorial`、`doubleFactorial`、`bernoulli`、`harmonic`、`permutations`、`combinationsWithRepetition`、`multinomial`、`bell`、`catalan`、`stirlingSecondKind`、`compositions`，以及各个异步版本；整数（bigint，或安全整数范围内的 number）；质因数和它的指数；`extendedGcd` 的结果；`crt` 的结果 |
| `AsyncOptions`、`Value` | 异步运算的选项（`timeout`、`signal`）；需要表达式的地方可以传入的值（表达式、数字、bigint、十进制数、公式） |

类型声明里有每个声明的说明和示例。

## 错误

| 错误 | 什么时候抛出 |
|---|---|
| `MathSyntaxException` | 公式写得不对（带有出错的 `position`），需要表达式的地方给了方程，或者反过来 |
| `MathUnknownFunctionException` | 公式调用的函数既不是内置函数，也没有定义，或者把常数写成了调用（`g(2)`），带有它的 `position` |
| `MathDefinitionException` | 定义无效：用了内置的名字、参数重复、定义之间循环引用、定义嵌套太深 |
| `MathDomainException` | 把复数当成数字取值，取无穷大、`complexInfinity`（除以零；`toNumber()` 里也包括除以一个无法和 0 区分的值）的值，数论函数的参数不在定义域内（`totient(0)`），需要求逆的地方矩阵是奇异的（`solve()`、`inverse()`），`cholesky()` 的矩阵不是正定的，`squareRoot()` 的矩阵的主平方根不是实矩阵或者不存在，Sylvester 或 Lyapunov 方程没有唯一解，或者十进制数不在函数的定义域内（负数开平方、`asin()` 的参数是 2、负数的非整数次幂） |
| `MathDivisionByZeroException` | 计算十进制值时遇到除以零（包括除以一个无法和 0 区分的值、0 的对数、0 的负数次幂、以 1 为底的对数、在函数的极点上求值：`gamma()` 的参数是 -2、`zeta()` 的参数是 1），或者模数是 0 |
| `MathNotSupportedException` | 这个包对这个表达式不做的运算：非线性方程组、无法编译的表达式、嵌套超过 1000 层的表达式、运算中遇到太大而无法精确计算的数、对非整数求 `gcd` 或 `lcm`、数论的结果超过 2^20 位（二进制）、`bernoulli(n)` 和 `bell(n)` 的 n 超过 2000、`harmonic(n)` 的 n 超过 50000、`stirlingSecondKind(n, k)` 的 n 超过 50000 或 n k 超过 6250000、生成代码时遇到目标语言没有的函数、`2i` 这样的复数、和保留字重名的变量、特征值的计算不收敛、求 n 不是整数的 `polygamma(n, x)` 的十进制值、十进制数的指数超出了范围（约 ±10^18，32 位系统上约 ±4.25 × 10^8；例如 `exp()` 的参数是 10^19，`toDecimal()` 里也一样），或者十进制值要比要求的位数多算超过 50000 位（`sin(10^(10^6))`） |
| `MathArgumentException` | 参数无效：需要数字的地方还有变量、名字不是变量、给的值个数不对、需要整数的地方给的不是整数、需要十进制数的地方给的不是十进制数、精度不在 1 到 100000 之间、矩阵或向量的维数不对、稀疏矩阵的结构无效（包括构造之后数组被改动的情况）、对空数组求没有定义的统计量、分布的参数无效、分位数的概率不在 0 到 1 之间、`klDivergence` 的概率是负数 |
| `MathTimeoutException`、`MathCancelledException` | 异步运算超过时限，或者被取消 |
| `MathException` | 以上所有错误的基类；原生插件内部错误时，它的 `errno` 是 `E_MATH_INTERNAL` |

## 另见

- [SymEngine](https://github.com/symengine/symengine)：原生插件所基于的符号计算引擎。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库和它们的许可证。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
