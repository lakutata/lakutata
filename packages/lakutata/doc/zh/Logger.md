# Lakutata 日志

每个 `lakutata` 应用都有一个日志记录器，即由该包预置的 `log` 组件（`lakutata/com/logger` 中的 `Logger`）。它将可读的日志行，或供日志收集器读取的 pino 格式 JSON 行，写入标准输出或其他流。框架本身也通过它写入日志。

## 1. `log` 组件

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Logger} from 'lakutata/com/logger'

class Orders extends Component {
    @Inject('log')
    protected readonly log: Logger

    public pay(orderId: number, amount: number): void {
        this.log.info({orderId: orderId}, 'order %d paid: %s', orderId, amount.toFixed(2))
    }
}

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            //预置的日志记录器的选项：不需要 class
            log: {level: 'info', pretty: process.env.NODE_ENV !== 'production'},
            orders: {class: Orders}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: Orders = await app.getObject<Orders>('orders')
        orders.pay(42, 9.9)
    })
```

- 按名称 `log` 注入该组件。其类型可以声明为 `Logger`，也可以声明为 `lakutata` 中的 `ILogger`，即应用的所有日志记录器都实现的接口。
- 应用的处理函数（`onLaunched`、`onDone`、`onUncaughtException`、`onFatalException`）的第二个参数即为该组件（见[应用](Application.md)第 2 节）。
- 其选项写在 `components` 的 `log` 条目中，无需 `class`（第 4 节）。

## 2. 写一行日志

| 方法 | 级别 | 用途 |
|---|---|---|
| `fatal()` | 60 | 应用无法继续运行的故障；只有 `Logger` 提供该方法，`ILogger` 不提供 |
| `error()` | 50 | 需要有人处理的故障 |
| `warn()` | 40 | 应用能够恢复的意外情况 |
| `info()` | 30 | 应用的正常运行 |
| `debug()` | 20 | 调试用的细节 |
| `trace()` | 10 | 比调试更细的跟踪信息 |

每个方法依次接受一个可选的对象（其属性会添加到该行中）、消息，以及消息中占位符的值：

```typescript
import {Logger} from 'lakutata/com/logger'

declare const log: Logger

