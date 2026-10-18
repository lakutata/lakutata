# Lakutata 异常

`lakutata` 中的 `Exception` 是框架所有错误的基类，也是应用自己的异常的基类。异常带有一个供客户端和日志识别的错误码（`errno`）、一条由模板生成的消息，以及错误对应的 HTTP 状态码。动作失败时，传输方式把这些信息发给客户端。

## 1. 声明异常

继承 `Exception`，设置 `errno`；对于会发给客户端的错误，再设置 `statusCode`：

```typescript
import {Exception} from 'lakutata'

export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public readonly statusCode: number = 404
}

export class PaymentFailedException extends Exception {
    public errno: string = 'E_PAYMENT_FAILED'

    public readonly statusCode: number = 502

    //自己的属性：随错误一起发送，也一起写入日志
    public readonly gateway: string = 'stripe'
}

export function findOrder(id: number): never {
    throw new OrderNotFoundException('Order {id} not found', {id: id})
}
```

异常带有这些属性：

| 属性 | 是什么 |
|---|---|
| `errno` | 错误码，可以是字符串（`'E_ORDER_NOT_FOUND'`）或数字 |
| `message`、`errMsg` | 消息；`errMsg` 是它的副本，会发给客户端 |
| `err` | 类名（`'OrderNotFoundException'`） |
| `statusCode` | 错误对应的 HTTP 状态码，默认 500 |
| `appId`、`appName` | 应用的 id 和名字；异常在应用加载选项之前创建时为 `'Unknown'` |
| `stack` | 调用栈 |

子类自己的属性，比如上面的 `gateway`，会和其他属性一起发送、一起写入日志。

## 2. 消息

构造函数的参数决定消息：

| 创建方式 | 消息 |
|---|---|
| `new OrderNotFoundException('Order {id} not found', {id: 7})` | `Order 7 not found` |
| `new OrderNotFoundException('Order {0} of {1} not found', 7, 'ada')` | `Order 7 of ada not found` |
| `new OrderNotFoundException('Order {0} of {1} not found', [7, 'ada'])` | `Order 7 of ada not found` |
| `new OrderNotFoundException('Order {0} not found', 7)` | `Order 7 not found` |
| `new OrderNotFoundException('Order %d not found (%s)', 7, 'archived')` | `Order 7 not found (archived)` |
| `new OrderNotFoundException('Order {id} of {owner} not found', {id: 7})` | `Order 7 of {owner} not found` |
| `new OrderNotFoundException('Order not found')` | `Order not found` |
| `new OrderNotFoundException(new Error('timeout'))` | `timeout` |
| `new OrderNotFoundException()` | `Order not found exception` |

- 模板从一个对象中取值（`{id}`），或者按位置从它后面的参数中取值（`{0}`、`{1}`），参数可以逐个给出，也可以放在一个数组里。`util.format()` 的占位符（`%s`、`%d`、`%j`……）使用同样的参数。
- 缺少的值会让占位符保留在消息中。生成消息从不抛出错误。
- 不给参数时，消息由类名中的单词组成，缩写保持大写（`HTTPRequestException` 得到 `HTTP request exception`）。

## 3. 默认消息与原因

要给异常一个默认消息，就在构造函数中接收它，再传给 `super()`：

```typescript
import {Exception} from 'lakutata'

export class QuotaExceededException extends Exception {
    public errno: string = 'E_QUOTA_EXCEEDED'

    public readonly statusCode: number = 429

    constructor(message: string = 'The quota of the month is used up') {
        super(message)
    }
}
```

不要在字段中设置 `message`：这个字段会替换抛出异常时给出的消息；并且在编译选项 `useDefineForClassFields` 为 `true` 时，`errMsg` 会保留默认消息。`lakutata` 发布的 `tsconfig.json` 把这个选项设为 `false`。

`new XxxException(error)` 只保留另一个错误的消息。要保留这个错误本身，把它设为 `cause`：

```typescript
import {Exception} from 'lakutata'

class PaymentFailedException extends Exception {
    public errno: string = 'E_PAYMENT_FAILED'

    public readonly statusCode: number = 502
}

export async function pay(orderId: number, charge: () => Promise<void>): Promise<void> {
    try {
        await charge()
    } catch (error) {
        const failure: PaymentFailedException = new PaymentFailedException('Payment of order {id} failed', {id: orderId})
        failure.cause = error
        throw failure
    }
}
```

