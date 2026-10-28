# Lakutata Math

`@lakutata/math` 包在 Node.js 里做数学计算，符号计算和数值计算都有：公式的代数和微积分运算、方程和不等式、任意精度的十进制数、矩阵、统计和概率分布、数值解法、单位、数论。它不属于 `lakutata`，也不需要应用：在任何地方导入它的函数就能调用。它的特点是：

- **公式按纸上的写法书写**：`x^2 - 5x + 6`、`2(x + 1)`、`5!`、`sin(pi/6)`。结果也用同样的写法给出，所以能再读回来，也能转成 TeX 用于显示。
- **结果是精确的**：`0.1 + 0.2` 是 `3/10`，`sqrt(8)` 是 `2sqrt(2)`，`x^2 - 2` 的根是 `-sqrt(2)` 和 `sqrt(2)`。只有需要数值时才计算数值：可以是双精度数，也可以是指定位数的十进制数，每一位都正确。
- **符号计算和数值计算在同一个包里**：一个运算没有精确结果时（某些积分、五次多项式的根），数值方法可以直接用同一个公式。
- **由原生插件完成计算**：插件基于 SymEngine、Boost、Eigen 和 mpdecimal，是编译好的代码，所以很快。耗时的运算在插件自己的线程里执行，可以设时限、可以取消，不会占住事件循环。

`@lakutata/math` 的 README 介绍了每个函数及其选项；这篇指南按计算的种类，逐一说明这个包能算什么，每类都给出一个例子。

```bash
npm install @lakutata/math
```

原生插件在安装这个包时编译，所以机器上要有 Python 3 和支持 C++17 的编译器（README 列出了各系统需要安装什么），编译要半分钟到几分钟。包管理器必须运行这个包的安装脚本：npm 会运行它，可能会提示这个脚本“not yet covered by allowScripts”（运行 `npm install-scripts approve @lakutata/math` 记录你允许它运行）；Bun 和 pnpm 只为被告知可以信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 里设置，pnpm 用 `pnpm approve-builds`）。没有编译好的插件时，加载这个包会抛出错误，并说明怎样编译。

## 1. 公式和结果

`expression()` 读入一个公式。数字紧挨着名字或括号表示相乘（`2x`、`3(x + 1)`），`^` 表示乘方，常数（`pi`、`e`、`i`、`inf`）和函数（`sin`、`ln`、`sqrt`、`gamma`、`erf`、`zeta` 等）都用通常的名字；完整的列表见 README。表达式本身不会改变：每个运算都得到一个新的表达式。

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

- `toString()` 给出 `expression()` 能读回的公式，`toTeX()` 给出它的 TeX（供 KaTeX 或 MathJax 显示）。
- `toNumber()` 给出最接近的双精度数。它从精确值的十进制数字算出，所以即使双精度计算已经没有一位有效数字，结果的每一位也都是对的：作为双精度数，`1e30` 并不正好是 10^30，`Math.cos(1e30)` 算的其实是另一个数的余弦。`toDecimal(digits)` 以字符串给出指定位数的有效数字，每一位都是对的。
- `substitute({x: 2})` 把变量换成给定的值，结果仍然是精确的。
- `createMath({definitions})` 创建一个范围，其中的函数和常数用公式写出，可用的函数和包本身相同。公式会展开其中的定义：求导和解方程时都会用到它们。包直接导出的函数属于 `math`，这个范围没有任何定义。

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

- **多项式和分式**：`expand`、`factor`（在有理数上分解，变量个数不限）、`cancel`、`together`、`apart`（部分分式）和 `completeSquare`。
- **化简**：`simplify()` 用对变量的所有取值都成立的恒等式（三角、双曲、指数、嵌套根式）寻找更短的形式；取决于变量符号的化简一律不做，所以 `sqrt(x^2)` 保持原样。
- **积分**：用部分分式、积分表、换元、分部积分，以及积分产生的特殊函数（`sin(x)/x` 的积分是 `Si(x)`）。每个原函数返回前都会求导验证。定积分在区间内的极点处分段计算；积分无限增大时结果是 `inf`。
- **极限**用 Gruntz 算法：可以取两侧或一侧的极限，点可以是有限点或无穷远，能处理各种不定式（`0/0`、`1^inf`、`inf - inf` 等）。
- **级数**（`series(variable, point, order)`）、**求和与求积**的闭式（`sum(1/k^2, k, 1, inf)` 是 `pi^2/6`）、**分段函数**（`piecewise(x^2, x < 0, x)`），以及**拉普拉斯变换**及其逆变换。

