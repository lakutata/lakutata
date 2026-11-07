# @lakutata/serial

[English](README.md) | 中文

Node.js 的串口库，属于 [lakutata](https://github.com/lakutata/lakutata) 框架：把串口作为流打开，设置线路参数（波特率、数据位、校验位、停止位、流控），读写调制解调器信号线，列出系统里的串口和 USB 转接器的 ID。经典蓝牙设备（串口协议 SPP）可以按地址打开，得到同样的流。和系统打交道的部分由一个小型原生插件完成：Linux 和 macOS 上用 termios，Windows 上用通信 API。`lakutata` 包不重新导出这个包，请从 `@lakutata/serial` 导入。

## 安装

```shell
npm install @lakutata/serial
```

- 原生插件在安装时编译（node-gyp）：机器上需要 Python 3 和 C++ 编译器（macOS 上是 Xcode 命令行工具，Linux 上是 `build-essential`，Windows 上是 Visual Studio 的 C++ 生成工具）。
- npm 会运行包的安装脚本；Bun 和 pnpm 只为信任的依赖运行（Bun 写在 `package.json` 的 `trustedDependencies` 里，pnpm 用 `pnpm approve-builds`）。
- Node.js `>=18.10.0` 或 Bun，以及 `@lakutata/core`（这个包的异常继承它的 `Exception`）。

## 用法

```typescript
import {listSerialPorts, openSerialPort} from '@lakutata/serial'

for (const info of await listSerialPorts()) console.log(info.path, info.vendorId, info.product)

const port = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200})
port.on('error', (error: Error) => console.error(error))
port.on('data', (data: Buffer) => console.log('received', data))
port.write('AT\r\n')
await port.drain()
await port.close()
```

- `openSerialPort(options)` 打开串口，结果是一个 `SerialPort`，它是 `Duplex` 流：写入的数据从线路发出，线路收到的数据可以读出。路径：Linux 上是 `/dev/ttyUSB0` 或 `/dev/ttyACM0`，macOS 上是 `/dev/cu.*`（呼出设备，不等待载波），Windows 上是 `COM3`。
- 串口默认独占打开：打开期间其他程序打不开它。在 Linux 和 macOS 上，`exclusive: false` 允许其他程序打开；Windows 总是独占打开串口。
- `drain()` 在已写入的数据从线路发出后完成；`end()` 会等这些数据发完再触发 `'finish'`。
- `close()` 在数据发完后关闭串口；`destroy()` 立即关闭，丢弃还没发出的数据。
- `update(options)` 在之前的写入发完后修改线路参数；`getSignals()` 读取 CTS、DSR、DCD 和 RI；`setSignals()` 设置 DTR 和 RTS，或在之前的写入发完后发送中断信号（break）；`flush()` 丢弃两个方向上等待中的数据。
- **一定要监听 `'error'`。** 设备不在了（拔掉了转接器、蓝牙断开）时，即使当时没有在读写，流也会以 `SerialException` 失败，它的 `disconnected` 是 `true`。没有 `'error'` 监听器的话，Node.js 会结束进程。
- 设置完线路参数后会读回核对：驱动没有接受某项设置（某种校验方式、某个它跑不了的波特率）时，打开或修改会以 `'EINVAL'` 失败，而不是带着别的设置继续运行。

### 选项

| 选项 | 默认值 | 取值 |
|---|---|---|
| `path` | | 串口的路径 |
| `baudRate` | `9600` | 每秒的位数：标准波特率到处可用，其他波特率要系统和转接器支持 |
| `dataBits` | `8` | `5`、`6`、`7`、`8` |
| `stopBits` | `1` | `1`、`1.5`（仅 Windows，且只能配 5 个数据位）、`2` |
| `parity` | `'none'` | `'none'`、`'even'`、`'odd'`，以及 `'mark'` 和 `'space'`（Linux 和 Windows） |
| `flowControl` | `'none'` | `'none'`、`'rts/cts'` 和 `'dtr/dsr'`（硬件流控；Linux 没有 DTR/DSR 流控）、`'xon/xoff'`（软件流控） |
| `stallTimeout` | `0` | 输出停止多久后，写入和等待发送（drain）以 `'ETIMEDOUT'` 失败，单位毫秒（0 表示不限） |
| `exclusive` | `true` | 不让其他程序打开这个串口 |
| `openTimeout` | `30000` | 打开最多可以花多长时间，单位毫秒 |

用 `'xon/xoff'` 时，收到字节 0x13 会让输出停下：会发送二进制数据的设备（比如回报状态的打印机）需要硬件流控。打印机设成 DTR/DSR、而线缆把打印机的 DTR 接到电脑的 CTS 时，用 `'rts/cts'` 也可以。

### 输出停下来的时候

设备可能不再接收数据：它把 CTS 拉低了，或者是缺纸的打印机。所有的等待都有上限：

- 设了 `stallTimeout` 时，输出停止达到这个时长后，写入或等待发送（drain）以 `'ETIMEDOUT'` 失败，数据仍留在队列里。
- `close()` 在输出还在动时一直等待；输出停止达到 `stallTimeout`（`close({stallTimeout})`，默认 10 秒）后，丢弃剩下的数据，关闭串口，并以 `'ETIMEDOUT'` 拒绝。
- 中断信号（break）要先等输出发完；流控把输出卡住超过 2 秒时，它以 `'ETIMEDOUT'` 失败。

最后一个字节交给系统之后，`drain()` 和 `close()` 还要等系统报告不了的那部分字节：在驱动和转接器芯片里的数据。等待的时长是这些字节按线路速度发完所需的时间，macOS 上最多按 4 KB 算（9600 波特率下约 4 秒，115200 下约 0.4 秒），Linux 和 Windows 上最多按 1 KB 算。

### 蓝牙

```typescript
import {openBluetoothSerial} from '@lakutata/serial'

const printer = await openBluetoothSerial({address: '00:11:22:33:44:55'})
printer.on('error', (error: Error) => console.error(error))
printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
await printer.close()
```

`openBluetoothSerial()` 通过串口协议（SPP）打开经典蓝牙设备，得到和串口一样的流。设备要先和系统配对。不支持低功耗蓝牙（BLE）设备。

- Linux：通过 RFCOMM 套接字连接设备，使用给定的 `channel`（默认 1）。
- macOS 和 Windows：系统会为配对的设备生成一个串口，这个函数打开地址匹配的那个；Windows 上是“传出”的那个串口。
- 线路参数和调制解调器信号线对蓝牙连接不起作用：蓝牙连接有它自己的速度。

### 列出串口

`listSerialPorts()` 给出每个串口的 `path`；USB 转接器还有它的 `vendorId`、`productId`、`serialNumber`、`manufacturer` 和 `product`；macOS 和 Windows 上已配对的蓝牙设备的串口还有它的 `bluetoothAddress`，设备名放在 `product` 里。在 Linux 上，`stablePath` 是它在 `/dev/serial/by-id` 里的链接，转接器换个 USB 口插也不会变。串口的来源：Linux 上是 sysfs，macOS 上是 IOKit（`/dev/cu.*` 设备），Windows 上是设备管理器。

### 工作方式

每个打开的串口都有自己的线程，负责它的读、写和设置：打开的串口不占用 Node.js 线程池里的线程，所以不会拖慢文件、DNS 或加密操作。没有读写时线程也在监视设备，所以转接器一拔掉，Linux 和 macOS 上会立即报告，Windows 上在一秒内报告。插件只用 Node-API（不调用 libuv），所以能在 Bun 和 worker 线程里运行。

打开的串口会让进程保持运行，就像打开的套接字一样：用完请关闭它。worker 或进程结束时还开着的串口会被关闭，还没发出的数据会被丢弃。

## API

| 导出 | 说明 |
|---|---|
| `openSerialPort(options)` | 打开串口，得到 `SerialPort` |
| `openBluetoothSerial(options)` | 按地址打开已配对的蓝牙设备，得到 `SerialPort` |
| `SerialPort` | 打开的串口，是 `Duplex` 流：`path`、`baudRate`、`settings`、`update()`、`getSignals()`、`setSignals()`、`drain()`、`flush()`、`close()` |
| `listSerialPorts()` | 系统里的串口，以及它们的 USB 设备的 ID |
| `SerialPortOptions`、`BluetoothSerialOptions`、`SerialLineOptions`、`SerialDrainOptions`、`SerialCloseOptions`、`SerialPortInfo`、`SerialSignals`、`SerialSignalOptions` | 相关的类型 |
| `SerialException` | 这个包的异常（见[错误](#错误)） |

## 错误

所有失败都抛出 `SerialException`（`errno` 是 `'E_SERIAL'`）。它的 `code` 是系统的错误名，设备不在了时 `disconnected` 是 `true`：

| `code` | 什么时候 |
|---|---|
| `'ENOENT'` | 没有这个串口 |
| `'EBUSY'` | 串口已被其他程序打开，或已在别处被独占打开 |
| `'EACCES'` | 用户无权打开它（Linux 上是不在它所属的组里） |
| `'ENOTTY'` | 这个路径不是串口（`/dev/usb/lp0` 是 USB 打印机，不是串口） |
| `'EINVAL'` | 它不接受的选项，或设备没有接受的设置 |
| `'ETIMEDOUT'` | 输出停止太久，或打开花的时间太长 |
| `'EHOSTDOWN'`、`'ECONNREFUSED'` | 蓝牙设备没有响应，或拒绝连接（Linux） |
| `'EAFNOSUPPORT'`、`'ENOTSUP'` | 系统不提供蓝牙套接字（比如容器里），或这个平台根本不支持蓝牙 |
| `'EIO'` | 打开期间设备不在了（`disconnected` 是 `true`） |
| `'ECANCELED'` | 向已经关闭的串口发出的请求 |

## 常见问题

- **Linux 上权限不足（`'EACCES'`）：** 把用户加到串口所属的组里（Debian 和 Ubuntu 上是 `dialout`，Arch 上是 `uucp`），然后重新登录。
- **Ubuntu 22.04、Linux Mint 21 上插了 CH340 转接器却没有 `/dev/ttyUSB0`：** 是 `brltty` 软件包占用了它。卸载这个软件包，或禁用它的 udev 规则。
- **Linux 上新插的串口有几秒钟打不开：** ModemManager 在用 AT 命令探测新串口。让它忽略这个设备（在 udev 规则里设 `ID_MM_DEVICE_IGNORE`），或停掉它。
- **一打开串口开发板就复位（Arduino、ESP32）：** Linux 和 macOS 在打开串口时会拉高 DTR 和 RTS，用户代码无法避免这个脉冲。
- **树莓派：** 用 `/dev/serial0`，`/dev/ttyAMA0` 可能被蓝牙芯片占用。
- **Linux 上关闭要等最多 30 秒：** 转接器里有因流控发不出去的数据时，内核会在关闭串口时等它（`closing_wait`，默认 30 秒）。事件循环不会被阻塞，但 `close()` 的 Promise 要等内核放开串口才会完成。丢弃数据也不能缩短这个等待，因为转接器芯片里的字节是够不着的。
- **Windows 上刚关闭就重新打开报 `'EBUSY'`：** 有些驱动在串口关闭后要稍等一会儿才释放它，隔一小会儿再打开即可。
- **macOS：** 用 `/dev/cu.*` 设备，`/dev/tty.*` 是给接入连接用的。

## 另见

- [`@lakutata/thermal-printer`](../thermal-printer)：热敏打印机，串口是它的连接方式之一。
