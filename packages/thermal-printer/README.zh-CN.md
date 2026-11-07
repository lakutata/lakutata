# @lakutata/thermal-printer

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的热敏打印机包。管理器组件负责找到打印机（USB 打印机、系统打印队列、串口和蓝牙口），并按应用落盘的 JSON 定义打开它们。打开后的每台打印机都是一个对象：它用 [`@lakutata/thermal`](../thermal) 渲染用 HTML 编排的小票、标签和腕带，编码成这台打印机的指令（ESC/POS、TSPL 或 ZPL），按调用的顺序发出去。`lakutata` 包不重新导出这个包，请从 `@lakutata/thermal-printer` 导入。

## 安装

```shell
npm install @lakutata/thermal-printer
```

- 它会安装 `@lakutata/thermal`，后者的原生插件在安装时编译（机器上需要什么见它的 README）。
- 在 macOS 和 Windows 上，这个包还会编译一个自己的小插件，用于 USB 打印机和 Windows 的后台打印服务。Linux 上不需要：USB 打印机就是设备文件，打印队列用 CUPS 命令。
- 串口和蓝牙打印机需要 `@lakutata/serial`（`npm install @lakutata/serial`）。没有安装时，打开这类打印机会失败，错误信息里写明需要这个包。
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

配置里的打印机在第一次使用时才打开，应用启动时某台打印机不在也不会让应用启动失败。

### 找到打印机并保存

打印机一般是在程序运行时选择的，而不是写死在代码里：先找到打印机，打开用户选中的那台，再把它的定义存下来。

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

- `discover()` 列出候选设备，每项都带一个可以直接打开、也可以直接保存的 `connection`。USB 打印机还会给出它上报的 IEEE 1284 ID（`deviceId`）、这个 ID 对应的 `printerModels()` 里的型号（`model`），以及它上报的指令语言（`language`）。网络打印机没法这样找到，需要用户填写地址。
- `open(definition, name?)` 对每台设备只打开一次：同一台设备再次打开，返回的是同一个对象（定义仍是第一次的），这样一台打印机上不会有两个队列交错发送数据。
- `get(name)` 按名字取打印机，`names()` 列出名字，`openPrinters()` 列出已打开的打印机，`close(printer)` 关闭一台打印机。
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

- `print()` 在指令交给连接后完成（打印机可能还在打印），结果是打印的页数和发送的字节数。同一台打印机的打印按调用顺序一个接一个发出。
- 一次打印的 `commands` 选项覆盖打印机自己的；它的 `signal` 可以在它排队等候或渲染时取消它。
- 用定义调用 `manager.print()` 时会打开这台打印机（见 `open()`），打开后一直保持到被关闭：这样打印过一次的 USB、串口或蓝牙打印机会一直被应用占用，`close()` 之前其他程序打开它会得到 `'EBUSY'`。
- `preview(html)` 只渲染不打印；`commandsOf(content)` 给出指令但不发送。

### 图片和条码

HTML 里的图片可以是 `data:` 地址（PNG、JPEG、GIF、BMP、SVG）、内联的 `<svg>` 元素，以及 `baseDir` 下的文件。[`@lakutata/barcode`](../barcode) 生成的条码可以直接放进去，不需要存文件：

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

- SVG 按打印机的分辨率画成黑白，条码最清晰。用 `<img>` 放进去并给 `<img>` 设尺寸：直接内联的 `<svg>` 会保持它自己声明的宽高，浏览器里也是这样。
- 位图（PNG、JPEG……）默认做抖动，适合照片。条码的位图要加上 `#threshold`，线条才是实心的。
- `qrcode:` 由引擎直接画二维码，模块落在整点上，不需要图片。

### 打印机定义