这些运算大多有异步版本（第 11 节）。

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

- 多项式方程先做因式分解，所以根的形式很简单（得到 1、2、3，而不是卡尔达诺公式的根式）；各个因式在四次以内都精确求解，`a x^n + b` 不论几次都能精确求解。不给 `{domain: 'real'}` 时，解在复数范围内。
- `solve(equations, variables)` 解线性方程组；有无穷多解时，用自由变量表示其他变量。
- 由多项式分式构成的不等式给出它的实数解，形式是区间和值组成的集合（`MathSet`），集合可以求并、交、补，也可以判断某个值是否属于它。

## 4. 十进制数

`decimal()` 得到一个指定精度的十进制数（默认 32 位有效数字，最多 100000 位）：用于金额，或者需要很多位数字的值。每个运算都把结果正确舍入，恰好在中间时舍入到偶数。

```typescript
import {decimal, expression} from '@lakutata/math'

console.log(decimal(0.1).add(0.2).toString())                  //0.3
console.log(decimal('19.99').mul(3).toFixed(2))                //59.97
console.log(decimal(1, {precision: 50}).div(7).toString())     //0.14285714285714285714285714285714285714285714285714
console.log(decimal(2, {precision: 40}).sqrt().toString())     //1.41421356237309504880168872420969807857
console.log(expression('gamma(1/3)').toDecimal(40))            //2.678938534707747633655692940974677644129
console.log(expression('e^(pi*sqrt(163))').toDecimal(40))      //262537412640768743.9999999999992500725972
```

- 数字按它的写法读入（`0.1` 就是十分之一，而不是双精度数的二进制值），字符串按十进制数读入（`'19.99'`），bigint 精确读入。
- 除了四则运算，十进制数还有开方、`exp` 和对数、三角和双曲函数、`gamma`、`erf`、`zeta`、`lambertw` 以及取整函数。表达式的 `toDecimal()` 能计算这些函数，还能计算更多特殊函数（`polygamma`、`beta`、`Si`、`Ei` 等）。
- `toDecimal()` 会用更多位数重新计算，直到两次结果一致，所以它给出的每一位都是对的：`e^(pi*sqrt(163))` 不是整数，尽管它小数点后的前十二位都是 9。

## 5. 矩阵

矩阵有两种：数值矩阵用于计算，表达式矩阵用于精确的线性代数。

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

- `matrix()` 把双精度数存放在一个 `Float64Array` 里，`linalg` 用 Eigen 计算：线性方程组、最小二乘、逆矩阵、行列式、各种分解（LU、QR、SVD、Cholesky、特征值、Schur）、矩阵的指数和平方根、Sylvester 方程和 Lyapunov 方程，以及稀疏矩阵和它的直接解法、迭代解法。
- `expressionMatrix()` 的元素是表达式：行列式、逆矩阵、方程组、简化行阶梯形、零空间、特征多项式、特征值和特征向量，结果都是精确的，含变量时也一样。`jacobian()` 给出一组表达式的雅可比矩阵。

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

- 一组值的统计量：和（补偿了舍入误差）、均值、中位数、众数、方差（默认按总体计算，`{normalization: 'unbiased'}` 按样本计算）、分位数、协方差、相关系数、z 分数。
- 24 种概率分布，由 Boost.Math 计算，有密度、累积分布函数、分位数、各阶矩和抽样。各个库为分布选用的参数不同，所以这里的参数都用名字给出（`{shape, scale}`）；README 列出了它们在 SciPy 中对应的写法。
- `stats.random(seed)` 得到一个随机数生成器（xoshiro256**）：种子相同时，在任何平台上抽出的均匀随机数和整数都相同。它不能用于密码学。

## 7. 数值解法

方程或积分没有精确解，或者只需要数值时，`numeric` 可以直接用同样的公式：

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

- `polynomialRoots` 给出多项式的全部根，包括复根；`findRoot` 在一个有根区间里或者从一个初始猜测出发求根；`solveSystem` 求非线性方程组的一个解。
- `integrate` 用 QUADPACK 的方法计算定积分（和 SciPy 的 `quad` 相同），区间可以是无穷的，端点或指定的点上可以有奇点。
- `solveODE` 解常微分方程和方程组，用显式 Runge-Kutta 方法（和 SciPy 的 RK45 相同），刚性方程可以用 Radau IIA。
- 方法不收敛时不会抛出异常，而是在结果里说明（`converged`、`completed`）。

## 8. 单位和物理常数

