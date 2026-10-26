# @lakutata/math

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的符号数学包：公式按纸上的写法输入（`x^2 - 5x + 6`、`2(x + 1)`），可以展开、求导、解方程、求值，结果是精确的。计算由基于 [SymEngine](https://github.com/symengine/symengine) 的原生插件完成，原生插件在安装这个包时编译。耗时的运算还可以放到原生插件自己的线程里执行，并且可以设置时限、随时取消。`lakutata` 包没有重新导出这个包，请从 `@lakutata/math` 导入。

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
| `pi`、`e`、`i`、`inf`（或 `oo`）、`nan` | 常数 |
| `sin`、`cos`、`tan`、`asin`、`sinh`……、`exp`、`ln`、`log(x)`（自然对数）、`log(x, b)`、`log10`、`log2`、`sqrt`、`cbrt`、`root(x, n)`、`abs`、`sign`、`floor`、`ceil`、`trunc`、`min`、`max`、`gamma`、`beta`、`erf`、`zeta`、`binomial`、`factorial`…… | 函数 |
| `x^2 = 4` | 方程（`math.equation()` 或 `math.parse()`） |
| `x < 1`、`x >= 0` | 不等式，由 `math.parse()` 读取 |

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

公式给出精确的结果：`0.1 + 0.2` 是 `3/10`，`sin(pi/6)` 是 `1/2`，`sqrt(8)` 是 `2sqrt(2)`。需要数字时：

- `toNumber()` 转成 JavaScript 的数字（值是复数时抛出 `MathDomainException`），`toComplex()` 得到 `{re, im}`。
- `toDecimal(digits)` 得到指定有效位数、正确舍入的字符串（默认位数是组件的 `precision`）。
- `compile(variables)` 把表达式编译成一个以数字为参数的函数，适合反复求值；`batch()` 一次算很多组数据：

```typescript
import type {Math} from '@lakutata/math'

function plot(math: Math): Float64Array {
    const f = math.expression('x^2 + sin(y)').compile(['x', 'y'])
    console.log(f(2, 0))                                                   //4
    return f.batch(Float64Array.of(1, 0, 2, 0, 3, 0))                      //[1, 4, 9]
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

### 异步运算

可能耗时的运算都有异步版本：`expandAsync()`、`simplifyAsync()`、`diffAsync()`、`seriesAsync()`、`solveAsync()`、`toDecimalAsync()`，以及组件的 `solveAsync()`。它们在原生插件自己的线程里执行，不占用 libuv 的线程池：线程数默认是 CPU 核数减一，也可以用环境变量 `LAKUTATA_MATH_THREADS` 指定。选项有 `timeout`（毫秒）和 `signal`（`AbortSignal`）：

- 到了时限，Promise 以 `MathTimeoutException` 拒绝；signal 取消时，以 `MathCancelledException` 拒绝。有检查点的运算（展开、十进制计算、线性方程组）会在下一个检查点停下；其他运算会先算完，线程才空出来。
- 组件限制自己同时执行的运算数（`concurrency`）。组件销毁时会等正在执行的运算结束，最多等 `drainTimeout` 毫秒。

表达式最多嵌套 1000 层：更深的公式会被拒绝（`MathNotSupportedException`），以免运算时栈溢出。

### 打包

`lakutata package` 生成的包、可执行文件和安装程序会带上编译好的原生插件（`build/Release/math.node`），所以要在每个目标平台上先安装这个包，再在那里打包。

## API

| 导出 | 说明 |
|---|---|
| `Math` | 组件：`parse`、`expression`、`equation`、`with`、`solve`、`solveAsync` |
| `buildMathOptions`、`MathConfig` | 在组件配置里声明它，以及它的选项：`definitions`、`precision`、`timeout`、`concurrency`、`drainTimeout` |
| `MathScope`、`MathDefinitions` | `with()` 得到的范围，方法和组件相同；定义（按签名给出的公式） |
| `Expression` | 表达式：`toString`、`toTeX`、`toNumber`、`toComplex`、`toDecimal`、`variables`、`equals`、`add`、`sub`、`mul`、`div`、`pow`、`neg`、`expand`、`simplify`、`diff`、`series`、`substitute`、`evaluate`、`solve`、`compile`，以及各个异步版本 |
| `Equation`、`Inequality`、`InequalityRelation` | 方程（`left`、`right`、`difference`、`substitute`、`solve`、`solveAsync`），不等式（`left`、`right`、`relation`） |
| `Solutions`、`SolutionsKind`、`SolutionInterval`、`SolveOptions` | 方程的解：表达式的数组，带有 `kind`、`intervals` 和 `text`；解的范围 `domain` |
| `SystemSolution`、`SystemEquation` | 方程组的一组解（每个变量对应一个表达式），方程组里的一个方程 |
| `CompiledFunction` | 编译后的表达式：以数字为参数的函数，它的 `variables` 和 `batch` |
| `AsyncOptions`、`Value` | 异步运算的选项（`timeout`、`signal`）；需要表达式的地方可以传入的值（表达式、数字、bigint、公式） |

类型声明里有每个声明的说明和示例。

## 错误

| 错误 | 什么时候抛出 |
|---|---|
| `MathSyntaxException` | 公式写得不对（带有出错的 `position`），需要表达式的地方给了方程，或者反过来 |
| `MathUnknownFunctionException` | 公式调用的函数既不是内置函数，也没有定义（带有它的 `position`） |
| `MathDefinitionException` | 定义无效：用了内置的名字、参数重复、定义之间循环引用、定义嵌套太深 |
| `MathDomainException` | 把复数当成数字取值，或者取无穷大、`complexInfinity`（除以零）的值 |
| `MathDivisionByZeroException` | 计算十进制值时遇到除以零 |
| `MathNotSupportedException` | 这个包对这个表达式不做的运算：非线性方程组、无法编译的表达式、嵌套超过 1000 层的表达式 |
| `MathArgumentException` | 参数无效：需要数字的地方还有变量、名字不是变量、给的值个数不对 |
| `MathTimeoutException`、`MathCancelledException` | 异步运算超过时限，或者被取消 |
| `MathException` | 以上所有错误的基类；原生插件内部错误时，它的 `errno` 是 `E_MATH_INTERNAL` |

## 另见

- [SymEngine](https://github.com/symengine/symengine)：原生插件所基于的符号计算引擎。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库和它们的许可证。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
