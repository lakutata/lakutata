# @lakutata/barcode

English | [中文](README.zh-CN.md)

Barcodes and QR codes for the [Lakutata](https://github.com/lakutata/lakutata) framework: a component that generates
them (PNG, SVG or pixels) and reads them from images, in a native addon built on [zint](https://zint.org.uk)
(generation) and [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (reading). Every format it generates, it reads
back: 32 linear and matrix formats, from EAN-13 and Code 128 to QR Code, Data Matrix, PDF417 and Aztec. The work runs in
the addon's threads, never in the JavaScript thread. The `lakutata` package does not re-export this package: import it
from `@lakutata/barcode`.

## Installation

```shell
npm install @lakutata/barcode
```

- The addon is compiled during installation (node-gyp), so the machine needs Python 3 and a C++20 compiler: the Xcode
  Command Line Tools on macOS, `build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, the Visual Studio
  Build Tools ("Desktop development with C++") on Windows. If the compilation fails, the installation fails.
- The package manager has to run the package's install script. npm runs it, and may warn that the script is "not yet
  covered by allowScripts": `npm install-scripts approve @lakutata/barcode` records that you allow it. Bun and pnpm run
  it only for dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error that explains how to build the addon.
- Node.js `>=18.10.0`.
- The addon uses Node-API, so Bun and Electron's main process load the addon that node-gyp built for Node.js, without a
  rebuild.
- In a React Native mobile application (Lakutata's mobile template), `lakutata mobile stage` compiles the addon for
  Android, iOS and HarmonyOS, with the NDK, Xcode and the DevEco Studio toolchain.

## Usage

### Generating and reading

Inject the component: it needs no registration, and uses the default options. For your own defaults, time limit or
concurrency, register a component in the configuration (see [Options of the component](#options-of-the-component)).

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Barcode, type BarcodeResult, type RawImage} from '@lakutata/barcode'

class Labels extends Component {
    @Inject(Barcode)
    protected readonly barcode: Barcode

    public async orderLabel(id: string): Promise<Buffer> {
        //A PNG, 8 pixels by module, readable with about 15% of it damaged (error correction M)
        return await this.barcode.generate('QRCode', `https://example.com/orders/${id}`, {scale: 8, errorCorrection: 'M'})
    }

    public async productBars(): Promise<string> {
        //An SVG, the digits under the bars, an add-on of 2 digits
        return await this.barcode.generate('EAN13', '590123412345', {output: 'svg', addOn: '12'})
    }

    public async pixels(): Promise<RawImage> {
        //The pixels: gray in black and white, RGB with colors, RGBA with transparency
        return await this.barcode.generate('Code128', 'LKT-1001', {output: 'raw', foreground: '#1E3A8A'})
    }

    public async scan(photo: Buffer): Promise<BarcodeResult[]> {
        //An image file (PNG, JPEG, GIF, BMP, WebP or TGA): every code found in it, each with its format, its text, its
        //bytes and its position in the image (an empty array when there is none)
        return await this.barcode.read(photo, {formats: ['QRCode', 'EAN13']})
    }
}
```

`generate(format, content, options)` takes the content as text (UTF-8) or as bytes (a `Uint8Array`), and returns a
`Buffer` (PNG), a string (SVG) or a `RawImage` (`output: 'raw'`). `read(image, options)` returns the codes found, each
with its format, text and bytes, its corners in the image, its orientation, error correction and version, its add-on and
its symbology identifier; an image without a code yields an empty array.

### The options of the generation

| Option | |
|---|---|
| `output` | `'png'` (by default), `'svg'` or `'raw'` |
| `scale` | the module size (the narrowest bar, a square of a matrix code): pixels in PNG and raw, SVG units; an integer from 1 to 100, 4 by default |
| `height` | a linear format's bar height, in modules |
| `quietZone` | `true` for the quiet zones of the format's standard (by default), `false` for none, or a number of modules |
| `showText` | whether a linear format shows its content under its bars (from a `scale` of 2 in PNG and raw); `true` by default |
| `foreground`, `background` | the colors, `#RRGGBB` or `#RRGGBBAA` (`#FFFFFF00`: a transparent background) |
| `rotate` | 0, 90, 180 or 270 degrees, clockwise |
| `errorCorrection` | `'L'`, `'M'`, `'Q'`, `'H'` for QR Code; `'L'`, `'M'`, `'Q'` for Micro QR Code; `'M'`, `'H'` for rMQR Code; 0 to 8 for PDF417; 1 to 4 for Aztec |
| `version` | a matrix code's size: 1 to 40 for QR Code, 1 to 4 for Micro QR Code, 1 to 38 for rMQR Code, 1 to 48 for Data Matrix, 1 to 36 for Aztec |
| `gs1` | the content is GS1 data, `[01]09506000134352[17]261231` or `(01)09506000134352(17)261231` (Code 128, QR Code, rMQR Code, Data Matrix, Aztec; the DataBar Expanded formats always take GS1 data) |
| `eci` | the content's character set (26 UTF-8, 3 ISO-8859-1, 20 Shift JIS...) |
| `addOn` | an EAN or UPC add-on: 2 or 5 digits |

A symbol option (`errorCorrection`, `version`, `gs1`, `eci`, `addOn`) specified for a format that does not take it
throws `BarcodeOptionException`; a presentation option (`height`, `showText`, `quietZone`) is ignored by formats without
it. `barcodeFormats` lists the options each format takes.

### The options of the reading

| Option | |
|---|---|
| `formats` | the formats looked for; all of them by default |
| `tryHarder`, `tryRotate`, `tryInvert`, `tryDownscale` | spend more time on codes that are hard to read, turned, light on dark, or in large images; `true` by default |
| `pure` | the image holds a single code, straight, with nothing around it (an image made by `generate()`): the fastest read |
| `maxSymbols` | the maximum number of codes to read |
| `addOn` | the add-ons of EAN and UPC codes: `'read'` (by default), `'ignore'` or `'require'` |

An image is refused with `BarcodeImageException` when it cannot be decoded, or before its pixels are decoded when it
has more than 50 million pixels.

### The formats

| Formats | Read as | Text read |
|---|---|---|
| `EAN13`, `EAN8` | themselves | the digits and their check digit |
| `UPCA`, `UPCE` | `EAN13` (`UPCA` when `formats` requests it without `EAN13`), `UPCE` | 13 digits (ISO/IEC 15420): a 0, then the UPC-A |
| `ISBN` | `EAN13` | its 13 digits |
| `DataBar`, `DataBarStacked`, `DataBarStackedOmni`, `DataBarLimited`, `DataBarExpanded`, `DataBarExpandedStacked` | themselves; `DataBarStackedOmni` as `DataBarStacked` | GS1 data, `(01)09506000134352` |
| `Code128`, `Code39`, `Code39Extended`, `Code93`, `Codabar`, `Telepen`, `DXFilmEdge` | themselves | the content |
| `Code32`, `PZN` | themselves | the pharmacode with its check digit: `A123456788`, `-12345678` |
| `ITF`, `ITF14` | `ITF` | the digits (and ITF-14's check digit) |
| `QRCode`, `MicroQRCode`, `RMQRCode`, `DataMatrix`, `PDF417`, `CompactPDF417`, `MicroPDF417`, `Aztec`, `AztecRune`, `MaxiCode` | themselves; `CompactPDF417` as `PDF417`, `AztecRune` as `Aztec` | the content |

Some formats are read as another format because zxing-cpp cannot distinguish them: a UPC-A is an EAN-13 starting with 0,
an ISBN one starting with 978 or 979; the others are read as their family. `barcodeFormats` provides this format
(`reads`) for each one. Their contents are read back as they were generated.

### Options of the component

`buildBarcodeOptions()` declares a component under a name, with defaults, a time limit and a concurrency; the
configuration may register several under different names, each with its own options. Other objects inject it by its name
(`@Inject('labels')`) or obtain it with `getObject('labels')`:

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Barcode, buildBarcodeOptions} from '@lakutata/barcode'

class Tickets extends Component {
    @Inject('labels')
    protected readonly labels: Barcode

    public async ticket(id: string): Promise<Buffer> {
        return await this.labels.generate('QRCode', `https://example.com/tickets/${id}`)
    }
}

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            labels: buildBarcodeOptions({defaults: {generate: {scale: 6}, read: {formats: ['QRCode']}}, timeout: 5000}),
            tickets: {class: Tickets}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const tickets: Tickets = await app.getObject<Tickets>('tickets')
        const labels: Barcode = await app.getObject<Barcode>('labels')
        console.log((await labels.read(await tickets.ticket('1001')))[0].text)    //https://example.com/tickets/1001
    })
