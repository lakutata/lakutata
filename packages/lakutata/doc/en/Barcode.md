# Lakutata Barcode

The package `@lakutata/barcode` generates barcodes and QR codes and reads them from images: product labels, shipping
labels, tickets and links printed as QR codes, scanned from uploaded photos or from the frames of a camera. It is not
part of `lakutata`: install it on its own. What it is like:

- **What it generates, it reads back**: 32 linear and matrix formats, from EAN-13, UPC, Code 128 and the GS1 DataBar to
  QR Code, Data Matrix, PDF417, Aztec and MaxiCode. The formats only one side handles (the postal codes, Han Xin,
  DotCode…) are left out.
- **Generated** as a PNG, an SVG or pixels, at the size, in the colors and the rotation, with the error correction asked
  for.
- **Read** from PNG, JPEG, GIF, BMP, WebP and TGA images, or from pixels; every code of an image, with its position.
- **A component**, `Barcode`, injected without being registered, with defaults, time limits, cancellation and a
  concurrency.
- **A native addon** built on [zint](https://zint.org.uk) and [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp),
  compiled when the package is installed on Linux, macOS and Windows, and by `lakutata mobile stage` for the mobile
  applications of Android, iOS and HarmonyOS; it also runs in Bun and in the main process of Electron. Its work runs in
  its own threads, never in the thread of JavaScript.

The README of `@lakutata/barcode` describes every option; this guide goes through what the package is for, with an
example of each use.

```bash
npm install @lakutata/barcode
```

The addon is compiled when the package is installed, so the machine needs Python 3 and a C++20 compiler (the Command
Line Tools of Xcode, `build-essential` or `build-base` on Linux, the Build Tools of Visual Studio on Windows). The
package manager has to run the install script of the package: npm runs it, and may warn that the script is "not yet
covered by allowScripts" (`npm install-scripts approve @lakutata/barcode` records that you allow it); Bun and pnpm run
it only for the packages they are told to trust (`trustedDependencies` in the package.json for Bun, `pnpm
approve-builds` for pnpm). The component needs `@lakutata/core`, a peer dependency that `lakutata` brings.

## 1. Generating a code

`generate(format, content, options)` takes the content as text, encoded in UTF-8, or as bytes (a `Uint8Array`), and
gives a PNG by default:

```typescript
import {Container} from 'lakutata'
import {Barcode, type RawImage} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)

const png: Buffer = await barcode.generate('QRCode', 'https://example.com/orders/123')
const svg: string = await barcode.generate('DataMatrix', 'LKT-1001', {output: 'svg'})
const pixels: RawImage = await barcode.generate('Code128', 'LKT-1001', {output: 'raw', scale: 2})
console.log(png.length, svg.length)                          //704 1008
console.log(pixels.width, pixels.height, pixels.channels)    //264 116 1

await container.destroy()
```

- The size of a matrix code (its version) and the way its content is encoded are chosen for the content: the smallest
  symbol that holds it, unless `version` asks for one.
- The pixels are gray in black and white (1 byte a pixel), RGB with colors (3), RGBA with transparency (4): what a
  canvas, an image library or a printer driver takes.
- A content the format cannot encode (letters in an EAN-13, too long for the version asked) throws
  `BarcodeContentException`, with the reason given by zint.

In an application, the component is injected instead of taken from a container (section 5).

## 2. Size, colors and printing

`scale` is the size of a module, the narrowest bar or a square of a matrix code: pixels in a PNG and in pixels, units
in an SVG. It is a whole number, so the bars of a PNG keep sharp edges. For print, the size of a module in millimetres
gives the scale: `scale = mm × dpi / 25.4`, rounded. An EAN-13 has modules of 0.33 mm at its nominal size, and may be
printed from 80% to 200% of it: on a thermal label printer of 203 dpi, a scale of 3 gives modules of 0.375 mm (114%);
at 300 dpi, a scale of 4 gives 0.34 mm. An SVG prints at any size: its scale only sets its units.

- `height` sets the height of the bars of a linear format, in modules, so it follows the scale.
- `showText` prints the content under the bars of a linear format, from a scale of 2 in a PNG or in pixels (the font
  needs 2 pixels a module).
- `quietZone` keeps the margins the standard of the format asks for (by default); a scanner needs them to find the code,
  so a label without them must leave the space around the code blank.
- `foreground` and `background` take `#RRGGBB` and `#RRGGBBAA`. Keep dark bars on a light background: the package
  reads light on dark too (`tryInvert`), but many scanners do not. A transparent background is read as if it were white.
- `rotate` turns the code by 90, 180 or 270 degrees, clockwise, for a label printed sideways.
- `errorCorrection` lets a matrix code be read with part of it damaged or covered: from `'L'` (about 7%) to `'H'`
  (about 30%) for QR Code. A higher level makes a larger code for the same content.

## 3. EAN, UPC and GS1

The retail formats compute their check digit, and verify the one they are given:

```typescript
import {Container} from 'lakutata'
import {Barcode, type BarcodeResult, BarcodeContentException} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)

//12 digits: the check digit is computed
const ean: Buffer = await barcode.generate('EAN13', '590123412345', {addOn: '12'})
const [product]: BarcodeResult[] = await barcode.read(ean)
console.log(product.format, product.text, product.addOn)        //EAN13 5901234123457 12

//13 digits: the check digit is verified
await barcode.generate('EAN13', '5901234123458').catch((error: BarcodeContentException) => console.log(error.message))
//Error 275: Invalid check digit '8', expecting '7'

//A logistics label: the GTIN, the expiry date and the batch
const gs1: Buffer = await barcode.generate('Code128', '[01]09506000134352[17]261231[10]ABC123', {gs1: true})
const [label]: BarcodeResult[] = await barcode.read(gs1)
console.log(label.text, label.gs1, label.symbologyIdentifier)   //(01)09506000134352(17)261231(10)ABC123 true ]C1

await container.destroy()
```

- **UPC.** A UPC-A is an EAN-13 that starts with 0, and is read as an `EAN13` of 13 digits: `01234567890` gives
  `0012345678905`. Asking for `formats: ['UPCA']` without `EAN13` gives the format `UPCA`, with the same 13 digits. An
  ISBN is read as an `EAN13` too.
- **Add-ons.** The add-on of 2 or 5 digits (an issue number, a price) is in `addOn`, apart from the text. With
  `addOn: 'require'`, a read keeps only the codes that have one.
- **GS1.** The application identifiers are written in brackets or in parentheses; with `gs1: true`, Code 128 becomes
  GS1-128, and QR Code, Data Matrix and Aztec take GS1 data too. The DataBar Expanded formats always hold GS1 data; the
  other DataBar formats hold a GTIN, given with or without its check digit. A read gives the data in parentheses, with
  `gs1: true`.

The README of the package lists, format by format, the format it is read as and the text a read gives.

## 4. Reading images

`read(image, options)` takes an image file (its bytes, a `Buffer` or a `Uint8Array`) or pixels, and gives every code it
finds, an empty array when there is none:

```typescript
import {readFileSync} from 'node:fs'
import {Container} from 'lakutata'
import {Barcode, type BarcodeResult, type RawImage} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)

const photo: Buffer = readFileSync('qrcode.jpeg')
for (const result of await barcode.read(photo, {formats: ['QRCode', 'DataMatrix']})) {
    console.log(result.format, result.text, result.position.topLeft, result.orientation)
    //QRCode https://lakutata.com/fixtures { x: 16, y: 16 } 0
}

//Pixels: 1 byte a pixel in gray, 3 in RGB, 4 in RGBA (the ImageData of a canvas, a decoded video frame)
const frame: RawImage = await barcode.generate('DataMatrix', 'LKT-1001', {output: 'raw'})
const rgba: Uint8Array = new Uint8Array(frame.width * frame.height * 4)
frame.data.forEach((gray: number, index: number): void => rgba.set([gray, gray, gray, 255], index * 4))
const results: BarcodeResult[] = await barcode.read({data: rgba, width: frame.width, height: frame.height, channels: 4})
console.log(results.map((result: BarcodeResult): string => result.text))   //[ 'LKT-1001' ]

await container.destroy()
```

- **Faster reads.** `formats` limits the search to the formats expected: reading a QR Code in a 1920×1080 frame takes
  about 8 ms looking for every format, 1.4 ms looking for QR codes only (section 7). `pure: true` reads an image that
  holds one code, straight, with nothing around it, such as an image made by `generate()`.
- **Harder images.** `tryHarder`, `tryRotate`, `tryInvert` and `tryDownscale` are on by default: they look again for
  codes that are small, turned, light on dark or in large images. Turned off, a read of images known to be easy is
  faster.
- **What is not read.** A code whose modules are less than about 2 pixels wide, a blurred or a glaring photo, a code cut
  by the edge of the image. The read then gives fewer codes, or none: it throws only for an image it cannot decode
  (`BarcodeImageException`).
- **Large images** of more than 50 million pixels are refused before their pixels are decoded, so an uploaded file
  cannot make the process allocate gigabytes.
- **The bytes.** `bytes` holds the content as it is encoded; `text` is its readable form (with the check digits, GS1 in
  parentheses), and `symbologyIdentifier` tells how to read the bytes (`]Q1` a QR Code, `]C1` GS1-128…).

## 5. In an application

The component is injected without being registered, with its default options. Registered with
`buildBarcodeOptions()`, it gets defaults of its own for `generate()` and `read()`, a time limit and a concurrency; an
application may register several, under different names. A controller that serves the label of a product as a PNG and
reads the codes of an uploaded image:

```typescript
import express, {type Express, type Request} from 'express'
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, type FileResult, Result} from 'lakutata/com/entrypoint'
import {GET, POST} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {Barcode, type BarcodeResult, buildBarcodeOptions} from '@lakutata/barcode'

class LabelDTO extends DTO {
    @Expect(DTO.String().pattern(/^\d{12,13}$/).required())
    public ean: string
}

class ScanDTO extends DTO {
    @Expect(DTO.Binary().required())
    public image: Buffer
}

class LabelController extends Controller {
    @Inject('labels')
    protected readonly labels: Barcode

    //GET /labels/590123412345: the EAN-13 of a product, as a PNG
    @GET('/labels/:ean', LabelDTO)
    public async label(input: LabelDTO): Promise<FileResult> {
        return Result.file(await this.labels.generate('EAN13', input.ean), {contentType: 'image/png'})
    }

    //POST /scans, an image as its body: the codes found in it
    @POST('/scans', ScanDTO)
    public async scan(input: ScanDTO): Promise<{ format: string, text: string }[]> {
        const results: BarcodeResult[] = await this.labels.read(input.image)
        return results.map((result: BarcodeResult) => ({format: result.format, text: result.text}))
    }
}

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        labels: buildBarcodeOptions({defaults: {generate: {scale: 3}, read: {formats: ['EAN13', 'QRCode']}}, timeout: 10000}),
        entrypoint: buildEntrypoints({
            controllers: [LabelController],
            http: expressHTTPEntrypoint({
                port: 8080,
                before: (app: Express): void => {
                    //The body of POST /scans is the image
                    app.post('/scans', express.raw({type: 'image/*', limit: '10mb'}))
                },
                input: (request: Request): Record<string, unknown> => Buffer.isBuffer(request.body) ? {image: request.body} : {...request.query, ...request.body}
            })
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl -s -o label.png localhost:8080/labels/590123412345
$ curl -s --data-binary @label.png -H 'Content-Type: image/png' localhost:8080/scans
[{"format":"EAN13","text":"5901234123457"}]
```

- The options of a call go over the defaults of the component: `this.labels.generate('QRCode', url, {scale: 6})` keeps
  the other defaults.
- The arguments are validated: an unknown format or a color not written `#RRGGBB` is refused with
  `InvalidMethodAcceptException` before the addon is called.
- One component serves every controller at once: its calls do not depend on one another, except for its
  `concurrency`.
- In a mobile application of React Native (the mobile template), the component runs in the Node.js of the application in
  the same way: `lakutata mobile stage` compiles the addon from its sources for Android (with the NDK), iOS (Xcode) and
  HarmonyOS (DevEco Studio).

## 6. Time limits, cancellation and concurrency

Every call takes a `signal` (an `AbortSignal`) and a `timeout` in milliseconds, which count from the call; the
`timeout` of the component applies to the calls without one.

```typescript
import {readFileSync} from 'node:fs'
import {Container} from 'lakutata'
import {Barcode, type BarcodeResult} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)
const photo: Buffer = readFileSync('qrcode.jpeg')

//At most 2 seconds, the wait for its turn included
const results: BarcodeResult[] = await barcode.read(photo, {timeout: 2000})

//Until the scan is cancelled
const scan: AbortController = new AbortController()
const reading: Promise<BarcodeResult[]> = barcode.read(photo, {signal: scan.signal})
scan.abort()
await reading.catch((error: Error) => console.log(error.constructor.name))   //BarcodeCancelledException

await container.destroy()
```

- An operation that has not started yet is dropped. One that is running cannot be stopped, since zint and zxing-cpp
  have no point where they could be interrupted: its promise is rejected at once (`BarcodeTimeoutException`,
  `BarcodeCancelledException`), and its result is discarded when it ends. The operations are short (section 7); the
  time limits are there for the large photos and the hostile uploads.
- `concurrency` limits the operations of a component running at once; the others wait for their turn, and their time
  limit runs while they wait. Without it, the operations queue in the threads of the addon.
- The addon runs `LAKUTATA_BARCODE_THREADS` threads, by default one less than the processors, shared by every
  component; it does not use the thread pool of libuv, so file and DNS operations are not held up.
- When the application stops, the component waits for its operations running, at most `drainTimeout` milliseconds
  (10000 by default); the operations still waiting are rejected with `BarcodeCancelledException`, and so is every call
  after that.

## 7. Speed

Measured on an Apple M4 (Node.js 24, one call at a time unless stated):

| Operation | Time |
|---|---|
| A QR Code of a URL, as a PNG (148×148) | 0.19 ms |
| The same QR Code as pixels / as an SVG | 0.08 ms / 0.17 ms |
| An EAN-13 / a Code 128 as a PNG, with its text | 0.62 ms / 1.6 ms |
| Reading that QR Code PNG, every format / `formats: ['QRCode']` | 0.33 ms / 0.11 ms |
| Reading its pixels, `formats: ['QRCode']`, `pure: true` | 0.06 ms |
| Reading a QR Code in a 1920×1080 frame, every format / `formats: ['QRCode']` | 7.8 ms / 1.4 ms |
| 1000 QR Code PNGs generated at once / read at once (9 threads) | 63 ms / 33 ms |

A photo taken by a phone is slower to read than these images made by `generate()`: its code is smaller, turned and
blurred, and the `try…` options work harder on it.

## 8. How it is checked, and what it does not do

The tests generate every format and read it back from its PNG and from its pixels, with random contents (text in several
scripts, and bytes), check the effect of each option, read images in the seven file formats, and read 240 damaged
images, which must give codes or `BarcodeImageException` and nothing else. They run on macOS (arm64: Node.js 24 and
18.10, Bun 1.4), on Linux (arm64: Node.js 22 on Debian 12, Node.js 24 on Alpine) and on Windows 11 (arm64: Node.js 24);
the package also runs in the main process of Electron 44, and in the mobile applications of Android, iOS and HarmonyOS,
where every format and the seven file formats are read back on their emulators.

What it does not do, whether by design or not yet:

- The formats zxing-cpp cannot read back are not generated: the four-state postal codes, Han Xin, DotCode, Code One,
  Grid Matrix, Codablock-F, Code 16K, Code 49 and the other stacked formats of zint. Telepen Numeric is left out too,
  since a read takes it for Telepen unless it looks for nothing else.
- A code split over several symbols (structured append) is read symbol by symbol: `structuredAppend` gives the place of
  each, and joining their contents is left to the application.
- The pixels are gray, RGB or RGBA; BGR and BGRA (some camera APIs) are converted by the application. A GIF is read
  from its first frame.
- The output is PNG, SVG or pixels: EPS, EMF and PDF are not offered.

## 9. Exceptions

All of them extend `BarcodeException`, which extends the `Exception` of lakutata.

| Exception | `errno` | When |
|---|---|---|
| `BarcodeContentException` | `E_BARCODE_CONTENT` | A content the format cannot encode, with the reason given by zint |
| `BarcodeOptionException` | `E_BARCODE_OPTION` | An option of the symbol the format does not take (`errorCorrection` for Code 128), or a value out of its range (`version: 41`) |
| `BarcodeImageException` | `E_BARCODE_IMAGE` | An image that cannot be decoded or has more than 50 million pixels; pixels that are not `width × height × channels` bytes |
| `BarcodeTimeoutException` | `E_BARCODE_TIMEOUT` | An operation past its time limit |
| `BarcodeCancelledException` | `E_BARCODE_CANCELLED` | An operation whose signal aborted, or a call to a destroyed component |
| `BarcodeException` | `E_BARCODE` | An internal error of the addon |
