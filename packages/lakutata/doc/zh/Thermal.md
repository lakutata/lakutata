# Lakutata 热敏打印机

小票、标签和腕带以 HTML 和 CSS 编排，渲染为打印机自身的点阵，再以打印机的指令发送。这一过程由以下三个包完成：

- [`@lakutata/thermal`](https://github.com/lakutata/lakutata/tree/main/packages/thermal)，即引擎：`render()` 按纸张宽度排版 HTML，并绘制为黑白点阵（原生插件，内含 litehtml、FreeType 和一套中文字体）；`encode()` 将点阵转换为 ESC/POS、TSPL 或 ZPL 指令。渲染结果即打印预览，`toPNG()` 返回的正是打印机将要打印的点。
- [`@lakutata/thermal-printer`](https://github.com/lakutata/lakutata/tree/main/packages/thermal-printer)，即组件：`ThermalPrinterManager` 负责查找打印机，按应用保存为 JSON 的定义打开打印机，并为每台打印机提供一个 `ThermalPrinter`；后者按调用顺序，经网口、系统打印队列、USB、串口或蓝牙打印。
- [`@lakutata/serial`](https://github.com/lakutata/lakutata/tree/main/packages/serial)：支持串口和经典蓝牙设备，用于经串口或经典蓝牙连接的打印机（也可用于其他任何串口设备）。

`lakutata` 包不重新导出这些包，请按应用的需要安装相应的包。

```shell
npm install @lakutata/thermal-printer          # 会一起安装引擎
npm install @lakutata/serial                   # 串口和蓝牙打印机需要
```

引擎和串口包在安装时会编译原生插件（机器上需要 Python 3 和 C++ 编译器）；组件仅在 macOS 和 Windows 上编译一个小型插件。

## 1. 打印

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildThermalPrinterManagerOptions, type ThermalPrinterManager} from '@lakutata/thermal-printer'

class Counter extends Component {
    @Inject('printers')
    protected readonly printers: ThermalPrinterManager

    public async receipt(order: {id: string, total: string}): Promise<void> {
        await this.printers.print('front', `<h1>Order ${order.id}</h1><p>Total ${order.total}</p>`)
    }
}

Application.run(() => ({
    id: 'shop',
    name: 'Shop',
    components: {
        printers: buildThermalPrinterManagerOptions({
            printers: {
                front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}}
            }
        }),
        counter: {class: Counter}
    }
}))
```

- 一台打印机即一个**定义**，包括其 `connection`、介质（`model`、`paper`、`label`、`width`、`dpi`、`rotate`、`page`）和 `commands`（切纸、走纸、钱箱……）。配置中的打印机在首次使用时才打开。
- `print()` 按打印机的介质渲染 HTML，将其编码为打印机的指令并发送；指令交给连接后，调用即完成。同一台打印机的各次打印按调用顺序依次发出。
- `print()` 也接受 `render()` 的渲染结果，或以 `Buffer` 形式提供的原始指令（按原样发送）。

## 2. 程序运行时选择打印机

桌面或收银软件通常允许用户选择打印机，并保存用户的选择：

```typescript
import {readFile, writeFile} from 'node:fs/promises'
import {validatePrinterDefinition, type ThermalPrinterManager} from '@lakutata/thermal-printer'

async function choose(manager: ThermalPrinterManager): Promise<void> {
    const candidates = await manager.discover()
    const chosen = candidates.find((candidate) => candidate.printer)
    if (!chosen) return
    const printer = await manager.open({connection: chosen.connection, model: chosen.model, paper: 80, commands: {language: chosen.language, cut: 'partial'}}, 'front')
    await writeFile('printer.json', JSON.stringify(printer.definition))
}

async function restore(manager: ThermalPrinterManager): Promise<void> {
    await manager.open(validatePrinterDefinition(JSON.parse(await readFile('printer.json', 'utf8'))), 'front')
}
```

- `discover()` 查找 USB 打印机（附带打印机上报的 IEEE 1284 ID、该 ID 在型号表中对应的型号及其指令语言）、系统打印队列，以及串口和蓝牙端口。网络打印机无法通过这种方式找到，需要填写地址。
- `open()` 为每台设备只创建一次 `ThermalPrinter`。再次打开同一台设备时，得到的是同一个对象，因此一台打印机上不会有两个队列交错发送数据。`get(name)` 按名称取回该对象，`close()` 将其关闭。
- `printer.definition` 是需要保存的 JSON；`validatePrinterDefinition()` 用于检查已保存的定义。

## 3. 用 HTML 编排小票

页面宽度即打印机的打印宽度：58 毫米纸为 48 毫米（203 dpi 下 384 点），80 毫米纸为 72 毫米（576 点），标签或腕带则为其自身宽度。HTML 按此宽度排版，方式与浏览器相同：

```typescript
import {render} from '@lakutata/thermal'

