# 热敏打印机

小票、标签和腕带用 HTML 和 CSS 编排，渲染成打印机自己的点阵，再以打印机的指令发出去。由三个包完成：

- [`@lakutata/thermal`](https://github.com/lakutata/lakutata/tree/main/packages/thermal)，引擎：`render()` 按纸的宽度排版 HTML，画成黑白点阵（原生插件，内含 litehtml、FreeType 和一套中文字体）；`encode()` 把点阵变成 ESC/POS、TSPL 或 ZPL 指令。渲染结果就是打印预览：`toPNG()` 得到的正是打印机要印的那些点。
- [`@lakutata/thermal-printer`](https://github.com/lakutata/lakutata/tree/main/packages/thermal-printer)，组件：`ThermalPrinterManager` 负责找到打印机、按应用落盘的 JSON 定义打开它们，并为每台打印机给出一个 `ThermalPrinter`，它按调用顺序经网口、系统打印队列、USB、串口或蓝牙打印。
- [`@lakutata/serial`](https://github.com/lakutata/lakutata/tree/main/packages/serial)：串口和经典蓝牙设备，用于接在上面的打印机（也可以用于其他任何串口设备）。

`lakutata` 包不重新导出它们：应用用到哪个就安装哪个。

```shell
npm install @lakutata/thermal-printer          # 会一起安装引擎
npm install @lakutata/serial                   # 串口和蓝牙打印机需要
```

引擎和串口包安装时会编译原生插件（机器上需要 Python 3 和 C++ 编译器）；组件只在 macOS 和 Windows 上编译一个小插件。

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

- 一台打印机就是一个**定义**：它的 `connection`、介质（`model`、`paper`、`label`、`width`、`dpi`、`rotate`、`page`）和 `commands`（切纸、走纸、钱箱……）。配置里的打印机在第一次使用时才打开。
- `print()` 按打印机的介质渲染 HTML，编码成它的指令并发送；指令交给连接后完成。同一台打印机的打印按调用顺序一个接一个发出。
- `print()` 也接受 `render()` 的渲染结果，或者作为 `Buffer` 的原始指令（原样发送）。

## 2. 程序运行时选择打印机

桌面或收银软件通常让用户选择打印机，并把选择保存下来：

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

- `discover()` 找到 USB 打印机（带它上报的 IEEE 1284 ID、这个 ID 对应的型号表里的型号和它的指令语言）、系统打印队列，以及串口和蓝牙口。网络打印机没法这样找到，需要填写地址。
- `open()` 为每台设备只创建一次 `ThermalPrinter`：同一台设备再打开，得到的是同一个对象，这样一台打印机上不会有两个队列交错发送数据。`get(name)` 按名字取回它，`close()` 关闭它。
- `printer.definition` 是要保存的 JSON；`validatePrinterDefinition()` 检查保存下来的定义。

## 3. 用 HTML 编排小票

页面宽度就是打印机的打印宽度：58 毫米纸是 48 毫米（203 dpi 下 384 点），80 毫米纸是 72 毫米（576 点），标签或腕带就是它们的宽度。HTML 按这个宽度排版，和浏览器一样：

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

- **宽度自适应**：百分比、`max-width`、表格、文字换行。中文和日文按 UAX #14 的规则断行（闭标点不落在行首），长单词和网址也会断开。
- **媒体查询**看到的就是打印宽度：同一个模板可以让 58 毫米和 80 毫米的小票排得不一样。
- **单位**：`mm`、`pt`、`px`（和 CSS 一样是 1/96 英寸）、`%` 和 `em` 都换算成打印机的点，所以同一个模板在 180、203、300 dpi 下印出来尺寸一样。默认文字 12px，约 3 毫米。
- **CSS**：盒模型、`display`（block、inline、inline-block、flex、table）、浮动、`position`、圆角边框、线性和径向渐变、`::before` 和 `::after`、计数器、`var()`、`@media`、`white-space`。不支持：`calc()`、grid、`transform`、`opacity`、`box-shadow`、`letter-spacing`、`@font-face`。
- **黑白**：文字按黑色打印（接近白色的除外）；渐变和照片做抖动，SVG 和条码按阈值处理成纯黑。
- **字体**：内置 Noto Sans SC（常规和粗体，OFL 许可），覆盖中文、日文假名、拉丁字母和数字。`registerFont()` 注册其他字体，用 `font-family` 选择。

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

- 图片可以是 `data:` 地址（PNG、JPEG、GIF、BMP、SVG）、内联的 `<svg>` 元素，以及打印机 `baseDir` 下的文件（不能在它外面）。远程地址会被拒绝。
- `qrcode:<文字>` 直接画二维码，模块落在整点上，最清晰。
- 条码用 PNG 时，在地址后面加 `#threshold`，线条才是实心的。

## 4. 介质

| 选项 | 用于 | 例子 |
|---|---|---|
| `paper` | 58 或 80 毫米的小票纸卷，203 dpi | `{paper: 80}` |
| `model` | 型号表里的打印机（`printerModels()`）：它的分辨率、宽度、语言和习惯 | `{model: 'TM-T88VI'}` |
| `label` | 标签或腕带：宽度和长度（毫米），配合 `dpi` 或标签打印机的 `model` | `{model: 'HC100', label: {width: 25, height: 250}}` |
| `width`、`dpi` | 其他纸：打印宽度（毫米）和分辨率 | `{width: 24, dpi: 300}` |
| `rotate` | 转过来打印（90、180、270）：比如沿长度方向打印的腕带 | `{rotate: 90}` |
| `page` | 纸卷上的固定页长，以及多出来的内容怎么办（`overflow`） | `{paper: 58, page: {length: 100}}` |

## 5. 告诉打印机做什么

`commands` 就是 `encode()` 的选项，可以写在定义里（每次打印都用），也可以写在一次打印里（只用于这一次）：

| 选项 | 作用 |
|---|---|
| `cut` | 每页之后切纸（打印机要有切刀）：`'partial'` 半切，`'full'`（或 `true`）全切；ESC/POS、TSPL、ZPL 都支持。默认不切纸 |
| `feed` | ESC/POS：每页打印完再走出多少毫米的纸（`15`：送过 15 毫米外的撕纸口）。默认 0；和 `cut` 互不影响 |
| `drawer` | ESC/POS：最后一页之后弹开钱箱 |
| `language` | 没有 `model` 时的指令语言：`'escpos'`、`'tspl'`、`'zpl'` |
| `copies`、`sensor`、`gap`、`density`、`speed` | 标签打印机：份数、怎么找到标签（间隙、黑标、连续纸）、浓度、速度 |

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
| `network` | `host` 和 `port`（9100）：连接原始打印端口的 TCP 连接，每次打印连接一次 |
| `queue` | 系统打印队列：macOS 和 Linux 上是 CUPS（`lp -o raw`），Windows 上是后台打印服务（RAW 文档） |
| `usb` | USB 打印机：Linux 上是 `/dev/usb/lpN`，macOS 上按 ID，Windows 上是它的打印机接口（系统自带的驱动） |
| `serial` | 串口（`@lakutata/serial`）：`path`、`baudRate`、`flowControl`（`'rts/cts'`、`'dtr/dsr'`、`'xon/xoff'`） |
| `bluetooth` | 经典蓝牙打印机，需要先和系统配对（`@lakutata/serial`）：它的 `address` |

- USB、串口和蓝牙打印机在对象存在期间一直保持连接；网络打印机和打印队列每次打印连接一次。
- `stallTimeout`（默认 10 秒）：打印机不再接收数据（缺纸、上盖打开、离线）时让这次打印失败。`bytesPerSecond` 为慢速连接限速。
- `/dev/usb/lp0` 是 USB 打印机，不是串口：要写成 `usb` 连接。

## 7. 单独使用引擎

引擎不需要应用：渲染、预览、编码，字节由你自己发送。

```typescript
import {writeFile} from 'node:fs/promises'
import {encode, render} from '@lakutata/thermal'

const image = await render('<h1>Order 42</h1>', {paper: 58})
await writeFile('preview.png', image.toPNG())
const escpos: Buffer = encode(image, {language: 'escpos', feed: 3, cut: 'partial'})
console.log(escpos.length)
```

## 8. 串口和蓝牙设备

`@lakutata/serial` 把串口作为流打开，用于打印机和其他任何串口设备：

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

- 每个串口都有自己的线程：打开的串口不会拖慢 Node.js 的其他工作；转接器被拔掉时，即使当时没有读写也会报告（`'error'`，`disconnected: true`）。
- 所有等待都有上限：写入和等待发送用 `stallTimeout`，关闭用 `close({stallTimeout})`（10 秒）。
- 蓝牙：Linux 上用 RFCOMM 套接字；macOS 和 Windows 上用系统为配对设备生成的串口。

## 9. 运行环境和打包

- macOS、Linux 和 Windows 上的 Node.js 18.10 及以上、Bun、Electron 和 NW.js。插件基于 Node-API，同一份编译结果不用重新编译就能在 Electron 和 NW.js 里加载。
- `lakutata package`（bundle、Node.js 和 Bun 的可执行文件、Electron 应用）会把插件和字体随应用一起打包。
- 在手机应用中，构建工具像编译其他原生插件一样编译引擎的插件，打印机经网口连接。

## 10. 第一期不做的事

- 打印机按页面的点阵（位图）驱动：不使用打印机自带的文字字体、存储的标志和状态回读。
- 不支持低功耗蓝牙（BLE）打印机，也不支持其他指令语言（CPCL、EPL、Star 位图）。
- 不自动发现网络打印机：需要填写地址。

## 异常

| 异常 | 什么时候 |
|---|---|
| `ThermalOptionException` | 引擎不接受的选项：介质、指令 |
| `ThermalContentException` | 渲染不了的 HTML：读不了的图片、`baseDir` 以外的文件 |
| `ThermalFontException` | 用不了的字体 |
| `ThermalTimeoutException`、`ThermalCancelledException` | 渲染超过 `timeout`，或被 `signal` 取消 |
| `ThermalPrinterConnectionException` | 连不上打印机，或打印机在停滞超时内一直不接收数据 |
| `ThermalPrinterOptionException` | 不是合法的打印机定义 |
| `SerialException` | 串口或蓝牙设备出错；`code` 是错误名，`disconnected` 表示设备被拔掉 |
