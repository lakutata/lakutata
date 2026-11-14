# Lakutata 数学计算

`@lakutata/math` 包在 Node.js 中提供符号计算与数值计算：公式的代数与微积分运算、方程与不等式、任意精度的十进制数、矩阵、统计与概率分布、数值解法、单位、数论。该包不属于 `lakutata`，也不需要应用，在任何位置导入其函数即可调用。该包的主要特点如下：

- **公式按纸上的写法书写**：`x^2 - 5x + 6`、`2(x + 1)`、`5!`、`sin(pi/6)`。结果也采用同样的写法，因此可以重新读入，也可以转换为 TeX 用于显示。
- **结果是精确的**：`0.1 + 0.2` 得到 `3/10`，`sqrt(8)` 得到 `2sqrt(2)`，`x^2 - 2` 的根是 `-sqrt(2)` 和 `sqrt(2)`。只有在需要数值时才计算数值，数值可以是双精度数，也可以是指定位数的十进制数，其中每一位都正确。
- **符号计算和数值计算在同一个包中**：某个运算没有精确结果时（例如某些积分、五次多项式的根），数值方法可以直接使用同一个公式。
- **由原生插件完成计算**：插件基于 SymEngine、Boost、Eigen 和 mpdecimal 构建，是编译后的代码，因此速度很快。耗时的运算在插件自身的线程中执行，可以设置时限，也可以取消，不会阻塞事件循环。

`@lakutata/math` 的 README 介绍了每个函数及其选项；本指南按计算类别逐一说明该包能完成哪些计算，并为每一类给出一个示例。

```bash
npm install @lakutata/math
```

原生插件在安装时编译，因此机器上需要有 Python 3 和支持 C++17 的编译器（各系统需要安装的工具见 README），编译需要半分钟到几分钟。包管理器必须运行该包的安装脚本。npm 会运行安装脚本，并可能提示脚本“not yet covered by allowScripts”（运行 `npm install-scripts approve @lakutata/math` 即可记录允许其运行）。Bun 和 pnpm 只为明确信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 中设置，pnpm 使用 `pnpm approve-builds`）。没有编译好的插件时，加载该包会抛出错误，并说明编译方法。

## 1. 公式和结果

`expression()` 读入一个公式。数字紧接名称或括号时表示相乘（`2x`、`3(x + 1)`），`^` 表示乘方，常数（`pi`、`e`、`i`、`inf`）和函数（`sin`、`ln`、`sqrt`、`gamma`、`erf`、`zeta` 等）均使用通常的名称，完整列表见 README。表达式是不可变的，每个运算都返回一个新的表达式。

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

- `toString()` 返回 `expression()` 能够读回的公式，`toTeX()` 返回该表达式的 TeX 形式（供 KaTeX 或 MathJax 显示）。
- `toNumber()` 返回最接近精确值的双精度数。该结果由精确值的十进制数字算出，因此即使双精度计算已经没有一位有效数字，结果的每一位也都正确。举例来说，`1e30` 作为双精度数并不恰好等于 10^30，`Math.cos(1e30)` 计算的实际上是另一个数的余弦。`toDecimal(digits)` 以字符串形式返回指定位数的有效数字，每一位都正确。
- `substitute({x: 2})` 将变量替换为给定的值，结果仍是精确的。
- `createMath({definitions})` 创建一个范围，范围中的函数和常数以公式写出，可用的函数与包本身相同。公式会展开其中的定义，求导和解方程时都会用到这些定义。包直接导出的函数属于 `math`，即一个没有任何定义的范围。

## 2. 代数和微积分

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

- **多项式和分式**：`expand`、`factor`（在有理数域上分解，变量个数不限）、`cancel`、`together`、`apart`（部分分式）和 `completeSquare`。
- **化简**：`simplify()` 借助对变量的所有取值都成立的恒等式（三角、双曲、指数、嵌套根式）寻找更简短的形式；取决于变量符号的化简一律不做，因此 `sqrt(x^2)` 保持原样。
- **积分**：使用部分分式、积分表、换元、分部积分，以及积分型特殊函数（`Si`、`Ci`、`Shi`、`Chi`、`Ei`、`li` 和菲涅耳积分：`sin(x)/x` 的积分是 `Si(x)`）。每个原函数在返回前都会通过求导验证。定积分在区间内的极点处分段计算；积分无界增长时，结果为 `inf`。
- **极限**采用 Gruntz 算法：可以求双侧或单侧极限，极限点可以是有限点或无穷远，并能处理各类不定式（`0/0`、`1^inf`、`inf - inf` 等）。
- **级数**（`series(variable, point, order)`）、**求和与求积**的闭式（`sum(1/k^2, k, 1, inf)` 等于 `pi^2/6`）、**分段函数**（`piecewise(x^2, x < 0, x)`），以及**拉普拉斯变换**及其逆变换。

