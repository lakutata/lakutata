# Lakutata Barcode

The `@lakutata/barcode` package generates barcodes and QR codes and reads them from images: product labels, shipping
labels, tickets and links printed as QR codes, scanned from uploaded photos or camera frames. It is not part of
`lakutata`: install it separately. Its main features:

- **What it generates, it reads back**: 32 linear and matrix formats, from EAN-13, UPC, Code 128 and the GS1 DataBar to
  QR Code, Data Matrix, PDF417, Aztec and MaxiCode. Formats that only one side handles (the postal codes, Han Xin,
  DotCode…) are left out.
- **Generated** as a PNG, an SVG or pixels, with the requested size, colors, rotation and error correction.
- **Read** from PNG, JPEG, GIF, BMP, WebP and TGA images, or from pixels; every code in an image, with its position.
- **A component**, `Barcode`, injected without being registered, with the default options; components registered
  under names in the configuration have their own defaults, time limit and concurrency. Every call can take a time
  limit, and can be canceled.
- **A native addon** built on [zint](https://zint.org.uk) and [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp),
  compiled when the package is installed on Linux, macOS and Windows, and by `lakutata mobile stage` for Android, iOS
  and HarmonyOS mobile applications; it also runs in Bun and in Electron's main process. Its work runs in its own
  threads, never in the JavaScript thread.

The `@lakutata/barcode` README describes every option; this guide describes what the package is for, with an example
of each use.

```bash
npm install @lakutata/barcode
```

The addon is compiled when the package is installed, so the machine needs Python 3 and a C++20 compiler (the Xcode
Command Line Tools, `build-essential` or `build-base` on Linux, the Visual Studio Build Tools on Windows). The package
manager has to run the package's install script: npm runs it, and may warn that the script is "not yet covered by
allowScripts" (`npm install-scripts approve @lakutata/barcode` records that you allow it); Bun and pnpm run it only for
packages they are told to trust (`trustedDependencies` in the package.json for Bun, `pnpm
approve-builds` for pnpm). The component needs `@lakutata/core`, a peer dependency that `lakutata` brings.

## 1. Generating a code

`generate(format, content, options)` takes the content as text, encoded in UTF-8, or as bytes (a `Uint8Array`), and
returns a PNG by default:

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

- A matrix code's size (its version) and the way its content is encoded are chosen to fit the content: the smallest
  symbol that holds it, unless `version` requests one.
- Pixels are gray in black and white (1 byte per pixel), RGB with colors (3), RGBA with transparency (4): what a
  canvas, an image library or a printer driver takes.
- Content that the format cannot encode (letters in an EAN-13, content too long for the requested version) throws
  `BarcodeContentException`, with the reason zint reports.

In an application, the component is injected instead of taken from a container; for custom options, register a
component under a name in the configuration and inject it by that name (section 5).

## 2. Size, colors and printing

`scale` is the size of a module, the narrowest bar or a square of a matrix code: pixels in a PNG and in pixels, units
in an SVG. It is a whole number, so a PNG's bars keep sharp edges. For print, the module size in millimetres determines
the scale: `scale = mm × dpi / 25.4`, rounded. An EAN-13 has 0.33 mm modules at its nominal size, and may be printed
at 80% to 200% of it: on a 203 dpi thermal label printer, a scale of 3 yields 0.375 mm modules (114%); at 300 dpi, a
scale of 4 yields 0.34 mm. An SVG prints at any size: its scale only sets its units.

- `height` sets a linear format's bar height, in modules, so it follows the scale.
- `showText` prints the content under a linear format's bars, from a scale of 2 in a PNG or in pixels (the font needs
  2 pixels per module).
- `quietZone` keeps the margins the format's standard requires (by default); a scanner needs them to find the code, so
  a label without them must leave the space around the code blank.
- `foreground` and `background` take `#RRGGBB` and `#RRGGBBAA`. Keep dark bars on a light background: the package also
  reads light on dark (`tryInvert`), but many scanners do not. A transparent background is read as if it were white.
