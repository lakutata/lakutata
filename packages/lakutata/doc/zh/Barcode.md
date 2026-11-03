# Lakutata Barcode

`@lakutata/barcode` 包生成条形码和二维码，也能从图片里识别它们：商品标签、物流面单、票券、印成二维码的链接，可以从上传的照片或摄像头的画面里识别出来。它不属于 `lakutata`，需要单独安装。它的特点是：

- **能生成的都能识别回来**：32 种一维码和二维码，从 EAN-13、UPC、Code 128、GS1 DataBar 到 QR 码、Data Matrix、PDF417、Aztec 和 MaxiCode。只有一边支持的码制（邮政码、汉信码、DotCode 等）没有提供。
- **生成**为 PNG、SVG 或像素，尺寸、颜色、旋转方向和纠错等级都可以指定。
- **识别** PNG、JPEG、GIF、BMP、WebP、TGA 图片或像素；图片里的每个条码都会识别出来，并给出位置。
- **一个组件** `Barcode`，不用注册就能注入，使用默认选项；在配置里用名字注册的组件，可以有自己的默认选项、时限和并发数。每次调用都可以设置时限，也可以取消。
- **原生插件**：基于 [zint](https://zint.org.uk) 和 [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)，在 Linux、macOS 和 Windows 上安装这个包时编译，在 Android、iOS 和鸿蒙的手机应用里由 `lakutata mobile stage` 编译；也能在 Bun 和 Electron 的主进程里运行。生成和识别都在原生插件自己的线程里执行，不占用 JavaScript 线程。

`@lakutata/barcode` 的 README 介绍了每个选项；这篇指南按用途逐一说明这个包能做什么，每种用途都给出一个例子。

```bash
npm install @lakutata/barcode
```

原生插件在安装这个包时编译，所以机器上要有 Python 3 和支持 C++20 的编译器（macOS 上是 Xcode 的命令行工具，Linux 上是 `build-essential` 或 `build-base`，Windows 上是 Visual Studio 生成工具）。包管理器必须运行这个包的安装脚本：npm 会运行它，可能会提示这个脚本“not yet covered by allowScripts”（运行 `npm install-scripts approve @lakutata/barcode` 记录你允许它运行）；Bun 和 pnpm 只为被告知可以信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 里设置，pnpm 用 `pnpm approve-builds`）。组件需要 `@lakutata/core`，这是一个 peer 依赖，安装 `lakutata` 时会一起装上。

## 1. 生成条码

`generate(format, content, options)` 的内容可以是文本（按 UTF-8 编码），也可以是字节（`Uint8Array`）；默认返回 PNG：

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

- 二维码的尺寸（版本）和内容的编码方式按内容自动选择：选能装下内容的最小尺寸，除非用 `version` 指定。
- 像素在黑白时是灰度（每像素 1 字节），有颜色时是 RGB（3 字节），有透明时是 RGBA（4 字节），可以直接交给 canvas、图像库或打印机驱动。
- 内容无法用这种码制编码时（比如 EAN-13 里有字母，或者超出指定版本的容量），会抛出 `BarcodeContentException`，附带 zint 给出的原因。

在应用里，组件是注入的，不用从容器里取；要用自己的选项，就在配置里用一个名字注册组件，再按这个名字注入（第 5 节）。

## 2. 尺寸、颜色和打印

`scale` 是模块的大小，模块就是最窄的条，或二维码的一个小方块：在 PNG 和像素中是像素数，在 SVG 中是单位数。它是整数，所以 PNG 里的条边缘始终清晰。打印时，按模块的毫米数算出 scale：`scale = 毫米数 × dpi / 25.4`，再取整。EAN-13 的标准模块宽度是 0.33 毫米，允许按 80% 到 200% 缩放：在 203 dpi 的热敏标签打印机上，scale 为 3 时模块是 0.375 毫米（114%）；在 300 dpi 上，scale 为 4 时是 0.34 毫米。SVG 可以按任意尺寸打印，它的 scale 只决定单位。

- `height` 是一维码条的高度，单位是模块，所以会随 scale 一起缩放。
- `showText` 在一维码的条下方显示内容；PNG 和像素输出要求 scale 至少为 2（字体每个模块需要 2 个像素）。
- `quietZone` 默认留出码制标准规定的空白；扫描器靠这些空白找到条码，所以不留空白的标签，要在条码周围留出空位。
- `foreground` 和 `background` 写作 `#RRGGBB` 或 `#RRGGBBAA`。请保持浅底深条：这个包也能识别深底浅条（`tryInvert`），但很多扫描器不能。透明背景在识别时按白色处理。
- `rotate` 把条码顺时针旋转 90、180 或 270 度，用于横着打印的标签。
- `errorCorrection` 让二维码部分损坏或被遮住时仍能识别：QR 码从 `'L'`（约 7%）到 `'H'`（约 30%）。等级越高，同样的内容生成的码越大。

## 3. EAN、UPC 和 GS1

零售码制会计算校验位，给出的校验位也会被验证：

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

- **UPC。** UPC-A 就是以 0 开头的 EAN-13，会被识别为 13 位的 `EAN13`：`01234567890` 识别出 `0012345678905`。`formats` 里有 `UPCA` 而没有 `EAN13` 时，格式是 `UPCA`，数字还是这 13 位。ISBN 也会被识别为 `EAN13`。
- **附加码。** 2 位或 5 位的附加码（期号、价格）放在 `addOn` 里，和文本分开。用 `addOn: 'require'` 时，只保留带附加码的条码。
- **GS1。** 应用标识符可以写在方括号或圆括号里；加上 `gs1: true` 时，Code 128 就成了 GS1-128，QR 码、Data Matrix 和 Aztec 也可以装 GS1 数据。DataBar Expanded 两种码制的内容总是 GS1 数据；其他 DataBar 码制装的是 GTIN，带不带校验位都可以。识别时，数据以圆括号形式给出，`gs1` 为 `true`。

每种码制会被识别成什么、识别出的文本是什么样子，见这个包的 README。

## 4. 识别图片

`read(image, options)` 接受图片文件（它的字节，`Buffer` 或 `Uint8Array`）或像素，返回找到的所有条码；没有条码时返回空数组：

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

- **识别得更快。** `formats` 把查找范围限制在预期的码制上：在 1920×1080 的画面里识别一个 QR 码，查找所有码制约 8 毫秒，只查找 QR 码约 1.4 毫秒（第 7 节）。`pure: true` 用于图片里只有一个摆正的条码、周围没有别的东西的情况，例如 `generate()` 生成的图片。
- **难识别的图片。** `tryHarder`、`tryRotate`、`tryInvert` 和 `tryDownscale` 默认都打开：它们会再去找很小的、旋转了的、深底浅色的和大图里的条码。已知图片容易识别时，关掉它们会更快。
- **识别不出的情况。** 模块宽度小于约 2 像素的条码、模糊或反光的照片、被图片边缘截断的条码。这时识别出的条码会变少或者没有；只有图片无法解码时才会抛出异常（`BarcodeImageException`）。
- **大图片**：超过 5000 万像素的图片在解码像素之前就会被拒绝，所以上传的文件不会让进程分配几个 GB 的内存。
- **字节。** `bytes` 是编码在码里的原始内容；`text` 是它的可读形式（带校验位，GS1 用圆括号），`symbologyIdentifier` 说明怎样解读这些字节（`]Q1` 是 QR 码，`]C1` 是 GS1-128 等）。

## 5. 在应用中使用

组件不用注册就能注入（`@Inject(Barcode)`），使用默认选项。要用自己的选项时，在配置的 `components` 里给组件起一个名字，用 `buildBarcodeOptions()` 注册它，设置 `generate()` 和 `read()` 的默认选项、时限和并发数；一个应用可以用不同的名字注册多个，各用各的选项。下面的仓库应用注册了两个：`labels` 打印标签，`scanner` 识别照片：

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

- `buildBarcodeOptions()` 用你选定的名字声明组件；其他对象按这个名字注入它（`@Inject('labels')`），或者用 `getObject('labels')` 获取。
- 注册的组件只能按名字注入。`@Inject(Barcode)` 得到的是另一个组件：它是自动加载的，使用默认选项，配置里的选项对它不起作用。

下面的控制器把商品标签作为 PNG 返回，并识别上传图片里的条码：

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

- 调用时传入的选项覆盖组件的默认选项：`this.labels.generate('QRCode', url, {scale: 6})` 的其他选项仍用默认值。
- 参数会先经过校验：未知的码制、不是 `#RRGGBB` 格式的颜色，在调用原生插件之前就会被拒绝，抛出 `InvalidMethodAcceptException`。
- 一个组件可以同时为所有控制器服务：各次调用互不影响，只受 `concurrency` 的限制。
- 在 React Native 的手机应用（手机模板）里，组件同样在应用的 Node.js 中运行：`lakutata mobile stage` 会从源码为 Android（用 NDK）、iOS（用 Xcode）和鸿蒙（用 DevEco Studio）编译原生插件。

## 6. 时限、取消和并发

每次调用都可以传入 `signal`（`AbortSignal`）和以毫秒为单位的 `timeout`，时限从调用时开始计算；没有传 `timeout` 的调用使用组件的 `timeout`。

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

- 还没开始执行的操作会直接放弃。已经开始执行的操作无法中途停止，因为 zint 和 zxing-cpp 没有可以中断的地方：它的 Promise 会立即被拒绝（`BarcodeTimeoutException`、`BarcodeCancelledException`），结果在执行结束后丢弃。这些操作都很快（第 7 节）；时限是为大照片和恶意上传准备的。
- `concurrency` 限制一个组件同时执行的操作数，其余的排队等待，排队期间时限照样计算。不设置时，操作在原生插件的线程里排队。
- 原生插件有 `LAKUTATA_BARCODE_THREADS` 个线程，默认是处理器数减一，所有组件共用；它不使用 libuv 的线程池，所以不会拖慢文件和 DNS 操作。
- 应用停止时，组件会等待正在执行的操作，最多 `drainTimeout` 毫秒（默认 10000）；还在排队的操作以 `BarcodeCancelledException` 拒绝，之后的调用也一样。

## 7. 速度

在 Apple M4 上测得（Node.js 24，除特别说明外每次只执行一个调用）：

| 操作 | 耗时 |
|---|---|
| 一个网址的 QR 码，PNG（148×148） | 0.19 毫秒 |
| 同一个 QR 码，像素 / SVG | 0.08 毫秒 / 0.17 毫秒 |
| EAN-13 / Code 128，PNG，带文字 | 0.62 毫秒 / 1.6 毫秒 |
| 识别这个 QR 码的 PNG，所有码制 / `formats: ['QRCode']` | 0.33 毫秒 / 0.11 毫秒 |
| 识别它的像素，`formats: ['QRCode']`，`pure: true` | 0.06 毫秒 |
| 在 1920×1080 的画面里识别一个 QR 码，所有码制 / `formats: ['QRCode']` | 7.8 毫秒 / 1.4 毫秒 |
| 同时生成 / 同时识别 1000 个 QR 码 PNG（9 个线程） | 63 毫秒 / 33 毫秒 |

手机拍的照片比这些 `generate()` 生成的图片识别得慢：照片里的条码更小、有旋转、有模糊，`try…` 选项要做更多的工作。

## 8. 验证方式，以及不支持的情况

测试为每种码制生成条码，再从它的 PNG 和像素识别回来，内容有随机的（多种文字的文本，以及字节）；测试检查每个选项的效果，识别 7 种文件格式的图片，并识别 240 张损坏的图片，结果只能是识别出条码或者抛出 `BarcodeImageException`。测试在 macOS（arm64：Node.js 24 和 18.10、Bun 1.4）、Linux（arm64：Debian 12 上的 Node.js 22，Alpine 上的 Node.js 24）和 Windows 11（arm64：Node.js 24）上运行；这个包也能在 Electron 44 的主进程里运行，也能在 Android、iOS 和鸿蒙的手机应用里运行：在三个模拟器上，每种码制和 7 种文件格式都能识别回来。

它不支持的情况，有的是有意为之，有的是还没做：

- zxing-cpp 识别不了的码制不提供生成：四态邮政码、汉信码、DotCode、Code One、Grid Matrix、Codablock-F、Code 16K、Code 49 以及 zint 的其他堆叠码制。Telepen Numeric 也没有提供，因为识别时除非只查找它，否则会把它当成 Telepen。
- 分成多个码的内容（结构化追加）逐个识别：`structuredAppend` 给出每个码的位置，内容的拼接由应用完成。
- 像素只支持灰度、RGB 和 RGBA；BGR 和 BGRA（某些摄像头接口）需要应用自己转换。GIF 只识别第一帧。
- 输出只有 PNG、SVG 和像素，不提供 EPS、EMF 和 PDF。

## 9. 异常

所有异常都继承 `BarcodeException`，它继承 lakutata 的 `Exception`。

| 异常 | `errno` | 什么时候 |
|---|---|---|
| `BarcodeContentException` | `E_BARCODE_CONTENT` | 内容无法用这种码制编码，附带 zint 给出的原因 |
| `BarcodeOptionException` | `E_BARCODE_OPTION` | 码制不支持这个选项（如给 Code 128 指定 `errorCorrection`），或者值超出范围（`version: 41`） |
| `BarcodeImageException` | `E_BARCODE_IMAGE` | 图片无法解码，或者超过 5000 万像素；像素的字节数不等于 `width × height × channels` |
| `BarcodeTimeoutException` | `E_BARCODE_TIMEOUT` | 操作超过时限 |
| `BarcodeCancelledException` | `E_BARCODE_CANCELLED` | 操作的 signal 被中止，或者调用了已经销毁的组件 |
| `BarcodeException` | `E_BARCODE` | 原生插件的内部错误 |
