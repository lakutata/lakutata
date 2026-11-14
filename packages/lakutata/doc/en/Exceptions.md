# Lakutata Exceptions

`Exception`, from `lakutata`, is the base class for the framework's errors and for custom application errors. An
exception has a code (`errno`) by which clients and logs identify the error, a message built from a template, and the
error's HTTP status. Transports send these to clients when an action fails.

## 1. Declaring an exception

Extend `Exception`, set `errno` and, for errors that reach clients, `statusCode`:

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
| `errno` | The error code, a string (`'E_ORDER_NOT_FOUND'`) or a number |
| `message`, `errMsg` | The message; `errMsg` is a copy of it, sent to clients |
| `err` | The class name (`'OrderNotFoundException'`) |
| `statusCode` | The error's HTTP status; 500 by default |
| `appId`, `appName` | The application's ID and name, `'Unknown'` when the exception is created before the application has loaded its options |
| `stack` | The stack trace |

Subclass properties, such as `gateway` above, are sent and logged with the others.

## 2. The message

The constructor's arguments build the message:

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
  `{1}`), passed one by one or as an array. The placeholders of `util.format()` (`%s`, `%d`, `%j`…) take the same
  parameters.
- A missing value leaves its placeholder in the message. Building the message never throws.
- Without arguments, the message consists of the words in the class name; acronyms are kept
  (`HTTPRequestException` becomes `HTTP request exception`).

## 3. A default message and the cause

To define a default message, accept the message as a constructor parameter and pass it to `super()`:

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

Avoid setting `message` in a field: the field would replace the message passed when the exception is thrown, and with
the compiler option `useDefineForClassFields` set to `true`, `errMsg` would keep the default message. The
`tsconfig.json` published by `lakutata` sets that option to `false`.

`new XxxException(error)` keeps only the error's message. To keep the error itself, set it as the `cause`:

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

The logger writes the causes after the error (see [Logging](Logger.md), section 2), and the HTTP adapters read the
status along the cause chain: the first client error (4xx) found takes precedence (see [HTTP](HTTP.md), section 6).

## 4. What the clients receive

When an action fails, its transport reports the exception:

| Transport | The client receives |
|---|---|
| HTTP | The status `statusCode` and `{errno, errMsg}` (see [HTTP](HTTP.md), section 6) |
| Socket.IO, Electron, NW.js, the HTTP service, NATS, gRPC | The whole error, with all its own properties (see [Service Calls](ServiceCalls.md), section 3) |
| JSON-RPC | An error with the code `-32602` for invalid input, `-32601` when no action matches, `-32001` while the application is stopping, `-32000` otherwise, and the whole error as its `data` |
| The command line | `error: <message>` on standard error, and exit code 1 (see [Command Line](CLI.md)) |
| Schedules | No client: the exception is passed to `onError`, or logged (see [Scheduled Jobs](Schedules.md)) |

- Choose `statusCode` according to what the client can do about the error: 400 to 499 when the request is wrong (404 for
  a missing resource, 409 for a conflict), 500 and above when the application failed.
- Input rejected by its DTO produces an `InvalidValueException`, whose status is 400 (a client error).

## 5. Translating and recognizing an exception

With the `I18nMiddleware`, an exception's message is translated into the request's language, from the key
`errors.<errno>` and its template's parameters (see [Internationalization (i18n)](I18n.md#exception-messages)). Outside
a request, `exceptionParams(exception)`, from `lakutata`, returns those parameters.

To recognize an exception, use `instanceof` within the application, and `errno` across processes, because clients
receive an error's properties, not its class. HTTP service, NATS and gRPC proxies throw a `ServiceInvokeException` that
carries the remote error's `errno`.

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

The framework throws its own exceptions. The most common ones are:

| Exception | `errno` | When |
|---|---|---|
| `InvalidValueException` | `E_INVALID_VALUE` | A DTO rejects a value: an action's input, a call to `validate()` (400) |
| `InvalidObjectOptionsException` | `E_INVALID_OBJECT_OPTIONS` | An object's options are invalid, when the application launches |
| `DependencyInjectionException` | `E_DEPENDENCY_INJECTION` | An object cannot be created: a dependency is missing |
| `AccessDeniedException` | `E_ACCESS_DENY` | Access control denies a request (403) |
| `RouteNotFoundException` | `E_ROUTE_NOT_FOUND` | No HTTP action has this route and method (404) |
| `ControllerActionNotFoundException` | `E_CONTROLLER_ACTION_NOT_FOUND` | No action matches a service message or a command (404) |
| `EntrypointStoppedException` | `E_ENTRYPOINT_STOPPED` | The application is stopping (503) |
| `ServiceInvokeException` | `E_SERVICE_INVOKE` | An action called through a proxy (HTTP service, NATS, gRPC) failed; it carries the remote error's properties |
| `ServiceUnavailableException` | `E_SERVICE_UNAVAILABLE` | The service called by an `HTTPServiceProxy` did not respond (503) |

Each package's README lists its own exceptions. An exception that nothing catches, and an exception that makes the
launch fail, go to the application's handlers (`onUncaughtException`, `onFatalException`, see
[Application](Application.md), section 2).