- `rotate` turns the code by 90, 180 or 270 degrees, clockwise, for a label printed sideways.
- `errorCorrection` lets a matrix code be read with part of it damaged or covered: from `'L'` (about 7%) to `'H'`
  (about 30%) for QR Code. A higher level produces a larger code for the same content.

## 3. EAN, UPC and GS1

Retail formats compute their check digit, and verify the one they receive:

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

- **UPC.** A UPC-A is an EAN-13 that starts with 0, and is read as an `EAN13` of 13 digits: `01234567890` yields
  `0012345678905`. Requesting `formats: ['UPCA']` without `EAN13` yields the format `UPCA`, with the same 13 digits. An
  ISBN is also read as an `EAN13`.
- **Add-ons.** The 2- or 5-digit add-on (an issue number, a price) is in `addOn`, separately from the text. With
  `addOn: 'require'`, a read keeps only codes that have one.
- **GS1.** Application identifiers are written in brackets or parentheses; with `gs1: true`, Code 128 becomes GS1-128,
  and QR Code, Data Matrix and Aztec also take GS1 data. DataBar Expanded formats always hold GS1 data; other DataBar
  formats hold a GTIN, specified with or without its check digit. A read returns the data in parentheses, with
  `gs1: true`.

The package README lists, format by format, the format it is read as and the text a read returns.

## 4. Reading images

`read(image, options)` takes an image file (its bytes, a `Buffer` or a `Uint8Array`) or pixels, and returns every code
it finds, or an empty array when there is none:

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

- **Faster reads.** `formats` limits the search to the expected formats. `pure: true` reads an
  image that holds one code, straight, with nothing around it, such as an image made by `generate()`.
- **Harder images.** `tryHarder`, `tryRotate`, `tryInvert` and `tryDownscale` are on by default: they look again for
  codes that are small, turned, light on dark or in large images. With them turned off, reading images known to be easy
  is faster.
- **What is not read.** A code whose modules are less than about 2 pixels wide, a blurred photo or one with glare, a
  code cut off by the image's edge. The read then returns fewer codes, or none: it throws only for an image it cannot
  decode (`BarcodeImageException`).
- **Large images** of more than 50 million pixels are refused before their pixels are decoded, so an uploaded file
  cannot make the process allocate gigabytes.
- **The bytes.** `bytes` holds the encoded content; `text` is its readable form (with the check digits, GS1 in
  parentheses), and `symbologyIdentifier` indicates how to interpret the bytes (`]Q1` a QR Code, `]C1` GS1-128…).

## 5. In an application

The component is injected without being registered (`@Inject(Barcode)`), with the default options. For custom options,
register a component in the configuration's `components`: `buildBarcodeOptions()` declares it under a name,
with defaults for `generate()` and `read()`, a time limit and a concurrency; an application may register several, under
different names, each with its own options. The application below registers two, `labels` to print labels and
`scanner` to read photos:

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Barcode, type BarcodeResult, buildBarcodeOptions} from '@lakutata/barcode'

class Warehouse extends Component {
    @Inject('labels')
    protected readonly labels: Barcode

    @Inject('scanner')
    protected readonly scanner: Barcode

    //The label of an item: a Code 128 with its number printed under the bars
    public async label(sku: string): Promise<Buffer> {
        return await this.labels.generate('Code128', sku)
    }

    //The codes of a photo: Code 128 and QR codes only
    public async scan(photo: Buffer): Promise<BarcodeResult[]> {
        return await this.scanner.read(photo)
    }
}

