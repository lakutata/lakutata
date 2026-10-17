# @lakutata/logger

English | [中文](README.zh-CN.md)

The logger component of the lakutata framework. It writes pino's log format (one JSON object per line) or readable
lines, colored on a terminal, to stdout or any writable streams, buffering them for speed and flushing them when the
process exits. The umbrella package `lakutata` presets it as the `log` component of every application (created first,
so the framework logs through it too) and re-exports it as `lakutata/com/logger`.

## Installation

```shell
npm install lakutata
```

It has no optional dependencies.

## Usage

### Configuring the preset logger

Every `lakutata` application already has a logger named `log`. Configure it through the `log` entry of the
application's `components` (no `class` is needed), and get it with `@Inject('log')` or `getObject('log')`; it is a
singleton.

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
                //trace, debug, info, warn, error, fatal or silent
                level: 'info',
                //JSON lines for a log collector
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

| Option | Default | What it does |
|---|---|---|
| `level` | `'trace'` | The lowest level written: `'trace'` (10), `'debug'` (20), `'info'` (30), `'warn'` (40), `'error'` (50), `'fatal'` (60, only `fatal()`) or `'silent'` (nothing) |
| `pretty` | `true` | Readable lines when `true`, pino's JSON lines when `false` |
| `colorize` | on a terminal | Colors the readable lines written to `process.stdout`; by default when it is a terminal and `NO_COLOR` is not set (never the other streams, nor the JSON) |
| `sync` | `false` | Writes each line at once; otherwise the lines are buffered until the next turn of the event loop (or 16 KB) |
| `destinations` | `[process.stdout]` | The writable streams receiving every line; not closed by the logger |
| `redactedHeaders` | `['authorization', 'cookie', 'set-cookie', 'proxy-authorization']` | The headers of a logged request or response written as `[Redacted]` (case-insensitive); the list replaces the default one, `[]` redacts none |

### Logging

Each method (`error`, `warn`, `info`, `debug`, `trace`) takes the same arguments as in pino: an optional object of
properties, then a message with printf-style placeholders, then their values.

```typescript
import {Logger} from 'lakutata/com/logger'

declare const log: Logger

//A message, with placeholders: %s string, %d / %f number, %i integer, %o / %O / %j JSON, %% a percent sign
log.info('user %s signed in from %s', 'alice', '10.0.0.7')
//Properties added to the line, then the message
log.warn({orderId: 42, retries: 3}, 'payment retried %d times', 3)
//An error: written under "err" (type, message, stack, causes, own properties); its message is the default message
log.error(new Error('connection refused'), 'payment failed')
log.debug({query: 'SELECT 1', durationMs: 2.4})
```

The second call writes this JSON line:

```text
{"level":40,"time":1791117611866,"pid":4242,"hostname":"api-1","name":"Shop","orderId":42,"retries":3,"msg":"payment retried 3 times"}
```

or, with `pretty` on (the default), this readable line:

```text
[14:20:11.866] WARN (Shop/4242): payment retried 3 times
    orderId: 42
    retries: 3
```

- **Errors**: an `Error` (or an `err` property) is serialized with its type, its message followed by those of its
  causes, its stack followed by its causes' stacks, its aggregated errors and its own enumerable properties.
- **HTTP**: a request (`IncomingMessage`) is written under `req` (method, URL, query, params, headers, remote address
  and port), and a response under `res` (status code, headers).
- **Redaction**: the values of the `Authorization`, `Cookie`, `Set-Cookie` and `Proxy-Authorization` headers of a
  logged request or response are written as `[Redacted]` (see the `redactedHeaders` option). Nothing else is redacted:
  log the fields you need, not tokens, passwords or whole objects that contain them.
- **Fatal errors**: `fatal()` logs at level 60, above `error`, and writes the pending lines immediately, before the
  process exits.
- **No child loggers**: add the context (such as a request ID) to the object passed to each call.
- **Buffering**: unless `sync` is on, lines are written at the next turn of the event loop. `flush()` writes them
  immediately, and the logger flushes when the process exits or the component is destroyed. Streams with a file
  descriptor (stdout, stderr, a file) are written synchronously, so the lines keep their order.

## API

| Export | What it is |
|---|---|
| `Logger` | The component: `fatal()`, `error()`, `warn()`, `info()`, `debug()`, `trace()`, `flush()`; the options `level`, `pretty`, `colorize`, `sync`, `destinations`, `redactedHeaders` |
| `ILogger` | The interface of the application loggers (from `@lakutata/core`): the five log methods `error()` to `trace()` (not `fatal()`, which only `Logger` has) |
| `ILogMethod` | The signatures of a log method: `(obj, msg?, ...args)` or `(msg, ...args)` |

All of them are exported by `lakutata/com/logger` and `@lakutata/logger`. The typings document each declaration with
examples.

## Errors

| Exception | When |
|---|---|
| `InvalidObjectOptionsException` (from `lakutata`) | The application starts with invalid logger options: an unknown `level`, a destination that is not a stream (a logger created without this check, by a bare `Container` for example, throws `InvalidValueException` instead) |

A log method never throws because of what it logs: values that cannot be serialized (functions, symbols) are left
out, and circular references are replaced.

## See also

- `doc/en/Logger.md` in the `lakutata` package (Chinese in `doc/zh`): the logger guide.
- `doc/en/Application.md` in the same place: components and the application lifecycle.
- `@lakutata/core` (`lakutata`): `Application`, components, and the console logger of the core package.
- `@lakutata/monitor` (`lakutata/com/monitor`): the process monitors, whose statistics the logger can report.
