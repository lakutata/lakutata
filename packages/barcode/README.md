# @lakutata/barcode

English | [中文](README.zh-CN.md)

Barcodes and QR codes for the [lakutata](https://github.com/lakutata/lakutata) framework: a component that generates
them (PNG, SVG or pixels) and reads them from images, in a native addon built on [zint](https://zint.org.uk) (the
generation) and [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (the reading). Every format it generates, it reads
back: 32 linear and matrix formats, from EAN-13 and Code 128 to QR Code, Data Matrix, PDF417 and Aztec. The work runs in
the threads of the addon, never in the thread of JavaScript. The `lakutata` package does not re-export this package:
import it from `@lakutata/barcode`.

## Installation

```shell
npm install @lakutata/barcode
```

- The addon is compiled during the installation (node-gyp), so the machine needs Python 3 and a C++20 compiler: the
  Command Line Tools of Xcode on macOS, `build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, the Build
  Tools of Visual Studio ("Desktop development with C++") on Windows. Compiling takes from about half a minute to a few
  minutes. If it fails, the installation fails.
- The package manager has to run the install script of the package. npm runs it, and may warn that the script is "not
  yet covered by allowScripts": `npm install-scripts approve @lakutata/barcode` records that you allow it. Bun and pnpm
  run it only for the dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error telling how to build the addon.
- Node.js `>=18.10.0`.
- The addon uses Node-API, so Bun and the main process of Electron load the addon node-gyp built for Node.js, without a
  rebuild.

## Usage

### Generating and reading

Inject the component: it needs no registration.

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

    public async scan(photo: Buffer): Promise<string[]> {
        //A PNG, JPEG, GIF, BMP, WebP or TGA, or pixels
        const results: BarcodeResult[] = await this.barcode.read(photo, {formats: ['QRCode', 'EAN13']})
        return results.map((result: BarcodeResult): string => `${result.format}: ${result.text}`)
    }
}
```

`generate(format, content, options)` takes the content as text (UTF-8) or as bytes (a `Uint8Array`), and gives a
`Buffer` (PNG), a string (SVG) or a `RawImage` (`output: 'raw'`). `read(image, options)` gives the codes found, each
with its format, its text and its bytes, its corners in the image, its orientation, its error correction and its version,
its add-on, its symbology identifier; an image without a code gives an empty array.

### The options of the generation

| Option | |
|---|---|
| `output` | `'png'` (by default), `'svg'` or `'raw'` |
| `scale` | the size of a module (the narrowest bar, a square of a matrix code): pixels in PNG and raw, units of the SVG; an integer from 1 to 100, 4 by default |
| `height` | the height of the bars of a linear format, in modules |
| `quietZone` | `true` for the quiet zones of the standard of the format (by default), `false` for none, or a number of modules |
| `showText` | whether a linear format shows its content under its bars (from a `scale` of 2 in PNG and raw); `true` by default |
| `foreground`, `background` | the colors, `#RRGGBB` or `#RRGGBBAA` (`#FFFFFF00`: a transparent background) |
| `rotate` | 0, 90, 180 or 270 degrees, clockwise |
| `errorCorrection` | `'L'`, `'M'`, `'Q'`, `'H'` for QR Code; `'L'`, `'M'`, `'Q'` for Micro QR Code; `'M'`, `'H'` for rMQR Code; 0 to 8 for PDF417; 1 to 4 for Aztec |
| `version` | the size of a matrix code: 1 to 40 for QR Code, 1 to 4 for Micro QR Code, 1 to 38 for rMQR Code, 1 to 48 for Data Matrix, 1 to 36 for Aztec |
| `gs1` | the content is GS1 data, `[01]09506000134352[17]261231` or `(01)09506000134352(17)261231` (Code 128, QR Code, rMQR Code, Data Matrix, Aztec; the DataBar Expanded formats always take GS1 data) |
| `eci` | the character set of the content (26 UTF-8, 3 ISO-8859-1, 20 Shift JIS...) |
| `addOn` | the add-on of an EAN or a UPC: 2 or 5 digits |

An option of the symbol (`errorCorrection`, `version`, `gs1`, `eci`, `addOn`) given for a format that does not take it
throws `BarcodeOptionException`; an option of the presentation (`height`, `showText`, `quietZone`) is ignored by the
formats without it. `barcodeFormats` lists the options each format takes.

### The options of the reading

| Option | |
|---|---|
| `formats` | the formats looked for; all of them by default |
| `tryHarder`, `tryRotate`, `tryInvert`, `tryDownscale` | spend more time on the codes that are hard to read, turned, light on dark, in large images; `true` by default |
| `pure` | the image holds a single code, straight, with nothing around (an image made by `generate()`): the fastest read |
| `maxSymbols` | the largest number of codes to read |
| `addOn` | the add-ons of EAN and UPC codes: `'read'` (by default), `'ignore'` or `'require'` |

An image is refused with `BarcodeImageException` when it cannot be decoded, or before its pixels are decoded when it
has more than 50 million pixels.

### The formats

| Formats | Read as | The text read |
|---|---|---|
| `EAN13`, `EAN8` | themselves | the digits and their check digit |
| `UPCA`, `UPCE` | `EAN13` (`UPCA` when `formats` asks for it without `EAN13`), `UPCE` | 13 digits (ISO/IEC 15420): a 0, then the UPC-A |
| `ISBN` | `EAN13` | its 13 digits |
| `DataBar`, `DataBarStacked`, `DataBarStackedOmni`, `DataBarLimited`, `DataBarExpanded`, `DataBarExpandedStacked` | themselves; `DataBarStackedOmni` as `DataBarStacked` | GS1 data, `(01)09506000134352` |
| `Code128`, `Code39`, `Code39Extended`, `Code93`, `Codabar`, `Telepen`, `DXFilmEdge` | themselves | the content |
| `Code32`, `PZN` | themselves | the pharmacode with its check digit: `A123456788`, `-12345678` |
| `ITF`, `ITF14` | `ITF` | the digits (and the check digit of ITF-14) |
| `QRCode`, `MicroQRCode`, `RMQRCode`, `DataMatrix`, `PDF417`, `CompactPDF417`, `MicroPDF417`, `Aztec`, `AztecRune`, `MaxiCode` | themselves; `CompactPDF417` as `PDF417`, `AztecRune` as `Aztec` | the content |

Some formats are read as another one because zxing-cpp cannot tell them apart: a UPC-A is an EAN-13 starting with 0, an
ISBN one starting with 978 or 979; the others are read as their family. `barcodeFormats` gives this format (`reads`) for
each one. Their contents are read back as they were generated.

### Options of the component

Register the component with `buildBarcodeOptions()` to give it defaults, a time limit and a concurrency, or to have
several of them, each with its own options:

```typescript
import {Application} from 'lakutata'
import {Barcode, buildBarcodeOptions} from '@lakutata/barcode'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            labels: buildBarcodeOptions({defaults: {generate: {scale: 6}, read: {formats: ['QRCode']}}, timeout: 5000})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const labels: Barcode = await app.getObject('labels')
        console.log((await labels.read(await labels.generate('QRCode', 'shop.app')))[0].text)
    })
```

| Option | |
|---|---|
| `defaults` | the options of `generate()` and of `read()` before the ones of the call |
| `timeout` | the time limit of an operation, in milliseconds; 0 (none) by default |
| `concurrency` | the operations of the component running at once, the others waiting; no limit by default (the addon queues them on its threads) |
| `drainTimeout` | how long its destruction waits for the operations running; 10000 milliseconds by default |

Every call also takes a `signal` and a `timeout`, which count from the call. An operation waiting for its turn is
dropped when it is cancelled or timed out; one already running cannot be stopped (zint and zxing-cpp have no
checkpoint): its promise is rejected at once and its result discarded when it ends. The addon runs its operations in
its own threads (`LAKUTATA_BARCODE_THREADS`, else the processors less one), not in the thread pool of libuv.

### Without the container

A script, a test or code outside of a lakutata application takes the component from a `Container`:

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
| `buildBarcodeOptions`, `BarcodeConfig` | The options of a component in the configuration (`defaults`, `timeout`, `concurrency`, `drainTimeout`) |
| `BARCODE_FORMATS`, `BarcodeFormat` | The names of the formats |
| `barcodeFormats`, `BarcodeFormatInfo` | Each format with the format it is read as (`reads`) and the options of its symbol it takes (`errorCorrection`, `versions`, `gs1`, `eci`, `addOn`, `text`) |
| `GenerateOptions`, `ReadOptions`, `OperationOptions` | The options of `generate()` and of `read()`, and the ones of both (`signal`, `timeout`) |
| `RawImage` | Pixels: `data`, `width`, `height`, `channels` |
| `BarcodeResult`, `BarcodePoint` | A code read: `format`, `text`, `bytes`, `position`, `orientation`, `errorCorrectionLevel`, `version`, `symbologyIdentifier`, `addOn`, `gs1`, `mirrored`, `inverted`, `structuredAppend`; a point of its position |
| `BarcodeException`, `BarcodeContentException`, `BarcodeOptionException`, `BarcodeImageException`, `BarcodeTimeoutException`, `BarcodeCancelledException` | The exceptions of the package (see [Errors](#errors)) |

## Errors

| Error | When |
|---|---|
| `BarcodeContentException` | A content the format cannot encode (characters it does not take, a wrong length, too long for the version asked), with the reason given by zint |
| `BarcodeOptionException` | An option of the symbol the format does not take, or a value out of its range: `errorCorrection` for Code 128, `version: 41` for QR Code |
| `BarcodeImageException` | An image that cannot be decoded or has more than 50 million pixels; pixels that are not `width × height × channels` bytes |
| `BarcodeTimeoutException` | The time limit of the operation passed |
| `BarcodeCancelledException` | The signal of the operation aborted, or the component destroyed |
| `BarcodeException` | The base of the others, thrown itself for an internal error of the addon |
| `InvalidMethodAcceptException` (lakutata) | An argument of the wrong type: an unknown format, a color not written `#RRGGBB`, a `scale` that is not an integer from 1 to 100 |

## See also

- [zint](https://zint.org.uk) and [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp): the libraries the addon generates and
  reads the codes with.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon and their licenses. The package itself is under the MIT
  license.
