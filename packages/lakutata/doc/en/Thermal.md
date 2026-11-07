# Thermal Printers

Receipts, labels and wristbands are written in HTML and CSS, rendered to the printer's own dots, and sent as its
commands. Three packages do it:

- [`@lakutata/thermal`](https://github.com/lakutata/lakutata/tree/main/packages/thermal), the engine: `render()` lays
  the HTML out at the width of the paper and draws it in black and white dots (a native addon with litehtml, FreeType
  and a bundled Chinese font); `encode()` turns the dots into ESC/POS, TSPL or ZPL commands. The rendering is the print
  preview: `toPNG()` gives the very dots the printer prints.
- [`@lakutata/thermal-printer`](https://github.com/lakutata/lakutata/tree/main/packages/thermal-printer), the
  component: `ThermalPrinterManager` finds the printers, opens them from definitions an application saves as JSON, and
  gives a `ThermalPrinter` for each, which prints in the order of the calls over the network, a print queue of the
  system, USB, a serial port or Bluetooth.
- [`@lakutata/serial`](https://github.com/lakutata/lakutata/tree/main/packages/serial): serial ports and classic
  Bluetooth devices, for the printers on them (and for any other serial device).

The `lakutata` package does not re-export them: install the ones the application uses.

```shell
npm install @lakutata/thermal-printer          # the engine comes with it
npm install @lakutata/serial                   # for serial and Bluetooth printers
```

The engine and the serial package compile a native addon when they are installed (Python 3 and a C++ compiler on the
machine); the component compiles a small one on macOS and Windows only.

## 1. Printing

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildThermalPrinterManagerOptions, type ThermalPrinterManager} from '@lakutata/thermal-printer'

class Counter extends Component {
    @Inject('printers')
    protected readonly printers: ThermalPrinterManager

    public async receipt(order: {id: string, total: string}): Promise<void> {
        await this.printers.print('front', `<h1>Order ${order.id}</h1><p>Total ${order.total}</p>`)
    }
}

Application.run(() => ({
    id: 'shop',
    name: 'Shop',
    components: {
        printers: buildThermalPrinterManagerOptions({
            printers: {
                front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}}
            }
        }),
        counter: {class: Counter}
    }
}))
```

- A printer is a **definition**: its `connection`, its media (`model`, `paper`, `label`, `width`, `dpi`, `rotate`,
  `page`) and its `commands` (cut, feed, cash drawer…). The printers of the configuration open when they are first used.
- `print()` renders the HTML at the printer's media, encodes it as its commands and sends them. It resolves once the
  commands are handed to the connection. A printer's prints go out one after the other, in the order of the calls.
- `print()` also takes a rendering of `render()`, or raw commands as a `Buffer`, sent as they are.

## 2. Choosing a printer while the application runs

A desktop or point-of-sale application usually lets its user pick the printer, and saves the choice:

```typescript
import {readFile, writeFile} from 'node:fs/promises'
import {validatePrinterDefinition, type ThermalPrinterManager} from '@lakutata/thermal-printer'

async function choose(manager: ThermalPrinterManager): Promise<void> {
    const candidates = await manager.discover()
    const chosen = candidates.find((candidate) => candidate.printer)
    if (!chosen) return
    const printer = await manager.open({connection: chosen.connection, model: chosen.model, paper: 80, commands: {language: chosen.language, cut: 'partial'}}, 'front')
    await writeFile('printer.json', JSON.stringify(printer.definition))
}

async function restore(manager: ThermalPrinterManager): Promise<void> {
    await manager.open(validatePrinterDefinition(JSON.parse(await readFile('printer.json', 'utf8'))), 'front')
}
```

- `discover()` finds USB printers (with the IEEE 1284 id they report, the model of the table it names and their
  command language), the print queues of the system, and the serial and Bluetooth ports. Network printers are not
  found this way: their address is entered.
- `open()` creates a `ThermalPrinter` once for each device: opening the same device again gives the same object, so
  that two queues never mix their data on one printer. `get(name)` gives it back by name, `close()` closes it.
- `printer.definition` is the JSON to save; `validatePrinterDefinition()` checks a saved one.

## 3. Writing a receipt in HTML

The page is the width the printer prints: 48 mm on 58 mm paper (384 dots at 203 dpi), 72 mm on 80 mm paper (576
dots), the width of a label or of a wristband. The HTML is laid out at that width as a browser would lay it out:

```typescript
import {render} from '@lakutata/thermal'

