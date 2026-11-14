# @lakutata/thermal

[English](README.md) | 中文

用于 Node.js 的热敏打印。以 HTML 和 CSS 编排小票、标签和腕带，由原生插件渲染为打印机自身的点阵，再编码为 ESC/POS、TSPL 或 ZPL 指令。渲染结果既是打印预览，也是发给打印机的数据，即同一张黑白点阵图，既可以导出为 PNG，也可以编码为打印指令。整个过程无需浏览器：排版使用 [litehtml](https://github.com/litehtml/litehtml)，字形使用 [FreeType](https://freetype.org) 的单色加微调渲染，图形使用 [plutovg](https://github.com/sammycage/plutovg)，SVG 使用 [lunasvg](https://github.com/sammycage/lunasvg)。字体随包自带：思源黑体（Noto Sans SC）常规体和粗体。

本包负责渲染和编码；将指令发给打印机的组件位于 `@lakutata/thermal-printer` 包中。

## 安装

```shell
npm install @lakutata/thermal
```

- 插件在安装时编译（node-gyp），因此机器上需要安装 Python 3 和支持 C++17 的编译器：macOS 上为 Xcode 的 Command Line Tools，Linux 上为 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上为 Visual Studio 的生成工具（“使用 C++ 的桌面开发”）。编译失败时，安装也会失败。
- 包管理器需要运行本包的安装脚本。npm 会运行该脚本，但可能提示该脚本“not yet covered by allowScripts”，此时运行 `npm install-scripts approve @lakutata/thermal` 即可记录允许其运行。Bun 和 pnpm 只为明确信任的依赖运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 中设置，pnpm 使用 `pnpm approve-builds`）；未允许时，加载本包会抛出错误，并说明插件的编译方法。
- Node.js `>=18.10.0`，以及 `@lakutata/core`。插件使用 Node-API，因此 Bun 和 Electron 主进程可以直接加载 node-gyp 为 Node.js 编译的插件，无需重新编译。
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

`render()` 返回一个 `PrintImage`，其中包含各页点阵（纸卷上只有一页），每页具有位行（`rows`）、`dot(x, y)` 和 `toPNG()`。

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

- `paper` 是 203 dpi 小票机的纸宽：`58`（打印宽度 48 mm，384 点）或 `80`（72 mm，576 点）。国产品牌和 Epson 的 203 dpi 机型均为这两种宽度。分辨率或打印宽度不同的打印机，例如 Epson TM-T88 系列和 Bixolon SRP-350（180 dpi，512 点），请用 `width` 和 `dpi` 给出，因为使用 `paper: 80` 时，右侧会被截掉。
- `width` 是打印宽度，即打印机规格书上写的“打印宽度 72 mm”，不是纸宽。
- `label` 是标签或腕带的尺寸：横跨打印头的宽度（`width`）和沿走纸方向的长度（`height`）。
- 尺寸以毫米为单位，或使用带单位的字符串：`'72mm'`、`'2in'`、`'576dots'`。尺寸换算为点时一律向下取整：203 dpi 的打印机为每毫米 8 点，300 dpi 的打印机为每毫米 12 点，因此其宽度恰好是整数；180 dpi 时，72 mm 为 510 点，而打印头有 512 点，因此多出两点空白，而不是被截掉两点。
- `width` 和 `label` 需要 `dpi`，`paper` 固定为 203。腕带机多为 300 dpi。
- 定长的介质（`label`，或带 `page.length` 的 `width`）会分页：`page.overflow` 只保留第一页（`'clip'`，默认）或按内容需要分成多页（`'paginate'`）。
- `rotate` 将每页顺时针旋转。沿带子方向打印的腕带，按带子的长度排版，再旋转 90 或 270 度。`page.lead` 在每页开头沿走纸方向留出空白，用于开头部分无法打印的打印机。

### CSS 里的尺寸

CSS 的长度是真实的长度，`mm`、`cm`、`pt` 和 `px`（1/96 英寸）都按打印机的分辨率换算，因此同一份模板在 180、203 和 300 dpi 的打印机上打印出的尺寸相同。默认文字为 12px，约 3 mm，与打印机自带的 12 × 24 字体高度相同。媒体查询看到的是打印宽度，因此同一份模板可以为 58 mm 和 80 mm 的小票排出不同的版式：

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

litehtml 支持的 CSS：盒模型、`display`（block、inline、inline-block、flex、table）、浮动、`position`、圆角边框、线性和径向渐变背景、`::before` 和 `::after`、计数器、`var()`、`@media`、`text-transform`（仅处理 ASCII 字母）、`white-space`。不支持 `calc()`、grid、`transform`、`opacity`、`box-shadow`、`letter-spacing` 和 `@font-face`（字体通过 `registerFont()` 注册）。

### 图片和二维码

- 内嵌的 `<svg>` 元素，以及 `<img>` 的以下来源：`data:` URL（PNG、JPEG、GIF、BMP、SVG），以及 `baseDir` 所指目录中的文件（`<img src="logo.png">`、`<link rel="stylesheet" href="receipt.css">`）。该目录之外的路径、远程地址（`https:`），以及没有 `baseDir` 时的任何文件，都会被拒绝。
- `qrcode:` 来源按整数个点绘制二维码，并在其框内尽量放大。`qrcode:` 后面是经过百分号编码的文本（`encodeURIComponent`），`#` 后面是选项：`ec`（纠错级别，`L`、`M`、`Q` 或 `H`，默认 `M`）和 `quiet`（静区的模块数，默认 4）。例如 `<img style="width: 25mm" src="qrcode:ORDER-42#ec=Q&quiet=2">`。
- 照片会做抖动处理；SVG 和线条图会做二值化处理。可以用片段为某一张图片指定处理方式，例如 `<img src="logo.png#threshold">`、`<img src="photo.svg#dither">`。

### 字体

自带的思源黑体覆盖中文、日文假名、拉丁文、希腊文和西里尔文，包含常规体和粗体（不含韩文谚文）；该字体用作通用字体族（`sans-serif`、`serif`……）的字体，也用于注册字体中缺少的字。其他字体在进程中注册一次：

```typescript
import {registerFont, render} from '@lakutata/thermal'

await registerFont({family: 'Brand', weight: 700, file: './fonts/brand-bold.ttf'})
const image = await render('<h1 style="font-family: Brand">Lakeside</h1>', {paper: 80})
console.log(image.height)
```

注册的字体族缺少所需的字重或样式时，会自动加粗或倾斜。不支持需要字形组合的文字（阿拉伯文、泰文、天城文）。

### 打印指令

`encode()` 按指令语言或型号，将渲染结果编码为打印机的指令：

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

- **ESC/POS**（小票机）：每页编码为 `raster` 指定的位图指令，即 `'gsv0'`（`GS v 0`，默认）、`'gsl'`（`GS ( L`，Epson 推荐）或 `'esc*'`（`ESC *`，24 点一列，最早的指令）。每段最多 `bandHeight` 行（默认 255，因为小打印机的缓冲区较小）。每页之后是 `feed`（毫米）和 `cut`（`'full'` 或 `'partial'`，先走纸到切刀）；最后一页之后，`drawer` 打开钱箱（`true` 表示 2 号引脚，或 `{pin, on, off}`，单位为毫秒）。走纸和 `ESC *` 的分段按打印机的纵向移动单位计数，因此编码器先用 `GS P` 将该单位设为一个点。
- **`skipBlank`**（ESC/POS 和 TSPL，默认开启）：1 毫米及以上的空白不发送。ESC/POS 用走纸跳过空白，TSPL 只为有内容的部分各发送一个 `BITMAP`。这样一张小票的数据更少，在慢速连接上尤为明显（9600 波特率的串口每秒约传输 960 字节）。如果打印机的走纸不识别 `GS P`（小票中的空白打印出来偏短或偏长），请将该选项设为 `false`。ESC/POS 在 255 dpi 以上时仍会发送每一行；ZPL 本身就会压缩空白行。
- **TSPL**（TSC 和许多国产标签机）：标签尺寸、`sensor`（`'gap'`、`'mark'` 或 `'continuous'`）和 `gap`、`density`（0 到 15）、`speed`，然后每页一个 `BITMAP`，打印 `copies` 份。
- **ZPL**（Zebra 及其兼容打印机）：每页一张标签，带宽度和长度、传感器（`^MN`）、`density`（0 到 30，`~SD`）、`speed`（`^PR`），页面是一个图形字段（`^GF`），默认压缩（`compress`）。
- **`cut`** 在三种语言中都表示每页之后切纸（打印机需配备切刀）：`'full'`（或 `true`）为全切，`'partial'` 为半切。TSPL 上设置 `SET CUTTER 1` 或 `SET PARTIAL_CUTTER 1`，ZPL 上设置切刀模式（`^MMC`，始终全切）。`false` 关闭标签打印机的切刀（`SET CUTTER OFF`、`^MMT`），标签打印机会将该设置保留到之后的任务。未设置 `cut` 时不切纸，标签打印机保持原有的设置。

### 打印机型号

`printerModels()` 列出可按名称识别的打印机；渲染时，`model` 给出打印机的分辨率和打印宽度，编码时给出其指令语言和位图指令。标签机的型号给出分辨率和该机型的惯例，标签尺寸由 `label` 选项给出：

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

这些数据来自厂商的规格书和 [escpos-printer-db](https://github.com/receipt-print-hq/escpos-printer-db) 的社区配置，每个型号的 `source` 说明出处。表中没有的打印机，请按其参数给出：渲染时使用 `width` 和 `dpi`（或 `label` 和 `dpi`），编码时使用 `language`。

### 点是怎样画出来的

除颜色接近白色的文字外，文字一律打印为黑色，字形借助字体的微调做单色渲染，因此点是清晰的，而不是像截图那样将灰色边缘二值化或抖动后的结果。边框、黑色或白色的填充、SVG 和二维码的边缘也是清晰的。灰色填充、渐变和照片会做抖动处理（Floyd–Steinberg），且抖动不会扩散到特意绘制为黑色或白色的点上。文字按 Unicode 的规则断行（闭合标点留在行尾，开括号留在行首），长于 16 个字符的单词（网址、由字母组成的单号）可以在任意位置断开。

## API

| 导出 | 说明 |
|---|---|
| `render(html, options)` | 将 HTML 渲染为 `PrintImage` |
| `encode(image, options)` | 将渲染结果编码为 ESC/POS、TSPL 或 ZPL 指令 |
| `printerModels()` | 可按名称识别的打印机 |
| `registerFont(font)` | 为渲染注册一个字体 |
| `PrintImage` | 渲染结果：`pages`、`width`、`height`、`dpi`、`dotsPerMm`、`toPNG(page?)` |
| `PrintPage` | 一页点阵：`width`、`height`、`rows`、`bytesPerRow`、`dot(x, y)`、`toPNG()` |
| `RenderOptions`、`MediaOptions`、`PageOptions`、`LabelSize`、`Length`、`FontSource`、`EncodeOptions` | 选项 |
| `PrinterModel`、`PrinterLanguage`、`EscPosRaster` | 型号表中的一个型号、指令语言、ESC/POS 的位图指令 |
| `ThermalException`、`ThermalOptionException`、`ThermalFontException`、`ThermalContentException`、`ThermalTimeoutException`、`ThermalCancelledException` | 本包的异常（见[错误](#错误)） |

## 错误

| 错误 | 抛出时机 |
|---|---|
| `ThermalOptionException` | 选项有误：未给出介质或给出了多种介质、介质缺少分辨率、尺寸超出范围、旋转的页面没有固定长度、型号未知、编码时未给出指令语言 |
| `ThermalFontException` | 字体文件无法读取，或 FreeType 无法打开该文件 |
| `ThermalContentException` | 图片或样式表无法读取或无法解码（在 `baseDir` 之外、远程地址、文件损坏），二维码的文本过长，内容长于 `maxLength`（默认 2500 mm） |
| `ThermalTimeoutException` | 渲染在队列中等待的时间超过了其 `timeout` |
| `ThermalCancelledException` | 渲染开始之前，其 `signal` 被中止 |
| `ThermalException` | 其他异常的基类，插件内部出错时直接抛出该异常 |

## 另见

- `@lakutata/thermal-printer`：将指令发给打印机的组件。
- `THIRD_PARTY_NOTICES.md`：编译进插件的库、自带的字体及其许可证。本包本身采用 MIT 许可证。
