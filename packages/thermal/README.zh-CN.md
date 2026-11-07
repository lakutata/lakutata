# @lakutata/thermal

[English](README.md) | 中文

用于 Node.js 的热敏打印：用 HTML 和 CSS 编排小票、标签和腕带，由原生插件渲染成打印机自己的点阵，再编码成 ESC/POS、TSPL 或 ZPL 指令。渲染结果既是打印预览，也是发给打印机的数据：同一张黑白点阵图，可以导出 PNG，也可以编码成打印指令。整个过程不用浏览器：排版用 [litehtml](https://github.com/litehtml/litehtml)，字形用 [FreeType](https://freetype.org) 的单色加微调渲染，图形用 [plutovg](https://github.com/sammycage/plutovg)，SVG 用 [lunasvg](https://github.com/sammycage/lunasvg)。在较新的机器上，一张小票渲染约 2 毫秒。字体随包自带：思源黑体（Noto Sans SC）常规体和粗体。

这个包负责渲染和编码；把指令发给打印机的组件在 `@lakutata/thermal-printer` 包里。

## 安装

```shell
npm install @lakutata/thermal
```

- 插件在安装时编译（node-gyp），所以机器上需要 Python 3 和支持 C++17 的编译器：macOS 上是 Xcode 的 Command Line Tools，Linux 上是 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上是 Visual Studio 的生成工具（"使用 C++ 的桌面开发"）。编译在较新的机器上约十秒，慢的机器上要几分钟。编译失败时安装也会失败。
- 包管理器要运行这个包的安装脚本。npm 会运行，可能提示这个脚本"not yet covered by allowScripts"：`npm install-scripts approve @lakutata/thermal` 会记下你允许它。Bun 和 pnpm 只为告诉它们可以信任的依赖运行安装脚本（Bun 是 package.json 里的 `trustedDependencies`，pnpm 是 `pnpm approve-builds`）；没有允许时，加载这个包会抛出一个错误，告诉你怎样编译插件。
- Node.js `>=18.10.0`，以及 `@lakutata/core`。插件用的是 Node-API，所以 Bun 和 Electron 主进程可以直接加载 node-gyp 为 Node.js 编译的插件，不用重新编译。
- 包的下载大小约 17 MB，解压后 28 MB，主要是两个字体文件和插件的源码。

## 用法

### 一张小票

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

`render()` 返回一个 `PrintImage`：它的各页点阵（纸卷上只有一页），每页有它的位行（`rows`）、`dot(x, y)` 和 `toPNG()`。

### 介质

每次渲染用四种写法之一说明介质：

```typescript
import {render} from '@lakutata/thermal'

const html: string = '<p>Hello</p>'
await render(html, {paper: 58})                                 //203 dpi 的 58 mm 小票机：384 点
await render(html, {width: 72, dpi: 180})                       //180 dpi、打印宽度 72 mm（Epson TM-T88）
await render(html, {label: {width: 40, height: 30}, dpi: 300})  //一张 40 × 30 mm 的标签
await render(html, {label: {width: 25, height: 250}, dpi: 300, rotate: 90, page: {lead: 25.4}})  //一条腕带
```

- `paper` 是 203 dpi 小票机的纸宽：`58`（打印宽度 48 mm，384 点）或 `80`（72 mm，576 点）。国产品牌和 Epson 的 203 dpi 机型都是这两个宽度。分辨率或打印宽度不同的打印机，比如 Epson TM-T88 系列和 Bixolon SRP-350（180 dpi，512 点），用 `width` 和 `dpi` 给出：用 `paper: 80` 的话，右边会被截掉。
- `width` 是打印宽度，即打印机规格书上写的“打印宽度 72 mm”，不是纸宽。
- `label` 是标签或腕带的尺寸：横跨打印头的宽度（`width`）和沿走纸方向的长度（`height`）。
- 尺寸用毫米，或者带单位的字符串：`'72mm'`、`'2in'`、`'576dots'`。尺寸换算成点时一律向下取整：203 dpi 的打印机是每毫米 8 点，300 dpi 的是每毫米 12 点，所以它们的宽度正好是整数；180 dpi 时，72 mm 是 510 点，打印头有 512 点，多出两点空白，而不是被截掉两点。
- `width` 和 `label` 需要 `dpi`，`paper` 固定为 203。腕带机多是 300 dpi。
- 定长的介质（`label`，或者带 `page.length` 的 `width`）会分页：`page.overflow` 只保留第一页（`'clip'`，默认）或者按内容需要分成多页（`'paginate'`）。
- `rotate` 把每页顺时针旋转。沿着带子方向打印的腕带，按带子的长度排版，再旋转 90 或 270 度。`page.lead` 在每页开头沿走纸方向留出空白，用于开头不能打印的打印机。

### CSS 里的尺寸

CSS 的长度是真实的长度：`mm`、`cm`、`pt` 和 `px`（1/96 英寸）都按打印机的分辨率换算，所以同一份模板在 180、203 和 300 dpi 的打印机上印出来一样大。默认文字是 12px，约 3 mm，和打印机自带的 12 × 24 字体一样高。媒体查询看到的是打印宽度，所以同一份模板可以为 58 mm 和 80 mm 的小票排出不同的版式：

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

litehtml 支持的 CSS：盒模型、`display`（block、inline、inline-block、flex、table）、浮动、`position`、圆角边框、线性和径向渐变背景、`::before` 和 `::after`、计数器、`var()`、`@media`、`text-transform`（只处理 ASCII 字母）、`white-space`。不支持 `calc()`、grid、`transform`、`opacity`、`box-shadow`、`letter-spacing` 和 `@font-face`（字体用 `registerFont()` 注册）。

### 图片和二维码

- 内嵌的 `<svg>` 元素，以及 `<img>` 的这些来源：`data:` URL（PNG、JPEG、GIF、BMP、SVG），和 `baseDir` 所指目录里的文件（`<img src="logo.png">`、`<link rel="stylesheet" href="receipt.css">`）。这个目录之外的路径、远程地址（`https:`），以及没有 `baseDir` 时的任何文件，都会被拒绝。
- `qrcode:` 来源按整数个点画出二维码，在它的框里尽量大：`qrcode:` 后面是经过百分号编码的文本（`encodeURIComponent`），`#` 后面是选项：`ec`（纠错级别，`L`、`M`、`Q` 或 `H`，默认 `M`）和 `quiet`（静区的模块数，默认 4）。例如 `<img style="width: 25mm" src="qrcode:ORDER-42#ec=Q&quiet=2">`。
- 照片会抖动；SVG 和线条图会二值化。用片段可以为某一张图片指定：`<img src="logo.png#threshold">`、`<img src="photo.svg#dither">`。

### 字体

自带的思源黑体覆盖中文、日文假名、拉丁文、希腊文和西里尔文，有常规体和粗体（不含韩文谚文）；它是通用字体族（`sans-serif`、`serif`……）的字体，也用于注册的字体缺少的字。其他字体在进程里注册一次：

```typescript
import {registerFont, render} from '@lakutata/thermal'

await registerFont({family: 'Brand', weight: 700, file: './fonts/brand-bold.ttf'})
const image = await render('<h1 style="font-family: Brand">Lakeside</h1>', {paper: 80})
console.log(image.height)
```

注册的字体族缺少所要的字重或样式时，会自动加粗或倾斜。需要字形组合的文字（阿拉伯文、泰文、天城文）不支持。

### 打印指令

`encode()` 把渲染结果编码成打印机的指令，按指令语言或型号：

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

- **ESC/POS**（小票机）：每页编码成 `raster` 指定的位图指令：`'gsv0'`（`GS v 0`，默认）、`'gsl'`（`GS ( L`，Epson 推荐）或 `'esc*'`（`ESC *`，24 点一列，最老的）。每段最多 `bandHeight` 行（默认 255：小打印机的缓冲区小）。每页之后是 `feed`（毫米）和 `cut`（`'full'` 或 `'partial'`，先走纸到切刀）；最后一页之后，`drawer` 打开钱箱（`true` 表示 2 号引脚，或者 `{pin, on, off}`，单位毫秒）。走纸和 `ESC *` 的分段按打印机的纵向移动单位计数，所以编码器先用 `GS P` 把它设成一个点；这一点还没有在打印机上验证。
- **TSPL**（TSC 和很多国产标签机）：标签尺寸、`sensor`（`'gap'`、`'mark'` 或 `'continuous'`）和 `gap`、`density`（0 到 15）、`speed`，然后每页一个 `BITMAP`，打印 `copies` 份。
- **ZPL**（Zebra 和兼容它的打印机）：每页一张标签，带宽度和长度、传感器（`^MN`）、`density`（0 到 30，`~SD`）、`speed`（`^PR`），页面是一个图形字段（`^GF`），默认压缩（`compress`）。

### 打印机型号

`printerModels()` 列出按名字认识的打印机；渲染时 `model` 给出它的分辨率和打印宽度，编码时给出它的指令语言和位图指令。标签机的型号给出分辨率和它的习惯，标签尺寸由 `label` 选项给出：

| 型号 | 品牌 | dpi | 点数 | 指令语言 | 介质 |
|---|---|---|---|---|---|
| `TM-T88V`、`TM-T88VI`、`TM-T88VII` | Epson | 180 | 512 | ESC/POS（`GS ( L`） | 纸卷 |
| `TM-T20III`、`TM-m30` | Epson | 203 | 576 | ESC/POS | 纸卷 |
| `SRP-350III`、`SRP-350plusIII` | Bixolon | 180 | 512 | ESC/POS | 纸卷 |
| `Sunmi 58`、`Sunmi 80` | 商米 | 203 | 384、576 | ESC/POS | 纸卷 |
| `XP-58IIH`、`XP-Q80K` | 芯烨 | 203 | 384、576 | ESC/POS | 纸卷 |
| `GP-58130IVC` | 佳博 | 203 | 384 | ESC/POS | 纸卷 |
| `TP80K` | 汉印 | 203 | 576 | ESC/POS | 纸卷 |
| `ZJ-5870` | Zjiang | 203 | 384 | ESC/POS | 纸卷 |
| `TDP-225`、`TDP-225W` | TSC | 203 | 416 | TSPL | 标签、腕带 |
| `TDP-324`、`TDP-324W` | TSC | 300 | 576 | TSPL | 标签、腕带 |
| `HC100`、`ZD510-HC` | Zebra | 300 | 361 | ZPL | 腕带，沿带子方向打印 |

这些数据来自厂商的规格书和 [escpos-printer-db](https://github.com/receipt-print-hq/escpos-printer-db) 的社区配置，每个型号的 `source` 说明出处。表里没有的打印机按它的数据给出：渲染用 `width` 和 `dpi`（或 `label` 和 `dpi`），编码用 `language`。

### 点是怎样画出来的

文字除非颜色接近白色，一律打成黑色，字形用字体的微调做单色渲染：点是清楚的，不是截图那种灰色边缘再二值化或抖动的结果。边框、黑色或白色的填充、SVG 和二维码的边缘也是清楚的。灰色填充、渐变和照片会抖动（Floyd–Steinberg），而且抖动不会扩散到特意画成黑色或白色的点上。文字按 Unicode 的规则断行（闭合标点留在行尾，开括号留在行首），长于 16 个字符的单词（网址、由字母组成的单号）可以在任意位置断开。

## API

| 导出 | 说明 |
|---|---|
| `render(html, options)` | 把 HTML 渲染成 `PrintImage` |
| `encode(image, options)` | 把渲染结果编码成 ESC/POS、TSPL 或 ZPL 指令 |
| `printerModels()` | 按名字认识的打印机 |
| `registerFont(font)` | 为渲染注册一个字体 |
| `PrintImage` | 渲染结果：`pages`、`width`、`height`、`dpi`、`dotsPerMm`、`toPNG(page?)` |
| `PrintPage` | 一页点阵：`width`、`height`、`rows`、`bytesPerRow`、`dot(x, y)`、`toPNG()` |
| `RenderOptions`、`MediaOptions`、`PageOptions`、`LabelSize`、`Length`、`FontSource`、`EncodeOptions` | 选项 |
| `PrinterModel`、`PrinterLanguage`、`EscPosRaster` | 型号表里的一个型号、指令语言、ESC/POS 的位图指令 |
| `ThermalException`、`ThermalOptionException`、`ThermalFontException`、`ThermalContentException`、`ThermalTimeoutException`、`ThermalCancelledException` | 这个包的异常（见[错误](#错误)） |

## 错误

| 错误 | 什么时候 |
|---|---|
| `ThermalOptionException` | 选项不正确：没有给出介质或给出了多种、介质缺少分辨率、尺寸超出范围、旋转的页面没有固定长度、未知的型号、编码没有给出指令语言 |
| `ThermalFontException` | 字体文件读不出来，或者 FreeType 打不开它 |
| `ThermalContentException` | 图片或样式表读不出来或解码不了（在 `baseDir` 之外、远程地址、文件损坏），二维码的文本太长，内容长于 `maxLength`（默认 2500 mm） |
| `ThermalTimeoutException` | 渲染在队列里等待的时间超过了它的 `timeout` |
| `ThermalCancelledException` | 渲染开始之前，它的 `signal` 被中止 |
| `ThermalException` | 其他异常的基类，插件内部出错时直接抛出它 |

## 另见

- `@lakutata/thermal-printer`：把指令发给打印机的组件。
- `THIRD_PARTY_NOTICES.md`：编译进插件的库、自带的字体以及它们的许可证。这个包本身采用 MIT 许可证。