const html: string = `
    <style>
        h1 { text-align: center; font-size: 20px; margin: 0 0 2mm }
        .row { display: flex; justify-content: space-between }
        @media (max-width: 50mm) { .row { display: block } }
        table { width: 100%; border-collapse: collapse }
        td:last-child { text-align: right }
    </style>
    <h1>湖畔咖啡</h1>
    <div class="row"><span>Order 42</span><span>2026-11-08 12:30</span></div>
    <table><tr><td>Latte</td><td>¥32.00</td></tr><tr><td>Croissant</td><td>¥18.00</td></tr></table>`
const narrow = await render(html, {paper: 58})
const wide = await render(html, {paper: 80})
console.log(narrow.width, wide.width)
```

- **Widths adapt**: percentages, `max-width`, tables, the wrapping of text. Chinese and Japanese text breaks by the
  rules of UAX #14 (no closing punctuation at the start of a line), and long words and addresses break too.
- **Media queries** see the print width: one template lays out 58 mm and 80 mm receipts differently.
- **Units**: `mm`, `pt`, `px` (1/96 inch, as in CSS), `%` and `em` become the printer's dots, so a template prints the
  same size at 180, 203 and 300 dpi. The default text is 12px, about 3 mm.
- **CSS**: the box model, `display` (block, inline, inline-block, flex, table), floats, `position`, rounded borders,
  linear and radial gradients, `::before` and `::after`, counters, `var()`, `@media`, `white-space`. Not supported:
  `calc()`, grid, `transform`, `opacity`, `box-shadow`, `letter-spacing`, `@font-face`.
- **Black and white**: text prints black, unless its color is nearly white. Gradients and photos are dithered, and
  SVG and barcodes are thresholded to solid black.
- **Fonts**: Noto Sans SC (regular and bold, the OFL license) is bundled and covers Chinese, Japanese kana, Latin
  and digits. `registerFont()` adds others, and `font-family` chooses them.

### Pictures, barcodes and QR codes

```typescript
import type {Barcode} from '@lakutata/barcode'
import type {ThermalPrinter} from '@lakutata/thermal-printer'

async function label(printer: ThermalPrinter, barcode: Barcode): Promise<void> {
    const svg: string = await barcode.generate('EAN13', '590123412345', {output: 'svg'})
    await printer.print(`
        <img style="width: 40mm" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
        <img style="width: 25mm" src="qrcode:ORDER-42">
        <img style="width: 30mm" src="logo.png">
    `)
}
```

- `data:` URLs (PNG, JPEG, GIF, BMP, SVG), inline `<svg>` elements, and the files under the printer's `baseDir`
  (never outside it). Remote URLs are refused.
- `qrcode:<text>` draws a QR code with its modules on whole dots: the sharpest.
- A barcode as a PNG wants `#threshold` after its URL, so that its bars stay solid.

## 4. Media

| Option | For | Example |
|---|---|---|
| `paper` | A roll of receipt paper, 58 or 80 mm, at 203 dpi | `{paper: 80}` |
| `model` | A printer of the table (`printerModels()`): its resolution, width, language and habits | `{model: 'TM-T88VI'}` |
| `label` | Labels or wristbands: their width and length in millimetres, with `dpi` or a label printer's `model` | `{model: 'HC100', label: {width: 25, height: 250}}` |
| `width`, `dpi` | Any other paper: the width printed in millimetres and the resolution | `{width: 24, dpi: 300}` |
| `rotate` | Printed turned (90, 180, 270): a wristband printed along its length | `{rotate: 90}` |
| `page` | A fixed page length on a roll, and what happens to the rest (`overflow`) | `{paper: 58, page: {length: 100}}` |

## 5. What the printer is told

`commands` gives the options of `encode()`, in the definition (every print) or in a print (that print only):

| Option | What it does |
|---|---|
| `cut` | Cut after each page, on a printer with a cutter: `'partial'` (a half cut) or `'full'` (or `true`); on ESC/POS, TSPL and ZPL. Nothing is cut by default |
| `feed` | ESC/POS: the paper pushed out after each page, in millimetres (`15`: past a tear bar 15 mm away). 0 by default. It does not depend on `cut` |
| `drawer` | ESC/POS: open the cash drawer after the last page |
| `skipBlank` | ESC/POS and TSPL: blank stretches of a millimetre or more are not sent (ESC/POS feeds the paper over them), so a receipt takes fewer bytes. On by default; `false` for a printer whose gaps come out too short or too long |
| `language` | The command language when there is no `model`: `'escpos'`, `'tspl'`, `'zpl'` |
| `copies`, `sensor`, `gap`, `density`, `speed` | Label printers: copies, how labels are found (gap, black mark, continuous), darkness, speed |

