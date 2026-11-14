# Lakutata 异常

`lakutata` 中的 `Exception` 是框架所有错误的基类，也是应用自定义异常的基类。异常带有一个供客户端和日志识别的错误码（`errno`）、一条由模板生成的消息，以及错误对应的 HTTP 状态码。动作失败时，传输方式将这些信息发送给客户端。

## 1. 声明异常

继承 `Exception`，设置 `errno`；对于会发送给客户端的错误，还需设置 `statusCode`：

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

异常带有以下属性：

| 属性 | 含义 |
|---|---|
| `errno` | 错误码，可以是字符串（`'E_ORDER_NOT_FOUND'`）或数字 |
| `message`、`errMsg` | 消息；`errMsg` 是其副本，会发送给客户端 |
| `err` | 类名（`'OrderNotFoundException'`） |
| `statusCode` | 错误对应的 HTTP 状态码，默认 500 |
| `appId`、`appName` | 应用的 ID 和名称；异常在应用加载选项之前创建时为 `'Unknown'` |
| `stack` | 调用栈 |

子类自身的属性（例如上例中的 `gateway`）会与其他属性一同发送，并一同写入日志。

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

- 模板从一个对象中取值（`{id}`），或按位置从其后的参数中取值（`{0}`、`{1}`），参数可以逐个给出，也可以放在一个数组中。`util.format()` 的占位符（`%s`、`%d`、`%j`……）使用同样的参数。
- 缺少值时，占位符会保留在消息中。生成消息的过程从不抛出错误。
- 不提供参数时，消息由类名中的单词组成，缩写保持大写（`HTTPRequestException` 生成 `HTTP request exception`）。

## 3. 默认消息与原因

若要为异常设置默认消息，请在构造函数中接收消息参数，再将其传给 `super()`：

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

请勿在字段中设置 `message`。该字段会替换抛出异常时给出的消息；此外，当编译选项 `useDefineForClassFields` 为 `true` 时，`errMsg` 会保留默认消息。`lakutata` 发布的 `tsconfig.json` 将该选项设为 `false`。

`new XxxException(error)` 仅保留另一个错误的消息。若要保留该错误本身，请将其设为 `cause`：

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

日志会在错误之后写出其原因（见[日志](Logger.md)第 2 节）；HTTP 适配器会沿原因链查找状态码，第一个客户端错误（4xx）优先（见 [HTTP](HTTP.md) 第 6 节）。

## 4. 客户端收到什么

动作失败时，各传输方式按以下方式报告异常：

| 传输方式 | 客户端收到 |
|---|---|
| HTTP | 状态码 `statusCode` 和 `{errno, errMsg}`（见 [HTTP](HTTP.md) 第 6 节） |
| Socket.IO、Electron、NW.js、HTTP 服务、NATS、gRPC | 完整的错误，即其所有自身属性（见[服务调用](ServiceCalls.md)第 3 节） |
| JSON-RPC | 一个错误：输入不合法时错误码为 `-32602`，没有匹配的动作时为 `-32601`，应用正在停止时为 `-32001`，其他情况为 `-32000`；完整的错误放在 `data` 中 |
| 命令行 | 标准错误中的 `error: <消息>`，退出码为 1（见[命令行](CLI.md)） |
| 定时任务 | 无客户端，异常交给 `onError`，或写入日志（见[定时任务](Schedules.md)） |

- 选择 `statusCode` 时，应根据客户端能否自行纠正该错误来决定：请求有误时使用 400 到 499（资源不存在时用 404，冲突时用 409），应用自身出错时使用 500 及以上。
- 被 DTO 拒绝的输入会产生 `InvalidValueException`，其状态码为 400，表示客户端错误。

## 5. 翻译与识别异常

使用 `I18nMiddleware` 时，异常的消息会按请求的语言翻译，翻译键为 `errors.<errno>`，参数来自异常的模板（见[国际化（i18n）](I18n.md#异常消息的翻译)中的“异常消息的翻译”一节）。在请求之外，`lakutata` 中的 `exceptionParams(exception)` 返回这些参数。

在应用内部用 `instanceof` 识别异常，跨进程时则用 `errno`，因为客户端收到的是错误的属性，而不是错误的类。HTTP 服务、NATS 和 gRPC 的代理抛出的 `ServiceInvokeException` 带有远端错误的 `errno`。

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

框架会抛出自身定义的异常，最常见的如下：

| 异常 | `errno` | 抛出时机 |
|---|---|---|
| `InvalidValueException` | `E_INVALID_VALUE` | DTO 拒绝了一个值：动作的输入，或对 `validate()` 的调用（400） |
| `InvalidObjectOptionsException` | `E_INVALID_OBJECT_OPTIONS` | 应用启动时，某个对象的选项无效 |
| `DependencyInjectionException` | `E_DEPENDENCY_INJECTION` | 无法创建对象：缺少某个依赖 |
| `AccessDeniedException` | `E_ACCESS_DENY` | 访问控制拒绝了请求（403） |
| `RouteNotFoundException` | `E_ROUTE_NOT_FOUND` | 没有与该路由和方法对应的 HTTP 动作（404） |
| `ControllerActionNotFoundException` | `E_CONTROLLER_ACTION_NOT_FOUND` | 没有动作与服务消息或命令匹配（404） |
| `EntrypointStoppedException` | `E_ENTRYPOINT_STOPPED` | 应用正在停止（503） |
| `ServiceInvokeException` | `E_SERVICE_INVOKE` | 通过代理（HTTP 服务、NATS、gRPC）调用的动作失败；带有远端错误的各个属性 |
| `ServiceUnavailableException` | `E_SERVICE_UNAVAILABLE` | `HTTPServiceProxy` 调用的服务未响应（503） |

每个包的 README 列出了该包自身的异常。未被任何代码捕获的异常，以及导致应用启动失败的异常，会交给应用的处理函数（`onUncaughtException`、`onFatalException`，见[应用](Application.md)第 2 节）。
