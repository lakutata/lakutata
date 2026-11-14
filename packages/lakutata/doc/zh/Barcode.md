# Lakutata 条形码

`@lakutata/barcode` 包用于生成条形码和二维码，也能从图片中识别它们，例如从上传的照片或摄像头画面中识别商品标签、物流面单、票券以及印成二维码的链接。本包不属于 `lakutata`，需要单独安装。其主要特点如下：

- **能生成的都能识别回来**：支持 32 种一维码和二维码，从 EAN-13、UPC、Code 128、GS1 DataBar 到 QR 码、Data Matrix、PDF417、Aztec 和 MaxiCode。只有一方支持的码制（邮政码、汉信码、DotCode 等）未提供。
- **生成**结果可以是 PNG、SVG 或像素，尺寸、颜色、旋转方向和纠错等级均可指定。
- **识别** PNG、JPEG、GIF、BMP、WebP、TGA 图片或像素；图片中的每个条码都会被识别，并给出其位置。
- **一个组件** `Barcode`，无需注册即可注入，使用默认选项；在配置中以名称注册的组件可以拥有自身的默认选项、时限和并发数。每次调用都可以设置时限，也可以取消。
- **原生插件**：基于 [zint](https://zint.org.uk) 和 [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)。在 Linux、macOS 和 Windows 上，插件在安装本包时编译；在 Android、iOS 和鸿蒙的手机应用中，插件由 `lakutata mobile stage` 编译。插件也可以在 Bun 和 Electron 主进程中运行。生成和识别都在原生插件自身的线程中执行，不占用 JavaScript 线程。

`@lakutata/barcode` 的 README 介绍了每个选项；本指南按用途逐一说明本包的功能，并为每种用途提供一个示例。

```bash
npm install @lakutata/barcode
```

原生插件在安装本包时编译，因此机器上需要安装 Python 3 和支持 C++20 的编译器（macOS 上为 Xcode 命令行工具，Linux 上为 `build-essential` 或 `build-base`，Windows 上为 Visual Studio 生成工具）。包管理器必须运行本包的安装脚本。npm 会运行该脚本，并可能提示该脚本“not yet covered by allowScripts”（运行 `npm install-scripts approve @lakutata/barcode` 可记录允许其运行）；Bun 和 pnpm 只为明确信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 中设置，pnpm 使用 `pnpm approve-builds`）。组件需要 `@lakutata/core`，这是一个 peer 依赖，安装 `lakutata` 时会一并安装。

## 1. 生成条码

`generate(format, content, options)` 接受的内容可以是文本（按 UTF-8 编码），也可以是字节（`Uint8Array`），默认返回 PNG：

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

- 二维码的尺寸（版本）和内容的编码方式根据内容自动选择，即选用能容纳内容的最小尺寸，除非通过 `version` 指定。
- 像素在黑白时为灰度（每像素 1 字节），有颜色时为 RGB（3 字节），有透明度时为 RGBA（4 字节），可以直接交给 canvas、图像库或打印机驱动使用。
- 内容无法用该码制编码时（例如 EAN-13 中含有字母，或内容超出指定版本的容量），会抛出 `BarcodeContentException`，并附带 zint 给出的原因。

在应用中，组件通过注入获得，无需从容器中获取；如需使用自定义选项，请在配置中以某个名称注册组件，再按该名称注入（第 5 节）。

## 2. 尺寸、颜色和打印

`scale` 是模块的大小（模块即最窄的条，或二维码中的一个小方块），在 PNG 和像素中以像素计，在 SVG 中以单位计。该值为整数，因此 PNG 中条的边缘始终清晰。打印时，请根据模块的毫米数计算 scale：`scale = 毫米数 × dpi / 25.4`，再取整。EAN-13 的标准模块宽度为 0.33 毫米，允许按 80% 到 200% 缩放。例如，在 203 dpi 的热敏标签打印机上，scale 为 3 时模块宽度为 0.375 毫米（114%）；在 300 dpi 下，scale 为 4 时为 0.34 毫米。SVG 可以按任意尺寸打印，其 scale 只决定单位。

- `height` 是一维码条的高度，以模块为单位，因此会随 scale 一起缩放。
- `showText` 在一维码的条下方显示内容；对于 PNG 和像素输出，要求 scale 至少为 2（字体在每个模块中需要 2 个像素）。
- `quietZone` 默认留出码制标准规定的空白；扫描器依靠这些空白找到条码，因此不留空白的标签必须在条码周围留出空位。
- `foreground` 和 `background` 采用 `#RRGGBB` 或 `#RRGGBBAA` 格式。请保持浅底深条，因为本包虽然也能识别深底浅条（`tryInvert`），但许多扫描器无法识别。透明背景在识别时按白色处理。
- `rotate` 将条码顺时针旋转 90、180 或 270 度，适用于横向打印的标签。
- `errorCorrection` 使二维码在部分损坏或被遮挡时仍能被识别，QR 码的等级从 `'L'`（约 7%）到 `'H'`（约 30%）。等级越高，相同内容生成的码越大。

## 3. EAN、UPC 和 GS1

零售码制会计算校验位，并验证传入的校验位：

```typescript
import {Container} from 'lakutata'
import {Barcode, type BarcodeResult, BarcodeContentException} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)

//12 位数字：自动计算校验位
const ean: Buffer = await barcode.generate('EAN13', '590123412345', {addOn: '12'})
const [product]: BarcodeResult[] = await barcode.read(ean)
console.log(product.format, product.text, product.addOn)        //EAN13 5901234123457 12

//13 位数字：验证校验位
await barcode.generate('EAN13', '5901234123458').catch((error: BarcodeContentException) => console.log(error.message))
//Error 275: Invalid check digit '8', expecting '7'

//物流标签：GTIN、有效期和批号
const gs1: Buffer = await barcode.generate('Code128', '[01]09506000134352[17]261231[10]ABC123', {gs1: true})
const [label]: BarcodeResult[] = await barcode.read(gs1)
console.log(label.text, label.gs1, label.symbologyIdentifier)   //(01)09506000134352(17)261231(10)ABC123 true ]C1

await container.destroy()
```

- **UPC。** UPC-A 即以 0 开头的 EAN-13，会被识别为 13 位的 `EAN13`，例如 `01234567890` 的识别结果为 `0012345678905`。`formats` 中包含 `UPCA` 而不包含 `EAN13` 时，格式为 `UPCA`，数字仍为这 13 位。ISBN 同样会被识别为 `EAN13`。
- **附加码。** 2 位或 5 位的附加码（期号、价格）位于 `addOn` 中，与文本分开。使用 `addOn: 'require'` 时，识别结果只保留带附加码的条码。
- **GS1。** 应用标识符可以写在方括号或圆括号中；设置 `gs1: true` 时，Code 128 即成为 GS1-128，QR 码、Data Matrix 和 Aztec 也可以承载 GS1 数据。两种 DataBar Expanded 码制的内容始终是 GS1 数据；其他 DataBar 码制承载的是 GTIN，可以带校验位，也可以不带。识别时，数据以圆括号形式返回，且 `gs1` 为 `true`。

每种码制识别后对应的格式以及识别返回的文本，见本包的 README。

## 4. 识别图片

`read(image, options)` 接受图片文件（文件的字节，即 `Buffer` 或 `Uint8Array`）或像素，返回找到的所有条码；没有条码时返回空数组：

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

//像素：灰度每像素 1 字节，RGB 3 字节，RGBA 4 字节（canvas 的 ImageData、解码后的视频帧）
const frame: RawImage = await barcode.generate('DataMatrix', 'LKT-1001', {output: 'raw'})
const rgba: Uint8Array = new Uint8Array(frame.width * frame.height * 4)
frame.data.forEach((gray: number, index: number): void => rgba.set([gray, gray, gray, 255], index * 4))
const results: BarcodeResult[] = await barcode.read({data: rgba, width: frame.width, height: frame.height, channels: 4})
console.log(results.map((result: BarcodeResult): string => result.text))   //[ 'LKT-1001' ]

await container.destroy()
```

- **加快识别。** `formats` 将查找范围限制在预期的码制上。例如，在 1920×1080 的画面中识别一个 QR 码，查找所有码制约需 8 毫秒，只查找 QR 码约需 1.4 毫秒（第 7 节）。`pure: true` 适用于图片中只有一个端正放置的条码、且周围没有其他内容的情况，例如 `generate()` 生成的图片。
- **难以识别的图片。** `tryHarder`、`tryRotate`、`tryInvert` 和 `tryDownscale` 默认均已开启，会进一步查找尺寸很小、发生旋转、深底浅色以及位于大图中的条码。如果已知图片容易识别，关闭这些选项可以加快识别。
- **无法识别的情况。** 包括模块宽度小于约 2 像素的条码、模糊或反光的照片，以及被图片边缘截断的条码。此时识别出的条码会减少甚至没有；只有图片无法解码时才会抛出异常（`BarcodeImageException`）。
- **大图片**：超过 5000 万像素的图片在解码像素之前即被拒绝，因此上传的文件不会导致进程分配数 GB 的内存。
- **字节。** `bytes` 是码中编码的原始内容；`text` 是其可读形式（带校验位，GS1 使用圆括号），`symbologyIdentifier` 说明如何解读这些字节（`]Q1` 表示 QR 码，`]C1` 表示 GS1-128 等）。

## 5. 在应用中使用

组件无需注册即可注入（`@Inject(Barcode)`），并使用默认选项。如需使用自定义选项，请在配置的 `components` 中为组件指定一个名称，并通过 `buildBarcodeOptions()` 注册，同时设置 `generate()` 和 `read()` 的默认选项、时限和并发数。一个应用可以用不同的名称注册多个组件，每个组件使用各自的选项。下面的仓库应用注册了两个组件，`labels` 用于打印标签，`scanner` 用于识别照片：

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Barcode, type BarcodeResult, buildBarcodeOptions} from '@lakutata/barcode'

class Warehouse extends Component {
    @Inject('labels')
    protected readonly labels: Barcode

    @Inject('scanner')
    protected readonly scanner: Barcode

    //货品标签：Code 128，编号印在条的下方
    public async label(sku: string): Promise<Buffer> {
        return await this.labels.generate('Code128', sku)
    }

    //照片里的条码：只查找 Code 128 和 QR 码
    public async scan(photo: Buffer): Promise<BarcodeResult[]> {
        return await this.scanner.read(photo)
    }
}

Application
    .run(() => ({
        id: 'warehouse.app',
        name: 'Warehouse',
        components: {
            //203 dpi 的标签打印机：模块 3 个像素，条下方显示内容
            labels: buildBarcodeOptions({defaults: {generate: {scale: 3, showText: true}}}),
            //每张照片最多识别 2 秒
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

- `buildBarcodeOptions()` 以自行选定的名称声明组件；其他对象按该名称注入组件（`@Inject('labels')`），或者通过 `getObject('labels')` 获取。
- 注册的组件只能按名称注入。`@Inject(Barcode)` 得到的是另一个组件，该组件自动加载并使用默认选项，配置中的选项对其不起作用。

下面的控制器将商品标签作为 PNG 返回，并识别上传图片中的条码：

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

    //GET /labels/590123412345：商品的 EAN-13，PNG 格式
    @GET('/labels/:ean', LabelDTO)
    public async label(input: LabelDTO): Promise<FileResult> {
        return Result.file(await this.labels.generate('EAN13', input.ean), {contentType: 'image/png'})
    }

    //POST /scans，请求体是图片：返回图片里的条码
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
                    //POST /scans 的请求体就是图片
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

- 调用时传入的选项会覆盖组件的默认选项，例如 `this.labels.generate('QRCode', url, {scale: 6})` 的其他选项仍使用默认值。
- 参数会先经过校验。未知的码制，以及不符合 `#RRGGBB` 格式的颜色，会在调用原生插件之前被拒绝，并抛出 `InvalidMethodAcceptException`。
- 一个组件可以同时服务于所有控制器，各次调用互不影响，仅受 `concurrency` 的限制。
- 在 React Native 手机应用（手机模板）中，组件同样在应用的 Node.js 中运行。`lakutata mobile stage` 会从源码为 Android（使用 NDK）、iOS（使用 Xcode）和鸿蒙（使用 DevEco Studio）编译原生插件。