const html: string = `
    <style>
        h1 { text-align: center; font-size: 20px; margin: 0 0 2mm }
        .row { display: flex; justify-content: space-between }
        @media (max-width: 50mm) { .row { display: block } }
        table { width: 100%; border-collapse: collapse }
        td:last-child { text-align: right }
    </style>
    <h1>湖畔咖啡</h1>
    <div class="row"><span>Order 42</span><span>2026-11-08 12:30</span></div>
    <table><tr><td>Latte</td><td>¥32.00</td></tr><tr><td>Croissant</td><td>¥18.00</td></tr></table>`
const narrow = await render(html, {paper: 58})
const wide = await render(html, {paper: 80})
console.log(narrow.width, wide.width)
```

- **宽度自适应**：百分比、`max-width`、表格、文字换行。中文和日文按 UAX #14 的规则断行（闭标点不落在行首），长单词和网址也会被断开。
- **媒体查询**所见的宽度即打印宽度，因此同一个模板可以为 58 毫米和 80 毫米的小票采用不同的排版。
- **单位**：`mm`、`pt`、`px`（与 CSS 相同，为 1/96 英寸）、`%` 和 `em` 都会换算为打印机的点，因此同一个模板在 180、203、300 dpi 下打印出的尺寸相同。默认文字大小为 12px，约 3 毫米。
- **CSS**：盒模型、`display`（block、inline、inline-block、flex、table）、浮动、`position`、圆角边框、线性和径向渐变、`::before` 和 `::after`、计数器、`var()`、`@media`、`white-space`。不支持：`calc()`、grid、`transform`、`opacity`、`box-shadow`、`letter-spacing`、`@font-face`。
- **黑白**：文字按黑色打印（接近白色的除外）；渐变和照片经过抖动处理，SVG 和条码按阈值处理为纯黑。
- **字体**：内置 Noto Sans SC（常规和粗体，OFL 许可），覆盖中文、日文假名、拉丁字母和数字。`registerFont()` 用于注册其他字体，注册后的字体通过 `font-family` 选择。

### 图片、条码和二维码

```typescript
import type {Barcode} from '@lakutata/barcode'
import type {ThermalPrinter} from '@lakutata/thermal-printer'

async function label(printer: ThermalPrinter, barcode: Barcode): Promise<void> {
    const svg: string = await barcode.generate('EAN13', '590123412345', {output: 'svg'})
    await printer.print(`
        <img style="width: 40mm" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
        <img style="width: 25mm" src="qrcode:ORDER-42">
        <img style="width: 30mm" src="logo.png">
    `)
}
```

- 图片可以是 `data:` 地址（PNG、JPEG、GIF、BMP、SVG）、内联的 `<svg>` 元素，以及打印机 `baseDir` 下的文件（不能位于该目录之外）。远程地址会被拒绝。
- `qrcode:<文字>` 直接绘制二维码，模块与整点对齐，效果最清晰。
- 条码使用 PNG 时，需要在地址后添加 `#threshold`，线条才能保持实心。

## 4. 介质

| 选项 | 用途 | 示例 |
|---|---|---|
| `paper` | 58 或 80 毫米的小票纸卷，203 dpi | `{paper: 80}` |
| `model` | 型号表中的打印机（`printerModels()`）：包括其分辨率、宽度、语言和习惯 | `{model: 'TM-T88VI'}` |
| `label` | 标签或腕带：宽度和长度（毫米），配合 `dpi` 或标签打印机的 `model` | `{model: 'HC100', label: {width: 25, height: 250}}` |
| `width`、`dpi` | 其他纸张：打印宽度（毫米）和分辨率 | `{width: 24, dpi: 300}` |
| `rotate` | 旋转后打印（90、180、270），例如沿长度方向打印的腕带 | `{rotate: 90}` |
| `page` | 纸卷上的固定页长，以及超出部分的处理方式（`overflow`） | `{paper: 58, page: {length: 100}}` |

## 5. 告诉打印机做什么

`commands` 即 `encode()` 的选项，可以写在定义中（每次打印都使用），也可以写在某次打印中（仅用于该次打印）：

| 选项 | 作用 |
|---|---|
| `cut` | 每页之后切纸（打印机需配备切刀）：`'partial'` 为半切，`'full'`（或 `true`）为全切；ESC/POS、TSPL、ZPL 均支持。默认不切纸 |
| `feed` | ESC/POS：每页打印后走纸的毫米数（`15` 表示走纸越过 15 毫米外的撕纸口）。默认为 0；与 `cut` 互不影响 |
| `drawer` | ESC/POS：最后一页之后弹开钱箱 |
| `skipBlank` | ESC/POS 和 TSPL：1 毫米及以上的空白不发送（ESC/POS 以走纸跳过），从而减少一张小票的数据量。默认开启；如果打印机打出的空白偏短或偏长，请设为 `false` |
| `language` | 没有 `model` 时的指令语言：`'escpos'`、`'tspl'`、`'zpl'` |
| `copies`、`sensor`、`gap`、`density`、`speed` | 标签打印机：份数、标签检测方式（间隙、黑标、连续纸）、浓度、速度 |

