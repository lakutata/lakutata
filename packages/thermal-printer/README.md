# @lakutata/thermal-printer

English | [中文](README.zh-CN.md)

Thermal printers for the [lakutata](https://github.com/lakutata/lakutata) framework: a component that renders receipts,
labels and wristbands written in HTML (by [`@lakutata/thermal`](../thermal)), encodes them as the commands of each
printer (ESC/POS, TSPL or ZPL), and sends them by the network, the system's print queue, a serial port, USB or
Bluetooth. Each printer has one queue: its prints go out one after the other, in the order of the calls. The `lakutata`
package does not re-export this package: import it from `@lakutata/thermal-printer`.

## Installation

```shell
npm install @lakutata/thermal-printer
```

- It installs `@lakutata/thermal`, whose native addon is compiled during the installation (see its README for what the
  machine needs).
- Node.js `>=18.10.0`, with `@lakutata/core`.
- The serial and Bluetooth connections come from `@lakutata/serial` and the USB connection from `@lakutata/usb`,
  installed when a printer uses them. Without the package, a print to such a printer fails with an error naming it.

## Usage

### Printers in the configuration

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildThermalPrinterOptions, type ThermalPrinter} from '@lakutata/thermal-printer'

class Counter extends Component {
    @Inject('printers')
    protected readonly printers: ThermalPrinter

    public async receipt(order: {id: string, total: string}): Promise<void> {
        await this.printers.print('front', `<h1>Order ${order.id}</h1><p>Total ${order.total}</p>`)
    }
}

Application.run(() => ({
    id: 'shop',
    name: 'Shop',
    components: {
        printers: buildThermalPrinterOptions({
            printers: {
                front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}},
                kitchen: {connection: {type: 'network', host: '192.168.1.51'}, paper: 80, commands: {language: 'escpos', cut: 'full'}},
                labels: {connection: {type: 'queue', name: 'TSC_TDP_225'}, model: 'TDP-225', label: {width: 40, height: 30}},
                ward: {connection: {type: 'usb', path: '/dev/usb/lp0'}, model: 'HC100', label: {width: 25, height: 250}, commands: {sensor: 'mark'}}
            }
        }),
        counter: {class: Counter}
    }
}))
```

A printer is its `connection`, its media as `render()` of `@lakutata/thermal` takes them (`model`, `paper`, `label`,
`width`, `dpi`, `rotate`, `page`), and the options of its `commands` as `encode()` takes them (the `language` when it
has no model, `feed`, `cut`, `drawer`, `sensor`, `density`, `copies`…). `baseDir` is the directory its HTML reads its
pictures from, `textLanguage` the language of its text.

### Printing

```typescript
import type {ThermalPrinter} from '@lakutata/thermal-printer'
import {render} from '@lakutata/thermal'

async function print(printers: ThermalPrinter): Promise<void> {
    //HTML: rendered at the printer's media, encoded as its commands
    await printers.print('front', '<h1>Order 42</h1>', {commands: {drawer: true}})
    //A rendering, encoded for the printer
    await printers.print('kitchen', await render('<h2>Table 7</h2>', {paper: 80}))
    //Raw commands, sent as they are
    await printers.print('front', Buffer.from([0x1B, 0x40, 0x0A]))
    //A printer given by the call
    await printers.print({connection: {type: 'network', host: '192.168.1.60'}, paper: 58, commands: {language: 'escpos'}}, '<p>Hello</p>')
}
```

- `print()` resolves once the commands are sent (handed to the connection; the printer may still be printing them),
  with the pages and the bytes sent. Each print opens the connection, sends its commands and closes it.
- The options of a print's `commands` apply over the printer's own (`{commands: {cut: false}}`), and its `signal` cancels
  it while it waits for its turn.
- `preview(printer, html)` renders without printing: the same dots the printer would print, `toPNG()` for a picture.
  `commands(printer, content)` gives the commands without sending them.

### Connections

| `type` | Options | How |
|---|---|---|
| `'network'` | `host`, `port` (9100) | A TCP connection to the raw printing port, the same for ESC/POS, TSPL and ZPL printers |
| `'queue'` | `name` | The system's print queue, the commands sent raw: CUPS's `lp -d <name> -o raw` on macOS and Linux. Not supported on Windows yet |
| `'serial'` | `path`, `baudRate` (9600), `flowControl` (`'rts/cts'`, `'dtr/dsr'`, `'xon/xoff'`) | A serial port, by `@lakutata/serial` |
| `'usb'` | `vendorId`, `productId`, `serialNumber`, or `path` | A USB printer, by `@lakutata/usb` |
| `'bluetooth'` | `address`, `channel` (1, Linux) | A classic Bluetooth printer (its serial port profile), paired with the system first, by `@lakutata/serial` |

- `connectTimeout` (10 seconds) limits the opening of a connection.
- `stallTimeout` (10 seconds): a printer that takes no data for that long (out of paper, its cover open, offline)
  fails the print with a `ThermalPrinterConnectionException`; 0 waits as long as it takes.
- `bytesPerSecond` paces a slow link: printers on Bluetooth or a slow serial port stall, or print white lines, when the
  data come faster or slower than they print.

## API

| Export | What it is |
|---|---|
| `ThermalPrinter` | The component: `print()`, `preview()`, `commands()`, `printerNames()` |
| `buildThermalPrinterOptions`, `ThermalPrinterConfig` | The options of a component in the configuration (`printers`, `drainTimeout`) |
| `PrinterDefinition`, `PrinterConnection`, `NetworkConnection`, `QueueConnection`, `SerialConnection`, `UsbConnection`, `BluetoothConnection` | A printer and its connections |
| `PrintOptions`, `PrintResult` | The options and the result of a print |
| `ThermalPrinterException`, `ThermalPrinterConnectionException` | The exceptions of the package (see [Errors](#errors)) |

## Errors

| Error | When |
|---|---|
| `ThermalPrinterConnectionException` | The printer cannot be reached or the commands cannot be sent: the connection refused or timed out, the print queue failing, the device not opened |
| `ThermalPrinterException` | No printer of that name, a connection whose package is not installed, a connection the platform does not offer, the component destroyed |
| The exceptions of `@lakutata/thermal` | The rendering or the encoding failed (`ThermalOptionException`, `ThermalContentException`…) |

## See also

- [`@lakutata/thermal`](../thermal): the rendering of the HTML and the commands of the printers.
- [`@lakutata/serial`](../serial): serial ports and Bluetooth devices.
