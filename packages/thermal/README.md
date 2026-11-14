# @lakutata/thermal

English | [中文](README.zh-CN.md)

Thermal printing for Node.js: receipts, labels and wristbands written in HTML and CSS, rendered by a native addon into
the printer's own dot grid, then encoded as ESC/POS, TSPL or ZPL commands. The rendering is both the print preview and
the printer's data: one picture of black dots, exported as PNG or sent as printer commands. No browser is involved: the
layout is [litehtml](https://github.com/litehtml/litehtml), the glyphs [FreeType](https://freetype.org) in monochrome
with hinting, the graphics [plutovg](https://github.com/sammycage/plutovg) and the SVG
[lunasvg](https://github.com/sammycage/lunasvg). The
fonts are bundled: Noto Sans SC (Source Han Sans), regular and bold.

The package renders and encodes; the `@lakutata/thermal-printer` package is the component that sends the commands to
the printers.

## Installation

```shell
npm install @lakutata/thermal
```

- The addon is compiled during the installation (node-gyp), so the machine requires Python 3 and a C++17 compiler: the
  Xcode Command Line Tools on macOS, `build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, and the
  Visual Studio Build Tools ("Desktop development with C++") on Windows. Compiling takes about ten seconds on a recent
  machine, a few minutes on a slow one. If it fails, the installation fails.
- The package manager has to run the package's install script. npm runs it, and may warn that the script is "not yet
  covered by allowScripts": `npm install-scripts approve @lakutata/thermal` records that you allow it. Bun and pnpm run
  it only for dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error that explains how to build the addon.
- Node.js `>=18.10.0`, with `@lakutata/core`. The addon uses Node-API, so Bun and Electron's main process load the addon
  that node-gyp built for Node.js, without a rebuild.
- The package is a 17 MB download, 28 MB unpacked: the two fonts and the addon's sources.

## Usage

### A receipt

```typescript
import {writeFile} from 'node:fs/promises'
import {render} from '@lakutata/thermal'

const image = await render(`
    <style>
        h1 { text-align: center; font-size: 6mm; margin: 0 0 2mm }
        table { width: 100%; border-collapse: collapse }
        td.price { text-align: right }
        .total td { border-top: 0.3mm solid #000; font-weight: bold }
    </style>
    <h1>Lakeside Café</h1>
    <table>
        <tr><td>Latte</td><td class="price">¥32.00</td></tr>
        <tr><td>Croissant</td><td class="price">¥15.00</td></tr>
        <tr class="total"><td>Total</td><td class="price">¥47.00</td></tr>
    </table>
    <p style="text-align: center"><img style="width: 25mm; height: 25mm" src="qrcode:https%3A%2F%2Fexample.com%2Fr%2F42"></p>
`, {paper: 80})
console.log(image.width, image.height)
await writeFile('preview.png', image.toPNG())
```

`render()` returns a `PrintImage`: its pages of dots (one on a roll), each with its rows of bits (`rows`), `dot(x, y)`
and `toPNG()`.

### The media

Each rendering names its media in one of four ways:

```typescript
import {render} from '@lakutata/thermal'

const html: string = '<p>Hello</p>'
await render(html, {paper: 58})                                 //a 58 mm receipt printer at 203 dpi: 384 dots
await render(html, {width: 72, dpi: 180})                       //a print width of 72 mm at 180 dpi (an Epson TM-T88)
await render(html, {label: {width: 40, height: 30}, dpi: 300})  //a 40 × 30 mm label
await render(html, {label: {width: 25, height: 250}, dpi: 300, rotate: 90, page: {lead: 25.4}})  //a wristband
```

- `paper` is the paper width for 203 dpi receipt printers: `58` (a print width of 48 mm, 384 dots) or `80` (72 mm, 576
  dots). Chinese brands and Epson's 203 dpi models print these widths. A printer with another resolution or print width,
  such as the Epson TM-T88 family and the Bixolon SRP-350 (180 dpi, 512 dots), is specified by `width` and `dpi`: with
  `paper: 80` its output would be cut on the right.
- `width` is the print width, as the printer's specification states it ("print width 72 mm"), not the paper's.
- `label` is the size of a label or a wristband: across the print head (`width`) and along the feed (`height`).
- Sizes are millimetres, or strings with a unit: `'72mm'`, `'2in'`, `'576dots'`. A size is converted to dots rounded
  down, never up: 203 dpi printers are 8 dots per millimetre and 300 dpi ones 12, so their widths come out
  whole; at 180 dpi, 72 mm are 510 dots of a 512-dot head, two dots of margin rather than two dots cut off.
- `dpi` is required by `width` and `label`, and is 203 for `paper`. Wristband printers are often 300 dpi.
- Fixed-length media (`label`, or `width` with `page.length`) are cut into pages: `page.overflow` keeps the first page
  (`'clip'`, the default) or creates as many as the content requires (`'paginate'`).
- `rotate` turns each page clockwise. A wristband printed along the band is laid out along its length, then turned by
  90 or 270. `page.lead` leaves the start of each page blank along the feed, for printers that cannot print there.

### Sizes in the CSS

CSS lengths are real lengths: `mm`, `cm`, `pt` and `px` (1/96 inch) are converted through the printer's resolution, so
a template prints the same size at 180, 203 and 300 dpi. The default text is 12px, about 3 mm, the height of the
printers' own 12 × 24 font. Media queries see the print width, so one template can lay out 58 mm and 80 mm receipts
differently:

```typescript
import {render} from '@lakutata/thermal'

const html: string = `
    <style>
        .columns { display: flex; justify-content: space-between }
        @media (max-width: 50mm) { .columns { display: block } }
    </style>
    <div class="columns"><span>Order 42</span><span>2026-11-07 12:30</span></div>`
const narrow = await render(html, {paper: 58})
const wide = await render(html, {paper: 80})
console.log(narrow.height > wide.height)
```

The CSS litehtml lays out: the box model, `display` (block, inline, inline-block, flex, table), floats, `position`,
borders with rounded corners, backgrounds with linear and radial gradients, `::before` and `::after`, counters, `var()`,
`@media`, `text-transform` (ASCII letters), `white-space`. It does not support `calc()`, grid, `transform`, `opacity`,
`box-shadow`, `letter-spacing` and `@font-face` (fonts are registered by `registerFont()`).

### Pictures and QR codes

- Inline `<svg>` elements, and `<img>` sources: `data:` URLs (PNG, JPEG, GIF, BMP, SVG), and files in the directory
  specified by `baseDir` (`<img src="logo.png">`, `<link rel="stylesheet" href="receipt.css">`). A path outside that
  directory, a remote address (`https:`) and, without `baseDir`, any file are refused.
- `qrcode:` sources draw a QR code on whole dots, as large as its box allows. The text after `qrcode:` is
  percent-encoded (`encodeURIComponent`), and the options follow `#`: `ec` (the error correction, `L`, `M`, `Q` or `H`,
  `M` by default) and `quiet` (the modules of the quiet zone, 4 by default). For example
  `<img style="width: 25mm" src="qrcode:ORDER-42#ec=Q&quiet=2">`.
- Photographs are dithered; SVG and line art are thresholded. A fragment chooses for one picture:
  `<img src="logo.png#threshold">`, `<img src="photo.svg#dither">`.

### Fonts

The bundled Noto Sans SC covers Chinese, Japanese kana, Latin, Greek and Cyrillic, in regular and bold (not Korean
Hangul); it is the font for the generic families (`sans-serif`, `serif`…) and for the characters a registered font
lacks. More fonts are registered once for the process:

```typescript
import {registerFont, render} from '@lakutata/thermal'

await registerFont({family: 'Brand', weight: 700, file: './fonts/brand-bold.ttf'})
const image = await render('<h1 style="font-family: Brand">Lakeside</h1>', {paper: 80})
console.log(image.height)
```

A family registered without the requested weight or style is emboldened or slanted. Scripts that require shaping
(Arabic, Thai, Devanagari) are not supported.

### Printer commands

`encode()` turns a rendering into a printer's commands, by its language or its model:

```typescript
import {encode, render} from '@lakutata/thermal'

const receipt = await render('<h1>Order 42</h1>', {paper: 80})
const escpos: Buffer = encode(receipt, {language: 'escpos', feed: 3, cut: 'partial', drawer: true})

const band = await render('<b>Ward 3 · Bed 12</b>', {model: 'HC100', label: {width: 25, height: 250}})
const zpl: Buffer = encode(band, {model: 'HC100', sensor: 'mark'})

const label = await render('<b>Shelf A-12</b>', {label: {width: 40, height: 30}, dpi: 203})
const tspl: Buffer = encode(label, {language: 'tspl', gap: 2, density: 8})
console.log(escpos.length, zpl.length, tspl.length)
```

- **ESC/POS** (receipt printers): each page as raster bands, sent with `'gsv0'` (`GS v 0`, the default), `'gsl'`
  (`GS ( L`, which Epson recommends) or `'esc*'` (`ESC *`, 24-dot columns, the oldest), as `raster` selects. A band
  holds `bandHeight` rows (255 by default: small printers have small buffers). After each page, `feed` (millimetres) and
  `cut` (`'full'` or `'partial'`, after the paper is fed to the cutter); after the last one, `drawer` opens the cash
  drawer (`true` for pin 2, or `{pin, on, off}` in milliseconds). The feed and the `ESC *` bands count in the printer's
  vertical motion unit, so the encoder first sets it to the dot pitch (`GS P`).
- **`skipBlank`** (ESC/POS and TSPL, on by default): a blank stretch of a millimetre or more is not sent. ESC/POS feeds
  the paper over it, TSPL sends one `BITMAP` for each stretch printed. A receipt takes fewer bytes, which matters on a
  slow link (a serial port at 9600 bits a second takes about 960 bytes a second). Set it to `false` on a printer whose
  feed does not follow `GS P` (the receipt's gaps come out too short or too long). ESC/POS over 255 dpi sends every row;
  ZPL already compresses its blank rows.
- **TSPL** (TSC and many Chinese label printers): the label size, its `sensor` (`'gap'`, `'mark'` or `'continuous'`)
  and `gap`, `density` (0 to 15), `speed`, then each page a `BITMAP` printed in `copies`.
- **ZPL** (Zebra and printers that emulate it): each page a label of its width and length, its sensor (`^MN`),
  `density` (0 to 30, `~SD`), `speed` (`^PR`), the page a graphic field (`^GF`), compressed by default (`compress`).
- **`cut`** cuts after each page in the three languages, on a printer with a cutter: `'full'` (or `true`) or
  `'partial'` (a half cut). On TSPL it sets `SET CUTTER 1` or `SET PARTIAL_CUTTER 1`, and on ZPL the cutter mode
  (`^MMC`, always a full cut). `false` turns off a label printer's cutter (`SET CUTTER OFF`, `^MMT`): a label
  printer keeps that setting from one job to the next. Without `cut`, nothing is cut and a label printer keeps its own
  setting.

### The printer models

`printerModels()` lists the printers known by name; `model` provides a rendering with their resolution and print width,
and an encoding with their language and raster command. A label printer's model provides its resolution and its habits,
and the `label` option provides the label's size:

| Model | Brand | dpi | Dots | Language | Media |
|---|---|---|---|---|---|
| `TM-T88V`, `TM-T88VI`, `TM-T88VII` | Epson | 180 | 512 | ESC/POS (`GS ( L`) | roll |
| `TM-T20III`, `TM-m30` | Epson | 203 | 576 | ESC/POS | roll |
| `SRP-350III`, `SRP-350plusIII` | Bixolon | 180 | 512 | ESC/POS | roll |
| `Sunmi 58`, `Sunmi 80` | Sunmi | 203 | 384, 576 | ESC/POS | roll |
| `XP-58IIH`, `XP-Q80K` | Xprinter | 203 | 384, 576 | ESC/POS | roll |
| `GP-58130IVC` | Gprinter | 203 | 384 | ESC/POS | roll |
| `TP80K` | HPRT | 203 | 576 | ESC/POS | roll |
| `ZJ-5870` | Zjiang | 203 | 384 | ESC/POS | roll |
| `TDP-225`, `TDP-225W` | TSC | 203 | 416 | TSPL | labels, wristbands |
| `TDP-324`, `TDP-324W` | TSC | 300 | 576 | TSPL | labels, wristbands |
| `HC100`, `ZD510-HC` | Zebra | 300 | 361 | ZPL | wristbands, printed along the band |

The figures come from the makers' specifications and from the community profiles of
[escpos-printer-db](https://github.com/receipt-print-hq/escpos-printer-db); `source` indicates which. A printer that is
not listed is specified by its figures: `width` and `dpi` (or `label` and `dpi`) for the rendering, `language` for the
encoding.

### How the dots are drawn

Text prints black unless its color is nearly white, and its glyphs are rendered in monochrome with the font's hinting:
crisp dots, not the gray edges of a thresholded or dithered screenshot. Borders, black or white fills, SVG and QR codes
are also drawn with crisp edges. Gray fills, gradients and photographs are dithered (Floyd–Steinberg), and their
dithering never spreads into the dots drawn black or white on purpose. Text is broken into lines by the Unicode rules
(closing punctuation stays at the end of a line, opening punctuation at its start), and a word longer than 16 characters
(a web address, an order number of letters) can break anywhere.

## API

| Export | What it is |
|---|---|
| `render(html, options)` | Renders HTML into a `PrintImage` |
| `encode(image, options)` | Encodes a rendering as ESC/POS, TSPL or ZPL commands |
| `printerModels()` | The printers known by name |
| `registerFont(font)` | Registers a font for the renderings |
| `PrintImage` | A rendering: `pages`, `width`, `height`, `dpi`, `dotsPerMm`, `toPNG(page?)` |
| `PrintPage` | A page of dots: `width`, `height`, `rows`, `bytesPerRow`, `dot(x, y)`, `toPNG()` |
| `RenderOptions`, `MediaOptions`, `PageOptions`, `LabelSize`, `Length`, `FontSource`, `EncodeOptions` | The options |
| `PrinterModel`, `PrinterLanguage`, `EscPosRaster` | A model from the table, the command languages, the ESC/POS raster commands |
| `ThermalException`, `ThermalOptionException`, `ThermalFontException`, `ThermalContentException`, `ThermalTimeoutException`, `ThermalCancelledException` | The package's exceptions (see [Errors](#errors)) |

## Errors

| Error | When |
|---|---|
| `ThermalOptionException` | Invalid options: no media or more than one, a media without its resolution, a size out of range, a rotated page without a fixed length, an unknown model, an encoding without its language |
| `ThermalFontException` | A font file that cannot be read, or that FreeType does not open |
| `ThermalContentException` | A picture or a style sheet that cannot be read or decoded (outside `baseDir`, remote, broken), a QR code with too much text, content longer than `maxLength` (2500 mm by default) |
| `ThermalTimeoutException` | The rendering waited in the queue longer than its `timeout` |
| `ThermalCancelledException` | The rendering's `signal` aborted before it started |
| `ThermalException` | The base of the others, thrown directly for an internal addon error |

## See also

- `@lakutata/thermal-printer`: the component that sends the commands to the printers.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon, the bundled fonts, and their licenses. The package
  itself is under the MIT license.