Application
    .run(() => ({
        id: 'warehouse.app',
        name: 'Warehouse',
        components: {
            //A label printer of 203 dpi: modules of 3 pixels, the content under the bars
            labels: buildBarcodeOptions({defaults: {generate: {scale: 3, showText: true}}}),
            //At most 2 seconds a photo
            scanner: buildBarcodeOptions({defaults: {read: {formats: ['Code128', 'QRCode']}}, timeout: 2000}),
            warehouse: {class: Warehouse}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const warehouse: Warehouse = await app.getObject<Warehouse>('warehouse')
        const [code]: BarcodeResult[] = await warehouse.scan(await warehouse.label('LKT-1001'))
        console.log(code.format, code.text)     //Code128 LKT-1001
    })
```

- `buildBarcodeOptions()` declares the component under a name of your choice; other objects inject it by that name
  (`@Inject('labels')`) or obtain it with `getObject('labels')`.
- A registered component is injected only by its name: `@Inject(Barcode)` injects a different component, autoloaded
  with the default options; the configuration's options do not apply to it.

A controller that serves a product's label as a PNG and reads the codes in an uploaded image:

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

- A call's options override the component's defaults: `this.labels.generate('QRCode', url, {scale: 6})` keeps the
  other defaults.
- Arguments are validated: an unknown format or a color not written `#RRGGBB` is refused with
  `InvalidMethodAcceptException` before the addon is called.
- One component serves every controller at the same time: its calls do not depend on one another, except for its
  `concurrency`.
- In a React Native mobile application (the mobile template), the component runs the same way in the application's
  Node.js: `lakutata mobile stage` compiles the addon from its sources for Android (with the NDK), iOS (Xcode) and
  HarmonyOS (DevEco Studio).

## 6. Time limits, cancellation and concurrency

Every call takes a `signal` (an `AbortSignal`) and a `timeout` in milliseconds, which count from the call; the
component's `timeout` applies to calls without one.

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
  have no point where they could be interrupted: its promise is rejected immediately (`BarcodeTimeoutException`,
  `BarcodeCancelledException`), and its result is discarded when it ends. Operations are short; the time
  limits are there for large photos and hostile uploads.
- `concurrency` limits how many of a component's operations run at the same time; the others wait for their turn, and
  their time limit runs while they wait. Without it, operations queue in the addon's threads.
- The addon runs `LAKUTATA_BARCODE_THREADS` threads, by default one fewer than the number of processors, shared by
  every component; it does not use the libuv thread pool, so file and DNS operations are not held up.
- When the application stops, the component waits for its running operations, for at most `drainTimeout` milliseconds
  (10000 by default); operations still waiting are rejected with `BarcodeCancelledException`, as is every later call.

## 7. Speed

A photo taken with a phone is slower to read than an image made by `generate()`: its code is smaller, turned and
blurred, and the `try…` options work harder on it.

## 8. What it does not do

Some of the following are by design, and the others are not implemented yet:

- Formats that zxing-cpp cannot read back are not generated: the four-state postal codes, Han Xin, DotCode, Code One,
  Grid Matrix, Codablock-F, Code 16K, Code 49 and zint's other stacked formats. Telepen Numeric is also left out, since
  a read takes it for Telepen unless it looks for nothing else.
- A code split over several symbols (structured append) is read symbol by symbol: `structuredAppend` provides each
  symbol's place, and joining their contents is left to the application.
- Pixels are gray, RGB or RGBA; BGR and BGRA (some camera APIs) are converted by the application. A GIF is read from
  its first frame.
- The output is PNG, SVG or pixels: EPS, EMF and PDF are not offered.

## 9. Exceptions

All of them extend `BarcodeException`, which extends the `Exception` of `lakutata`.

| Exception | `errno` | When |
|---|---|---|
| `BarcodeContentException` | `E_BARCODE_CONTENT` | Content the format cannot encode, with the reason zint reports |
| `BarcodeOptionException` | `E_BARCODE_OPTION` | A symbol option the format does not take (`errorCorrection` for Code 128), or a value out of its range (`version: 41`) |
| `BarcodeImageException` | `E_BARCODE_IMAGE` | An image that cannot be decoded or has more than 50 million pixels; pixels that are not `width × height × channels` bytes |
| `BarcodeTimeoutException` | `E_BARCODE_TIMEOUT` | An operation past its time limit |
| `BarcodeCancelledException` | `E_BARCODE_CANCELLED` | An operation whose signal aborted, or a call to a destroyed component |
| `BarcodeException` | `E_BARCODE` | An internal addon error |