```typescript
import {constant, unit} from '@lakutata/math'

console.log(unit('5 cm + 2 inch').toString())                          //10.08 cm
console.log(unit('100 km/h').to('m/s').toString())                     //(250/9) m / s
console.log(unit('20 degC').to('degF').toString())                     //68 degF
console.log(unit('1.5 h').split(['h', 'min']).map(String))             //['1 h', '30 min']
console.log(constant('boltzmann').mul('300 K').to('eV').toDecimal(6))  //0.025852 eV
```

单位表来自 mathjs（251 个单位，可以带前缀），单位的值都是精确的：`1 inch` 正好是 `2.54 cm`。量纲不同的值不能相加，也不能互相换算。`constant()` 给出 mathjs 的 52 个物理常数，取 CODATA 2022 的值；`createMath({units})` 可以添加自己的单位。

## 9. 数论和多项式

```typescript
import {ntheory, poly} from '@lakutata/math'

console.log(ntheory.factor(360))                                                  //[{prime: 2n, exponent: 3}, {prime: 3n, exponent: 2}, {prime: 5n, exponent: 1}]
console.log(ntheory.isPrime(2n ** 61n - 1n))                                      //true
console.log(ntheory.convergents(ntheory.continuedFraction('pi', {terms: 4})).map(String)) //['3', '22/7', '333/106', '355/113']
console.log(poly.gcd('x^4 - 1', 'x^6 - 1').toString())                            //x^2 - 1
console.log(poly.discriminant('a*x^2 + b*x + c', 'x').toString())                 //-4a*c + b^2
```

`ntheory` 处理整数（bigint）：整除、模运算、中国剩余定理、素数和因数分解、数列和计数、连分数。`poly` 处理多项式，变量个数不限：最大公因式和最小公倍式、结式、判别式和因式分解。

## 10. 把公式变成函数

需要多次求值的表达式，可以编译成数值函数，或者写成代码：

```typescript
import {expression} from '@lakutata/math'

const f = expression('x^2 + sin(y)').compile(['x', 'y'])
console.log(f(2, 0))                                      //4
console.log(f.batch(Float64Array.of(1, 0, 2, 0, 3, 0)))   //Float64Array(3) [1, 4, 9]
console.log(expression('x^2 - 5x + 6').toJavaScript())    //Math.pow(x, 2) - 5*x + 6
console.log(expression('sqrt(x^2 + y^2)').toC())          //sqrt(pow(x, 2.0) + pow(y, 2.0))
```

`batch()` 一次调用就算出很多行的值。`cse()` 找出几个表达式共有的部分，这样由它们写出的代码中，每个部分只计算一次。

## 11. 耗时的运算

运算在 JavaScript 线程里执行，其中一些可能很耗时：大的乘方展开、积分、几千位数字、大数的因数分解。运算期间事件循环只能等着。可能耗时的运算都有异步版本（`expandAsync()`、`simplifyAsync()`、`integrateAsync()`、`solveAsync()`、`toDecimalAsync()` 等，以及 `linalg`、`ntheory`、`poly` 和 `numeric` 里的异步版本），它们在原生插件的线程里执行：

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

- 原生插件的线程数是处理器核数减一，或者环境变量 `LAKUTATA_MATH_THREADS` 给出的数。它们不是 libuv 的线程池，所以程序的文件读写和 DNS 查询不用等它们。
- `timeout`（`createMath()` 的选项，也可以在单次调用时给出；默认不限时）到时后，运算以 `MathTimeoutException` 拒绝；`signal` 取消时，以 `MathCancelledException` 拒绝。等待空闲线程的时间不计入时限。
- 被取消的运算会在下一个检查点停下，检查点在运算的各个步骤之间。单个步骤（Eigen 的一次分解、一次很大的乘法）会执行到底，线程要到那时才空出来：Promise 在时限到时就被拒绝，但计算可能还要继续一会儿。
- `concurrency`（`createMath()` 的选项）限制一个范围里同时执行的运算数，其余的运算排队等待。

## 12. 在应用中使用

控制器调用这个包，和其他代码调用它没有区别。处理客户端发来的公式时，请用异步运算，并传入请求的 `signal`：客户端断开时，运算会被取消。

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