//%s 字符串，%d 和 %f 数字，%i 整数，%o、%O 和 %j JSON，%% 百分号
log.info('user %s signed in from %s', 'alice', '10.0.0.7')
//对象的属性加到这一行中
log.warn({orderId: 42, retries: 3}, 'payment retried %d times', 3)
//错误：写在 "err" 下；没有给出消息时，它的消息就是这一行的消息
log.error(new Error('connection refused'), 'payment failed')
```

- 没有对应占位符的值会被丢弃：`log.info('done', 42)` 只写出 `done`。
- 错误写在 `err` 下，包括：错误的类型；错误的消息，其后是各个原因的消息；调用栈，其后是各个原因的调用栈；以及错误自身的属性（例如异常的 `errno` 和 `statusCode`）。
- HTTP 请求写在 `req` 下（方法、URL、请求头、远端地址），HTTP 响应写在 `res` 下。其中的 `Authorization`、`Cookie`、`Set-Cookie` 和 `Proxy-Authorization` 请求头写为 `[Redacted]`。
- 除此之外，日志记录器不会隐去任何内容，也不提供子日志记录器。因此，请只记录所需的字段，不要记录令牌或包含令牌的整个对象；上下文（例如请求 ID）应放在每次调用传入的对象中。

```text
[13:44:12.447] ERROR (Shop/24236): payment failed
    err: {
      "type": "PaymentFailedException",
      "message": "Payment of order 7 failed: socket hang up",
      "stack":
          PaymentFailedException: Payment of order 7 failed
              at pay (file:///app/build/Orders.js:48:17)
          caused by: Error: socket hang up
              at charge (file:///app/build/Gateway.js:12:9)
      "appId": "shop.app",
      "appName": "Shop",
      "statusCode": 502,
      "errMsg": "Payment of order 7 failed",
      "err": "PaymentFailedException",
      "errno": "E_PAYMENT_FAILED"
    }
```

## 3. 可读的行或 JSON

默认情况下（`pretty: true`），日志行为可读格式，依次包含本地时区的时间、级别、应用名称、进程 ID 和消息，其后每个属性各占一行并缩进：

```text
[13:45:04.246] INFO (Shop/24297): order 42 paid: 9.90
    orderId: 42
```

设置 `pretty: false` 时，每一行是一个 JSON 对象，格式与 pino 相同：`level`、`time`（自纪元起的毫秒数）、`pid`、`hostname`、`name`（应用名称）、对象的属性，以及 `msg`。日志收集器读取这种格式，生产环境中请使用该格式。

```text
{"level":30,"time":1792215904479,"pid":24300,"hostname":"api-1","name":"Shop","orderId":42,"msg":"order 42 paid: 9.90"}
```

## 4. 选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `level` | `'trace'` | 写出的最低级别：`'trace'`、`'debug'`、`'info'`、`'warn'`、`'error'`、`'fatal'`（仅写出 `fatal()` 的日志）或 `'silent'`（不写出任何日志） |
| `pretty` | `true` | 写出可读的行；`false` 时写出 JSON 行 |
| `colorize` | 在终端中时 | 为写入标准输出的可读行添加颜色 |
| `destinations` | `[process.stdout]` | 接收日志行的流（第 5 节） |
| `sync` | `false` | 每一行立即写出，而不是成批写出（第 6 节） |
| `redactedHeaders` | `['authorization', 'cookie', 'set-cookie', 'proxy-authorization']` | 写为 `[Redacted]` 的请求头；该列表会替换默认列表，`[]` 表示不隐去任何请求头 |

默认情况下，仅当标准输出是终端且未设置环境变量 `NO_COLOR` 时，可读行才带颜色，因此重定向到文件或被日志收集器读取的标准输出不会包含颜色控制码。设置 `colorize: true` 时始终添加颜色。

## 5. 输出目标

`destinations` 中的每个流都会收到每一行日志：

```typescript
import {createWriteStream} from 'node:fs'
import {Application} from 'lakutata'

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        log: {
            pretty: false,
            //标准输出，以及一个追加写入的文件
            destinations: [process.stdout, createWriteStream('shop.log', {flags: 'a'})]
        }
    }
}))
```

- 日志记录器不会关闭这些流，也不会轮转文件，这些工作应交由系统处理（logrotate、容器的日志收集器）。
- 标准输出被协议占用的应用（基于 stdio 的 JSON-RPC、基于 stdio 的 MCP）应将日志写入标准错误：`log: {class: Logger, destinations: [process.stderr]}`（见[服务调用](ServiceCalls.md)第 4 节）。

## 6. 缓冲

日志行成批写出，时机为事件循环的下一轮，或待写出的内容达到 16 KB 时。进程退出时以及日志记录器被销毁时，等待中的行也会写出。

- `sync: true` 使每一行立即写出。
- `flush()` 立即写出等待中的行，例如在调用 `process.exit()` 之前。
- `fatal()` 立即写出其自身的行和等待中的行。
- 标准输出、标准错误和文件是同步写入的，因此日志行保持原有顺序。

## 7. 换用其他日志记录器

`log` 组件可以替换为自定义的类，即一个实现了 `ILogger` 并通过 `class` 声明的组件。替换之后，框架和应用的处理函数都通过该组件写入日志。

```typescript
import {Application, Component, type ILogger} from 'lakutata'

class ConsoleOnlyLogger extends Component implements ILogger {
    public error(...args: unknown[]): void {
        console.error(...args)
    }

    public warn(...args: unknown[]): void {
        console.warn(...args)
    }

    public info(...args: unknown[]): void {
        console.info(...args)
    }

    public debug(...args: unknown[]): void {
        console.debug(...args)
    }

    public trace(...args: unknown[]): void {
        console.debug(...args)
    }
}

Application.run(() => ({
    id: 'tool.app',
    name: 'Tool',
    components: {
        log: {class: ConsoleOnlyLogger}
    }
}))
```
