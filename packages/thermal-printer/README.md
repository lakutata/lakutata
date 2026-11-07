# @lakutata/thermal-printer

English | [中文](README.zh-CN.md)

Thermal printers for the [lakutata](https://github.com/lakutata/lakutata) framework. A manager component finds the
printers (USB printers, the print queues of the system, serial and Bluetooth ports) and opens them from definitions an
application saves as JSON. Each opened printer is an object that renders receipts, labels and wristbands written in
HTML (by [`@lakutata/thermal`](../thermal)), encodes them as the printer's commands (ESC/POS, TSPL or ZPL), and sends
them in the order of the calls. The `lakutata` package does not re-export this package: import it from
`@lakutata/thermal-printer`.

## Installation

```shell
npm install @lakutata/thermal-printer
```

- It installs `@lakutata/thermal`, whose native addon is compiled during the installation (see its README for what the
  machine needs).
- On macOS and Windows, the package compiles a small addon of its own for USB printers and the Windows print spooler.
  Linux needs none: its USB printers are device files and its print queues are CUPS commands.
- Serial and Bluetooth printers need `@lakutata/serial` (`npm install @lakutata/serial`). Without it, opening such a
  printer fails with an error naming the package.
- Node.js `>=18.10.0`, with `@lakutata/core`.

## Usage

### The manager

```typescript
import {Application} from 'lakutata'
import {buildThermalPrinterManagerOptions} from '@lakutata/thermal-printer'

Application.run(() => ({
    id: 'shop',
    name: 'Shop',
    components: {
        printers: buildThermalPrinterManagerOptions({
            printers: {
                front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}},
                labels: {connection: {type: 'queue', name: 'TSC_TDP_225'}, model: 'TDP-225', label: {width: 40, height: 30}}
            }
        })
    }
}))
```

The printers of the configuration are opened when they are first used. A printer that is away when the application
starts does not fail it.

### Finding a printer and saving it

Printers are usually chosen while the application runs, not written in its code: find them, open the one the user
picks, and save its definition.

```typescript
import {writeFile} from 'node:fs/promises'
import type {ThermalPrinterManager} from '@lakutata/thermal-printer'

async function setUp(manager: ThermalPrinterManager): Promise<void> {
    const candidates = await manager.discover()
    //USB printers and print queues are printers; serial and Bluetooth ports may have one
    const chosen = candidates.find((candidate) => candidate.printer)
    if (!chosen) return
    const printer = await manager.open({connection: chosen.connection, model: chosen.model, paper: 80, commands: {language: chosen.language}}, 'front')
    await writeFile('printer.json', JSON.stringify(printer.definition))
}
```

The next time the application starts, it opens the saved definition again:

```typescript
import {readFile} from 'node:fs/promises'
import {validatePrinterDefinition, type ThermalPrinterManager} from '@lakutata/thermal-printer'

async function restore(manager: ThermalPrinterManager): Promise<void> {
    const definition = validatePrinterDefinition(JSON.parse(await readFile('printer.json', 'utf8')))
    await manager.open(definition, 'front')
}
```

- `discover()` lists candidates, each with a `connection` ready to be opened and saved. For a USB printer, it also
  gives the IEEE 1284 id the printer reports (`deviceId`), the model of `printerModels()` that id names (`model`) and
  the command language it reports (`language`). Network printers cannot be found this way: the user enters their
  address.
- `open(definition, name?)` opens a printer once for its device: opening the same device again returns the same
  object (with its first definition), so that two queues never mix their data on one printer.
- `get(name)` gives a printer by its name, `names()` lists the names, `openPrinters()` lists the printers open, and
  `close(printer)` closes one.
- `validatePrinterDefinition()` checks a definition read from a file. The engine checks its media when it is opened.

### Printing

```typescript
import type {ThermalPrinterManager} from '@lakutata/thermal-printer'

async function print(manager: ThermalPrinterManager): Promise<void> {
    const front = await manager.get('front')
    //HTML: rendered at the printer's media, encoded as its commands
    await front.print('<h1>Order 42</h1>', {commands: {drawer: true}})
    //Raw commands, sent as they are
    await front.print(Buffer.from([0x1B, 0x40, 0x0A]))
    //The preview: the same dots the printer prints
    const png: Buffer = (await front.preview('<h1>Order 42</h1>')).toPNG()
    //In one call, by name or by definition
    await manager.print('front', '<p>Thank you</p>')
    console.log(png.length)
}
```

- `print()` resolves once the commands are handed to the connection (the printer may still be printing them), with the
  pages and the bytes sent. A printer's prints go out one after the other, in the order of the calls.
- The options of a print's `commands` apply over the printer's own. Its `signal` cancels it while it waits for its turn
  or is rendered.
- `manager.print()` with a definition opens that printer (see `open()`), and the printer stays open until it is closed:
  a USB, serial or Bluetooth printer printed on once that way stays held by the application, and other programs get
  `'EBUSY'` until `close()`.
- `preview(html)` renders without printing. `commandsOf(content)` gives the commands without sending them.

### A printer definition

| Field | What it is |
|---|---|
| `connection` | How the printer is reached (see [Connections](#connections)) |
| `model`, `paper`, `label`, `width`, `dpi`, `rotate`, `page` | Its media, as `render()` of `@lakutata/thermal` takes them |
| `commands` | The options of its commands, as `encode()` takes them: the `language` when it has no model, `feed`, `cut`, `drawer`, `sensor`, `density`, `copies`… |
| `baseDir` | The directory its HTML reads its pictures from |
| `textLanguage` | The language of its text, for the line breaking |
| `connectTimeout` | How long the connection may take to open (10 seconds) |
| `stallTimeout` | How long the printer may take no data (out of paper, its cover open, offline) before the print fails (10 seconds; 0 waits as long as it takes) |
| `bytesPerSecond` | The most bytes a second sent to it: a slow link whose printer stalls or prints white lines when the data come too fast or too slow |

A printer without media can still print raw commands and renderings.

### Connections

| `type` | Options | How |
|---|---|---|
| `'network'` | `host`, `port` (9100) | A TCP connection to the raw printing port, the same for ESC/POS, TSPL and ZPL printers; connected for each print |
| `'queue'` | `name` | A print queue of the system, the commands sent as they are: CUPS's `lp -d <name> -o raw` on macOS and Linux, the spooler on Windows (a raw document; `XPS_PASS` for the drivers of version 4) |
| `'usb'` | `path`, or `vendorId`, `productId` and `serialNumber` | A USB printer: its device file `/dev/usb/lpN` on Linux (the user in the `lp` group), its ids on macOS, the path of its printer interface on Windows (the system's own driver, no other needed) |
| `'serial'` | `path`, `baudRate` (9600), `flowControl` (`'rts/cts'`, `'dtr/dsr'`, `'xon/xoff'`) | A serial port, by `@lakutata/serial` |
| `'bluetooth'` | `address`, `channel` (1, Linux) | A classic Bluetooth printer (its serial port profile), paired with the system first, by `@lakutata/serial` |

- A USB, serial or Bluetooth printer keeps its connection while its object lives: the connection opens at the first
  print and opens again after a failure. A network printer and a print queue are connected for each print, because
  printers on port 9100 often take one client at a time and a queue takes one document per job.
- `/dev/usb/lp0` is a USB printer, not a serial port: give it as a `'usb'` connection, not as `'serial'`.
- On macOS, a USB printer used by a CUPS queue is busy while the queue prints: opening it then fails with `'EBUSY'`.

### Closing

- `manager.close(printer)` closes a printer: its prints are sent first (for `drainTimeout` at most, 10 seconds), then
  its connection closes. A printer of the configuration opens again at its next use.
- The manager closes all its printers when the application stops (its container is destroyed).
- When the process ends, the system closes the device files, sockets and handles that are still open. A print cut
  off by a killed process leaves its printer with part of its data.

## API

| Export | What it is |
|---|---|
| `ThermalPrinterManager` | The manager: `discover()`, `open()`, `get()`, `names()`, `openPrinters()`, `close()`, `print()`, `preview()` |
| `buildThermalPrinterManagerOptions`, `ThermalPrinterManagerConfig` | The options of a manager in the configuration (`printers`, `drainTimeout`) |
| `ThermalPrinter` | An open printer: `print()`, `preview()`, `commandsOf()`, `definition` |
| `validatePrinterDefinition` | Checks a definition read from a file |
| `PrinterDefinition`, `PrinterConnection`, `NetworkConnection`, `QueueConnection`, `UsbConnection`, `SerialConnection`, `BluetoothConnection` | A printer and its connections |
| `PrinterCandidate`, `DiscoverOptions` | What `discover()` finds |
| `PrintOptions`, `PrintResult` | The options and the result of a print |
| `ThermalPrinterException`, `ThermalPrinterConnectionException`, `ThermalPrinterOptionException` | The exceptions of the package (see [Errors](#errors)) |

## Errors

| Error | When |
|---|---|
| `ThermalPrinterConnectionException` | The printer cannot be reached or the commands cannot be sent: the connection refused or timed out, the device not connected or busy, the print queue failing, the printer taking no data for its stall timeout |
| `ThermalPrinterOptionException` | A definition that is not one: a connection missing or wrong, an option of the wrong kind |
| `ThermalPrinterException` | No printer of that name, a connection whose package is not installed, a printer or a manager closed |
| The exceptions of `@lakutata/thermal` | The engine refused the media (`ThermalOptionException`), or the rendering or the encoding failed |

## See also

- [`@lakutata/thermal`](../thermal): the rendering of the HTML and the commands of the printers.
- [`@lakutata/serial`](../serial): serial ports and Bluetooth devices.