```

A registered component is injected only by its name: `@Inject(Barcode)` injects a different component, autoloaded with
the default options; the configuration's options do not apply to it.

| Option | |
|---|---|
| `defaults` | the options of `generate()` and `read()`, before the call's own options |
| `timeout` | an operation's time limit, in milliseconds; 0 (none) by default |
| `concurrency` | how many of the component's operations may run at the same time, the others waiting; no limit by default (the addon queues them on its threads) |
| `drainTimeout` | how long its destruction waits for running operations; 10000 milliseconds by default |

Every call also takes a `signal` and a `timeout`, which count from the call. An operation waiting for its turn is
dropped when it is canceled or timed out; one already running cannot be stopped (zint and zxing-cpp have no checkpoint):
its promise is rejected immediately and its result discarded when it ends. The addon runs its operations in its own
threads (`LAKUTATA_BARCODE_THREADS`, otherwise one fewer than the number of processors), not in the libuv thread pool.

### Without the container

A script, a test or code outside a Lakutata application obtains the component from a `Container`:

```typescript
import {Container} from 'lakutata'
import {Barcode} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)
console.log((await barcode.read(await barcode.generate('DataMatrix', 'lakutata')))[0].text)
await container.destroy()
```

## API

| Export | What it is |
|---|---|
| `Barcode` | The component: `generate()` and `read()` |
| `buildBarcodeOptions`, `BarcodeConfig` | A component's options in the configuration (`defaults`, `timeout`, `concurrency`, `drainTimeout`) |
| `BARCODE_FORMATS`, `BarcodeFormat` | The format names |
| `barcodeFormats`, `BarcodeFormatInfo` | Each format with the format it is read as (`reads`) and the symbol options it takes (`errorCorrection`, `versions`, `gs1`, `eci`, `addOn`, `text`) |
| `GenerateOptions`, `ReadOptions`, `OperationOptions` | The options of `generate()` and `read()`, and those common to both (`signal`, `timeout`) |
| `RawImage` | Pixels: `data`, `width`, `height`, `channels` |
| `BarcodeResult`, `BarcodePoint` | A code read: `format`, `text`, `bytes`, `position`, `orientation`, `errorCorrectionLevel`, `version`, `symbologyIdentifier`, `addOn`, `gs1`, `mirrored`, `inverted`, `structuredAppend`; a point of its position |
| `BarcodeException`, `BarcodeContentException`, `BarcodeOptionException`, `BarcodeImageException`, `BarcodeTimeoutException`, `BarcodeCancelledException` | The package's exceptions (see [Errors](#errors)) |

## Errors

| Error | When |
|---|---|
| `BarcodeContentException` | Content the format cannot encode (characters it does not accept, a wrong length, too long for the requested version), with the reason zint reports |
| `BarcodeOptionException` | A symbol option the format does not take, or a value out of its range: `errorCorrection` for Code 128, `version: 41` for QR Code |
| `BarcodeImageException` | An image that cannot be decoded or has more than 50 million pixels; pixels that are not `width × height × channels` bytes |
| `BarcodeTimeoutException` | The operation's time limit passed |
| `BarcodeCancelledException` | The operation's signal aborted, or the component destroyed |
| `BarcodeException` | The base of the others, thrown itself for an internal addon error |
| `InvalidMethodAcceptException` (`lakutata`) | An argument of the wrong type: an unknown format, a color not written `#RRGGBB`, a `scale` that is not an integer from 1 to 100 |

## See also

- [zint](https://zint.org.uk) and [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp): the libraries with which the
  addon generates and reads the codes.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon and their licenses. The package itself is licensed
  under the MIT license.
