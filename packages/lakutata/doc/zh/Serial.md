# Lakutata 串口

`@lakutata/serial` 包用于与串口设备通信，例如秤、扫码枪、PLC、调制解调器、Arduino 和 ESP32 等开发板，以及打印机。串口打开后是一个 Node.js 流，写入的数据从线路发出，线路收到的数据可以从流中读出。经典蓝牙设备可以按地址打开，得到同样的流。该包不属于 `lakutata`，也不需要应用，其主要特点如下：

- **串口是 `Duplex` 流**：`write()`、`'data'`、`pipe()` 的用法与套接字相同。线路参数（波特率、数据位、校验位、停止位、流控）和调制解调器信号线（DTR、RTS、CTS、DSR、DCD、RI）均在该流上设置和读取。
- **找到要用的串口**：列出系统中的串口，以及各串口 USB 转接器的厂商 ID 和产品 ID。在 Linux 上还提供一个路径，即使转接器改插到其他 USB 口，该路径也不会改变。
- **设备被拔出时会报告**：即使当时没有读写操作也会报告，应用可以据此重新打开串口。
- **所有等待都有上限**：设备不再接收数据时（例如打印机缺纸），写入会在超时后失败，而不会无限期挂起。
- **原生插件**：在安装该包时编译，支持 Linux、macOS 和 Windows。在 Linux 和 macOS 上使用 termios，在 Windows 上使用通信 API。每个打开的串口都有独立的线程，因此不会拖慢 Node.js 的文件、DNS 和加密操作。

`@lakutata/serial` 的 README 列出了所有选项和错误码；本指南按用途逐一说明该包的功能，并为每种用途给出一个示例。

```bash
npm install @lakutata/serial
```

原生插件在安装该包时编译，因此机器上需要有 Python 3 和 C++ 编译器（macOS 上是 Xcode 命令行工具，Linux 上是 `build-essential`，Windows 上是 Visual Studio 的 C++ 生成工具）。包管理器必须运行该包的安装脚本。npm 会运行安装脚本。Bun 和 pnpm 只为明确信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 中设置，pnpm 使用 `pnpm approve-builds`）。`@lakutata/core` 是本包的 peer 依赖，本包的异常继承自其中的 `Exception`。

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

- 路径：在 Linux 上为 `/dev/ttyUSB0` 或 `/dev/ttyACM0`（树莓派上使用 `/dev/serial0`），在 macOS 上为 `/dev/cu.*`（`/dev/tty.*` 设备用于等待传入连接），在 Windows 上为 `COM3`。
- **务必监听 `'error'`。** 设备断开时，流会以 `SerialException` 失败，该异常的 `disconnected` 为 `true`；没有 `'error'` 监听器时，Node.js 会结束进程。
- 串口默认以独占方式打开，即在打开期间其他程序无法再打开该串口。在 Linux 和 macOS 上，`exclusive: false` 允许其他程序同时打开；Windows 始终以独占方式打开串口。
- `drain()` 在已写入的数据从线路发出后完成。`close()` 在数据发送完毕后关闭串口，`destroy()` 则立即关闭串口，并丢弃尚未发出的数据。
- 与打开的套接字一样，打开的串口会使进程保持运行，因此使用完毕后请将其关闭。

## 2. 线路参数和信号线

线路参数请按设备说明书设置：

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

- `baudRate` 的标准值在任何系统和转接器上都可用，其他值需要系统和转接器支持。`dataBits` 取 5 到 8；`stopBits` 取 1、1.5（仅限 Windows，且只能搭配 5 个数据位）或 2；`parity` 取 `'none'`、`'even'`、`'odd'`，在 Linux 和 Windows 上还可取 `'mark'` 和 `'space'`。
- `flowControl` 取 `'none'`、`'rts/cts'`、`'dtr/dsr'`（Linux 上不可用）或 `'xon/xoff'`。使用 `'xon/xoff'` 时，收到字节 0x13 会使输出暂停，因此发送二进制数据的设备需要使用硬件流控。
- 线路参数设置完成后会读回核对。驱动未接受某项设置时，打开串口或 `update()` 会以 `'EINVAL'` 失败，而不会在其他设置下继续运行。
- `update()` 在此前的写入发送完毕后修改线路参数。`getSignals()` 读取 CTS、DSR、DCD 和 RI；`setSignals()` 设置 DTR 和 RTS，或在此前的写入发送完毕后发送中断信号（break）。`flush()` 丢弃两个方向上等待中的数据。
- Linux 和 macOS 在打开串口时会拉高 DTR 和 RTS。因此，遇到这一脉冲即复位的开发板（Arduino、ESP32）在串口打开时就会复位，代码无法避免这种复位。

## 3. 找到要用的串口

设备改插到其他 USB 口，或者开机时转接器被识别的顺序发生变化时，设备的串口路径都会改变。可以改为按转接器的 ID 选择串口：

```typescript
import {listSerialPorts, openSerialPort, type SerialPort, type SerialPortInfo} from '@lakutata/serial'

const ports: SerialPortInfo[] = await listSerialPorts()
const scale: SerialPortInfo | undefined = ports.find((info: SerialPortInfo): boolean => info.vendorId === 0x1a86 && info.productId === 0x7523)
if (!scale) throw new Error('the scale is not plugged in')
const port: SerialPort = await openSerialPort({path: scale.stablePath ?? scale.path, baudRate: 9600})
port.on('error', (error: Error) => console.error(error))
```