这些运算大多提供异步版本（第 11 节）。

## 3. 方程和不等式

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

- 多项式方程会先分解因式，因此根的形式很简单（得到 1、2、3，而非卡尔达诺公式给出的根式）；四次及以下的因式均精确求解，`a x^n + b` 无论次数多少都能精确求解。未指定 `{domain: 'real'}` 时，在复数范围内求解。
- `solve(equations, variables)` 求解线性方程组；有无穷多解时，以自由变量表示其他变量。
- 求解由多项式分式构成的不等式，得到的是实数解，形式为区间与值组成的集合（`MathSet`）。集合可以求并集、交集和补集，也可以判断某个值是否属于该集合。

## 4. 十进制数

`decimal()` 返回一个指定精度的十进制数（默认 32 位有效数字，最多 100000 位），适用于金额，以及需要很多位数字的值。每个运算都对结果正确舍入，恰好位于中间时舍入到偶数。

```typescript
import {decimal, expression} from '@lakutata/math'

console.log(decimal(0.1).add(0.2).toString())                  //0.3
console.log(decimal('19.99').mul(3).toFixed(2))                //59.97
console.log(decimal(1, {precision: 50}).div(7).toString())     //0.14285714285714285714285714285714285714285714285714
console.log(decimal(2, {precision: 40}).sqrt().toString())     //1.41421356237309504880168872420969807857
console.log(expression('gamma(1/3)').toDecimal(40))            //2.678938534707747633655692940974677644129
console.log(expression('e^(pi*sqrt(163))').toDecimal(40))      //262537412640768743.9999999999992500725972
```

- 数字按其书写形式读入（`0.1` 即十分之一，而不是双精度数的二进制值），字符串按十进制数读入（`'19.99'`），bigint 精确读入。
- 除四则运算外，十进制数还支持开方、`exp` 和对数、三角函数和双曲函数、`gamma`、`erf`、`zeta`、`lambertw` 以及取整函数。表达式的 `toDecimal()` 不仅能计算这些函数，还能计算更多特殊函数（`polygamma`、`beta`、`Si`、`Ei` 等）。
- `toDecimal()` 会以更多位数重新计算，直到两次结果一致，因此结果的每一位都正确。例如，`e^(pi*sqrt(163))` 不是整数，尽管其小数点后的前十二位都是 9。

## 5. 矩阵

矩阵分为两种：数值矩阵用于数值计算，表达式矩阵用于精确的线性代数运算。

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

- `matrix()` 将双精度数存放在一个 `Float64Array` 中，`linalg` 使用 Eigen 计算：线性方程组、最小二乘、逆矩阵、行列式、各种分解（LU、QR、SVD、Cholesky、特征值、Schur）、矩阵指数和矩阵平方根、Sylvester 方程和 Lyapunov 方程，以及稀疏矩阵及其直接解法和迭代解法。
- `expressionMatrix()` 的元素是表达式，可用于以下运算：行列式、逆矩阵、方程组、简化行阶梯形、零空间、特征多项式、特征值和特征向量，结果都是精确的，含变量时也是如此。`jacobian()` 返回一组表达式的雅可比矩阵。

## 6. 统计和概率

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

- 一组值的统计量：和（经过舍入误差补偿）、均值、中位数、众数、方差（默认按总体计算，`{normalization: 'unbiased'}` 按样本计算）、分位数、协方差、相关系数、z 分数。
- 24 种概率分布，由 Boost.Math 计算，提供密度、累积分布函数、分位数、各阶矩和抽样。各个库对分布的参数化方式不同，因此这里的参数均按名称给出（`{shape, scale}`）；README 列出了这些参数在 SciPy 中的对应写法。
- `stats.random(seed)` 返回一个随机数生成器（xoshiro256**）。种子相同时，该生成器在任何平台上抽出的均匀随机数和整数都相同。该生成器不适用于密码学用途。

## 7. 数值解法

当方程或积分没有精确解，或者只需要数值时，`numeric` 可以直接使用同样的公式：

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

- `polynomialRoots` 求多项式的全部根，包括复根；`findRoot` 在给定的有根区间内求根，或从初始猜测值出发求根；`solveSystem` 求非线性方程组的一个解。
- `integrate` 采用 QUADPACK 的方法计算定积分（与 SciPy 的 `quad` 相同），积分区间可以是无穷区间，端点或指定点处可以有奇点。
- `solveODE` 求解常微分方程及方程组，采用显式 Runge-Kutta 方法（与 SciPy 的 RK45 相同），刚性方程可以改用 Radau IIA。
- 方法不收敛时不会抛出异常，而是在结果中注明（`converged`、`completed`）。