## 6. 时限、取消和并发

每次调用都可以传入 `signal`（`AbortSignal`）和以毫秒为单位的 `timeout`，时限从调用时开始计算；未传入 `timeout` 的调用使用组件的 `timeout`。

```typescript
import {readFileSync} from 'node:fs'
import {Container} from 'lakutata'
import {Barcode, type BarcodeResult} from '@lakutata/barcode'

const container: Container = new Container()
const barcode: Barcode = await container.get(Barcode)
const photo: Buffer = readFileSync('qrcode.jpeg')

//最多 2 秒，排队的时间也算在内
const results: BarcodeResult[] = await barcode.read(photo, {timeout: 2000})

//直到识别被取消
const scan: AbortController = new AbortController()
const reading: Promise<BarcodeResult[]> = barcode.read(photo, {signal: scan.signal})
scan.abort()
await reading.catch((error: Error) => console.log(error.constructor.name))   //BarcodeCancelledException

await container.destroy()
```

- 尚未开始执行的操作会被直接放弃。已经开始执行的操作无法中途停止，因为 zint 和 zxing-cpp 没有可供中断的位置；此类操作的 Promise 会立即被拒绝（`BarcodeTimeoutException`、`BarcodeCancelledException`），其结果在执行结束后被丢弃。这些操作的耗时都很短（第 7 节），时限用于应对大照片和恶意上传。
- `concurrency` 限制一个组件同时执行的操作数，其余操作排队等待，排队期间时限仍然计算。未设置时，操作在原生插件的线程中排队。
- 原生插件使用 `LAKUTATA_BARCODE_THREADS` 个线程（默认为处理器数减一），由所有组件共用；原生插件不使用 libuv 线程池，因此不会拖慢文件和 DNS 操作。
- 应用停止时，组件会等待正在执行的操作，最长 `drainTimeout` 毫秒（默认 10000）；仍在排队的操作以 `BarcodeCancelledException` 被拒绝，此后的调用同样如此。