| 字段 | 说明 |
|---|---|
| `connection` | 连接方式（见[连接方式](#连接方式)） |
| `model`、`paper`、`label`、`width`、`dpi`、`rotate`、`page` | 它的介质，写法和 `@lakutata/thermal` 的 `render()` 一样 |
| `commands` | 每页或每次打印之后让打印机做的事：切纸、走纸、弹钱箱……（见[指令选项](#指令选项)） |
| `baseDir` | 它的 HTML 读取图片的目录 |
| `textLanguage` | 文字的语言，用于断行 |
| `connectTimeout` | 打开连接最多可以花多长时间（10 秒） |
| `stallTimeout` | 打印机多久不接收数据（缺纸、上盖打开、离线）就判这次打印失败（10 秒；设为 0 则一直等） |
| `bytesPerSecond` | 每秒最多发送多少字节：用于慢速连接，数据来得太快或太慢时，这类连接上的打印机会卡顿或印出白线 |

没有介质的打印机仍然可以打印原始指令和渲染结果。

### 指令选项

`commands` 的写法和 `@lakutata/thermal` 的 `encode()` 一样。一次打印可以单独修改它们（`print(html, {commands: {cut: false}})`）。

| 选项 | 作用 |
|---|---|
| `language` | 定义里没有 `model` 时的指令语言：`'escpos'`（小票机）、`'tspl'` 或 `'zpl'`（标签机） |
| `cut` | 每页之后切纸（打印机要有切刀）：`'partial'` 半切，小票还连着一点；`'full'`（或 `true`）全切。`false` 关闭标签打印机的切刀。默认不切纸 |
| `feed` | ESC/POS：每页打印完后再走出多少毫米的纸：写 `15` 就多走 15 毫米，用来把小票送过撕纸口（每台打印机到撕纸口的距离不一样，按自己的打印机填）。默认 0，不走纸。它和 `cut` 互不影响：两个都写时先走纸，再切纸（切纸指令会自己把纸送到切刀） |
| `drawer` | ESC/POS：最后一页之后弹开钱箱：`true`（2 号引脚），第二个钱箱用 `{pin: 5}` |
| `copies` | TSPL 和 ZPL：每张标签打几份 |
| `sensor`、`gap` | TSPL 和 ZPL：打印机怎么找到标签的起点（标签间的间隙、黑标或连续纸）以及间隙的大小 |
| `density`、`speed` | TSPL 和 ZPL：打印的浓度和速度 |
| `raster`、`bandHeight`、`initialize`、`compress` | 点阵的发送方式：除非打印机工作不正常，保持默认即可（见 `@lakutata/thermal` 的 README） |

### 连接方式

| `type` | 选项 | 方式 |
|---|---|---|
| `'network'` | `host`、`port`（9100） | 连接原始打印端口的 TCP 连接，ESC/POS、TSPL、ZPL 打印机都一样；每次打印连接一次 |
| `'queue'` | `name` | 系统打印队列，指令原样发送：macOS 和 Linux 上是 CUPS 的 `lp -d <name> -o raw`，Windows 上是后台打印服务（RAW 文档；第 4 版驱动用 `XPS_PASS`） |
| `'usb'` | `path`，或 `vendorId`、`productId` 和 `serialNumber` | USB 打印机：Linux 上是设备文件 `/dev/usb/lpN`（用户需要在 `lp` 组里），macOS 上按 ID 打开，Windows 上是它的打印机接口路径（用系统自带的驱动，不需要另装驱动） |
| `'serial'` | `path`、`baudRate`（9600）、`flowControl`（`'rts/cts'`、`'dtr/dsr'`、`'xon/xoff'`） | 串口，由 `@lakutata/serial` 提供 |
| `'bluetooth'` | `address`、`channel`（1，仅 Linux） | 经典蓝牙打印机（串口协议 SPP），需要先和系统配对，由 `@lakutata/serial` 提供 |

- USB、串口和蓝牙打印机在对象存在期间一直保持连接：第一次打印时打开，出错后重新打开。网络打印机和打印队列每次打印连接一次，因为 9100 端口的打印机往往一次只接受一个客户端，打印队列每个任务对应一个文档。
- `/dev/usb/lp0` 是 USB 打印机，不是串口：要写成 `'usb'` 连接，而不是 `'serial'`。
- 在 macOS 上，某个 CUPS 队列正在用这台 USB 打印机打印时，它是被占用的，这时打开会以 `'EBUSY'` 失败。

### 关闭

- `manager.close(printer)` 关闭一台打印机：先把它队列里的打印发完（最多等 `drainTimeout`，10 秒），再关闭连接。配置里的打印机下次使用时会重新打开。
- 应用停止（容器销毁）时，管理器关闭所有打印机。
- 进程结束时，还开着的设备文件、套接字和句柄由系统关闭。进程被强杀时正在进行的打印，打印机只会收到前半段数据。

## API

| 导出 | 说明 |
|---|---|
| `ThermalPrinterManager` | 管理器：`discover()`、`open()`、`get()`、`names()`、`openPrinters()`、`close()`、`print()`、`preview()` |
| `buildThermalPrinterManagerOptions`、`ThermalPrinterManagerConfig` | 管理器在配置里的选项（`printers`、`drainTimeout`） |
| `ThermalPrinter` | 打开的打印机：`print()`、`preview()`、`commandsOf()`、`definition` |
| `validatePrinterDefinition` | 检查从文件读出的定义 |
| `PrinterDefinition`、`PrinterConnection`、`NetworkConnection`、`QueueConnection`、`UsbConnection`、`SerialConnection`、`BluetoothConnection` | 打印机和它的连接方式 |
| `PrinterCandidate`、`DiscoverOptions` | `discover()` 找到的设备 |
| `PrintOptions`、`PrintResult` | 一次打印的选项和结果 |
| `ThermalPrinterException`、`ThermalPrinterConnectionException`、`ThermalPrinterOptionException` | 这个包的异常（见[错误](#错误)） |

## 错误

| 错误 | 什么时候 |
|---|---|
| `ThermalPrinterConnectionException` | 连不上打印机或指令发不出去：连接被拒绝或超时、设备没接上或被占用、打印队列出错、打印机在停滞超时内一直不接收数据 |
| `ThermalPrinterOptionException` | 不是合法的定义：缺少连接方式或连接方式不对、选项类型不对 |
| `ThermalPrinterException` | 没有这个名字的打印机、连接方式所需的包没有安装、打印机或管理器已关闭 |
| `@lakutata/thermal` 的异常 | 引擎不接受这个介质（`ThermalOptionException`），或渲染、编码失败 |

## 另见

- [`@lakutata/thermal`](../thermal)：HTML 的渲染和打印机的指令。
- [`@lakutata/serial`](../serial)：串口和蓝牙设备。
