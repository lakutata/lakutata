# Lakutata Serial

`@lakutata/serial` 包用来和串口设备通信：秤、扫码枪、PLC、调制解调器、Arduino 和 ESP32 这类开发板、打印机。串口打开后是一个 Node.js 的流：写入的数据从线路发出，线路收到的数据可以读出。经典蓝牙设备可以按地址打开，得到同样的流。它不属于 `lakutata`，也不需要应用。它的特点是：

- **串口是 `Duplex` 流**：`write()`、`'data'`、`pipe()` 的用法和套接字一样；线路参数（波特率、数据位、校验位、停止位、流控）和调制解调器信号线（DTR、RTS、CTS、DSR、DCD、RI）都在这个流上设置和读取。
- **找到要用的串口**：列出系统里的串口，以及它们的 USB 转接器的厂商 ID 和产品 ID；在 Linux 上还有一个路径，转接器换个 USB 口插也不会变。
- **设备拔掉会报告**：即使当时没有读写也会报告，应用可以据此重新打开串口。
- **所有的等待都有上限**：设备不再接收数据时（比如打印机缺纸），写入会在超时后失败，而不是一直卡住。
- **原生插件**：在安装这个包时编译，支持 Linux、macOS 和 Windows；Linux 和 macOS 上用 termios，Windows 上用通信 API。每个打开的串口都有自己的线程，不会拖慢 Node.js 的文件、DNS 和加密操作。

`@lakutata/serial` 的 README 列出了所有选项和错误码；这篇指南按用途逐一说明这个包能做什么，每种用途都给出一个例子。

```bash
npm install @lakutata/serial
```

原生插件在安装这个包时编译，所以机器上要有 Python 3 和 C++ 编译器（macOS 上是 Xcode 命令行工具，Linux 上是 `build-essential`，Windows 上是 Visual Studio 的 C++ 生成工具）。包管理器必须运行这个包的安装脚本：npm 会运行它；Bun 和 pnpm 只为被告知可以信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 里设置，pnpm 用 `pnpm approve-builds`）。`@lakutata/core` 是 peer 依赖：这个包的异常继承它的 `Exception`。

## 1. 打开串口

```typescript
import {openSerialPort, type SerialPort} from '@lakutata/serial'

const port: SerialPort = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200})
port.on('error', (error: Error) => console.error(error))
port.on('data', (data: Buffer) => console.log('received', data))
port.write('AT\r\n')
await port.drain()
await port.close()
```

- 路径：Linux 上是 `/dev/ttyUSB0` 或 `/dev/ttyACM0`（树莓派上用 `/dev/serial0`），macOS 上是 `/dev/cu.*`（`/dev/tty.*` 设备是等待接入连接用的），Windows 上是 `COM3`。
- **一定要监听 `'error'`。** 设备不在了时，流会以 `SerialException` 失败，它的 `disconnected` 是 `true`；没有 `'error'` 监听器的话，Node.js 会结束进程。
- 串口默认独占打开：打开期间其他程序打不开它。在 Linux 和 macOS 上，`exclusive: false` 允许其他程序打开；Windows 总是独占打开串口。
- `drain()` 在已写入的数据从线路发出后完成。`close()` 在数据发完后关闭串口，`destroy()` 立即关闭，丢弃还没发出的数据。
- 打开的串口会让进程保持运行，就像打开的套接字一样：用完请关闭它。

## 2. 线路参数和信号线

线路参数照设备说明书设置：

```typescript
import {openSerialPort, type SerialPort, type SerialSignals} from '@lakutata/serial'

const port: SerialPort = await openSerialPort({
    path: 'COM3',
    baudRate: 9600,
    dataBits: 7,
    parity: 'even',
    stopBits: 1,
    flowControl: 'rts/cts'
})
port.on('error', (error: Error) => console.error(error))
await port.update({baudRate: 19200})
const signals: SerialSignals = await port.getSignals()
console.log(signals.cts, signals.dsr)
await port.setSignals({dtr: false})
await port.close()
```

- `baudRate` 的标准值到处可用，其他值要系统和转接器支持。`dataBits` 是 5 到 8；`stopBits` 是 1、1.5（仅 Windows，且只能配 5 个数据位）或 2；`parity` 是 `'none'`、`'even'`、`'odd'`，Linux 和 Windows 上还有 `'mark'` 和 `'space'`。
- `flowControl` 是 `'none'`、`'rts/cts'`、`'dtr/dsr'`（Linux 上没有）或 `'xon/xoff'`。用 `'xon/xoff'` 时，收到字节 0x13 会让输出停下，所以会发送二进制数据的设备需要硬件流控。
- 设置完线路参数后会读回核对：驱动没有接受某项设置时，打开或 `update()` 会以 `'EINVAL'` 失败，而不是带着别的设置继续运行。
- `update()` 在之前的写入发完后修改线路参数。`getSignals()` 读取 CTS、DSR、DCD 和 RI；`setSignals()` 设置 DTR 和 RTS，或在之前的写入发完后发送中断信号（break）。`flush()` 丢弃两个方向上等待中的数据。
- Linux 和 macOS 在打开串口时会拉高 DTR 和 RTS：遇到这个脉冲就复位的开发板（Arduino、ESP32），一打开串口就会复位，代码无法避免。

## 3. 找到要用的串口

设备换了个 USB 口插，或者开机时转接器被识别的顺序变了，它的串口路径都会变。可以改为按转接器的 ID 选择串口：

