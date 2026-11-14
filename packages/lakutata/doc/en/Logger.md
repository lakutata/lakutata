# Lakutata Logging

Every `lakutata` application has a logger: the `log` component, preset by the package (`Logger`, from
`lakutata/com/logger`). It writes readable lines, or pino JSON lines for a log collector, to standard output or to other
streams. The framework also logs through it.

## 1. The `log` component

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
            //The options of the preset logger: no class needed
            log: {level: 'info', pretty: process.env.NODE_ENV !== 'production'},
            orders: {class: Orders}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: Orders = await app.getObject<Orders>('orders')
        orders.pay(42, 9.9)
    })
```

- Inject it by its name, `log`. Type it as `Logger`, or as `ILogger` (from `lakutata`), the interface that every
  application logger implements.
- The application's handlers (`onLaunched`, `onDone`, `onUncaughtException`, `onFatalException`) receive it as
  their second argument (see [Application](Application.md), section 2).
- Its options go into the `log` entry of `components`, without `class` (section 4).

## 2. Writing a line

| Method | Level | For |
|---|---|---|
| `fatal()` | 60 | A failure after which the application cannot continue; only `Logger` has it, not `ILogger` |
| `error()` | 50 | A failure that someone must act on |
| `warn()` | 40 | An unexpected event the application recovers from |
| `info()` | 30 | The application's normal operation |
| `debug()` | 20 | Details for debugging |
| `trace()` | 10 | Finer details |

Each method takes an optional object, whose properties are added to the line, then a message, then values for its
placeholders:

```typescript
import {Logger} from 'lakutata/com/logger'

declare const log: Logger

//%s string, %d and %f number, %i integer, %o, %O and %j JSON, %% a percent sign
log.info('user %s signed in from %s', 'alice', '10.0.0.7')
//The properties of the object are added to the line
log.warn({orderId: 42, retries: 3}, 'payment retried %d times', 3)
//An error: written under "err"; its message is the message of the line when none is given
log.error(new Error('connection refused'), 'payment failed')
```

- A value without a placeholder is dropped: `log.info('done', 42)` writes `done`.
- An error is written under `err`: its type, its message followed by the messages of its causes, its stack followed by
  the stacks of its causes, and its own properties (such as an exception's `errno` and `statusCode`).
- An HTTP request is written under `req` (method, URL, headers, remote address), an HTTP response under `res`. Their
  `Authorization`, `Cookie`, `Set-Cookie` and `Proxy-Authorization` headers are written as `[Redacted]`.
- Nothing else is redacted, and there are no child loggers: log the fields you need, not tokens or whole objects that
  hold them, and provide the context (a request ID) in the object passed with each call.

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

## 3. Readable lines or JSON

By default (`pretty: true`), lines are readable, with the time in the local time zone, the level, the application
name, its process ID, the message, then one indented line per property:

```text
[13:45:04.246] INFO (Shop/24297): order 42 paid: 9.90
    orderId: 42
```

With `pretty: false`, each line is a JSON object in pino's format: `level`, `time` (milliseconds since the epoch),
`pid`, `hostname`, `name` (the application name), the object's properties, and `msg`. A log
collector reads these lines; use them in production.

```text
{"level":30,"time":1792215904479,"pid":24300,"hostname":"api-1","name":"Shop","orderId":42,"msg":"order 42 paid: 9.90"}
```

## 4. Options

| Option | Default | Meaning |
|---|---|---|
| `level` | `'trace'` | The lowest level written: `'trace'`, `'debug'`, `'info'`, `'warn'`, `'error'`, `'fatal'` (only lines written by `fatal()`) or `'silent'` (nothing) |
| `pretty` | `true` | Readable lines; `false` writes JSON lines |
| `colorize` | on a terminal | Colors readable lines written to standard output |
| `destinations` | `[process.stdout]` | The streams that receive the lines (section 5) |
| `sync` | `false` | Writes each line immediately, instead of in batches (section 6) |
| `redactedHeaders` | `['authorization', 'cookie', 'set-cookie', 'proxy-authorization']` | The headers written as `[Redacted]`; the list replaces the default list, and `[]` redacts none |

By default, readable lines are colored when standard output is a terminal and the `NO_COLOR` environment variable is
not set, so standard output redirected to a file or read by a collector receives no escape codes.
`colorize: true` colors it in any case.

## 5. Destinations

Each stream in `destinations` receives every line:

```typescript
import {createWriteStream} from 'node:fs'
import {Application} from 'lakutata'

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        log: {
            pretty: false,
            //The standard output, and a file the lines are appended to
            destinations: [process.stdout, createWriteStream('shop.log', {flags: 'a'})]
        }
    }
}))
```

- The logger does not close the streams, and does not rotate the files: leave that to the system (logrotate, the
  container log collector).
- An application whose standard output belongs to a protocol (JSON-RPC over stdio, MCP over stdio) writes its logs to
  standard error: `log: {class: Logger, destinations: [process.stderr]}` (see [Service Calls](ServiceCalls.md),
  section 4).

## 6. Buffering

Lines are written in batches: at the next turn of the event loop, or once 16 KB are waiting. Waiting lines are also
written when the process exits and when the logger is destroyed.

- `sync: true` writes each line immediately.
- `flush()` writes the waiting lines now, such as before a `process.exit()`.
- `fatal()` writes its line and the waiting ones immediately.
- Standard output, standard error and files are written synchronously, so lines keep their order.

## 7. Another logger

The `log` component can be replaced by a custom class: a component that implements `ILogger`, declared with `class`.
The framework and the application's handlers then log through it.

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
