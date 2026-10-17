# Lakutata Exceptions

`Exception`, from `lakutata`, is the base class of the errors of the framework, and of the application's own. An
exception has a code (`errno`) that the clients and the logs identify the error by, a message built from a template, and
the HTTP status of the error. The transports send these to the clients when an action fails.

## 1. Declaring an exception

Extend `Exception`, set `errno` and, for the errors that reach the clients, `statusCode`:

```typescript
import {Exception} from 'lakutata'

export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public readonly statusCode: number = 404
}

export class PaymentFailedException extends Exception {
    public errno: string = 'E_PAYMENT_FAILED'

    public readonly statusCode: number = 502

    //A property of its own: sent and logged with the error
    public readonly gateway: string = 'stripe'
}

export function findOrder(id: number): never {
    throw new OrderNotFoundException('Order {id} not found', {id: id})
}
```

An exception carries:

| Property | What it is |
|---|---|
| `errno` | The code of the error, a string (`'E_ORDER_NOT_FOUND'`) or a number |
| `message`, `errMsg` | The message; `errMsg` is a copy of it, sent to the clients |
| `err` | The name of the class (`'OrderNotFoundException'`) |
| `statusCode` | The HTTP status of the error; 500 by default |
| `appId`, `appName` | The id and the name of the application, `'Unknown'` when the exception is created before the application has loaded its options |
| `stack` | The stack trace |

The properties of the subclass, such as `gateway` above, are sent and logged with the others.

## 2. The message

The arguments of the constructor build the message:

| Created with | Message |
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

- A template takes its values from an object (`{id}`), or from the parameters that follow it, by position (`{0}`,
  `{1}`), given one by one or as an array. The placeholders of `util.format()` (`%s`, `%d`, `%j`…) take the same
  parameters.
- A value that is missing leaves its placeholder in the message. Building the message never throws.
- Without arguments, the message is made of the words of the class name; the acronyms are kept
  (`HTTPRequestException` gives `HTTP request exception`).

## 3. A default message and the cause

To give an exception a default message, take it in a constructor and pass it to `super()`:

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

Avoid setting `message` in a field: the field would replace the message given when the exception is thrown, and with
the compiler option `useDefineForClassFields` set to `true`, `errMsg` would keep the default message. The
`tsconfig.json` published by `lakutata` sets that option to `false`.

`new XxxException(error)` keeps only the message of the error. To keep the error itself, set it as the `cause`:

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

The logger writes the causes after the error (see [Logger](Logger.md), section 2), and the HTTP adapters read the status
along the causes: the first client error (4xx) found wins (see [HTTP](HTTP.md), section 6).

## 4. What the clients receive

When an action fails, its transport reports the exception:

| Transport | The client receives |
|---|---|
| HTTP | The status `statusCode` and `{errno, errMsg}` (see [HTTP](HTTP.md), section 6) |
| Socket.IO, Electron, the HTTP service, NATS, gRPC | The whole error: all its own properties (see [ServiceCalls](ServiceCalls.md), section 3) |
| JSON-RPC | An error with the code `-32000` and the whole error as its `data` |
| The command line | `error: <message>` on the standard error, and the exit code 1 (see [CLI](CLI.md)) |
| Schedules | No client: the exception is given to `onError`, or logged (see [Schedules](Schedules.md)) |

- Choose `statusCode` by what the client can do about the error: 400 to 499 when the request is wrong (404 for a
  missing resource, 409 for a conflict), 500 and above when the application failed.
- An input refused by its DTO is an `InvalidValueException`, whose status is 400: an error of the client.

## 5. Translating and recognizing an exception

With the `I18nMiddleware`, the message of an exception is translated into the language of the request, from the key
`errors.<errno>` and the parameters of its template (see
[I18n](I18n.md#exception-messages)). Out of a request, `exceptionParams(exception)`, from `lakutata`, gives
those parameters.

To recognize an exception, use `instanceof` within the application, and `errno` across processes: the clients receive
the properties of an error, not its class. The proxies of NATS and gRPC throw a `ServiceInvokeException` that carries
the `errno` of the remote error.

```typescript
import {Exception} from 'lakutata'

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

export function isMissingOrder(error: unknown): boolean {
    return error instanceof OrderNotFoundException || (error as { errno?: unknown })?.errno === 'E_ORDER_NOT_FOUND'
}
```

## 6. The exceptions of the framework

The framework throws exceptions of its own. The ones met most often:

| Exception | `errno` | When |
|---|---|---|
| `InvalidValueException` | `E_INVALID_VALUE` | A DTO refuses a value: the input of an action, a call to `validate()` (400) |
| `InvalidObjectOptionsException` | `E_INVALID_OBJECT_OPTIONS` | The options of an object are invalid, when the application starts |
| `DependencyInjectionException` | `E_DEPENDENCY_INJECTION` | An object cannot be created: a dependency is missing |
| `AccessDeniedException` | `E_ACCESS_DENY` | The access control refuses a request (403) |
| `RouteNotFoundException` | `E_ROUTE_NOT_FOUND` | No HTTP action has this route and method (404) |
| `ControllerActionNotFoundException` | `E_CONTROLLER_ACTION_NOT_FOUND` | No action matches a service message or a command (404) |
| `EntrypointStoppedException` | `E_ENTRYPOINT_STOPPED` | The application is stopping (503) |
| `ServiceInvokeException` | `E_SERVICE_INVOKE` | A call through a proxy of NATS or gRPC failed |

The README of each package lists its own exceptions. An exception that nothing catches, and an exception that stops the
launch of the application, go to its handlers (`onUncaughtException`, `onFatalException`, see
[Application](Application.md), section 2).
