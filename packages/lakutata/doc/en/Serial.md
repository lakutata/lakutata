# Lakutata Serial

The `@lakutata/serial` package communicates with devices on serial ports: scales, barcode scanners, PLCs, modems, boards
such as Arduino and ESP32, printers. A port opens as a Node.js stream; what you write is sent on the line, and what the
line receives is read. Classic Bluetooth devices open by their address as the same kind of stream. It is not part of
`lakutata`, and it needs no application. Its main features:

- **A port is a `Duplex` stream**: `write()`, `'data'` and `pipe()` work as they do on a socket; the line (speed, data
  bits, parity, stop bits, flow control) and the modem lines (DTR, RTS, CTS, DSR, DCD, RI) are set and read on it.
- **Finding the port**: the system's ports, with the vendor and product IDs of their USB adapters, and on Linux a path
  that stays the same when the adapter moves to another USB socket.
- **Unplugged devices are reported** even while nothing is read or written, so an application can open the port
  again.
- **Every wait is bounded**: when a device stops accepting data (a printer out of paper), a write fails after a timeout
  instead of hanging.
- **A native addon**, compiled when the package is installed, for Linux, macOS and Windows: termios on Linux and macOS,
  the communications API on Windows. Each open port has its own thread, so it does not delay file, DNS or crypto work in
  Node.js.

The `@lakutata/serial` README lists every option and every error code; this guide describes what the package is for,
with an example of each use.

```bash
npm install @lakutata/serial
```