日志会在错误之后写出它的原因（见 [Logger](Logger.md) 第 2 节）；HTTP 适配器会沿着原因查找状态码，第一个客户端错误（4xx）优先（见 [HTTP](HTTP.md) 第 6 节）。

## 4. 客户端收到什么

动作失败时，传输方式这样报告异常：

| 传输方式 | 客户端收到 |
|---|---|
| HTTP | 状态码 `statusCode` 和 `{errno, errMsg}`（见 [HTTP](HTTP.md) 第 6 节） |
| Socket.IO、Electron、HTTP 服务、NATS、gRPC | 完整的错误：它所有的自身属性（见 [ServiceCalls](ServiceCalls.md) 第 3 节） |
| JSON-RPC | 一个错误：输入不合法时错误码为 `-32602`，没有匹配的动作时为 `-32601`，应用正在停止时为 `-32001`，其他情况为 `-32000`；完整的错误放在 `data` 中 |
| 命令行 | 标准错误中的 `error: <消息>`，退出码为 1（见 [CLI](CLI.md)） |
| 定时任务 | 没有客户端：异常交给 `onError`，或者写入日志（见 [Schedules](Schedules.md)） |

- 选择 `statusCode` 时看错误出在哪一方：请求有误时用 400 到 499（资源不存在用 404，冲突用 409），应用自身出错时用 500 及以上。
- 被 DTO 拒绝的输入是 `InvalidValueException`，它的状态码是 400，表示客户端的错误。

## 5. 翻译与识别异常

使用 `I18nMiddleware` 时，异常的消息会按请求的语言翻译，翻译的键是 `errors.<errno>`，参数来自异常的模板（见 [I18n](I18n.md) 中的“异常消息的翻译”一节）。在请求之外，`lakutata` 中的 `exceptionParams(exception)` 返回这些参数。

在应用内部用 `instanceof` 识别异常，跨进程时用 `errno`：客户端收到的是错误的属性，而不是它的类。HTTP 服务、NATS 和 gRPC 的代理抛出的 `ServiceInvokeException` 带有远端错误的 `errno`。

```typescript
import {Exception} from 'lakutata'

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

export function isMissingOrder(error: unknown): boolean {
    return error instanceof OrderNotFoundException || (error as { errno?: unknown })?.errno === 'E_ORDER_NOT_FOUND'
}
```

## 6. 框架的异常

框架会抛出自己的异常。最常遇到的有：

| 异常 | `errno` | 什么时候 |
|---|---|---|
| `InvalidValueException` | `E_INVALID_VALUE` | DTO 拒绝了一个值：动作的输入，或者对 `validate()` 的调用（400） |
| `InvalidObjectOptionsException` | `E_INVALID_OBJECT_OPTIONS` | 应用启动时，某个对象的选项无效 |
| `DependencyInjectionException` | `E_DEPENDENCY_INJECTION` | 无法创建对象：缺少某个依赖 |
| `AccessDeniedException` | `E_ACCESS_DENY` | 访问控制拒绝了请求（403） |
| `RouteNotFoundException` | `E_ROUTE_NOT_FOUND` | 没有 HTTP 动作对应这个路由和方法（404） |
| `ControllerActionNotFoundException` | `E_CONTROLLER_ACTION_NOT_FOUND` | 没有动作与服务消息或命令匹配（404） |
| `EntrypointStoppedException` | `E_ENTRYPOINT_STOPPED` | 应用正在停止（503） |
| `ServiceInvokeException` | `E_SERVICE_INVOKE` | 通过代理（HTTP 服务、NATS、gRPC）调用的动作失败；带有远端错误的各个属性 |
| `ServiceUnavailableException` | `E_SERVICE_UNAVAILABLE` | `HTTPServiceProxy` 调用的服务没有给出响应（503） |

每个包的 README 列出了它自己的异常。没有被任何代码捕获的异常，以及导致应用启动失败的异常，会交给应用的处理函数（`onUncaughtException`、`onFatalException`，见 [Application](Application.md) 第 2 节）。
