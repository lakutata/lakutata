# @lakutata/logger

[English](README.md) | 中文

lakutata 框架的日志组件。它把 pino 格式的日志（每行一个 JSON 对象）或可读的日志行（在终端中带颜色）写到标准输出或任意可写流；它会缓冲日志行来提高速度，并在进程退出时写出缓冲中的行。`lakutata` 包把它预置为每个应用的 `log` 组件（最先创建，所以框架也通过它写日志），并把它重新导出为 `lakutata/com/logger`。

## 安装

```shell
npm install lakutata
```

它没有可选依赖。

## 用法

### 配置预置的日志记录器

每个 `lakutata` 应用都已经有一个名为 `log` 的日志记录器。在应用 `components` 的 `log` 项中配置它（不需要 `class`），用 `@Inject('log')` 或 `getObject('log')` 获取它；它是单例。

```typescript
import {createWriteStream} from 'node:fs'
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Logger} from 'lakutata/com/logger'

class Orders extends Component {
    @Inject('log')
    protected readonly log: Logger

    public pay(orderId: number, amount: number): void {
        this.log.info({orderId: orderId, amount: amount}, 'order %d paid', orderId)
    }
}

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            log: {
                //trace、debug、info、warn、error、fatal 或 silent
                level: 'info',
                //供日志收集器读取的 JSON 行
                pretty: false,
                destinations: [process.stdout, createWriteStream('shop.log', {flags: 'a'})]
            },
            orders: {class: Orders}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: Orders = await app.getObject('orders')
        orders.pay(42, 9.9)
    })
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `level` | `'trace'` | 写出的最低级别：`'trace'`（10）、`'debug'`（20）、`'info'`（30）、`'warn'`（40）、`'error'`（50）、`'fatal'`（60，只写 `fatal()` 的日志）或 `'silent'`（什么都不写） |
| `pretty` | `true` | 为 `true` 时写可读的行，为 `false` 时写 pino 的 JSON 行 |
| `colorize` | 在终端中时 | 给写到 `process.stdout` 的可读行加上颜色；默认只在它是终端且没有设置 `NO_COLOR` 时加颜色（其他流和 JSON 行从不加颜色） |
| `sync` | `false` | 每一行立即写出；否则日志行会缓冲到事件循环的下一轮（或者达到 16 KB） |
| `destinations` | `[process.stdout]` | 接收每一行日志的可写流；日志记录器不会关闭它们 |
| `redactedHeaders` | `['authorization', 'cookie', 'set-cookie', 'proxy-authorization']` | 记录请求或响应时写成 `[Redacted]` 的头（不区分大小写）；这个列表会替换默认列表，`[]` 表示不隐去任何头 |

### 写日志

每个方法（`error`、`warn`、`info`、`debug`、`trace`）的参数和 pino 相同：先是一个可选的属性对象，然后是带 printf 风格占位符的消息，最后是占位符的值。

```typescript
import {Logger} from 'lakutata/com/logger'

declare const log: Logger

//带占位符的消息：%s 字符串，%d / %f 数字，%i 整数，%o / %O / %j JSON，%% 百分号
log.info('user %s signed in from %s', 'alice', '10.0.0.7')
//先是加到这一行中的属性，然后是消息
log.warn({orderId: 42, retries: 3}, 'payment retried %d times', 3)
//错误：写在 "err" 下（类型、消息、调用栈、原因、自身的属性）；它的消息就是默认的消息
log.error(new Error('connection refused'), 'payment failed')
log.debug({query: 'SELECT 1', durationMs: 2.4})
```

第二次调用写出这样一行 JSON：

```text
{"level":40,"time":1791117611866,"pid":4242,"hostname":"api-1","name":"Shop","orderId":42,"retries":3,"msg":"payment retried 3 times"}
```

开启 `pretty` 时（默认开启），写出的是这样的可读行：

```text
[14:20:11.866] WARN (Shop/4242): payment retried 3 times
    orderId: 42
    retries: 3
```

- **错误**：`Error`（或者 `err` 属性）序列化后包含：类型；消息，后面接着各个原因的消息；调用栈，后面接着各个原因的调用栈；聚合的错误；以及它自身的可枚举属性。
- **HTTP**：请求（`IncomingMessage`）写在 `req` 下（方法、URL、查询参数、路由参数、请求头、远端地址和端口），响应写在 `res` 下（状态码、响应头）。
- **隐去**：记录请求或响应时，`Authorization`、`Cookie`、`Set-Cookie` 和 `Proxy-Authorization` 头的值写成 `[Redacted]`（见 `redactedHeaders` 选项）。除此之外不会隐去任何内容：只记录需要的字段，不要记录令牌、密码，也不要记录包含它们的整个对象。
- **致命错误**：`fatal()` 以级别 60 记录（高于 `error`），并在进程退出之前立即写出等待中的行。
- **没有子日志记录器**：把上下文（比如请求 ID）放在每次调用传入的对象中。
- **缓冲**：除非开启了 `sync`，日志行会在事件循环的下一轮写出。`flush()` 立即写出它们；进程退出或组件被销毁时，日志记录器也会写出等待中的行。有文件描述符的流（标准输出、标准错误、文件）是同步写入的，所以日志行保持原来的顺序。

## API

| 导出 | 说明 |
|---|---|
| `Logger` | 组件：`fatal()`、`error()`、`warn()`、`info()`、`debug()`、`trace()`、`flush()`；选项 `level`、`pretty`、`colorize`、`sync`、`destinations`、`redactedHeaders` |
| `ILogger` | 应用的日志记录器都实现的接口（来自 `@lakutata/core`）：从 `error()` 到 `trace()` 这五个日志方法（不包括 `fatal()`，只有 `Logger` 有这个方法） |
| `ILogMethod` | 日志方法的签名：`(obj, msg?, ...args)` 或 `(msg, ...args)` |

以上全部由 `lakutata/com/logger` 和 `@lakutata/logger` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候 |
|---|---|
| `InvalidObjectOptionsException`（来自 `lakutata`） | 应用启动时，日志记录器的选项不合法：未知的 `level`，或者输出目标不是流（不经过这项检查创建的日志记录器，例如在单独的 `Container` 中创建时，抛出的是 `InvalidValueException`） |

日志方法不会因为记录的内容而抛出异常：无法序列化的值（函数、symbol）会被略去，循环引用会被替换。

## 另见

- `lakutata` 包中的 `doc/zh/Logger.md`：日志指南。
- 同一位置的 `doc/zh/Application.md`：组件和应用的生命周期。
- `@lakutata/core`（`lakutata`）：`Application`、组件，以及核心包的控制台日志记录器。
- `@lakutata/monitor`（`lakutata/com/monitor`）：进程的监控器，日志记录器可以把它们的统计写进日志。
