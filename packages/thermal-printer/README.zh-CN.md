# @lakutata/thermal-printer

[English](README.md) | 中文

[Lakutata](https://github.com/lakutata/lakutata) 框架的热敏打印机包。管理器组件负责查找打印机（USB 打印机、系统打印队列、串口和蓝牙口），并按应用保存到磁盘的 JSON 定义打开这些打印机。打开后的每台打印机都是一个对象，该对象用 [`@lakutata/thermal`](../thermal) 渲染以 HTML 编排的小票、标签和腕带，将其编码为该打印机的指令（ESC/POS、TSPL 或 ZPL），并按调用顺序发出。`lakutata` 包不会重新导出本包，请从 `@lakutata/thermal-printer` 导入。

## 安装

```shell
npm install @lakutata/thermal-printer
```

- 本包会安装 `@lakutata/thermal`，后者的原生插件在安装时编译（机器上所需的工具见其 README）。
- 在 macOS 和 Windows 上，本包还会编译一个自带的小插件，用于 USB 打印机和 Windows 的后台打印服务。Linux 上不需要该插件，因为 USB 打印机就是设备文件，打印队列使用 CUPS 命令。
- 串口和蓝牙打印机需要 `@lakutata/serial`（`npm install @lakutata/serial`）。未安装时，打开这类打印机会失败，错误信息中会写明需要该包。
- Node.js `>=18.10.0`，以及 `@lakutata/core`。

## 用法

### 管理器

```typescript
import {Application} from 'lakutata'
import {buildThermalPrinterManagerOptions} from '@lakutata/thermal-printer'

Application.run(() => ({
    id: 'shop',
    name: 'Shop',
    components: {
        printers: buildThermalPrinterManagerOptions({
            printers: {
                front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}},
                labels: {connection: {type: 'queue', name: 'TSC_TDP_225'}, model: 'TDP-225', label: {width: 40, height: 30}}
            }
        })
    }
}))
```

配置中的打印机在首次使用时才打开，因此应用启动时即使某台打印机不可用，也不会导致应用启动失败。

### 找到打印机并保存

打印机一般在程序运行时选择，而不是固定写在代码中：先查找打印机，打开用户选中的打印机，再保存其定义。

```typescript
import {writeFile} from 'node:fs/promises'
import type {ThermalPrinterManager} from '@lakutata/thermal-printer'

async function setUp(manager: ThermalPrinterManager): Promise<void> {
    const candidates = await manager.discover()
    //USB 打印机和打印队列一定是打印机；串口和蓝牙口上可能接着打印机
    const chosen = candidates.find((candidate) => candidate.printer)
    if (!chosen) return
    //带切刀的小票机：每张小票打完半切
    const printer = await manager.open({connection: chosen.connection, model: chosen.model, paper: 80, commands: {language: chosen.language, cut: 'partial'}}, 'front')
    await writeFile('printer.json', JSON.stringify(printer.definition))
}
```

下次启动时，再打开保存的定义：

```typescript
import {readFile} from 'node:fs/promises'
import {validatePrinterDefinition, type ThermalPrinterManager} from '@lakutata/thermal-printer'

async function restore(manager: ThermalPrinterManager): Promise<void> {
    const definition = validatePrinterDefinition(JSON.parse(await readFile('printer.json', 'utf8')))
    await manager.open(definition, 'front')
}
```

- `discover()` 列出候选设备，每项都带一个可以直接打开、也可以直接保存的 `connection`。USB 打印机还会给出其上报的 IEEE 1284 ID（`deviceId`）、该 ID 在 `printerModels()` 中对应的型号（`model`），以及其上报的指令语言（`language`）。网络打印机无法以这种方式找到，需要用户填写地址。
- `open(definition, name?)` 对每台设备只打开一次。再次打开同一台设备时，返回的是同一个对象（定义仍为第一次的定义），因此一台打印机上不会有两个队列交错发送数据。
- `get(name)` 按名称获取打印机，`names()` 列出名称，`openPrinters()` 列出已打开的打印机，`close(printer)` 关闭一台打印机。
- `validatePrinterDefinition()` 检查从文件读出的定义；介质在打开时由引擎检查。

### 打印

```typescript
import type {ThermalPrinterManager} from '@lakutata/thermal-printer'

async function print(manager: ThermalPrinterManager): Promise<void> {
    const front = await manager.get('front')
    //HTML：按打印机的介质渲染，编码成它的指令
    await front.print('<h1>Order 42</h1>', {commands: {drawer: true}})
    //原始指令：原样发送
    await front.print(Buffer.from([0x1B, 0x40, 0x0A]))
    //预览：和打印机印出来的点阵一样
    const png: Buffer = (await front.preview('<h1>Order 42</h1>')).toPNG()
    //一次调用，按名字或按定义
    await manager.print('front', '<p>Thank you</p>')
    console.log(png.length)
}
```

- `print()` 在指令交给连接后完成（打印机可能仍在打印），结果为打印的页数和发送的字节数。同一台打印机的各次打印按调用顺序依次发出。
- 一次打印的 `commands` 选项会逐项覆盖打印机自身 `commands` 中的同名选项；该次打印的 `signal` 可以在其排队等候或渲染时将其取消。
- 用定义调用 `manager.print()` 时会打开该打印机（见 `open()`），打印机打开后会保持到被关闭为止。因此，以这种方式打印过一次的 USB、串口或蓝牙打印机会持续被应用占用，在 `close()` 之前，其他程序打开该打印机会得到 `'EBUSY'`。
- `preview(html)` 只渲染不打印；`commandsOf(content)` 给出指令但不发送。

### 图片和条码

HTML 中的图片可以是 `data:` 地址（PNG、JPEG、GIF、BMP、SVG）、内联的 `<svg>` 元素，以及 `baseDir` 下的文件。[`@lakutata/barcode`](../barcode) 生成的条码可以直接放入，无需保存为文件：

```typescript
import type {Barcode} from '@lakutata/barcode'
import type {ThermalPrinter} from '@lakutata/thermal-printer'

async function label(printer: ThermalPrinter, barcode: Barcode): Promise<void> {
    const svg: string = await barcode.generate('EAN13', '590123412345', {output: 'svg'})
    const png: Buffer = await barcode.generate('Code128', 'ORDER-42')
    await printer.print(`
        <img style="width: 40mm" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
        <img style="width: 50mm" src="data:image/png;base64,${png.toString('base64')}#threshold">
        <img style="width: 25mm" src="qrcode:ORDER-42">
    `)
}
```

- SVG 按打印机的分辨率绘制为黑白图像，条码最清晰。请用 `<img>` 放入并为 `<img>` 设置尺寸，因为直接内联的 `<svg>` 会保持其自身声明的宽高，在浏览器中也是如此。
- 位图（PNG、JPEG……）默认做抖动处理，适合照片。条码的位图需要加上 `#threshold`，线条才能保持实心。
- `qrcode:` 由引擎直接绘制二维码，模块对齐到整点，无需图片。

### 打印机定义

| 字段 | 说明 |
|---|---|
| `connection` | 连接方式（见[连接方式](#连接方式)） |
| `model`、`paper`、`label`、`width`、`dpi`、`rotate`、`page` | 打印机的介质，写法与 `@lakutata/thermal` 的 `render()` 相同 |
| `commands` | 每页或每次打印之后打印机执行的操作：切纸、走纸、弹钱箱……（见[指令选项](#指令选项)） |
| `baseDir` | 打印机的 HTML 读取图片的目录 |
| `textLanguage` | 文字的语言，用于断行 |
| `connectTimeout` | 打开连接的最长时间（10 秒） |
| `stallTimeout` | 打印机不接收数据（缺纸、上盖打开、离线）达到多长时间即判定本次打印失败（10 秒；设为 0 则无限等待） |
| `bytesPerSecond` | 每秒最多发送的字节数，用于慢速连接；数据到达过快或过慢时，这类连接上的打印机会卡顿或印出白线 |

没有介质的打印机仍然可以打印原始指令和渲染结果。

### 指令选项

`commands` 的写法与 `@lakutata/thermal` 的 `encode()` 相同。一次打印可以单独修改这些选项（`print(html, {commands: {cut: false}})`）。

| 选项 | 含义 |
|---|---|
| `language` | 定义里没有 `model` 时的指令语言：`'escpos'`（小票机）、`'tspl'` 或 `'zpl'`（标签机） |
| `cut` | 每页之后切纸（打印机需配备切刀）：`'partial'` 为半切，小票仍有一小部分相连；`'full'`（或 `true`）为全切。`false` 关闭标签打印机的切刀。默认不切纸 |
| `feed` | ESC/POS：每页打印完毕后额外走纸的毫米数，例如设为 `15` 即多走 15 毫米，用于将小票送过撕纸口（各台打印机到撕纸口的距离不同，请按所用打印机设置）。默认 0，不走纸。该选项与 `cut` 互不影响，同时设置时先走纸，再切纸（切纸指令会自行将纸送到切刀） |
| `drawer` | ESC/POS：最后一页之后弹开钱箱：`true`（2 号引脚），第二个钱箱用 `{pin: 5}` |
| `copies` | TSPL 和 ZPL：每张标签的打印份数 |
| `sensor`、`gap` | TSPL 和 ZPL：打印机如何找到标签的起点（标签间的间隙、黑标或连续纸）以及间隙的大小 |
| `density`、`speed` | TSPL 和 ZPL：打印的浓度和速度 |
| `raster`、`bandHeight`、`initialize`、`compress`、`skipBlank` | 点阵的发送方式；除非打印机工作异常，保持默认即可（见 `@lakutata/thermal` 的 README） |

### 连接方式

| `type` | 选项 | 方式 |
|---|---|---|
| `'network'` | `host`、`port`（9100） | 连接原始打印端口的 TCP 连接，适用于 ESC/POS、TSPL、ZPL 打印机；每次打印连接一次 |
| `'queue'` | `name` | 系统打印队列，指令原样发送：macOS 和 Linux 上为 CUPS 的 `lp -d <name> -o raw`，Windows 上为后台打印服务（RAW 文档；第 4 版驱动使用 `XPS_PASS`） |
| `'usb'` | `path`，或 `vendorId`、`productId` 和 `serialNumber` | USB 打印机：Linux 上为设备文件 `/dev/usb/lpN`（用户需要位于 `lp` 组中），macOS 上按 ID 打开，Windows 上为其打印机接口路径（使用系统自带的驱动，无需另行安装驱动） |
| `'serial'` | `path`、`baudRate`（9600）、`flowControl`（`'rts/cts'`、`'dtr/dsr'`、`'xon/xoff'`） | 串口，由 `@lakutata/serial` 提供 |
| `'bluetooth'` | `address`、`channel`（1，仅 Linux） | 经典蓝牙打印机（串口协议 SPP），需要先与系统配对，由 `@lakutata/serial` 提供 |

- USB、串口和蓝牙打印机在对象存在期间始终保持连接，在第一次打印时打开，出错后重新打开。网络打印机和打印队列在每次打印时连接一次，因为 9100 端口的打印机往往一次只接受一个客户端，打印队列的每个任务对应一个文档。
- `/dev/usb/lp0` 是 USB 打印机，不是串口，因此应配置为 `'usb'` 连接，而不是 `'serial'`。
- 在 macOS 上，某个 CUPS 队列正在使用某台 USB 打印机打印时，该打印机处于占用状态，此时打开会以 `'EBUSY'` 失败。

### 关闭

- `manager.close(printer)` 关闭一台打印机，先发完其队列中的打印（最多等待 `drainTimeout`，10 秒），再关闭连接。配置中的打印机下次使用时会重新打开。
- 应用停止（容器销毁）时，管理器关闭所有打印机。
- 进程结束时，仍打开的设备文件、套接字和句柄由系统关闭。进程被强制终止时，对于正在进行的打印，打印机只会收到前面一部分数据。

## API

| 导出 | 说明 |
|---|---|
| `ThermalPrinterManager` | 管理器：`discover()`、`open()`、`get()`、`names()`、`openPrinters()`、`close()`、`print()`、`preview()` |
| `buildThermalPrinterManagerOptions`、`ThermalPrinterManagerConfig` | 管理器在配置中的选项（`printers`、`drainTimeout`） |
| `ThermalPrinter` | 打开的打印机：`print()`、`preview()`、`commandsOf()`、`definition` |
| `validatePrinterDefinition` | 检查从文件读出的定义 |
| `PrinterDefinition`、`PrinterConnection`、`NetworkConnection`、`QueueConnection`、`UsbConnection`、`SerialConnection`、`BluetoothConnection` | 打印机及其连接方式 |
| `PrinterCandidate`、`DiscoverOptions` | `discover()` 找到的设备 |
| `PrintOptions`、`PrintResult` | 一次打印的选项和结果 |
| `ThermalPrinterException`、`ThermalPrinterConnectionException`、`ThermalPrinterOptionException` | 本包的异常（见[错误](#错误)） |

## 错误

| 错误 | 抛出时机 |
|---|---|
| `ThermalPrinterConnectionException` | 无法连接打印机或指令无法发出：连接被拒绝或超时、设备未连接或被占用、打印队列出错、打印机在停滞超时时间内始终不接收数据 |
| `ThermalPrinterOptionException` | 定义不合法：缺少连接方式或连接方式有误、选项类型有误 |
| `ThermalPrinterException` | 不存在该名称的打印机、连接方式所需的包未安装、打印机或管理器已关闭 |
| `@lakutata/thermal` 的异常 | 引擎不接受该介质（`ThermalOptionException`），或渲染、编码失败 |

## 另见

- [`@lakutata/thermal`](../thermal)：HTML 的渲染和打印机的指令。
- [`@lakutata/serial`](../serial)：串口和蓝牙设备。