```typescript
import type {ThermalPrinter} from '@lakutata/thermal-printer'

async function ticket(printer: ThermalPrinter): Promise<void> {
    //This print only: no cut, open the drawer
    await printer.print('<h2>Table 7</h2>', {commands: {cut: false, drawer: true}})
}
```

## 6. Connections

| `type` | How |
|---|---|
| `network` | `host` and `port` (9100): a TCP connection to the raw printing port, opened for each print |
| `queue` | A print queue of the system: CUPS (`lp -o raw`) on macOS and Linux, the spooler on Windows (raw documents) |
| `usb` | A USB printer: `/dev/usb/lpN` on Linux, its ids on macOS, its printer interface on Windows (the system's own driver) |
| `serial` | A serial port (`@lakutata/serial`): `path`, `baudRate`, `flowControl` (`'rts/cts'`, `'dtr/dsr'`, `'xon/xoff'`) |
| `bluetooth` | A classic Bluetooth printer, paired with the system first (`@lakutata/serial`): its `address` |

- USB, serial and Bluetooth printers keep their connection open while their object lives; network printers and print
  queues are connected for each print.
- `stallTimeout` (10 seconds by default) fails a print when the printer stops taking data: out of paper, its cover
  open, offline. `bytesPerSecond` paces a slow link.
- `/dev/usb/lp0` is a USB printer, not a serial port: give it as a `usb` connection.

## 7. The engine alone

The engine needs no application: render, preview, encode, send the bytes yourself.

```typescript
import {writeFile} from 'node:fs/promises'
import {encode, render} from '@lakutata/thermal'

const image = await render('<h1>Order 42</h1>', {paper: 58})
await writeFile('preview.png', image.toPNG())
const escpos: Buffer = encode(image, {language: 'escpos', feed: 3, cut: 'partial'})
console.log(escpos.length)
```

## 8. Serial ports and Bluetooth devices

`@lakutata/serial` opens a port as a stream, for printers and any other serial device:

```typescript
import {listSerialPorts, openBluetoothSerial, openSerialPort} from '@lakutata/serial'

async function serial(): Promise<void> {
    console.log(await listSerialPorts())
    const port = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200, flowControl: 'rts/cts'})
    port.on('error', (error: Error) => console.error(error))
    port.write(Buffer.from([0x1B, 0x40]))
    await port.close()
    const printer = await openBluetoothSerial({address: '00:11:22:33:44:55'})
    await printer.close()
}
```

- Each port has a thread of its own: open ports do not slow down the rest of Node.js, and an unplugged adapter is
  reported (`'error'`, `disconnected: true`) even while nothing is read or written.
- Every wait has a bound: `stallTimeout` for the writes and the drains, `close({stallTimeout})` (10 seconds) for the
  closing.
- Bluetooth: an RFCOMM socket on Linux; on macOS and Windows, the serial port the system made for the paired device.

## 9. Platforms and packaging

- Node.js 18.10 and later, Bun, Electron and NW.js, on macOS, Linux and Windows. The addons are built on Node-API, so
  the same build loads in Electron and NW.js without being built again.
- `lakutata package` (bundles, executables of Node.js and of Bun, Electron applications) ships the addons and the
  fonts with the application.
- In mobile applications, the builder compiles the engine's addon as it compiles any other native addon, and the
  printers are reached over the network.

## 10. What is not done

- Printers are driven by the dots of their pages (raster): the printers' own text fonts, their stored logos and their
  status are not used.
- Bluetooth Low Energy printers, and other languages (CPCL, EPL, Star raster), are not supported.
- Network printers are not discovered: their address is entered.

## Exceptions

| Exception | When |
|---|---|
| `ThermalOptionException` | Options the engine refuses: media, commands |
| `ThermalContentException` | HTML it cannot render: a picture that cannot be read, a file outside `baseDir` |
| `ThermalFontException` | A font it cannot use |
| `ThermalTimeoutException`, `ThermalCancelledException` | A rendering past its `timeout`, or cancelled by its `signal` |
| `ThermalPrinterConnectionException` | A printer that cannot be reached, or takes no data for its stall timeout |
| `ThermalPrinterOptionException` | A printer definition that is not one |
| `SerialException` | A serial port or Bluetooth device that fails; its `code` names the error, `disconnected` an unplugged device |
