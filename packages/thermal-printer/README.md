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
    //A receipt printer with a cutter: a half cut after each receipt
    const printer = await manager.open({connection: chosen.connection, model: chosen.model, paper: 80, commands: {language: chosen.language, cut: 'partial'}}, 'front')
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

### Pictures and barcodes

The HTML takes pictures as `data:` URLs (PNG, JPEG, GIF, BMP, SVG), inline `<svg>` elements, and files under
`baseDir`. The barcodes of [`@lakutata/barcode`](../barcode) go straight in, without a file:

```typescript
import type {Barcode} from '@lakutata/barcode'
import type {ThermalPrinter} from '@lakutata/thermal-printer'

async function label(printer: ThermalPrinter, barcode: Barcode): Promise<void> {
    const svg: string = await barcode.generate('EAN13', '590123412345', {output: 'svg'})
    const png: Buffer = await barcode.generate('Code128', 'ORDER-42')
    await printer.print(`
        <img style="width: 40mm" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
        <img style="width: 50mm" src="data:image/png;base64,${png.toString('base64')}#threshold">
        <img style="width: 25mm" src="qrcode:ORDER-42">
    `)
}
```

- SVG is drawn in black and white at the printer's resolution: the sharpest barcodes. Give it as an `<img>` and size the
  `<img>`: an inline `<svg>` keeps the width and height it declares, as in a browser.
- Pictures (PNG, JPEG…) are dithered, as photos want. Add `#threshold` to a barcode's picture so that its bars stay
  solid.
- `qrcode:` draws a QR code itself, its modules on whole dots, without a picture.

### A printer definition

| Field | What it is |
|---|---|
| `connection` | How the printer is reached (see [Connections](#connections)) |
| `model`, `paper`, `label`, `width`, `dpi`, `rotate`, `page` | Its media, as `render()` of `@lakutata/thermal` takes them |
| `commands` | What the printer is told after each page or each print: cut, feed, open the cash drawer… (see [The options of the commands](#the-options-of-the-commands)) |
| `baseDir` | The directory its HTML reads its pictures from |
| `textLanguage` | The language of its text, for the line breaking |
| `connectTimeout` | How long the connection may take to open (10 seconds) |
| `stallTimeout` | How long the printer may take no data (out of paper, its cover open, offline) before the print fails (10 seconds; 0 waits as long as it takes) |
| `bytesPerSecond` | The most bytes a second sent to it: a slow link whose printer stalls or prints white lines when the data come too fast or too slow |

A printer without media can still print raw commands and renderings.

### The options of the commands

`commands` takes the options of `encode()` of `@lakutata/thermal`. A print can change them for itself
(`print(html, {commands: {cut: false}})`).

| Option | What it does |
|---|---|
| `language` | The command language when the definition has no `model`: `'escpos'` (receipt printers), `'tspl'` or `'zpl'` (label printers) |
| `cut` | Cut after each page, on a printer with a cutter: `'partial'` leaves the receipt hanging by a strip, `'full'` (or `true`) cuts it off. `false` turns the cutter of a label printer off. Nothing is cut by default |
| `feed` | ESC/POS: the paper pushed out after each page, in millimetres: `15` pushes the receipt 15 mm further, past a tear bar that far away (each printer has its own distance). 0 by default: no feed. It does not depend on `cut`: with both, the paper is fed, then cut (the cut feeds the paper to the cutter by itself) |
| `drawer` | ESC/POS: open the cash drawer after the last page: `true` (its pin 2), or `{pin: 5}` for the second drawer |
| `copies` | TSPL and ZPL: the copies of each label |
| `sensor`, `gap` | TSPL and ZPL: how the printer finds the start of a label (the gap between labels, a black mark, or continuous media) and the size of the gap |
| `density`, `speed` | TSPL and ZPL: the darkness and the speed of the printing |
| `raster`, `bandHeight`, `initialize`, `compress` | How the dots are sent: leave them at their defaults unless a printer misbehaves (see the README of `@lakutata/thermal`) |

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
