# Lakutata Logging

Every application of `lakutata` has a logger: the `log` component, preset by the package (`Logger`, from
`lakutata/com/logger`). It writes readable lines, or the JSON lines of pino for a log collector, to the standard output
or to other streams. The framework logs through it too.

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
  logger of an application implements.
- The handlers of the application (`onLaunched`, `onDone`, `onUncaughtException`, `onFatalException`) receive it as
  their second argument (see [Core](Core.md), section 5).
- Its options go into the `log` entry of `components`, without `class` (section 4).

## 2. Writing a line

| Method | Level | For |
|---|---|---|
| `fatal()` | 60 | A failure the application cannot go on after; only `Logger` has it, not `ILogger` |
| `error()` | 50 | A failure that someone must act on |
| `warn()` | 40 | An unexpected event the application recovers from |
| `info()` | 30 | The normal course of the application |
| `debug()` | 20 | The details for debugging |
| `trace()` | 10 | Finer details |

Each method takes an optional object, whose properties are added to the line, then a message, then the values of its
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
  the stacks of its causes, and its own properties (such as the `errno` and `statusCode` of an exception).
- An HTTP request is written under `req` (method, URL, headers, remote address), an HTTP response under `res`. Their
  `Authorization`, `Cookie`, `Set-Cookie` and `Proxy-Authorization` headers are written as `[Redacted]`.
- Nothing else is redacted, and there are no child loggers: log the fields you need, not tokens or whole objects that
  hold them, and give the context (a request id) in the object of each call.

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

By default (`pretty: true`), the lines are readable, with the time in the local time zone, the level, the name of the
application, its process id, the message, then one indented line per property:

```text
[13:45:04.246] INFO (Shop/24297): order 42 paid: 9.90
    orderId: 42
```

With `pretty: false`, each line is a JSON object, in the format of pino: `level`, `time` (milliseconds since the
epoch), `pid`, `hostname`, `name` (the name of the application), the properties of the object, and `msg`. A log
collector reads these lines; use them in production.

```text
{"level":30,"time":1792215904479,"pid":24300,"hostname":"api-1","name":"Shop","orderId":42,"msg":"order 42 paid: 9.90"}
```

## 4. Options

| Option | Default | Meaning |
|---|---|---|
| `level` | `'trace'` | The lowest level written: `'trace'`, `'debug'`, `'info'`, `'warn'`, `'error'`, `'fatal'` (only the lines of `fatal()`) or `'silent'` (nothing) |
| `pretty` | `true` | Readable lines; `false` writes the JSON lines |
| `colorize` | `true` | Colors the readable lines written to the standard output |
| `destinations` | `[process.stdout]` | The streams that receive the lines (section 5) |
| `sync` | `false` | Writes each line at once, instead of in batches (section 6) |
| `redactedHeaders` | `['authorization', 'cookie', 'set-cookie', 'proxy-authorization']` | The headers written as `[Redacted]`; the list replaces the default one, and `[]` redacts none |

`colorize` colors the standard output even when it is redirected to a file: set it to `false` then, or write JSON
lines.

## 5. Destinations

Each stream of `destinations` receives every line:

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
  collector of the containers).
- An application whose standard output belongs to a protocol (JSON-RPC over stdio, MCP over stdio) writes its logs to
  the standard error: `log: {class: Logger, destinations: [process.stderr]}` (see [ServiceCalls](ServiceCalls.md),
  section 4).

## 6. Buffering

The lines are written in batches: at the next turn of the event loop, or once 16 KB are waiting. The waiting lines are
also written when the process exits and when the logger is destroyed.

- `sync: true` writes each line at once.
- `flush()` writes the waiting lines now, such as before a `process.exit()`.
- `fatal()` writes its line and the waiting ones at once.
- The standard output, the standard error and the files are written synchronously, so the lines keep their order.

## 7. Another logger

The `log` component can be replaced by a class of your own: a component that implements `ILogger`, declared with
`class`. The framework and the handlers of the application then log through it.

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
