# Lakutata 日志

每个 `lakutata` 应用都有一个日志记录器：由这个包预设的 `log` 组件（`lakutata/com/logger` 中的 `Logger`）。它把可读的日志行，或者供日志收集器读取的 pino 格式的 JSON 行，写到标准输出或其他流中。框架本身也通过它写日志。

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
            //预设的日志记录器的选项：不需要 class
            log: {level: 'info', pretty: process.env.NODE_ENV !== 'production'},
            orders: {class: Orders}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: Orders = await app.getObject<Orders>('orders')
        orders.pay(42, 9.9)
    })
```

- 按名字 `log` 注入它。类型可以写成 `Logger`，也可以写成 `lakutata` 中的 `ILogger`，这是应用的所有日志记录器都实现的接口。
- 应用的处理函数（`onLaunched`、`onDone`、`onUncaughtException`、`onFatalException`）的第二个参数就是它（见 [Application](Application.md) 第 2 节）。
- 它的选项写在 `components` 的 `log` 中，不需要 `class`（第 4 节）。

## 2. 写一行日志

| 方法 | 级别 | 用于 |
|---|---|---|
| `fatal()` | 60 | 应用无法继续运行的故障；只有 `Logger` 有这个方法，`ILogger` 没有 |
| `error()` | 50 | 需要有人处理的故障 |
| `warn()` | 40 | 应用能够恢复的意外情况 |
| `info()` | 30 | 应用的正常运行 |
| `debug()` | 20 | 调试用的细节 |
| `trace()` | 10 | 比调试更细的跟踪信息 |

每个方法先接受一个可选的对象，它的属性会加到这一行中，然后是消息，最后是消息中占位符的值：

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
- 错误写在 `err` 下：它的类型；它的消息，后面跟着它的原因的消息；它的调用栈，后面跟着原因的调用栈；以及它自己的属性（比如异常的 `errno` 和 `statusCode`）。
- HTTP 请求写在 `req` 下（方法、URL、请求头、远端地址），HTTP 响应写在 `res` 下。它们的 `Authorization`、`Cookie`、`Set-Cookie` 和 `Proxy-Authorization` 请求头写成 `[Redacted]`。
- 除此之外不会隐去任何内容，也没有子日志记录器：只记录需要的字段，不要记录令牌，也不要记录包含令牌的整个对象；上下文（比如请求 id）放在每次调用的对象中。

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

默认情况下（`pretty: true`），日志行是可读的：本地时区的时间、级别、应用的名字、进程 id、消息，然后每个属性缩进一行：

```text
[13:45:04.246] INFO (Shop/24297): order 42 paid: 9.90
    orderId: 42
```

设置 `pretty: false` 时，每一行是一个 JSON 对象，格式与 pino 相同：`level`、`time`（自纪元起的毫秒数）、`pid`、`hostname`、`name`（应用的名字）、对象的属性，以及 `msg`。日志收集器读取这种格式；生产环境请使用它。

```text
{"level":30,"time":1792215904479,"pid":24300,"hostname":"api-1","name":"Shop","orderId":42,"msg":"order 42 paid: 9.90"}
```

## 4. 选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `level` | `'trace'` | 写出的最低级别：`'trace'`、`'debug'`、`'info'`、`'warn'`、`'error'`、`'fatal'`（只写 `fatal()` 的日志）或 `'silent'`（什么都不写） |
| `pretty` | `true` | 写可读的行；`false` 写 JSON 行 |
| `colorize` | 在终端中时 | 给写到标准输出的可读行加上颜色 |
| `destinations` | `[process.stdout]` | 接收日志行的流（第 5 节） |
| `sync` | `false` | 每一行立即写出，而不是成批写出（第 6 节） |
| `redactedHeaders` | `['authorization', 'cookie', 'set-cookie', 'proxy-authorization']` | 写成 `[Redacted]` 的请求头；这个列表会替换默认列表，`[]` 表示不隐去任何请求头 |

默认情况下，只有标准输出是终端、并且没有设置环境变量 `NO_COLOR` 时，可读行才带颜色：重定向到文件或者被日志收集器读取的标准输出不会包含颜色控制码。设置 `colorize: true` 时总是加上颜色。

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

- 日志记录器不会关闭这些流，也不会轮转文件：交给系统处理（logrotate、容器的日志收集器）。
- 标准输出被协议占用的应用（基于 stdio 的 JSON-RPC、基于 stdio 的 MCP）要把日志写到标准错误：`log: {class: Logger, destinations: [process.stderr]}`（见 [ServiceCalls](ServiceCalls.md) 第 4 节）。

## 6. 缓冲

日志行成批写出：在事件循环的下一轮，或者等待写出的内容达到 16 KB 时。进程退出时，以及日志记录器被销毁时，等待中的行也会写出。

- `sync: true` 让每一行立即写出。
- `flush()` 立即写出等待中的行，比如在调用 `process.exit()` 之前。
- `fatal()` 立即写出它自己的行和等待中的行。
- 标准输出、标准错误和文件是同步写入的，所以日志行保持原来的顺序。

## 7. 换用其他日志记录器

`log` 组件可以换成你自己的类：一个实现了 `ILogger` 的组件，用 `class` 声明。之后框架和应用的处理函数都通过它写日志。

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
