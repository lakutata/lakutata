# @lakutata/barcode

[English](README.md) | 中文

[Lakutata](https://github.com/lakutata/lakutata) 框架的条形码和二维码组件，可以生成条码（PNG、SVG 或像素），也可以识别图片中的条码。生成基于 [zint](https://zint.org.uk)，识别基于 [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)，二者均在原生插件中完成。凡是能生成的码制都能识别回来，共 32 种一维码和二维码，从 EAN-13、Code 128 到 QR 码、Data Matrix、PDF417 和 Aztec。生成和识别都在原生插件自身的线程中执行，不占用 JavaScript 线程。`lakutata` 包不会重新导出本包，请从 `@lakutata/barcode` 导入。

## 安装

```shell
npm install @lakutata/barcode
```

- 原生插件在安装时编译（node-gyp），因此机器上需要安装 Python 3 和支持 C++20 的编译器：macOS 上为 Xcode 命令行工具；Linux 上为 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine）；Windows 上为 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。编译失败时，安装也会失败。
- 包管理器需要执行本包的安装脚本。npm 会执行该脚本，但可能提示该脚本“not yet covered by allowScripts”，此时运行 `npm install-scripts approve @lakutata/barcode` 即可记录允许其执行。Bun 和 pnpm 只为明确信任的依赖执行安装脚本，需要先允许本包（Bun 在 package.json 的 `trustedDependencies` 中添加本包，pnpm 使用 `pnpm approve-builds`）；未允许时，加载本包会抛出错误，并说明原生插件的编译方法。
- Node.js `>=18.10.0`。
- 原生插件使用 Node-API，因此 Bun 和 Electron 主进程可以直接加载 node-gyp 为 Node.js 编译的插件，无需重新编译。
- 在 React Native 手机应用（Lakutata 的手机模板）中，`lakutata mobile stage` 会使用 NDK、Xcode 和 DevEco Studio 的工具链，为 Android、iOS 和鸿蒙编译原生插件。

## 用法

### 生成和识别

直接注入组件即可，组件无需注册，并使用默认选项。如需设置默认选项、时限或并发数，请在配置中注册组件（见[组件选项](#组件选项)）。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Barcode, type BarcodeResult, type RawImage} from '@lakutata/barcode'

class Labels extends Component {
    @Inject(Barcode)
    protected readonly barcode: Barcode

    public async orderLabel(id: string): Promise<Buffer> {
        //PNG，每个模块 8 像素，纠错等级 M：损坏约 15% 时仍能识别
        return await this.barcode.generate('QRCode', `https://example.com/orders/${id}`, {scale: 8, errorCorrection: 'M'})
    }

    public async productBars(): Promise<string> {
        //SVG，条下方显示数字，带 2 位附加码
        return await this.barcode.generate('EAN13', '590123412345', {output: 'svg', addOn: '12'})
    }

    public async pixels(): Promise<RawImage> {
        //像素：黑白时是灰度，有颜色时是 RGB，有透明时是 RGBA
        return await this.barcode.generate('Code128', 'LKT-1001', {output: 'raw', foreground: '#1E3A8A'})
    }

    public async scan(photo: Buffer): Promise<BarcodeResult[]> {
        //PNG、JPEG、GIF、BMP、WebP、TGA 图片：返回图片里找到的所有条码，每个都带有码制、文本、字节和在图片中的位置；
        //一个都没有时返回空数组
        return await this.barcode.read(photo, {formats: ['QRCode', 'EAN13']})
    }
}
```

`generate(format, content, options)` 接受的内容可以是文本（按 UTF-8 编码），也可以是字节（`Uint8Array`），返回值为 `Buffer`（PNG）、字符串（SVG）或 `RawImage`（`output: 'raw'`）。`read(image, options)` 返回识别到的所有条码，每个条码都包含码制、文本和字节、在图片中的四个角、方向、纠错等级和版本、附加码以及码制标识符；图片中没有条码时返回空数组。

### 生成选项

| 选项 | |
|---|---|
| `output` | `'png'`（默认）、`'svg'` 或 `'raw'` |
| `scale` | 模块（最窄的条，或二维码的一个小方块）的大小，在 PNG 和像素输出中为像素数，在 SVG 中为单位数；取值为 1 到 100 的整数，默认 4 |
| `height` | 一维码条的高度，单位为模块 |
| `quietZone` | `true` 表示按码制标准留出静区（默认），`false` 表示不留静区，也可以指定模块数 |
| `showText` | 一维码是否在条下方显示内容（PNG 和像素输出要求 `scale` 至少为 2）；默认 `true` |
| `foreground`、`background` | 颜色，采用 `#RRGGBB` 或 `#RRGGBBAA` 格式（`#FFFFFF00` 表示透明背景） |
| `rotate` | 顺时针旋转 0、90、180 或 270 度 |
| `errorCorrection` | QR 码为 `'L'`、`'M'`、`'Q'`、`'H'`；Micro QR 码为 `'L'`、`'M'`、`'Q'`；rMQR 码为 `'M'`、`'H'`；PDF417 为 0 到 8；Aztec 为 1 到 4 |
| `version` | 二维码的尺寸：QR 码 1 到 40，Micro QR 码 1 到 4，rMQR 码 1 到 38，Data Matrix 1 到 48，Aztec 1 到 36 |
| `gs1` | 内容为 GS1 数据，写作 `[01]09506000134352[17]261231` 或 `(01)09506000134352(17)261231`（适用于 Code 128、QR 码、rMQR 码、Data Matrix、Aztec；两种 DataBar Expanded 码制的内容始终是 GS1 数据） |
| `eci` | 内容的字符集（26 为 UTF-8，3 为 ISO-8859-1，20 为 Shift JIS 等） |
| `addOn` | EAN 或 UPC 的附加码：2 位或 5 位数字 |

码制本身的选项（`errorCorrection`、`version`、`gs1`、`eci`、`addOn`）用于不支持该选项的码制时，会抛出 `BarcodeOptionException`；外观选项（`height`、`showText`、`quietZone`）在不适用的码制上会被忽略。各码制支持的选项见 `barcodeFormats`。

### 识别选项

| 选项 | |
|---|---|
| `formats` | 要查找的码制；默认查找全部 |
| `tryHarder`、`tryRotate`、`tryInvert`、`tryDownscale` | 花费更多时间识别难以识别的条码、旋转的条码、深底浅色的条码以及大图中的条码；默认均为 `true` |
| `pure` | 图片中只有一个摆正的条码，周围没有其他内容（例如 `generate()` 生成的图片），此时识别速度最快 |
| `maxSymbols` | 最多识别的条码数 |
| `addOn` | EAN 和 UPC 的附加码：`'read'`（默认）、`'ignore'` 或 `'require'` |

图片无法解码时会抛出 `BarcodeImageException`；超过 5000 万像素的图片在解码像素之前就会被拒绝。

### 码制

| 码制 | 识别为 | 识别出的文本 |
|---|---|---|
| `EAN13`、`EAN8` | 本身 | 数字加校验位 |
| `UPCA`、`UPCE` | `EAN13`（`formats` 中包含 `UPCA` 而不包含 `EAN13` 时为 `UPCA`）、`UPCE` | 13 位数字（ISO/IEC 15420），即在 UPC-A 前加一个 0 |
| `ISBN` | `EAN13` | 13 位数字 |
| `DataBar`、`DataBarStacked`、`DataBarStackedOmni`、`DataBarLimited`、`DataBarExpanded`、`DataBarExpandedStacked` | 本身；`DataBarStackedOmni` 识别为 `DataBarStacked` | GS1 数据，例如 `(01)09506000134352` |
| `Code128`、`Code39`、`Code39Extended`、`Code93`、`Codabar`、`Telepen`、`DXFilmEdge` | 本身 | 内容本身 |
| `Code32`、`PZN` | 本身 | 带校验位的药品码：`A123456788`、`-12345678` |
| `ITF`、`ITF14` | `ITF` | 数字（ITF-14 还带校验位） |
| `QRCode`、`MicroQRCode`、`RMQRCode`、`DataMatrix`、`PDF417`、`CompactPDF417`、`MicroPDF417`、`Aztec`、`AztecRune`、`MaxiCode` | 本身；`CompactPDF417` 识别为 `PDF417`，`AztecRune` 识别为 `Aztec` | 内容本身 |

有些码制会被识别为另一种码制，因为 zxing-cpp 无法区分这些码制：UPC-A 即以 0 开头的 EAN-13，ISBN 即以 978 或 979 开头的 EAN-13；其余几种会被识别为所属的大类。每种码制会被识别为哪种码制，见 `barcodeFormats` 的 `reads`。识别出的内容与生成时的内容一致。

### 组件选项

为组件指定一个名称并通过 `buildBarcodeOptions()` 注册，即可设置默认选项、时限和并发数；也可以用不同的名称注册多个组件，每个组件使用各自的选项。其他对象按该名称注入组件（`@Inject('labels')`），或者通过 `getObject('labels')` 获取：

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

注册的组件只能按名称注入。`@Inject(Barcode)` 得到的是另一个组件，该组件自动加载并使用默认选项，配置中的选项对其不起作用。

| 选项 | |
|---|---|
| `defaults` | `generate()` 和 `read()` 的默认选项，调用时传入的选项优先 |
| `timeout` | 每个操作的时限，单位为毫秒；默认 0（不限时） |
| `concurrency` | 该组件可同时执行的操作数上限，其余操作排队等待；默认不限制，由原生插件的线程数决定 |
| `drainTimeout` | 组件销毁时等待正在执行的操作的最长时间；默认 10000 毫秒 |

每次调用还可以传入 `signal` 和 `timeout`，时限从调用时开始计算。仍在排队的操作被取消或超时时会被直接放弃；已经开始执行的操作被取消或超时时无法中途停止（zint 和 zxing-cpp 没有可中断的检查点），其 Promise 会立即被拒绝，其结果在执行结束后被丢弃。原生插件在自身的线程中执行操作（线程数由 `LAKUTATA_BARCODE_THREADS` 指定，默认为处理器数减一），不占用 libuv 的线程池。

### 不用容器

在脚本、测试或 Lakutata 应用之外的代码中，可以从 `Container` 获取组件：

```typescript
import {Container} from 'lakutata'
import {Barcode} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)
console.log((await barcode.read(await barcode.generate('DataMatrix', 'lakutata')))[0].text)
await container.destroy()
```

## API

| 导出 | 说明 |
|---|---|
| `Barcode` | 组件：`generate()` 和 `read()` |
| `buildBarcodeOptions`、`BarcodeConfig` | 组件在配置中的选项（`defaults`、`timeout`、`concurrency`、`drainTimeout`） |
| `BARCODE_FORMATS`、`BarcodeFormat` | 码制名称 |
| `barcodeFormats`、`BarcodeFormatInfo` | 每种码制会被识别为哪种码制（`reads`），以及该码制支持的码制选项（`errorCorrection`、`versions`、`gs1`、`eci`、`addOn`、`text`） |
| `GenerateOptions`、`ReadOptions`、`OperationOptions` | `generate()` 和 `read()` 的选项，以及两者共有的选项（`signal`、`timeout`） |
| `RawImage` | 像素：`data`、`width`、`height`、`channels` |
| `BarcodeResult`、`BarcodePoint` | 识别到的条码：`format`、`text`、`bytes`、`position`、`orientation`、`errorCorrectionLevel`、`version`、`symbologyIdentifier`、`addOn`、`gs1`、`mirrored`、`inverted`、`structuredAppend`；位置中的一个点 |
| `BarcodeException`、`BarcodeContentException`、`BarcodeOptionException`、`BarcodeImageException`、`BarcodeTimeoutException`、`BarcodeCancelledException` | 本包的异常（见[错误](#错误)） |

## 错误

| 错误 | 抛出时机 |
|---|---|
| `BarcodeContentException` | 内容无法用该码制编码（含有不支持的字符、长度不正确、超出指定版本的容量），异常附带 zint 给出的原因 |
| `BarcodeOptionException` | 码制不支持该选项，或者值超出范围，例如为 Code 128 指定 `errorCorrection`，为 QR 码指定 `version: 41` |
| `BarcodeImageException` | 图片无法解码，或者超过 5000 万像素；像素的字节数不等于 `width × height × channels` |
| `BarcodeTimeoutException` | 操作超过时限 |
| `BarcodeCancelledException` | 操作的 signal 被中止，或组件已销毁 |
| `BarcodeException` | 其他异常的基类；原生插件内部出错时直接抛出该异常 |
| `InvalidMethodAcceptException`（`lakutata`） | 参数类型不正确：未知的码制、颜色不是 `#RRGGBB` 格式、`scale` 不是 1 到 100 的整数 |

## 另见

- [zint](https://zint.org.uk) 和 [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)：原生插件用于生成和识别条码的库。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库及其许可证。本包自身采用 MIT 许可证。