The addon is compiled when the package is installed, so the machine needs Python 3 and a C++ compiler (the Xcode Command
Line Tools on macOS, `build-essential` on Linux, Visual Studio's C++ build tools on Windows). The package manager has to
run the package's install script: npm runs it; Bun and pnpm run it only for packages they are told to trust
(`trustedDependencies` in the package.json for Bun, `pnpm approve-builds` for pnpm). `@lakutata/core` is a peer
dependency: the package's exception extends its `Exception`.

## 1. Opening a port

```typescript
import {openSerialPort, type SerialPort} from '@lakutata/serial'

const port: SerialPort = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200})
port.on('error', (error: Error) => console.error(error))
port.on('data', (data: Buffer) => console.log('received', data))
port.write('AT\r\n')
await port.drain()
await port.close()
```

- The path is `/dev/ttyUSB0` or `/dev/ttyACM0` on Linux (`/dev/serial0` on a Raspberry Pi), `/dev/cu.*` on macOS (the
  `/dev/tty.*` devices wait for incoming connections), `COM3` on Windows.
- **Listen for `'error'`.** When the device disappears, the stream fails with a `SerialException` whose `disconnected`
  is `true`; without an `'error'` listener, Node.js ends the process.
- A port is exclusive by default: other programs cannot open it while it is open. `exclusive: false` allows this on
  Linux and macOS; Windows always opens ports exclusively.
- `drain()` resolves once the written data are sent on the line. `close()` closes the port once its data are sent,
  `destroy()` immediately, discarding what has not been sent yet.
- An open port keeps the process running, like an open socket: close it when you are done.

## 2. The line and the modem lines

The line options are those in the device's manual:

```typescript
import {openSerialPort, type SerialPort, type SerialSignals} from '@lakutata/serial'

const port: SerialPort = await openSerialPort({
    path: 'COM3',
    baudRate: 9600,
    dataBits: 7,
    parity: 'even',
    stopBits: 1,
    flowControl: 'rts/cts'
})
port.on('error', (error: Error) => console.error(error))
await port.update({baudRate: 19200})
const signals: SerialSignals = await port.getSignals()
console.log(signals.cts, signals.dsr)
await port.setSignals({dtr: false})
await port.close()
```

- `baudRate` accepts the standard speeds everywhere, and other speeds when the system and the adapter support them.
  `dataBits` is 5 to 8, `stopBits` 1, 1.5 (Windows only, with 5 data bits) or 2, `parity` `'none'`, `'even'`, `'odd'`,
  and `'mark'` or `'space'` on Linux and Windows.
- `flowControl` is `'none'`, `'rts/cts'`, `'dtr/dsr'` (not on Linux) or `'xon/xoff'`. With `'xon/xoff'` a received
  0x13 byte stops the output, so a device that sends binary data needs hardware flow control.
- The settings are read back after they are set: when a driver drops one, opening the port or `update()` fails with
  `'EINVAL'` instead of running with other settings.
- `update()` changes the line once the writes issued before it are sent. `getSignals()` reads CTS, DSR, DCD and RI;
  `setSignals()` sets DTR and RTS, or sends a break after the writes issued before it. `flush()` discards data waiting
  in either direction.
- Linux and macOS raise DTR and RTS when a port opens: a board that resets on that pulse (Arduino, ESP32) resets when
  the port is opened, and code cannot prevent it.

## 3. Finding the port

The path of a device's port changes when the device is plugged into another USB socket, or when adapters are found in a
different order at boot. Choose the port by its adapter's IDs instead:

```typescript
import {listSerialPorts, openSerialPort, type SerialPort, type SerialPortInfo} from '@lakutata/serial'

const ports: SerialPortInfo[] = await listSerialPorts()
const scale: SerialPortInfo | undefined = ports.find((info: SerialPortInfo): boolean => info.vendorId === 0x1a86 && info.productId === 0x7523)
if (!scale) throw new Error('the scale is not plugged in')
const port: SerialPort = await openSerialPort({path: scale.stablePath ?? scale.path, baudRate: 9600})
port.on('error', (error: Error) => console.error(error))
```

- Each port has its `path`. A USB adapter also provides its `vendorId` and `productId` (numbers), `serialNumber`,
  `manufacturer` and `product`; adapters of the same model are distinguished by their `serialNumber`, when they have
  one.
- On Linux, `stablePath` is the port's link in `/dev/serial/by-id`, which stays the same when the adapter moves.
- On macOS and Windows, a paired Bluetooth device's port provides its `bluetoothAddress`, and its name as `product`.

## 4. When the device stops taking data

A device can stop accepting data: it holds CTS low, or it is a printer out of paper. Every wait is bounded:

- With the `stallTimeout` option (in milliseconds), a write or a drain fails with `'ETIMEDOUT'` once the output has not
  moved for that long. The data remain queued.
- `close()` waits while the output is moving; once the output has stopped for `close({stallTimeout})` (10 seconds by
  default), it discards the remaining data, closes the port and rejects with `'ETIMEDOUT'`.
- A break waits for the output to be sent; if flow control still holds the output after 2 seconds, the break fails with
  `'ETIMEDOUT'`.
- `drain()` and `close()` also wait for the bytes still in the driver and in the adapter's chip, which the system cannot
  report: the time these bytes take at the line's speed, for up to 4 KB on macOS and 1 KB on Linux and Windows.

## 5. Bluetooth devices

```typescript
import {openBluetoothSerial, type SerialPort} from '@lakutata/serial'

const printer: SerialPort = await openBluetoothSerial({address: '00:11:22:33:44:55'})
printer.on('error', (error: Error) => console.error(error))
printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
await printer.close()
```

- A classic Bluetooth device opens through its serial port profile (SPP), once it is paired with the system.
  Bluetooth Low Energy devices are not supported.
- On Linux the device is reached through an RFCOMM socket, on the specified `channel` (1 by default); on macOS and
  Windows the function opens the serial port that the system created for the paired device (the outgoing one on
  Windows).
- The line options and the modem lines do not apply: the link has its own speed.

## 6. In an application

A component opens the port when the application launches and closes it when the application stops. When the device is
unplugged, the component opens the port again once the device is back:

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {openSerialPort, SerialException, type SerialPort} from '@lakutata/serial'

class Scale extends Component {
    @Configurable(DTO.String().required())
    protected readonly path: string

    @Inject('log')
    protected readonly log: ILogger

    protected port: SerialPort | undefined

    protected timer: NodeJS.Timeout | undefined

    protected weight: string = ''

    protected async init(): Promise<void> {
        await this.open()
    }

    protected async open(): Promise<void> {
        try {
            const port: SerialPort = await openSerialPort({path: this.path, baudRate: 9600})
            port.on('data', (data: Buffer): void => {
                this.weight = data.toString('ascii').trim()
            })
            port.on('error', (error: Error): void => {
                this.log.warn('scale: %s', error.message)
                if (error instanceof SerialException && error.disconnected) this.retry()
            })
            this.port = port
        } catch (error) {
            this.log.warn('scale: %s', (error as Error).message)
            this.retry()
        }
    }

    protected retry(): void {
        this.port = undefined
        this.timer = setTimeout((): Promise<void> => this.open(), 3000)
    }

    public current(): string {
        return this.weight
    }

    protected async destroy(): Promise<void> {
        clearTimeout(this.timer)
        await this.port?.close()
    }
}

Application.run(() => ({
    id: 'scale.app',
    name: 'Scale',
    components: {
        scale: {class: Scale, path: '/dev/ttyUSB0'}
    },
    bootstrap: ['scale']
}))
```

- A controller obtains the component with `@Inject('scale')` and responds with `current()`.
- For thermal printers on a serial port or a Bluetooth link, `@lakutata/thermal-printer` opens the port itself (see
  [Thermal Printers](Thermal.md)).

## 7. Systems, runtimes and packaging

- Node.js 18.10 and later, Bun, Electron and NW.js, on Linux, macOS and Windows. The addon is built on Node-API only (no
  libuv calls), so the same build loads in Electron and NW.js, and runs in worker threads; a port still open when its
  worker or the process ends is closed, and unsent data are discarded.
- An unplugged adapter is reported immediately on Linux and macOS, and within a second on Windows.
- **Linux**: the user must be in the port's group (`dialout` on Debian and Ubuntu, `uucp` on Arch). On Ubuntu 22.04 and
  Linux Mint 21 the `brltty` package claims CH340 adapters; ModemManager probes new ports for a few seconds. When an
  adapter holds output it cannot send, the kernel holds the port for up to 30 seconds while closing it (`closing_wait`),
  and `close()` settles once the kernel releases it.
- **Windows**: some drivers release a port a moment after it is closed; open it again after a short delay.
- Bundles, executables and installers made by `lakutata package` include the compiled addon: build them on each target
  platform, after installing the package there (see [Packaging](Packaging.md) and [Native Addons](NativeAddons.md)).

## 8. Exceptions

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
