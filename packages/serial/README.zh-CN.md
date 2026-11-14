# @lakutata/serial

[English](README.md) | 中文

Node.js 的串口库，属于 [Lakutata](https://github.com/lakutata/lakutata) 框架，可以将串口作为流打开，设置线路参数（波特率、数据位、校验位、停止位、流控），读写调制解调器信号线，列出系统中的串口和 USB 转接器的 ID。经典蓝牙设备（串口协议 SPP）可以按地址打开，得到同样的流。与系统交互的部分由一个小型原生插件完成，在 Linux 和 macOS 上使用 termios，在 Windows 上使用通信 API。`lakutata` 包不会重新导出本包，请从 `@lakutata/serial` 导入。

## 安装

```shell
npm install @lakutata/serial
```

- 原生插件在安装时编译（node-gyp），因此机器上需要安装 Python 3 和 C++ 编译器（macOS 上为 Xcode 命令行工具，Linux 上为 `build-essential`，Windows 上为 Visual Studio 的 C++ 生成工具）。
- npm 会运行包的安装脚本；Bun 和 pnpm 只为明确信任的依赖运行安装脚本（Bun 在 `package.json` 的 `trustedDependencies` 中设置，pnpm 使用 `pnpm approve-builds`）。
- Node.js `>=18.10.0` 或 Bun，以及 `@lakutata/core`（本包的异常继承自其中的 `Exception`）。

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

- `openSerialPort(options)` 打开串口，结果是一个 `SerialPort`，即一个 `Duplex` 流：写入的数据从线路发出，线路收到的数据可以读出。路径在 Linux 上为 `/dev/ttyUSB0` 或 `/dev/ttyACM0`，在 macOS 上为 `/dev/cu.*`（呼出设备，不等待载波），在 Windows 上为 `COM3`。
- 串口默认以独占方式打开，打开期间其他程序无法打开该串口。在 Linux 和 macOS 上，`exclusive: false` 允许其他程序打开；Windows 始终以独占方式打开串口。
- `drain()` 在已写入的数据从线路发出后完成；`end()` 会等待这些数据发送完毕后再触发 `'finish'`。
- `close()` 在数据发送完毕后关闭串口；`destroy()` 立即关闭，丢弃尚未发出的数据。
- `update(options)` 在之前的写入发送完毕后修改线路参数；`getSignals()` 读取 CTS、DSR、DCD 和 RI；`setSignals()` 设置 DTR 和 RTS，或在之前的写入发送完毕后发送中断信号（break）；`flush()` 丢弃两个方向上等待中的数据。
- **务必监听 `'error'`。** 设备不再存在时（转接器被拔出、蓝牙断开），即使当时没有读写操作，流也会以 `SerialException` 失败，其 `disconnected` 为 `true`。没有 `'error'` 监听器时，Node.js 会结束进程。
- 设置线路参数后会读回核对。驱动未接受某项设置（某种校验方式、某个驱动无法支持的波特率）时，打开或修改会以 `'EINVAL'` 失败，而不是以其他设置继续运行。

### 选项

| 选项 | 默认值 | 取值 |
|---|---|---|
| `path` | | 串口的路径 |
| `baudRate` | `9600` | 每秒的位数；标准波特率在各处均可用，其他波特率需要系统和转接器支持 |
| `dataBits` | `8` | `5`、`6`、`7`、`8` |
| `stopBits` | `1` | `1`、`1.5`（仅 Windows，且只能搭配 5 个数据位）、`2` |
| `parity` | `'none'` | `'none'`、`'even'`、`'odd'`，以及 `'mark'` 和 `'space'`（Linux 和 Windows） |
| `flowControl` | `'none'` | `'none'`、`'rts/cts'` 和 `'dtr/dsr'`（硬件流控；Linux 没有 DTR/DSR 流控）、`'xon/xoff'`（软件流控） |
| `stallTimeout` | `0` | 输出停止多长时间后，写入和等待发送（drain）以 `'ETIMEDOUT'` 失败，单位为毫秒（0 表示不限） |
| `exclusive` | `true` | 禁止其他程序打开该串口 |
| `openTimeout` | `30000` | 打开串口的最长时间，单位为毫秒 |

使用 `'xon/xoff'` 时，收到字节 0x13 会使输出停止，因此会发送二进制数据的设备（例如回报状态的打印机）需要硬件流控。打印机设置为 DTR/DSR、且线缆将打印机的 DTR 接到电脑的 CTS 时，也可以使用 `'rts/cts'`。

### 输出停下来的时候

设备可能不再接收数据，例如设备拉低了 CTS，或者是缺纸的打印机。所有的等待都有上限：

- 设置了 `stallTimeout` 时，输出停止达到该时长后，写入或等待发送（drain）以 `'ETIMEDOUT'` 失败，数据仍留在队列中。
- `close()` 在输出仍在进行时持续等待；输出停止达到 `stallTimeout`（`close({stallTimeout})`，默认 10 秒）后，丢弃剩余的数据，关闭串口，并以 `'ETIMEDOUT'` 拒绝。
- 中断信号（break）需要先等待输出发送完毕；流控使输出停滞超过 2 秒时，中断信号以 `'ETIMEDOUT'` 失败。

最后一个字节交给系统之后，`drain()` 和 `close()` 还要等待系统无法报告的那部分字节，即位于驱动和转接器芯片中的数据。等待时长为这些字节按线路速度发送完毕所需的时间，在 macOS 上最多按 4 KB 计算（9600 波特率下约 4 秒，115200 下约 0.4 秒），在 Linux 和 Windows 上最多按 1 KB 计算。

### 蓝牙

```typescript
import {openBluetoothSerial} from '@lakutata/serial'

const printer = await openBluetoothSerial({address: '00:11:22:33:44:55'})
printer.on('error', (error: Error) => console.error(error))
printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
await printer.close()
```

`openBluetoothSerial()` 通过串口协议（SPP）打开经典蓝牙设备，得到与串口相同的流。设备需要先与系统配对。不支持低功耗蓝牙（BLE）设备。

- Linux：通过 RFCOMM 套接字连接设备，使用给定的 `channel`（默认 1）。
- macOS 和 Windows：系统会为配对的设备生成串口，该函数打开地址匹配的串口；在 Windows 上为“传出”串口。
- 线路参数和调制解调器信号线对蓝牙连接不起作用，因为蓝牙连接有其自身的速度。

### 列出串口

`listSerialPorts()` 给出每个串口的 `path`；USB 转接器还有其 `vendorId`、`productId`、`serialNumber`、`manufacturer` 和 `product`；macOS 和 Windows 上已配对的蓝牙设备的串口还有其 `bluetoothAddress`，设备名称放在 `product` 中。在 Linux 上，`stablePath` 是串口在 `/dev/serial/by-id` 中的链接，转接器换插到其他 USB 口也不会改变。串口信息的来源在 Linux 上为 sysfs，在 macOS 上为 IOKit（`/dev/cu.*` 设备），在 Windows 上为设备管理器。

### 工作方式

每个打开的串口都有独立的线程，负责该串口的读、写和设置。打开的串口不占用 Node.js 线程池中的线程，因此不会拖慢文件、DNS 或加密操作。没有读写时，线程同样监视着设备，转接器一经拔出，Linux 和 macOS 上会立即报告，Windows 上在一秒内报告。插件只使用 Node-API（不调用 libuv），因此能在 Bun 和 worker 线程中运行。

打开的串口会使进程保持运行，与打开的套接字相同，因此使用完毕后请关闭串口。worker 或进程结束时仍打开的串口会被关闭，尚未发出的数据会被丢弃。

## API

| 导出 | 说明 |
|---|---|
| `openSerialPort(options)` | 打开串口，得到 `SerialPort` |
| `openBluetoothSerial(options)` | 按地址打开已配对的蓝牙设备，得到 `SerialPort` |
| `SerialPort` | 打开的串口，是 `Duplex` 流：`path`、`baudRate`、`settings`、`update()`、`getSignals()`、`setSignals()`、`drain()`、`flush()`、`close()` |
| `listSerialPorts()` | 系统中的串口，及其 USB 设备的 ID |
| `SerialPortOptions`、`BluetoothSerialOptions`、`SerialLineOptions`、`SerialDrainOptions`、`SerialCloseOptions`、`SerialPortInfo`、`SerialSignals`、`SerialSignalOptions` | 相关的类型 |
| `SerialException` | 本包的异常（见[错误](#错误)） |

## 错误

所有失败都抛出 `SerialException`（`errno` 为 `'E_SERIAL'`）。其 `code` 为系统的错误名，设备不再存在时 `disconnected` 为 `true`：

| `code` | 出现时机 |
|---|---|
| `'ENOENT'` | 该串口不存在 |
| `'EBUSY'` | 串口已被其他程序打开，或已在别处被独占打开 |
| `'EACCES'` | 用户无权打开该串口（在 Linux 上，即用户不在该串口所属的组中） |
| `'ENOTTY'` | 该路径不是串口（`/dev/usb/lp0` 是 USB 打印机，不是串口） |
| `'EINVAL'` | 它不接受的选项，或设备未接受的设置 |
| `'ETIMEDOUT'` | 输出停止时间过长，或打开耗时过长 |
| `'EHOSTDOWN'`、`'ECONNREFUSED'` | 蓝牙设备未响应，或拒绝连接（Linux） |
| `'EAFNOSUPPORT'`、`'ENOTSUP'` | 系统不提供蓝牙套接字（例如在容器中），或该平台根本不支持蓝牙 |
| `'EIO'` | 打开期间设备不再存在（`disconnected` 为 `true`） |
| `'ECANCELED'` | 向已关闭的串口发出的请求 |

## 常见问题

- **Linux 上权限不足（`'EACCES'`）：** 将用户添加到串口所属的组中（Debian 和 Ubuntu 上为 `dialout`，Arch 上为 `uucp`），然后重新登录。
- **Ubuntu 22.04、Linux Mint 21 上插入 CH340 转接器后没有 `/dev/ttyUSB0`：** `brltty` 软件包占用了该设备。请卸载该软件包，或禁用其 udev 规则。
- **Linux 上新插入的串口在几秒内无法打开：** ModemManager 正在用 AT 命令探测新串口。请让 ModemManager 忽略该设备（在 udev 规则中设置 `ID_MM_DEVICE_IGNORE`），或停止 ModemManager。
- **打开串口时开发板随即复位（Arduino、ESP32）：** Linux 和 macOS 在打开串口时会拉高 DTR 和 RTS，用户代码无法避免这一脉冲。
- **树莓派：** 请使用 `/dev/serial0`，因为 `/dev/ttyAMA0` 可能被蓝牙芯片占用。
- **Linux 上关闭串口最多需要等待 30 秒：** 转接器中有因流控无法发出的数据时，内核会在关闭串口时等待这些数据（`closing_wait`，默认 30 秒）。事件循环不会被阻塞，但 `close()` 的 Promise 要等内核释放串口后才会完成。丢弃数据也无法缩短这一等待，因为转接器芯片中的字节无法触及。
- **Windows 上关闭后立即重新打开时报 `'EBUSY'`：** 某些驱动在串口关闭后需要稍等片刻才会释放串口，稍后再打开即可。
- **macOS：** 请使用 `/dev/cu.*` 设备，`/dev/tty.*` 用于接入连接。

## 另见

- [`@lakutata/thermal-printer`](../thermal-printer)：热敏打印机，串口是其连接方式之一。