```typescript
import type {ThermalPrinter} from '@lakutata/thermal-printer'

async function ticket(printer: ThermalPrinter): Promise<void> {
    //只用于这一次打印：不切纸，弹开钱箱
    await printer.print('<h2>Table 7</h2>', {commands: {cut: false, drawer: true}})
}
```

## 6. 连接方式

| `type` | 方式 |
|---|---|
| `network` | `host` 和 `port`（9100）：连接原始打印端口的 TCP 连接，每次打印时建立一次连接 |
| `queue` | 系统打印队列：macOS 和 Linux 上为 CUPS（`lp -o raw`），Windows 上为后台打印服务（RAW 文档） |
| `usb` | USB 打印机：Linux 上为 `/dev/usb/lpN`，macOS 上按 ID 识别，Windows 上为其打印机接口（使用系统自带的驱动） |
| `serial` | 串口（`@lakutata/serial`）：`path`、`baudRate`、`flowControl`（`'rts/cts'`、`'dtr/dsr'`、`'xon/xoff'`） |
| `bluetooth` | 经典蓝牙打印机，需要先与系统配对（`@lakutata/serial`）：指定其 `address` |

- USB、串口和蓝牙打印机在对象存在期间始终保持连接；网络打印机和打印队列在每次打印时连接一次。
- `stallTimeout`（默认 10 秒）：打印机不再接收数据（缺纸、上盖打开、离线）时，使本次打印失败。`bytesPerSecond` 用于为慢速连接限速。
- `/dev/usb/lp0` 是 USB 打印机，不是串口，因此应配置为 `usb` 连接。

## 7. 单独使用引擎

引擎无需应用即可使用：渲染、预览、编码，然后自行发送字节。

```typescript
import {writeFile} from 'node:fs/promises'
import {encode, render} from '@lakutata/thermal'

const image = await render('<h1>Order 42</h1>', {paper: 58})
await writeFile('preview.png', image.toPNG())
const escpos: Buffer = encode(image, {language: 'escpos', feed: 3, cut: 'partial'})
console.log(escpos.length)
```

## 8. 串口和蓝牙设备

`@lakutata/serial` 将串口作为流打开，可用于打印机和其他任何串口设备（另有单独的指南[串口](Serial.md)）：

```typescript
import {listSerialPorts, openBluetoothSerial, openSerialPort} from '@lakutata/serial'

async function serial(): Promise<void> {
    console.log(await listSerialPorts())
    const port = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200, flowControl: 'rts/cts'})
    port.on('error', (error: Error) => console.error(error))
    port.write(Buffer.from([0x1B, 0x40]))
    await port.close()
    const printer = await openBluetoothSerial({address: '00:11:22:33:44:55'})
    await printer.close()
}
```

- 每个串口都有独立的线程，因此打开的串口不会拖慢 Node.js 的其他工作；转接器被拔出时，即使当时没有读写操作，也会报告该事件（`'error'`，`disconnected: true`）。
- 所有等待都有时间上限：写入和等待发送使用 `stallTimeout`，关闭使用 `close({stallTimeout})`（10 秒）。
- 蓝牙：Linux 上使用 RFCOMM 套接字；macOS 和 Windows 上使用系统为配对设备生成的串口。

## 9. 运行环境和打包

- 支持 macOS、Linux 和 Windows 上的 Node.js 18.10 及以上版本、Bun、Electron 和 NW.js。插件基于 Node-API，因此同一份编译结果无需重新编译即可在 Electron 和 NW.js 中加载。
- `lakutata package`（bundle、Node.js 和 Bun 的可执行文件、Electron 应用）会将插件和字体随应用一起打包。
- 在手机应用中，构建工具以编译其他原生插件的方式编译引擎的插件，打印机通过网口连接。

## 10. 第一期不做的事

- 打印机以页面的点阵（位图）驱动，不使用打印机自带的文字字体、存储的标志和状态回读。
- 不支持低功耗蓝牙（BLE）打印机，也不支持其他指令语言（CPCL、EPL、Star 位图）。
- 不自动发现网络打印机，需要填写地址。

## 异常

| 异常 | 抛出时机 |
|---|---|
| `ThermalOptionException` | 引擎不接受的选项：介质、指令 |
| `ThermalContentException` | 无法渲染的 HTML：无法读取的图片、`baseDir` 以外的文件 |
| `ThermalFontException` | 无法使用的字体 |
| `ThermalTimeoutException`、`ThermalCancelledException` | 渲染超过 `timeout`，或被 `signal` 取消 |
| `ThermalPrinterConnectionException` | 无法连接打印机，或打印机在停滞超时时间内始终不接收数据 |
| `ThermalPrinterOptionException` | 打印机定义无效 |
| `SerialException` | 串口或蓝牙设备出错；`code` 为错误名称，`disconnected` 表示设备已被拔出 |