## 7. 速度

以下数据在 Apple M4 上测得（Node.js 24，除特别说明外每次只执行一个调用）：

| 操作 | 耗时 |
|---|---|
| 一个网址的 QR 码，PNG（148×148） | 0.19 毫秒 |
| 同一个 QR 码，像素 / SVG | 0.08 毫秒 / 0.17 毫秒 |
| EAN-13 / Code 128，PNG，带文字 | 0.62 毫秒 / 1.6 毫秒 |
| 识别该 QR 码的 PNG，所有码制 / `formats: ['QRCode']` | 0.33 毫秒 / 0.11 毫秒 |
| 识别其像素，`formats: ['QRCode']`，`pure: true` | 0.06 毫秒 |
| 在 1920×1080 的画面中识别一个 QR 码，所有码制 / `formats: ['QRCode']` | 7.8 毫秒 / 1.4 毫秒 |
| 同时生成 / 同时识别 1000 个 QR 码 PNG（9 个线程） | 63 毫秒 / 33 毫秒 |

手机拍摄的照片的识别速度低于上述由 `generate()` 生成的图片，因为照片中的条码更小，并且存在旋转和模糊，`try…` 选项需要做更多的工作。

## 8. 验证方式，以及不支持的情况

测试为每种码制生成条码，再从其 PNG 和像素识别回来，内容随机生成（多种文字的文本以及字节）。测试还检查每个选项的效果，识别 7 种文件格式的图片，并识别 240 张损坏的图片，结果只能是识别出条码或抛出 `BarcodeImageException`。测试在 macOS arm64（Node.js 24 和 18.10、Bun 1.4）、Linux arm64（Debian 12 上的 Node.js 22，Alpine 上的 Node.js 24）和 Windows 11 arm64（Node.js 24）上运行。本包也能在 Electron 44 的主进程中运行，并能在 Android、iOS 和鸿蒙的手机应用中运行；在这三个平台的模拟器上，每种码制和 7 种文件格式都能识别回来。

