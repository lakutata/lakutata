# @lakutata/serial

English | [中文](README.zh-CN.md)

Serial ports for Node.js, part of the [Lakutata](https://github.com/lakutata/lakutata) framework. You open a port as a
stream, set its line (speed, data bits, parity, stop bits, flow control), read and set its modem lines, and list the
system's ports with their USB adapters' IDs. Classic Bluetooth devices (their serial port profile) open by their address
as the same kind of stream. A small native addon does the system's part: termios on Linux and macOS, the communications
API on Windows. The `lakutata` package does not re-export this package: import it from `@lakutata/serial`.

## Installation

```shell
npm install @lakutata/serial
```

- The addon is compiled during the installation (node-gyp): the machine requires Python 3 and a C++ compiler (the Xcode
  Command Line Tools on macOS, `build-essential` on Linux, Visual Studio's C++ build tools on Windows).
- npm runs the package's installation script; Bun and pnpm run it only for dependencies they trust
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
- A port is exclusive by default: other programs cannot open it while it is open. `exclusive: false` allows this on
  Linux and macOS; Windows always opens ports exclusively.
- `drain()` resolves once the written data are sent on the line. `end()` waits for them before `'finish'`.
- `close()` closes the port once its data are sent. `destroy()` closes it immediately and discards unsent data.
- `update(options)` changes the line's settings once the writes issued before it are sent. `getSignals()` reads CTS,
  DSR, DCD and RI. `setSignals()` sets DTR and RTS, and sends a break after the writes issued before it. `flush()`
  discards data waiting in either direction.
- **Listen for `'error'`.** When the device goes away (an adapter unplugged, a Bluetooth link lost), the stream fails
  with a `SerialException` whose `disconnected` is `true`, even while nothing is read or written. Without an `'error'`
  listener, Node.js ends the process.
- The settings are read back after they are set: when a driver drops one (a parity, a speed it cannot run at), opening
  the port or the update fails with `'EINVAL'` instead of running with other settings.

### Options

| Option | Default | Values |
|---|---|---|
| `path` | | The port's path |
| `baudRate` | `9600` | Bits per second: the standard speeds everywhere, other speeds when the system and the adapter support them |
| `dataBits` | `8` | `5`, `6`, `7`, `8` |
| `stopBits` | `1` | `1`, `1.5` (Windows only, with 5 data bits), `2` |
| `parity` | `'none'` | `'none'`, `'even'`, `'odd'`, `'mark'` and `'space'` (Linux and Windows) |
| `flowControl` | `'none'` | `'none'`, `'rts/cts'` and `'dtr/dsr'` (hardware; Linux has no DTR/DSR flow control), `'xon/xoff'` (software) |
| `stallTimeout` | `0` | How long the output may stop moving before a write or a drain fails with `'ETIMEDOUT'`, in milliseconds (0: no limit) |
| `exclusive` | `true` | Prevents other programs from opening the port |
| `openTimeout` | `30000` | How long opening the port may take, in milliseconds |

With `'xon/xoff'`, a received 0x13 byte stops the output: a device that sends binary data, like a printer reporting its
status, requires hardware flow control. If a printer is set to DTR/DSR and its cable wires its DTR to the computer's
CTS, `'rts/cts'` also works.

### When the output stops

A device can stop accepting data: it holds CTS low, or it is a printer out of paper. Every wait has a bound:

- With a `stallTimeout`, a write or a drain fails with `'ETIMEDOUT'` once the output has not moved for that long.
  The data stay queued.
- `close()` waits while the output is moving. Once the output has stopped for `stallTimeout` milliseconds
  (`close({stallTimeout})`, 10 seconds by default), `close()` discards the remaining data, closes the port and rejects
  with `'ETIMEDOUT'`.
- A break waits for the output to be sent first. If flow control still holds the output after 2 seconds, the
  break fails with `'ETIMEDOUT'`.

Once the last byte is handed to the system, `drain()` and `close()` still wait for the bytes the system cannot report:
those in the driver and in the adapter's chip. The wait is the time those bytes take at the line's speed, for
up to 4 KB on macOS (about 4 seconds at 9600 bits a second, 0.4 seconds at 115200) and up to 1 KB on Linux and
Windows.

### Bluetooth

```typescript
import {openBluetoothSerial} from '@lakutata/serial'

const printer = await openBluetoothSerial({address: '00:11:22:33:44:55'})
printer.on('error', (error: Error) => console.error(error))
printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
await printer.close()
```

`openBluetoothSerial()` opens a classic Bluetooth device through its serial port profile (SPP), as a serial port stream.
Pair the device with the system first. Bluetooth Low Energy devices are not supported.

- Linux: the device is reached by an RFCOMM socket, on the specified `channel` (1 by default).
- macOS and Windows: the system creates a serial port for the paired device, and the function opens the one whose
  address matches. On Windows that is the outgoing port.
- The line settings and the modem lines do not apply to a Bluetooth link: the link has its own speed.

### Listing

`listSerialPorts()` returns each port's `path`. For a USB adapter it also returns its `vendorId`, `productId`,
`serialNumber`, `manufacturer` and `product`. For a paired Bluetooth device's port on macOS and Windows, it returns its
`bluetoothAddress`, and its name as `product`. On Linux, `stablePath` is its link in `/dev/serial/by-id`, which stays
the same when the adapter is plugged into another socket. Ports are listed from sysfs on Linux, from IOKit on macOS (the
`/dev/cu.*` devices) and from the device manager on Windows.

### How it works

Each open port has a dedicated thread, which runs its reads, writes and settings: an open port does not occupy a thread
from Node.js's pool, so it does not delay file, DNS or crypto work. The thread watches the device while nothing is read
or written, so an unplugged adapter is reported immediately on Linux and macOS, and within a second on Windows. The
addon uses Node-API only (no libuv calls), so it runs in Bun and in worker threads.

An open port keeps the process running, like an open socket: close it when you are done. A port still open when its
worker or the process ends is closed, and its unsent data are discarded.

## API

| Export | What it is |
|---|---|
| `openSerialPort(options)` | Opens a port: a `SerialPort` |
| `openBluetoothSerial(options)` | Opens a paired Bluetooth device by its address: a `SerialPort` |
| `SerialPort` | An open port, a `Duplex` stream: `path`, `baudRate`, `settings`, `update()`, `getSignals()`, `setSignals()`, `drain()`, `flush()`, `close()` |
| `listSerialPorts()` | The system's ports, with their USB devices' IDs |
| `SerialPortOptions`, `BluetoothSerialOptions`, `SerialLineOptions`, `SerialDrainOptions`, `SerialCloseOptions`, `SerialPortInfo`, `SerialSignals`, `SerialSignalOptions` | Their types |
| `SerialException` | The package's exception (see [Errors](#errors)) |

## Errors

`SerialException` (`errno` `'E_SERIAL'`) is thrown for every failure. Its `code` names the system error, and
`disconnected` is `true` when the device is gone:

| `code` | When |
|---|---|
| `'ENOENT'` | No such port |
| `'EBUSY'` | The port is open in another program, or opened exclusively elsewhere |
| `'EACCES'` | The user is not allowed to open it (on Linux, not in its group) |
| `'ENOTTY'` | The path is not a serial port (`/dev/usb/lp0` is a USB printer, not a serial port) |
| `'EINVAL'` | Options it refuses, or a setting the device did not accept |
| `'ETIMEDOUT'` | The output stopped moving for too long, or the opening took too long |
| `'EHOSTDOWN'`, `'ECONNREFUSED'` | A Bluetooth device does not respond, or refuses the connection (Linux) |
| `'EAFNOSUPPORT'`, `'ENOTSUP'` | The system offers no Bluetooth sockets (a container), or no Bluetooth at all on this platform |
| `'EIO'` | The device disappeared while it was open (`disconnected` is `true`) |
| `'ECANCELED'` | A request to a closed port |

## Troubleshooting

- **Linux, permission denied (`'EACCES'`):** add the user to the port's group (`dialout` on Debian and Ubuntu, `uucp` on
  Arch), then log in again.
- **Ubuntu 22.04 and Linux Mint 21, no `/dev/ttyUSB0` for a CH340 adapter:** the `brltty` package claims the adapter.
  Remove it, or disable its udev rules.
- **Linux, a new port is busy for a few seconds:** ModemManager probes new ports with AT commands. Tell it to ignore
  the device (`ID_MM_DEVICE_IGNORE` in a udev rule), or stop it.
- **A board resets when the port opens (Arduino, ESP32):** Linux and macOS raise DTR and RTS when a port opens, and
  user code cannot prevent that pulse.
- **Raspberry Pi:** use `/dev/serial0`. `/dev/ttyAMA0` may belong to the Bluetooth chip.
- **Linux, a closing takes up to 30 seconds:** when an adapter holds output it cannot send (flow control), the kernel
  waits for it when the port closes (`closing_wait`, 30 seconds by default). The event loop is not blocked, but the
  promise returned by `close()` settles only once the kernel releases the port. Discarding the data does not shorten the
  wait, because the bytes in the adapter's chip are out of reach.
- **Windows, `'EBUSY'` right after a closing:** some drivers release a port a moment after it is closed. Open it again
  after a short delay.
- **macOS:** use the `/dev/cu.*` devices. The `/dev/tty.*` ones are for incoming connections.

## See also

- [`@lakutata/thermal-printer`](../thermal-printer): thermal printers, on a serial port among other connections.