```typescript
import {listSerialPorts, openSerialPort, type SerialPort, type SerialPortInfo} from '@lakutata/serial'

const ports: SerialPortInfo[] = await listSerialPorts()
const scale: SerialPortInfo | undefined = ports.find((info: SerialPortInfo): boolean => info.vendorId === 0x1a86 && info.productId === 0x7523)
if (!scale) throw new Error('the scale is not plugged in')
const port: SerialPort = await openSerialPort({path: scale.stablePath ?? scale.path, baudRate: 9600})
port.on('error', (error: Error) => console.error(error))
```

- 每个串口都有 `path`。USB 转接器还有 `vendorId` 和 `productId`（数字）、`serialNumber`、`manufacturer` 和 `product`；同一型号的转接器，有序列号的话靠 `serialNumber` 区分。
- 在 Linux 上，`stablePath` 是串口在 `/dev/serial/by-id` 里的链接，转接器换个口插也不会变。
- 在 macOS 和 Windows 上，已配对蓝牙设备的串口有它的 `bluetoothAddress`，设备名放在 `product` 里。

## 4. 设备不再接收数据的时候

设备可能不再接收数据：它把 CTS 拉低了，或者是缺纸的打印机。所有的等待都有上限：

- 选项里设了 `stallTimeout`（毫秒）时，输出停止达到这个时长后，写入或等待发送（drain）以 `'ETIMEDOUT'` 失败，数据仍留在队列里。
- `close()` 在输出还在动时一直等待；输出停止达到 `close({stallTimeout})`（默认 10 秒）后，丢弃剩下的数据，关闭串口，并以 `'ETIMEDOUT'` 拒绝。
- 中断信号（break）要先等输出发完；流控把输出卡住超过 2 秒时，它以 `'ETIMEDOUT'` 失败。
- `drain()` 和 `close()` 还要等驱动和转接器芯片里的那部分字节，系统报告不了它们：等待的时长是这些字节按线路速度发完所需的时间，macOS 上最多按 4 KB 算，Linux 和 Windows 上最多按 1 KB 算。

## 5. 蓝牙设备

```typescript
import {openBluetoothSerial, type SerialPort} from '@lakutata/serial'

const printer: SerialPort = await openBluetoothSerial({address: '00:11:22:33:44:55'})
printer.on('error', (error: Error) => console.error(error))
printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
await printer.close()
```

- 经典蓝牙设备和系统配对后，通过串口协议（SPP）打开。不支持低功耗蓝牙（BLE）设备。
- Linux 上通过 RFCOMM 套接字连接设备，使用给定的 `channel`（默认 1）；macOS 和 Windows 上打开系统为配对设备生成的串口（Windows 上是“传出”的那个）。
- 线路参数和信号线对蓝牙连接不起作用：蓝牙连接有它自己的速度。

## 6. 在应用里使用

用一个组件在应用启动时打开串口、在应用停止时关闭它。设备被拔掉后，等它插回来再重新打开：

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {openSerialPort, SerialException, type SerialPort} from '@lakutata/serial'

class Scale extends Component {
    @Configurable(DTO.String().required())
    protected readonly path: string

    @Inject('log')
    protected readonly log: ILogger

    protected port: SerialPort | undefined

    protected timer: NodeJS.Timeout | undefined

    protected weight: string = ''

    protected async init(): Promise<void> {
        await this.open()
    }

    protected async open(): Promise<void> {
        try {
            const port: SerialPort = await openSerialPort({path: this.path, baudRate: 9600})
            port.on('data', (data: Buffer): void => {
                this.weight = data.toString('ascii').trim()
            })
            port.on('error', (error: Error): void => {
                this.log.warn('scale: %s', error.message)
                if (error instanceof SerialException && error.disconnected) this.retry()
            })
            this.port = port
        } catch (error) {
            this.log.warn('scale: %s', (error as Error).message)
            this.retry()
        }
    }

    protected retry(): void {
        this.port = undefined
        this.timer = setTimeout((): Promise<void> => this.open(), 3000)
    }

    public current(): string {
        return this.weight
    }

    protected async destroy(): Promise<void> {
        clearTimeout(this.timer)
        await this.port?.close()
    }
}

Application.run(() => ({
    id: 'scale.app',
    name: 'Scale',
    components: {
        scale: {class: Scale, path: '/dev/ttyUSB0'}
    },
    bootstrap: ['scale']
}))
```

- 控制器用 `@Inject('scale')` 拿到这个组件，用 `current()` 回答请求。
- 串口或蓝牙连接的热敏打印机，由 `@lakutata/thermal-printer` 自己打开串口（见 [Thermal](Thermal.md)）。

## 7. 系统、运行环境和打包

- Linux、macOS 和 Windows 上的 Node.js 18.10 及以上、Bun、Electron 和 NW.js。插件只用 Node-API（不调用 libuv），所以同一份编译结果能在 Electron 和 NW.js 里加载，也能在 worker 线程里运行；worker 或进程结束时还开着的串口会被关闭，还没发出的数据会被丢弃。
- 转接器被拔掉，Linux 和 macOS 上会立即报告，Windows 上在一秒内报告。
- **Linux**：用户要在串口所属的组里（Debian 和 Ubuntu 上是 `dialout`，Arch 上是 `uucp`）。Ubuntu 22.04 和 Linux Mint 21 上，`brltty` 软件包会占用 CH340 转接器；ModemManager 会用几秒钟探测新插的串口。转接器里有因流控发不出去的数据时，内核在关闭串口时最多会再占用它 30 秒（`closing_wait`），`close()` 要等内核放开串口才会完成。
- **Windows**：有些驱动在串口关闭后要稍等一会儿才释放它，隔一小会儿再打开即可。
- `lakutata package` 生成的打包文件、可执行文件和安装程序会带上编译好的插件：请在每个目标平台上安装这个包后再打包（见 [Packaging](Packaging.md) 和 [NativeAddons](NativeAddons.md)）。

## 8. 异常

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
