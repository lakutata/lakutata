# @lakutata/barcode

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的条形码和二维码组件：生成条码（PNG、SVG 或像素），也能从图片里识别条码。生成基于 [zint](https://zint.org.uk)，识别基于 [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)，都在原生插件里完成。凡是能生成的码制都能识别回来，一共 32 种一维码和二维码，从 EAN-13、Code 128 到 QR 码、Data Matrix、PDF417 和 Aztec。生成和识别都在原生插件自己的线程里执行，不占用 JavaScript 线程。`lakutata` 包不会重新导出这个包，请从 `@lakutata/barcode` 导入。

## 安装

```shell
npm install @lakutata/barcode
```

- 原生插件在安装时编译（node-gyp），所以机器上需要 Python 3 和支持 C++20 的编译器：macOS 上是 Xcode 的命令行工具，Linux 上是 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上是 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。编译需要半分钟到几分钟；编译失败时，安装也会失败。
- 包管理器需要执行这个包的安装脚本。npm 会执行，但可能提示这个脚本“not yet covered by allowScripts”：用 `npm install-scripts approve @lakutata/barcode` 记下你允许它执行。Bun 和 pnpm 只为信任的依赖执行，需要先允许它（Bun 在 package.json 的 `trustedDependencies` 里加上它，pnpm 用 `pnpm approve-builds`）；没有允许时，加载这个包会抛出错误，说明怎样编译原生插件。
- Node.js `>=18.10.0`。
- 原生插件用的是 Node-API，所以 Bun 和 Electron 的主进程可以直接加载 node-gyp 为 Node.js 编译的插件，不用重新编译。
- 在 React Native 的手机应用（lakutata 的手机模板）里，`lakutata mobile stage` 会用 NDK、Xcode 和 DevEco Studio 的工具链，为 Android、iOS 和鸿蒙编译原生插件。

## 用法

### 生成和识别

直接注入组件即可，不需要注册。

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

`generate(format, content, options)` 的内容可以是文本（按 UTF-8 编码），也可以是字节（`Uint8Array`）；返回 `Buffer`（PNG）、字符串（SVG）或 `RawImage`（`output: 'raw'`）。`read(image, options)` 返回识别到的所有条码，每个都带有码制、文本和字节、在图片中的四个角、方向、纠错等级和版本、附加码以及码制标识符；图片里没有条码时返回空数组。

### 生成选项

| 选项 | |
|---|---|
| `output` | `'png'`（默认）、`'svg'` 或 `'raw'` |
| `scale` | 模块（最窄的条，或二维码的一个小方块）的大小：PNG 和像素中是像素数，SVG 中是单位数；1 到 100 的整数，默认 4 |
| `height` | 一维码条的高度，单位是模块 |
| `quietZone` | `true` 按码制标准留出静区（默认），`false` 不留，也可以是模块数 |
| `showText` | 一维码是否在条下方显示内容（PNG 和像素输出要求 `scale` 至少为 2）；默认 `true` |
| `foreground`、`background` | 颜色，写作 `#RRGGBB` 或 `#RRGGBBAA`（`#FFFFFF00` 表示透明背景） |
| `rotate` | 顺时针旋转 0、90、180 或 270 度 |
| `errorCorrection` | QR 码为 `'L'`、`'M'`、`'Q'`、`'H'`；Micro QR 码为 `'L'`、`'M'`、`'Q'`；rMQR 码为 `'M'`、`'H'`；PDF417 为 0 到 8；Aztec 为 1 到 4 |
| `version` | 二维码的尺寸：QR 码 1 到 40，Micro QR 码 1 到 4，rMQR 码 1 到 38，Data Matrix 1 到 48，Aztec 1 到 36 |
| `gs1` | 内容是 GS1 数据，写作 `[01]09506000134352[17]261231` 或 `(01)09506000134352(17)261231`（适用于 Code 128、QR 码、rMQR 码、Data Matrix、Aztec；DataBar Expanded 两种码制的内容总是 GS1 数据） |
| `eci` | 内容的字符集（26 为 UTF-8，3 为 ISO-8859-1，20 为 Shift JIS 等） |
| `addOn` | EAN 或 UPC 的附加码：2 位或 5 位数字 |

码制本身的选项（`errorCorrection`、`version`、`gs1`、`eci`、`addOn`）用在不支持它的码制上时，会抛出 `BarcodeOptionException`；外观选项（`height`、`showText`、`quietZone`）在不适用的码制上会被忽略。各码制支持哪些选项见 `barcodeFormats`。

### 识别选项

| 选项 | |
|---|---|
| `formats` | 要查找的码制；默认查找全部 |
| `tryHarder`、`tryRotate`、`tryInvert`、`tryDownscale` | 多花时间识别难以识别的条码、旋转的条码、深底浅色的条码以及大图中的条码；默认都是 `true` |
| `pure` | 图片里只有一个摆正的条码，周围没有别的东西（例如 `generate()` 生成的图片）：识别最快 |
| `maxSymbols` | 最多识别几个条码 |
| `addOn` | EAN 和 UPC 的附加码：`'read'`（默认）、`'ignore'` 或 `'require'` |

图片无法解码时会抛出 `BarcodeImageException`；超过 5000 万像素的图片在解码像素之前就会被拒绝。

### 码制

| 码制 | 识别为 | 识别出的文本 |
|---|---|---|
| `EAN13`、`EAN8` | 本身 | 数字加校验位 |
| `UPCA`、`UPCE` | `EAN13`（`formats` 里有 `UPCA` 而没有 `EAN13` 时为 `UPCA`）、`UPCE` | 13 位数字（ISO/IEC 15420）：一个 0 加上 UPC-A |
| `ISBN` | `EAN13` | 13 位数字 |
| `DataBar`、`DataBarStacked`、`DataBarStackedOmni`、`DataBarLimited`、`DataBarExpanded`、`DataBarExpandedStacked` | 本身；`DataBarStackedOmni` 识别为 `DataBarStacked` | GS1 数据，如 `(01)09506000134352` |
| `Code128`、`Code39`、`Code39Extended`、`Code93`、`Codabar`、`Telepen`、`DXFilmEdge` | 本身 | 内容本身 |
| `Code32`、`PZN` | 本身 | 带校验位的药品码：`A123456788`、`-12345678` |
| `ITF`、`ITF14` | `ITF` | 数字（ITF-14 还带校验位） |
| `QRCode`、`MicroQRCode`、`RMQRCode`、`DataMatrix`、`PDF417`、`CompactPDF417`、`MicroPDF417`、`Aztec`、`AztecRune`、`MaxiCode` | 本身；`CompactPDF417` 识别为 `PDF417`，`AztecRune` 识别为 `Aztec` | 内容本身 |

有些码制会被识别成另一种，因为 zxing-cpp 无法区分它们：UPC-A 就是以 0 开头的 EAN-13，ISBN 就是以 978 或 979 开头的 EAN-13；其余几种会被识别为所属的大类。每种码制会被识别成什么，见 `barcodeFormats` 的 `reads`。识别出的内容和生成时的内容一致。

### 组件选项

用 `buildBarcodeOptions()` 注册组件，可以给它设置默认选项、时限和并发数，也可以注册多个组件，各用各的选项：

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

| 选项 | |
|---|---|
| `defaults` | `generate()` 和 `read()` 的默认选项，调用时传入的选项优先 |
| `timeout` | 每个操作的时限，单位毫秒；默认 0（不限时） |
| `concurrency` | 这个组件同时执行的操作数，其余的排队等待；默认不限制，由原生插件的线程数决定 |
| `drainTimeout` | 组件销毁时最多等待正在执行的操作多久；默认 10000 毫秒 |

每次调用还可以传入 `signal` 和 `timeout`，时限从调用时开始计算。还在排队的操作被取消或超时时会直接放弃；已经开始执行的操作无法中途停止（zint 和 zxing-cpp 没有可中断的检查点），它的 Promise 会立即被拒绝，结果在执行结束后丢弃。原生插件在自己的线程里执行操作（线程数由 `LAKUTATA_BARCODE_THREADS` 指定，默认是处理器数减一），不占用 libuv 的线程池。

### 不用容器

在脚本、测试或 lakutata 应用之外的代码里，可以从 `Container` 取得组件：

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
| `barcodeFormats`、`BarcodeFormatInfo` | 每种码制会被识别成什么（`reads`），以及它支持的码制选项（`errorCorrection`、`versions`、`gs1`、`eci`、`addOn`、`text`） |
| `GenerateOptions`、`ReadOptions`、`OperationOptions` | `generate()` 和 `read()` 的选项，以及两者共有的选项（`signal`、`timeout`） |
| `RawImage` | 像素：`data`、`width`、`height`、`channels` |
| `BarcodeResult`、`BarcodePoint` | 识别到的条码：`format`、`text`、`bytes`、`position`、`orientation`、`errorCorrectionLevel`、`version`、`symbologyIdentifier`、`addOn`、`gs1`、`mirrored`、`inverted`、`structuredAppend`；位置中的一个点 |
| `BarcodeException`、`BarcodeContentException`、`BarcodeOptionException`、`BarcodeImageException`、`BarcodeTimeoutException`、`BarcodeCancelledException` | 这个包的异常（见[错误](#错误)） |

## 错误

| 错误 | 什么时候抛出 |
|---|---|
| `BarcodeContentException` | 内容无法用这种码制编码（含有不支持的字符、长度不对、超出指定版本的容量），附带 zint 给出的原因 |
| `BarcodeOptionException` | 码制不支持这个选项，或者值超出范围：例如给 Code 128 指定 `errorCorrection`，给 QR 码指定 `version: 41` |
| `BarcodeImageException` | 图片无法解码，或者超过 5000 万像素；像素的字节数不等于 `width × height × channels` |
| `BarcodeTimeoutException` | 操作超过时限 |
| `BarcodeCancelledException` | 操作的 signal 被中止，或者组件已经销毁 |
| `BarcodeException` | 其他异常的基类；原生插件内部出错时直接抛出它 |
| `InvalidMethodAcceptException`（lakutata） | 参数类型不对：未知的码制、颜色不是 `#RRGGBB` 格式、`scale` 不是 1 到 100 的整数 |

## 另见

- [zint](https://zint.org.uk) 和 [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)：原生插件用来生成和识别条码的库。
- `THIRD_PARTY_NOTICES.md`：编译进原生插件的库和它们的许可证。这个包本身采用 MIT 许可证。