- 这个包的异常没有 `statusCode`，所以上面写错的公式得到的响应是状态码 500 和 `{"errno": "E_MATH_SYNTAX", …}`。如果要用 400 回应客户端公式里的错误，请在动作里捕获 `MathException`，再抛出应用自己的异常（见 [Exceptions](Exceptions.md)）；`E_MATH_INTERNAL` 是原生插件的内部错误，保持原样。
- 公式的长度限制不了它的计算量：`(x + 1)^100000` 很短。能限制计算量的是时限。
- 这个包的值通过 `toJSON()` 转成 JSON：表达式、方程、十进制数和带单位的值转成它们的文本，解转成文本数组，矩阵转成它的各行。向量是 `Float64Array`，`JSON.stringify()` 会把它写成对象（`{"0": 1, "1": 1}`）：请发送 `Array.from(vector)`。
- `lakutata package` 打出的单文件包、可执行文件和安装包都带着编译好的原生插件（`build/Release/math.node`）。请在每个目标平台上安装这个包之后再打包；原生插件的规则同样适用（见 [Packaging](Packaging.md) 和 [NativeAddons](NativeAddons.md)）。
- 这个包可以在 Node.js `^22.13.0 || >=24.11.0`、Bun 和 Electron 的主进程中运行，后两者直接加载为 Node.js 编译的插件；不能在 Electron 的渲染进程和浏览器中运行。在 Bun 里，worker 线程里的插件运算还没结束就终止这个线程的话，整个进程会因为 Node-API 的致命错误退出（这是 Bun 1.4 的问题）。

## 13. 验证方式，以及不支持的情况

这个包的测试用大约 2500 个用例，把它的结果和 SymPy、mpmath（公式、十进制数、单位），NumPy、SciPy（矩阵、统计、概率分布、数值解法），以及 mathjs 和 nerdamer 的结果比较；测试在 macOS（arm64：Node.js 24、Bun 1.4、Electron 44）、Linux（arm64，glibc 和 musl：Node.js 24、Bun 1.4）和 Windows 11（arm64：Node.js 24）上运行。

它不支持的情况，有的是有意为之，有的是还没做：

- 分母要借助代数数才能分解的分式的积分（`1/(x^4 + 1)`），以及原函数既不是初等函数、也不是积分产生的特殊函数的积分，会抛出 `MathNotSupportedException`；求不出的积分不会保留成未计算的积分形式。定积分可以用 `numeric.integrate()` 计算。
- `solve()` 解单个方程或线性方程组；非线性方程组请用 `numeric.solveSystem()`。有无穷多个解的方程（如 `sin(x) = 0`）不给出解的数组：它的 `set` 只描述这些解（`{2pi*n + pi | n integer} or {2pi*n | n integer}`），集合的运算也不接受它。
- 不等式两边必须是有理系数的多项式分式。
- 表达式矩阵的精确特征值只能求到四次；数值特征值用 `linalg.eigen()` 求。
- 不做任何取决于变量符号的处理：`sqrt(x^2)` 不等于 `abs(x)`，取决于参数符号的极限（`exp(a*x)` 在 `inf` 处）求不出来。
- 精确数最多约 315000 位：更大的乘方保持乘方的形式（`2^(10^7)`）。

## 14. 异常

所有异常都继承 `MathException`。公式里的错误会给出出错字符的位置 `position`。每种异常的全部情况见这个包的 README。

| 异常 | `errno` | 什么时候 |
|---|---|---|
| `MathSyntaxException` | `E_MATH_SYNTAX` | 公式写得不对；需要表达式的地方给了方程，或者反过来 |
| `MathUnknownFunctionException` | `E_MATH_UNKNOWN_FUNCTION` | 公式调用了一个既不是内置、也没有定义的函数 |
| `MathDefinitionException` | `E_MATH_DEFINITION` | `createMath()` 的定义或单位无效 |
| `MathUnitException` | `E_MATH_UNIT` | 量纲不同的单位相加、比较或换算；未知的单位 |
| `MathDomainException` | `E_MATH_DOMAIN` | 值超出函数的定义域：把复数值当作数取用、对奇异矩阵求逆、极限不存在 |
| `MathDivisionByZeroException` | `E_MATH_DIVISION_BY_ZERO` | 计算十进制值时除以零、模为 0 |
| `MathNotSupportedException` | `E_MATH_NOT_SUPPORTED` | 这个包对这个公式不做的运算（第 13 节） |
| `MathArgumentException` | `E_MATH_ARGUMENT` | 参数无效：需要数的地方还剩下变量、矩阵的维数不对 |
| `MathTimeoutException`、`MathCancelledException` | `E_MATH_TIMEOUT`、`E_MATH_CANCELLED` | 异步运算超过时限，或者被取消 |
| `MathException` | `E_MATH_INTERNAL` | 原生插件的内部错误 |
