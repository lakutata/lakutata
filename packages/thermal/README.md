# @lakutata/thermal

English | [中文](README.zh-CN.md)

Thermal printing for Node.js: receipts, labels and wristbands written in HTML and CSS, rendered by a native addon into
the printer's own dot grid. The rendering is the print preview and the data of the printer at once: one picture of
black dots, exported as PNG or sent as printer commands. No browser is involved: the layout is
[litehtml](https://github.com/litehtml/litehtml), the glyphs [FreeType](https://freetype.org) in monochrome with
hinting, the graphics [plutovg](https://github.com/sammycage/plutovg) and the SVG [lunasvg](https://github.com/sammycage/lunasvg).
A receipt renders in about two milliseconds on a recent machine. The fonts are bundled: Noto Sans SC (Source Han Sans), regular and bold.

The package renders and encodes; the `@lakutata/thermal-printer` package is the component that drives the printers.

## Installation

```shell
npm install @lakutata/thermal
```

- The addon is compiled during the installation (node-gyp), so the machine needs Python 3 and a C++17 compiler: the
  Command Line Tools of Xcode on macOS, `build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, the Build
  Tools of Visual Studio ("Desktop development with C++") on Windows. Compiling takes about ten seconds on a recent
  machine, a few minutes on a slow one. If it fails, the installation fails.
- The package manager has to run the install script of the package. npm runs it, and may warn that the script is "not
  yet covered by allowScripts": `npm install-scripts approve @lakutata/thermal` records that you allow it. Bun and pnpm
  run it only for the dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error telling how to build the addon.
- Node.js `>=18.10.0`, with `@lakutata/core`. The addon uses Node-API, so Bun and the main process of Electron load
  the addon node-gyp built for Node.js, without a rebuild.
- The package is a 17 MB download, 28 MB unpacked: the two fonts and the sources of the addon.

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

- `paper` is the paper width of the 203 dpi receipt printers: `58` (a print width of 48 mm, 384 dots) or `80` (72 mm,
  576 dots). The Chinese brands and Epson's 203 dpi models print these widths. A printer of another resolution or print
  width, such as the Epson TM-T88 family and the Bixolon SRP-350 (180 dpi, 512 dots), is given by `width` and `dpi`:
  with `paper: 80` its output would be cut on the right.
- `width` is the print width, as the printer's specification gives it ("print width 72 mm"), not the paper's.
- `label` is the size of a label or a wristband: across the print head (`width`) and along the feed (`height`).
- Sizes are millimetres, or strings with a unit: `'72mm'`, `'2in'`, `'576dots'`. A size is converted to dots rounded
  down, never up: the 203 dpi printers are 8 dots per millimetre and the 300 dpi ones 12, so their widths come out
  whole; at 180 dpi, 72 mm are 510 dots of a 512-dot head, two dots of margin rather than two dots cut off.
- `dpi` is needed by `width` and `label`, and is 203 for `paper`. Wristband printers are often 300 dpi.
- Media of a fixed length (`label`, or `width` with `page.length`) are cut into pages: `page.overflow` keeps the first
  page (`'clip'`, the default) or makes as many as the content needs (`'paginate'`).
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

- Inline `<svg>` elements, and `<img>` sources: `data:` URLs (PNG, JPEG, GIF, BMP, SVG), and the files of the
  directory given by `baseDir` (`<img src="logo.png">`, `<link rel="stylesheet" href="receipt.css">`). A path outside
  that directory, a remote address (`https:`) and, without `baseDir`, any file are refused.
- `qrcode:` sources draw a QR code on whole dots, as large as its box allows: the text after `qrcode:` is percent-encoded
  (`encodeURIComponent`), the options follow `#`: `ec` (the error correction, `L`, `M`, `Q` or `H`, `M` by default) and
  `quiet` (the modules of the quiet zone, 4 by default). `<img style="width: 25mm" src="qrcode:ORDER-42#ec=Q&quiet=2">`.
- Photographs are dithered; SVG and line art are thresholded. A fragment chooses for one picture:
  `<img src="logo.png#threshold">`, `<img src="photo.svg#dither">`.

### Fonts

The bundled Noto Sans SC covers Chinese, Japanese kana, Latin, Greek and Cyrillic, in regular and bold (not Korean
Hangul); it is the font of the generic families (`sans-serif`, `serif`…) and of the characters a registered font lacks. More fonts are registered once for the
process:

```typescript
import {registerFont, render} from '@lakutata/thermal'

await registerFont({family: 'Brand', weight: 700, file: './fonts/brand-bold.ttf'})
const image = await render('<h1 style="font-family: Brand">Lakeside</h1>', {paper: 80})
console.log(image.height)
```

A family registered without the weight or the style asked for is emboldened or slanted. Scripts that need shaping
(Arabic, Thai, Devanagari) are not supported.

### How the dots are drawn

Text prints black unless its color is nearly white, its glyphs rendered in monochrome with the font's hinting: crisp
dots, not the gray edges of a screenshot thresholded or dithered. Borders, fills of black or white, SVG and QR codes are
drawn with crisp edges too. Gray fills, gradients and photographs are dithered (Floyd–Steinberg), and their dithering
never spreads into the dots drawn black or white on purpose. The text is broken into lines as Unicode does (closing
punctuation stays at the end of a line, opening punctuation at its start), and a word longer than 16 characters (a web
address, an order number of letters) can break anywhere.

## API

| Export | What it is |
|---|---|
| `render(html, options)` | Renders HTML into a `PrintImage` |
| `registerFont(font)` | Registers a font for the renderings |
| `PrintImage` | A rendering: `pages`, `width`, `height`, `dpi`, `dotsPerMm`, `toPNG(page?)` |
| `PrintPage` | A page of dots: `width`, `height`, `rows`, `bytesPerRow`, `dot(x, y)`, `toPNG()` |
| `RenderOptions`, `MediaOptions`, `PageOptions`, `LabelSize`, `Length`, `FontSource` | The options |
| `ThermalException`, `ThermalOptionException`, `ThermalFontException`, `ThermalContentException`, `ThermalTimeoutException`, `ThermalCancelledException` | The exceptions of the package (see [Errors](#errors)) |

## Errors

| Error | When |
|---|---|
| `ThermalOptionException` | Options that are not valid: no media or more than one, a media without its resolution, a size out of range, a rotated page without a fixed length |
| `ThermalFontException` | A font file that cannot be read, or that FreeType does not open |
| `ThermalContentException` | A picture or a style sheet that cannot be read or decoded (outside `baseDir`, remote, broken), a QR code with too much text, content longer than `maxLength` (2500 mm by default) |
| `ThermalTimeoutException` | The rendering waited in the queue longer than its `timeout` |
| `ThermalCancelledException` | The `signal` of the rendering aborted before it started |
| `ThermalException` | The base of the others, thrown itself for an internal error of the addon |

## See also

- `@lakutata/thermal-printer`: the component that sends the renderings to the printers.
- `THIRD_PARTY_NOTICES.md`: the libraries compiled into the addon, the bundled fonts, and their licenses. The package
  itself is under the MIT license.