## 8. 单位和物理常数

```typescript
import {constant, unit} from '@lakutata/math'

console.log(unit('5 cm + 2 inch').toString())                          //10.08 cm
console.log(unit('100 km/h').to('m/s').toString())                     //(250/9) m / s
console.log(unit('20 degC').to('degF').toString())                     //68 degF
console.log(unit('1.5 h').split(['h', 'min']).map(String))             //['1 h', '30 min']
console.log(constant('boltzmann').mul('300 K').to('eV').toDecimal(6))  //0.025852 eV
```

单位表来自 mathjs（共 251 个单位，可加前缀），所有单位的值都是精确的，例如 `1 inch` 恰好等于 `2.54 cm`。量纲不同的值不能相加，也不能互相换算。`constant()` 提供 mathjs 的 52 个物理常数，取值来自 CODATA 2022；`createMath({units})` 可以添加自定义单位。

## 9. 数论和多项式

```typescript
import {ntheory, poly} from '@lakutata/math'

console.log(ntheory.factor(360))                                                  //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
console.log(ntheory.isPrime(2n ** 61n - 1n))                                      //true
console.log(ntheory.convergents(ntheory.continuedFraction('pi', {terms: 4})).map(String)) //['3', '22/7', '333/106', '355/113']
console.log(poly.gcd('x^4 - 1', 'x^6 - 1').toString())                            //x^2 - 1
console.log(poly.discriminant('a*x^2 + b*x + c', 'x').toString())                 //-4a*c + b^2
```

`ntheory` 用于整数（bigint）运算：整除、模运算、中国剩余定理、素数与因数分解、数列与计数、连分数。`poly` 用于多项式运算（变量个数不限）：最大公因式和最小公倍式、结式、判别式以及因式分解。

## 10. 把公式变成函数

需要多次求值的表达式，可以编译为数值函数，或者转换为代码：

```typescript
import {expression} from '@lakutata/math'

const f = expression('x^2 + sin(y)').compile(['x', 'y'])
console.log(f(2, 0))                                      //4
console.log(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0)))   //Float64Array(3) [1, 4, 9]
console.log(expression('x^2 - 5x + 6').toJavaScript())    //Math.pow(x, 2) - 5*x + 6
console.log(expression('sqrt(x^2 + y^2)').toC())          //sqrt(pow(x, 2.0) + pow(y, 2.0))
```

`batch()` 在一次调用中计算多行值。`cse()` 找出多个表达式的公共部分，使得由这些表达式生成的代码中，每个公共部分只计算一次。

## 11. 耗时的运算

运算在 JavaScript 线程中执行，其中一些可能很耗时，例如大幂次的展开、积分、几千位数字的计算、大数的因数分解。运算期间，事件循环只能等待。可能耗时的运算都有异步版本（`expandAsync()`、`simplifyAsync()`、`integrateAsync()`、`solveAsync()`、`toDecimalAsync()` 等，以及 `linalg`、`ntheory`、`poly` 和 `numeric` 中的异步版本），异步版本在原生插件的线程中执行：

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

- 原生插件的线程数为处理器核数减一，或者为环境变量 `LAKUTATA_MATH_THREADS` 指定的数量。这些线程不属于 libuv 的线程池，因此程序的文件读写和 DNS 查询无需等待它们。
- `timeout`（`createMath()` 的选项，也可以在单次调用时指定；默认不限时）到期后，运算以 `MathTimeoutException` 拒绝；通过 `signal` 取消时，运算以 `MathCancelledException` 拒绝。等待空闲线程的时间不计入时限。
- 被取消的运算会在下一个检查点停止，检查点位于运算的各个步骤之间。单个步骤（例如 Eigen 对矩阵的一次分解、SymEngine 的一次求导）会执行到底，线程要到那时才会空闲。也就是说，Promise 在时限到达时即被拒绝，但计算可能还会继续一段时间。
- `concurrency`（`createMath()` 的选项）限制一个范围内同时执行的运算数量，其余运算排队等待。

## 12. 在应用中使用

控制器调用该包的方式与其他代码相同。处理客户端发来的公式时，请使用异步运算，并传入请求的 `signal`，这样客户端断开连接时，运算会被取消。

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