本包不支持的情况如下，其中有些是有意为之，有些则尚未实现：

- zxing-cpp 无法识别的码制不提供生成功能，包括：四态邮政码、汉信码、DotCode、Code One、Grid Matrix、Codablock-F、Code 16K、Code 49 以及 zint 的其他堆叠码制。Telepen Numeric 同样未提供，因为除非识别时只查找该码制，否则会将其识别为 Telepen。
- 分布在多个码中的内容（结构化追加）会逐个识别；`structuredAppend` 给出每个码的位置，内容的拼接由应用完成。
- 像素只支持灰度、RGB 和 RGBA；BGR 和 BGRA（某些摄像头接口）需要由应用自行转换。GIF 只识别第一帧。
- 输出格式仅限 PNG、SVG 和像素，不提供 EPS、EMF 和 PDF。

## 9. 异常

所有异常都继承自 `BarcodeException`，后者继承自 `lakutata` 的 `Exception`。

| 异常 | `errno` | 抛出时机 |
|---|---|---|
| `BarcodeContentException` | `E_BARCODE_CONTENT` | 内容无法用该码制编码，并附带 zint 给出的原因 |
| `BarcodeOptionException` | `E_BARCODE_OPTION` | 码制不支持该选项（例如为 Code 128 指定 `errorCorrection`），或值超出范围（`version: 41`） |
| `BarcodeImageException` | `E_BARCODE_IMAGE` | 图片无法解码，或者超过 5000 万像素；像素的字节数不等于 `width × height × channels` |
| `BarcodeTimeoutException` | `E_BARCODE_TIMEOUT` | 操作超过时限 |
| `BarcodeCancelledException` | `E_BARCODE_CANCELLED` | 操作的 signal 被中止，或调用了已销毁的组件 |
| `BarcodeException` | `E_BARCODE` | 原生插件的内部错误 |
