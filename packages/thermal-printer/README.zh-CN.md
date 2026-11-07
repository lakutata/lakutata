# @lakutata/thermal-printer

[English](README.md) | 中文

[lakutata](https://github.com/lakutata/lakutata) 框架的热敏打印机组件：用 [`@lakutata/thermal`](../thermal) 渲染用 HTML 编排的小票、标签和腕带，编码成每台打印机的指令（ESC/POS、TSPL 或 ZPL），再经网口、系统打印队列、串口、USB 或蓝牙发给打印机。每台打印机有一个任务队列：它的打印任务按调用的顺序一个接一个发出。`lakutata` 包不重新导出这个包，请从 `@lakutata/thermal-printer` 导入。

## 安装

```shell
npm install @lakutata/thermal-printer
```

- 它会安装 `@lakutata/thermal`，后者的原生插件在安装时编译（机器上需要什么见它的 README）。
- Node.js `>=18.10.0`，以及 `@lakutata/core`。
- 串口、USB 和蓝牙连接各在自己的包里，用到时再安装：`@lakutata/serial`、`@lakutata/usb`、`@lakutata/bluetooth`。没有安装对应的包时，发给这类打印机的打印会失败，错误信息里写明需要哪个包。

## 用法

### 在配置里声明打印机

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildThermalPrinterOptions, type ThermalPrinter} from '@lakutata/thermal-printer'

class Counter extends Component {
    @Inject('printers')
    protected readonly printers: ThermalPrinter

    public async receipt(order: {id: string, total: string}): Promise<void> {
        await this.printers.print('front', `<h1>Order ${order.id}</h1><p>Total ${order.total}</p>`)
    }
}

Application.run(() => ({
    id: 'shop',
    name: 'Shop',
    components: {
        printers: buildThermalPrinterOptions({
            printers: {
                front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}},
                kitchen: {connection: {type: 'network', host: '192.168.1.51'}, paper: 80, commands: {language: 'escpos', cut: 'full'}},
                labels: {connection: {type: 'queue', name: 'TSC_TDP_225'}, model: 'TDP-225', label: {width: 40, height: 30}},
                ward: {connection: {type: 'usb', path: '/dev/usb/lp0'}, model: 'HC100', label: {width: 25, height: 250}, commands: {sensor: 'mark'}}
            }
        }),
        counter: {class: Counter}
    }
}))
```

一台打印机由这些部分组成：它的 `connection`；它的介质，写法和 `@lakutata/thermal` 的 `render()` 一样（`model`、`paper`、`label`、`width`、`dpi`、`rotate`、`page`）；它的 `commands` 选项，写法和 `encode()` 一样（没有型号时的 `language`、`feed`、`cut`、`drawer`、`sensor`、`density`、`copies`……）。`baseDir` 是它的 HTML 读取图片的目录，`textLanguage` 是它的文字的语言。

### 打印

```typescript
import type {ThermalPrinter} from '@lakutata/thermal-printer'
import {render} from '@lakutata/thermal'

async function print(printers: ThermalPrinter): Promise<void> {
    //HTML：按打印机的介质渲染，编码成它的指令
    await printers.print('front', '<h1>Order 42</h1>', {commands: {drawer: true}})
    //渲染结果：为这台打印机编码
    await printers.print('kitchen', await render('<h2>Table 7</h2>', {paper: 80}))
    //原始指令：原样发送
    await printers.print('front', Buffer.from([0x1B, 0x40, 0x0A]))
    //调用时直接给出打印机
    await printers.print({connection: {type: 'network', host: '192.168.1.60'}, paper: 58, commands: {language: 'escpos'}}, '<p>Hello</p>')
}
```

- `print()` 在指令发送完后完成（指令交给了连接，打印机可能还在打印），结果是打印的页数和发送的字节数。每次打印打开连接、发送指令、关闭连接。
- 一次打印的 `commands` 选项覆盖打印机自己的（`{commands: {cut: false}}`），它的 `signal` 可以在它排队等候时取消它。
- `preview(printer, html)` 只渲染不打印：得到的点阵和打印机印出来的一样，用 `toPNG()` 得到图片。`commands(printer, content)` 给出指令但不发送。

### 连接方式

| `type` | 选项 | 方式 |
|---|---|---|
| `'network'` | `host`、`port`（9100） | 连接原始打印端口的 TCP 连接，ESC/POS、TSPL、ZPL 打印机都一样 |
| `'queue'` | `name` | 系统打印队列，指令原样发送：macOS 和 Linux 上是 CUPS 的 `lp -d <name> -o raw`。暂不支持 Windows |
| `'serial'` | `path`、`baudRate`（9600）、`flowControl` | 串口，由 `@lakutata/serial` 提供 |
| `'usb'` | `vendorId`、`productId`、`serialNumber`，或 `path` | USB 打印机，由 `@lakutata/usb` 提供 |
| `'bluetooth'` | `address`、`channel`（1） | 经典蓝牙打印机（串口协议 SPP），需要先由系统配对，由 `@lakutata/bluetooth` 提供 |

- `connectTimeout`（10 秒）限制打开连接的时间。
- `bytesPerSecond` 为慢速连接限速：蓝牙或低速串口上的打印机，数据来得比它打印得快或慢时，会卡顿或印出白线。

## API

| 导出 | 说明 |
|---|---|
| `ThermalPrinter` | 组件：`print()`、`preview()`、`commands()`、`printerNames()` |
| `buildThermalPrinterOptions`、`ThermalPrinterConfig` | 组件在配置里的选项（`printers`、`drainTimeout`） |
| `PrinterDefinition`、`PrinterConnection`、`NetworkConnection`、`QueueConnection`、`SerialConnection`、`UsbConnection`、`BluetoothConnection` | 打印机和它的连接方式 |
| `PrintOptions`、`PrintResult` | 一次打印的选项和结果 |
| `ThermalPrinterException`、`ThermalPrinterConnectionException` | 这个包的异常（见[错误](#错误)） |

## 错误

| 错误 | 什么时候 |
|---|---|
| `ThermalPrinterConnectionException` | 连不上打印机或指令发不出去：连接被拒绝或超时、打印队列出错、设备打不开 |
| `ThermalPrinterException` | 没有这个名字的打印机、连接方式所需的包没有安装、当前平台不提供这种连接方式、组件已经销毁 |
| `@lakutata/thermal` 的异常 | 渲染或编码失败（`ThermalOptionException`、`ThermalContentException`……） |

## 另见

- [`@lakutata/thermal`](../thermal)：HTML 的渲染和打印机的指令。
- `@lakutata/serial`、`@lakutata/usb`、`@lakutata/bluetooth`：设备的连接。