- 该包的异常没有 `statusCode`，因此对于上例中写错的公式，响应是状态码 500 和 `{"errno": "E_MATH_SYNTAX", …}`。若要以状态码 400 响应客户端公式中的错误，请在动作中捕获 `MathException`，再抛出应用自定义的异常（见[异常](Exceptions.md)）；对于原生插件的内部错误 `E_MATH_INTERNAL`，则保持原样。
- 公式的长度无法限制其计算量，例如 `(x + 1)^100000` 就很短。能够限制计算量的是时限。
- 该包的值通过 `toJSON()` 转换为 JSON：表达式、方程、十进制数和带单位的值转换为各自的文本，解转换为文本数组，矩阵转换为其各行。向量是 `Float64Array`，`JSON.stringify()` 会将其写成对象（`{"0": 1, "1": 1}`），因此请发送 `Array.from(vector)`。
- `lakutata package` 生成的单文件包、可执行文件和安装包都包含编译好的原生插件（`build/Release/math.node`）。请在每个目标平台上先安装该包，再在该平台上打包；原生插件的规则同样适用（见[打包](Packaging.md)和[原生插件](NativeAddons.md)）。
- 该包可以在 Node.js `>=18.10.0`、Bun 和 Electron 主进程中运行，后两者直接加载为 Node.js 编译的插件。该包无法在 Electron 渲染进程和浏览器中运行。在 Bun 中，如果在 worker 线程中的插件运算结束前终止该线程，整个进程会因 Node-API 致命错误而退出（这是 Bun 1.4 的缺陷）。

## 13. 验证方式，以及不支持的情况

该包的测试使用约 2500 个用例，将其结果与 SymPy、mpmath（公式、十进制数、单位），NumPy、SciPy（矩阵、统计、概率分布、数值解法），以及 mathjs 和 nerdamer 的结果比较。测试在 macOS（arm64：Node.js 24、Bun 1.4、Electron 44）、Linux（arm64，glibc 和 musl：Node.js 24、Bun 1.4）和 Windows 11（arm64：Node.js 24）上运行。

该包不支持的情况如下，其中有些是有意为之，有些是尚未实现：

- 两类积分会抛出 `MathNotSupportedException`：一类的被积函数是分式，且其分母需要借助代数数才能分解（`1/(x^4 + 1)`）；另一类的原函数无法用初等函数和本包已知的特殊函数表示。这些积分不会以未计算的积分形式保留。定积分可以用 `numeric.integrate()` 计算。
- `solve()` 求解单个方程或线性方程组；非线性方程组请使用 `numeric.solveSystem()`。有无穷多个解的方程（例如 `sin(x) = 0`）不给出解的数组，其 `set` 只描述这些解（`{2pi*n + pi | n integer} or {2pi*n | n integer}`），集合运算也不接受这一集合。
- 不等式两边必须是有理系数的多项式分式。
- 表达式矩阵的精确特征值只能求到四次；数值特征值可用 `linalg.eigen()` 求得。
- 不做任何取决于变量符号的处理：`sqrt(x^2)` 不等于 `abs(x)`，取决于参数符号的极限（`exp(a*x)` 在 `inf` 处的极限）无法求出。
- 精确数最多约有 315000 位，更大的乘方保持乘方形式（`2^(10^7)`）。

## 14. 异常

所有异常都继承自 `MathException`。公式中的错误会通过 `position` 给出出错字符的位置。每种异常的全部情况见该包的 README。

| 异常 | `errno` | 抛出时机 |
|---|---|---|
| `MathSyntaxException` | `E_MATH_SYNTAX` | 公式书写有误；需要表达式时给出了方程，或者需要方程时给出了表达式 |
| `MathUnknownFunctionException` | `E_MATH_UNKNOWN_FUNCTION` | 公式调用了既非内置、也未定义的函数 |
| `MathDefinitionException` | `E_MATH_DEFINITION` | `createMath()` 的定义或单位无效 |
| `MathUnitException` | `E_MATH_UNIT` | 量纲不同的单位相加、比较或换算；使用了未知的单位 |
| `MathDomainException` | `E_MATH_DOMAIN` | 值超出函数的定义域：将复数值作为数取用、对奇异矩阵求逆、极限不存在 |
| `MathDivisionByZeroException` | `E_MATH_DIVISION_BY_ZERO` | 计算十进制值时除以零、模为 0 |
| `MathNotSupportedException` | `E_MATH_NOT_SUPPORTED` | 该包不支持对此公式执行的运算（第 13 节） |
| `MathArgumentException` | `E_MATH_ARGUMENT` | 参数无效：需要数的位置仍有变量、矩阵的维数不正确 |
| `MathTimeoutException`、`MathCancelledException` | `E_MATH_TIMEOUT`、`E_MATH_CANCELLED` | 异步运算超过时限，或被取消 |
| `MathException` | `E_MATH_INTERNAL` | 原生插件的内部错误 |
