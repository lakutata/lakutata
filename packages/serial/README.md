# @lakutata/serial

English | [中文](README.zh-CN.md)

Serial ports for Node.js, part of the [lakutata](https://github.com/lakutata/lakutata) framework. You open a port as a
stream, set its line (speed, data bits, parity, stop bits, flow control), read and set its modem lines, and list the
ports of the system with the ids of their USB adapters. A small native addon does the system's part: termios on Linux
and macOS, the communications API on Windows. The `lakutata` package does not re-export this package: import it from
`@lakutata/serial`.

## Installation

```shell
npm install @lakutata/serial
```

- The addon is compiled during the installation (node-gyp): the machine needs Python 3 and a C++ compiler (Xcode's
  command line tools on macOS, `build-essential` on Linux, Visual Studio's C++ build tools on Windows).
- npm runs the installation script of the package; Bun and pnpm run it only for the dependencies they trust
  (`trustedDependencies` in the `package.json` for Bun, `pnpm approve-builds` for pnpm).
- Node.js `>=18.10.0` or Bun, with `@lakutata/core` (its `Exception` is the base of the package's exception).

## Usage

```typescript
import {listSerialPorts, openSerialPort} from '@lakutata/serial'

for (const info of await listSerialPorts()) console.log(info.path, info.vendorId, info.product)

const port = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200})
port.on('error', (error: Error) => console.error(error))
port.on('data', (data: Buffer) => console.log('received', data))
port.write('AT\r\n')
await port.drain()
await port.close()
```

- `openSerialPort(options)` opens a port and resolves with a `SerialPort`, a `Duplex` stream: what you write is sent
  on the line, and what the line receives is read. Paths: `/dev/ttyUSB0` or `/dev/ttyACM0` on Linux, `/dev/cu.*` on
  macOS (the callout devices, which do not wait for a carrier), `COM3` on Windows.
- A port is exclusive by default: other programs cannot open it while it is open. `exclusive: false` lets them on
  Linux and macOS; Windows always opens ports exclusively.
- `drain()` resolves once the data written are sent on the line. `end()` waits for them before `'finish'`.
- `close()` closes the port once its data are sent. `destroy()` closes it at once and discards the data not sent yet.
- `update(options)` changes the settings of the line after the writes before it are sent. `getSignals()` reads CTS,
  DSR, DCD and RI. `setSignals()` sets DTR and RTS, and sends a break after the writes before it. `flush()` discards
  the data waiting in either direction.
- **Listen for `'error'`.** When the device goes away (an adapter unplugged, a Bluetooth link lost), the stream fails
  with a `SerialException` whose `disconnected` is `true`, even while nothing is read or written. Without an `'error'`
  listener, Node.js ends the process.
- The settings are read back after they are set: a driver that drops one (a parity, a speed it cannot run at) makes
  the opening or the update fail with `'EINVAL'` instead of running with other settings.

### Options

| Option | Default | Values |
|---|---|---|
| `path` | | The path of the port |
| `baudRate` | `9600` | Bits per second: the standard speeds everywhere, other speeds when the system and the adapter take them |
| `dataBits` | `8` | `5`, `6`, `7`, `8` |
| `stopBits` | `1` | `1`, `1.5` (Windows only, with 5 data bits), `2` |
| `parity` | `'none'` | `'none'`, `'even'`, `'odd'`, `'mark'` and `'space'` (Linux and Windows) |
| `flowControl` | `'none'` | `'none'`, `'rts/cts'` and `'dtr/dsr'` (hardware; Linux has no DTR/DSR flow control), `'xon/xoff'` (software) |
| `stallTimeout` | `0` | How long the output may stop moving before a write or a drain fails with `'ETIMEDOUT'`, in milliseconds (0: no limit) |
| `exclusive` | `true` | Keeps the other programs from opening the port |
| `openTimeout` | `30000` | How long the opening may take, in milliseconds |

With `'xon/xoff'`, a received 0x13 byte stops the output: a device that sends binary data, like a printer reporting
its status, needs a hardware flow control. If a printer is set to DTR/DSR and its cable wires its DTR to the CTS of
the computer, `'rts/cts'` works too.

### When the output stops

A device can stop taking data: it holds CTS low, or it is a printer out of paper. Every wait has a bound:

- With a `stallTimeout`, a write or a drain fails with `'ETIMEDOUT'` once the output has not moved for that long.
  The data stay queued.
- `close()` waits while the output moves. Once it has stopped for `stallTimeout` milliseconds (`close({stallTimeout})`,
  10 seconds by default), `close()` discards what is left, closes the port and rejects with `'ETIMEDOUT'`.
- A break waits for the output to be sent first. If the flow control still holds the output after 2 seconds, the
  break fails with `'ETIMEDOUT'`.

Once the last byte is handed to the system, `drain()` and `close()` still wait for the bytes the system cannot report:
the ones in the driver and in the adapter's chip. The wait is the time those bytes take at the speed of the line, for
up to 4 KB on macOS (about 4 seconds at 9600 bits a second, 0.4 seconds at 115200) and up to 1 KB on Linux and
Windows.

### Listing

`listSerialPorts()` gives each port's `path`. For a USB adapter it also gives its `vendorId`, `productId`,
`serialNumber`, `manufacturer` and `product`. On Linux, `stablePath` is its link in `/dev/serial/by-id`, which stays
the same when the adapter is plugged into another socket. Ports are listed from sysfs on Linux, from IOKit on macOS
(the `/dev/cu.*` devices) and from the device manager on Windows.

### How it works

Each open port has a thread of its own, which runs its reads, writes and settings: an open port does not take a
thread of Node.js's pool, so it does not delay file, DNS or crypto work. The thread watches the device while nothing is
read or written, so an unplugged adapter is reported at once on Linux and macOS, and within a second on Windows. The
addon uses Node-API only (no libuv calls), so it runs in Bun and in worker threads.

An open port keeps the process running, like an open socket: close it when you are done. A port still open when its
worker or the process ends is closed, and its data not sent are discarded.

## API

| Export | What it is |
|---|---|
| `openSerialPort(options)` | Opens a port: a `SerialPort` |
| `SerialPort` | An open port, a `Duplex` stream: `path`, `baudRate`, `settings`, `update()`, `getSignals()`, `setSignals()`, `drain()`, `flush()`, `close()` |
| `listSerialPorts()` | The ports of the system, with the ids of their USB devices |
| `SerialPortOptions`, `SerialLineOptions`, `SerialDrainOptions`, `SerialCloseOptions`, `SerialPortInfo`, `SerialSignals`, `SerialSignalOptions` | Their types |
| `SerialException` | The exception of the package (see [Errors](#errors)) |

## Errors

`SerialException` (`errno` `'E_SERIAL'`) is thrown for every failure. Its `code` names the error of the system, and
`disconnected` is `true` when the device is gone:

| `code` | When |
|---|---|
| `'ENOENT'` | No such port |
| `'EBUSY'` | The port is open in another program, or opened exclusively elsewhere |
| `'EACCES'` | The user is not allowed to open it (on Linux, not in its group) |
| `'ENOTTY'` | The path is not a serial port (`/dev/usb/lp0` is a USB printer, not a serial port) |
| `'EINVAL'` | Options it refuses, or a setting the device did not take |
| `'ETIMEDOUT'` | The output stopped moving for too long, or the opening took too long |
| `'EIO'` | The device went away while it was open (`disconnected` is `true`) |
| `'ECANCELED'` | A request to a port that is closed |

## Troubleshooting

- **Linux, permission denied (`'EACCES'`):** add the user to the group of the port: `dialout` on Debian and Ubuntu,
  `uucp` on Arch. Log in again afterwards.
- **Ubuntu 22.04 and Linux Mint 21, no `/dev/ttyUSB0` for a CH340 adapter:** the `brltty` package claims the adapter.
  Remove it, or disable its udev rules.
- **Linux, a new port is busy for a few seconds:** ModemManager probes new ports with AT commands. Tell it to ignore
  the device (`ID_MM_DEVICE_IGNORE` in a udev rule), or stop it.
- **A board resets when the port opens (Arduino, ESP32):** Linux and macOS raise DTR and RTS when a port opens, and
  user code cannot prevent that pulse.
- **Raspberry Pi:** use `/dev/serial0`. `/dev/ttyAMA0` may belong to the Bluetooth chip.
- **Linux, a closing takes up to 30 seconds:** when an adapter holds output it cannot send (flow control), the kernel
  waits for it when the port closes (`closing_wait`, 30 seconds by default). The event loop is not blocked, but the
  promise of `close()` settles only once the kernel lets the port go. Discarding the data does not shorten the wait,
  because the bytes in the adapter's chip are out of reach.
- **Windows, `'EBUSY'` right after a closing:** some drivers release a port a moment after it is closed. Open it again
  after a short delay.
- **macOS:** use the `/dev/cu.*` devices. The `/dev/tty.*` ones are for incoming connections.

## See also

- [`@lakutata/thermal-printer`](../thermal-printer): thermal printers, on a serial port among other connections.