- 每个串口都有 `path`。USB 转接器还提供 `vendorId` 和 `productId`（数字）、`serialNumber`、`manufacturer` 和 `product`；同一型号的多个转接器在有序列号时可通过 `serialNumber` 区分。
- 在 Linux 上，`stablePath` 是串口在 `/dev/serial/by-id` 中的链接，即使转接器改插到其他 USB 口也不会改变。
- 在 macOS 和 Windows 上，已配对蓝牙设备的串口提供其 `bluetoothAddress`，设备名称位于 `product` 中。

## 4. 设备不再接收数据的时候

设备可能会停止接收数据，例如设备拉低了 CTS，或者设备是缺纸的打印机。所有等待都有上限：

- 在选项中设置了 `stallTimeout`（毫秒）时，输出停止达到该时长后，写入或等待发送（drain）会以 `'ETIMEDOUT'` 失败，数据仍保留在队列中。
- 输出仍在进行时，`close()` 会持续等待；输出停止的时长达到 `close({stallTimeout})`（默认 10 秒）后，丢弃剩余的数据，关闭串口，并以 `'ETIMEDOUT'` 拒绝。
- 中断信号（break）需要先等待输出发送完毕；流控使输出停滞超过 2 秒时，中断信号以 `'ETIMEDOUT'` 失败。
- `drain()` 和 `close()` 还需等待仍在驱动和转接器芯片中的字节，而系统无法报告这些字节。这部分等待的时长为这些字节按线路速度发送完毕所需的时间，在 macOS 上最多按 4 KB 计算，在 Linux 和 Windows 上最多按 1 KB 计算。

## 5. 蓝牙设备

```typescript
import {openBluetoothSerial, type SerialPort} from '@lakutata/serial'

const printer: SerialPort = await openBluetoothSerial({address: '00:11:22:33:44:55'})
printer.on('error', (error: Error) => console.error(error))
printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
await printer.close()
```

- 经典蓝牙设备与系统配对后，通过串口协议（SPP）打开。不支持低功耗蓝牙（BLE）设备。
- 在 Linux 上，通过 RFCOMM 套接字连接设备，使用指定的 `channel`（默认 1）。在 macOS 和 Windows 上，打开系统为已配对设备生成的串口（在 Windows 上为“传出”串口）。
- 线路参数和信号线对蓝牙连接不起作用，蓝牙连接有其自身的速度。

## 6. 在应用里使用

由一个组件在应用启动时打开串口，在应用停止时关闭串口。设备被拔出后，组件会在设备重新插入时再次打开串口：

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

- 控制器通过 `@Inject('scale')` 获取该组件，并用 `current()` 响应请求。
- 对于通过串口或蓝牙连接的热敏打印机，`@lakutata/thermal-printer` 会自行打开串口（见[热敏打印机](Thermal.md)）。

## 7. 系统、运行环境和打包

- 支持 Linux、macOS 和 Windows 上的 Node.js 18.10 及以上版本、Bun、Electron 和 NW.js。插件只使用 Node-API（不调用 libuv），因此同一份编译结果可以在 Electron 和 NW.js 中加载，也可以在 worker 线程中运行。worker 或进程结束时仍处于打开状态的串口会被关闭，尚未发出的数据会被丢弃。
- 转接器被拔出时，在 Linux 和 macOS 上会立即报告，在 Windows 上会在一秒内报告。
- **Linux**：用户需要加入串口所属的组（Debian 和 Ubuntu 上为 `dialout`，Arch 上为 `uucp`）。在 Ubuntu 22.04 和 Linux Mint 21 上，`brltty` 软件包会占用 CH340 转接器；ModemManager 会花几秒钟探测新插入的串口。转接器中有因流控而无法发出的数据时，内核在关闭串口时最多还会占用该串口 30 秒（`closing_wait`），`close()` 要等内核释放串口后才会完成。
- **Windows**：某些驱动在串口关闭后需要片刻才会释放串口，稍候再打开即可。
- `lakutata package` 生成的单文件包、可执行文件和安装包都包含编译好的原生插件。请在每个目标平台上先安装该包，再在该平台上打包（见[打包](Packaging.md)和[原生插件](NativeAddons.md)）。

## 8. 异常

所有失败都会抛出 `SerialException`（`errno` 为 `'E_SERIAL'`）。该异常的 `code` 为系统的错误名，设备断开时 `disconnected` 为 `true`：

| `code` | 抛出时机 |
|---|---|
| `'ENOENT'` | 串口不存在 |
| `'EBUSY'` | 串口已被其他程序打开，或已在别处被独占打开 |
| `'EACCES'` | 用户无权打开串口（在 Linux 上表示用户不在串口所属的组中） |
| `'ENOTTY'` | 该路径不是串口（`/dev/usb/lp0` 是 USB 打印机，不是串口） |
| `'EINVAL'` | 该包不接受的选项，或设备未接受的设置 |
| `'ETIMEDOUT'` | 输出停滞时间过长，或打开串口耗时过长 |
| `'EHOSTDOWN'`、`'ECONNREFUSED'` | 蓝牙设备无响应，或拒绝连接（Linux） |
| `'EAFNOSUPPORT'`、`'ENOTSUP'` | 系统不提供蓝牙套接字（例如在容器中），或当前平台根本不支持蓝牙 |
| `'EIO'` | 串口打开期间设备断开（`disconnected` 为 `true`） |
| `'ECANCELED'` | 向已关闭的串口发出请求 |
