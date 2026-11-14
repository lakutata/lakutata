# Lakutata 网口

`@lakutata/netif` 包使 Node.js 服务器按网口监听，而不是按地址监听。具有多个网口的设备通常只在其中一个网口上提供管理页面。该网口的地址来自 DHCP，会发生变化，设备启动时也可能尚未获得地址；而监听 `0.0.0.0` 又会使管理页面出现在所有网口上。使用该包后，服务器监听的是网口“eth1”本身，无论其当前地址是什么；地址变化，或网口拔出后重新插入时，服务器都会继续监听。该包不属于 `lakutata`，也不需要应用，其主要特点如下：

- **适用于任何服务器**：`http`、`https`、`http2`、`tls`、Express 和 Fastify 都将该网口上的连接作为自身的连接处理。UDP 套接字同样适用，可用于只在一个网口上工作的服务（DHCP、mDNS、SSDP）。
- **Lakutata 的适配器**提供 `interface` 选项，可使应用的控制器只在一个网口上提供服务（第 5 节）。
- **尽可能由系统拒绝来自其他网口的连接**：在 Linux 上，套接字绑定在网口上，经由其他网口发往该网口地址的连接会被拒绝。在 Windows 和 macOS 上，监听的是该网口的地址，`enforced` 表明系统是否会拒绝此类连接。
- **网口及其变化**：本机每个网口的状态，以及地址变化、连通状态变化和网口出现或消失时的事件，都来自系统的通知。
- **原生插件**：在安装该包时编译，支持 Linux、macOS 和 Windows，也可以在 Bun 和 Electron 主进程中运行。

`@lakutata/netif` 的 README 介绍了每个函数及其选项；本指南按用途逐一说明该包的功能，并为每种用途给出一个示例。

```bash
npm install @lakutata/netif
```

原生插件在安装该包时编译，因此机器上需要有 Python 3 和支持 C++17 的编译器（在 Alpine Linux 上还需要内核头文件：`apk add python3 make g++ linux-headers`）。包管理器必须运行该包的安装脚本。npm 会运行安装脚本，并可能提示该脚本“not yet covered by allowScripts”（运行 `npm install-scripts approve @lakutata/netif` 即可记录允许其运行）。Bun 和 pnpm 只为明确信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 中设置，pnpm 使用 `pnpm approve-builds`）。本包的类型引用了 peer 依赖 `@lakutata/core` 中的类型，包管理器会随本包一并安装这一依赖；本包运行时不会加载这一依赖。

## 1. 在网口上监听

`listenOn()` 使一个服务器在网口上监听。网口可以按名称、MAC 地址（`{mac: '52:54:00:12:34:56'}`，不随系统为网口指定的名称而变化）或序号指定；在 Windows 上，名称是网络连接的名称（`'以太网 2'`、`'Ethernet 2'`）。

```typescript
import {createServer} from 'node:http'
import express from 'express'
import {type InterfaceListener, listenOn} from '@lakutata/netif'

const app = express()
app.get('/', (request, response) => response.send(`served on ${request.socket.localAddress}`))

const listener: InterfaceListener = await listenOn('eth1', createServer(app), {port: 8080})
listener.on('error', error => console.error(error))
console.log(listener.port, listener.addresses)
```

- 监听器接受连接后将其交给服务器，服务器像处理自身的连接一样处理这些连接。服务器本身并未监听，因此其 `address()` 为 `null`，`server.close()` 也无法停止监听器；请使用 `listener.port`、`listener.addresses` 和 `listener.close()`。
- 网口可以暂时不存在，也可以尚未获得地址。此时 `listenOn()` 会立即返回，待网口可以监听时再开始监听。网口拔出后重新插入，或地址发生变化时，会自动重新监听；已建立的连接交由服务器处理。
- 首次监听的错误（例如端口已被占用）会直接抛出；之后的监听错误以 `error` 事件发出，并在稍后重试。请像对待 `net.Server` 一样，为监听器添加 `error` 事件的监听函数。
- `family` 选择 `'IPv4'`、`'IPv6'` 或 `'both'`（默认）；`port: 0` 由系统选择端口，重新监听时沿用同一端口。

## 2. 哪些连接会被挡住

另一个网络中的客户端可以自行添加一条经过设备的路由，使发往管理网口地址的数据包从设备的另一个网口进入。`enforced` 表明系统是否会拒绝此类连接：

| | `enforced` |
|---|---|
| Linux | `true`：套接字绑定在网口上（`SO_BINDTODEVICE`）；在 Linux 5.7 之前，这需要 `CAP_NET_RAW` 能力，缺少该能力时按地址监听，`enforced` 为 `false` |
| Windows | 其他网口均按强主机模型收包、均未开启转发时为 `true`，这也是默认情况 |
| macOS | 默认为 `false`；仅当系统设置为拒绝此类数据包（`net.inet.ip.check_interface` 设为 2，IPv6 还需设置 `net.inet6.ip6.check_interface`）且未开启转发时，才为 `true` |

默认情况下，以系统允许的最佳方式监听，无论如何都不会逊于用 `listen(port, host)` 按地址监听；`reason` 说明没有保证的原因，以及获得保证的方法。如果管理网口是一道安全边界，请使用 `strict: true`，这样在没有保证时拒绝监听，在运行中失去保证期间停止监听：

```typescript
import {createServer} from 'node:http'
import {type InterfaceListener, NetIfNotEnforcedException, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface({mac: '52:54:00:12:34:56'})
try {
    const listener: InterfaceListener = await management.listen(createServer(), {port: 443, strict: true})
    listener.on('error', error => console.error(error))
    listener.on('enforced', enforced => console.log(enforced ? 'guaranteed again' : 'stopped: no longer guaranteed'))
} catch (error) {
    if (error instanceof NetIfNotEnforcedException) console.error(error.message)
    throw error
}
```

## 3. 跟踪一个网口

`NetworkInterface` 提供一个网口的当前状态（`present`、`running`、`addresses` 等），并在每次变化时发出事件。事件来自系统的通知，而非定时轮询。

```typescript
import {type InterfaceAddress, listInterfaces, NetworkInterface} from '@lakutata/netif'

console.log(listInterfaces().map(entry => `${entry.name}: ${entry.running ? 'connected' : 'not connected'}`))

const wan: NetworkInterface = new NetworkInterface('eth0')
wan.on('change', ({added, removed}) => {
    for (const address of added) console.log(`new address ${address.cidr}`)
    for (const address of removed) console.log(`address gone ${address.cidr}`)
})
wan.on('down', () => console.log('the cable of eth0 is unplugged'))
wan.on('up', () => console.log('the cable of eth0 is plugged in'))
const address: InterfaceAddress = await wan.waitForAddress({family: 'IPv4', timeout: 60000})
console.log(`reachable at ${address.address}`)
```

- `listInterfaces()` 也会列出没有地址的网口及其状态；`os.networkInterfaces()` 只列出有地址的网口。
- IPv6 地址在可用后才计入，即添加约一秒后、重复地址检测结束时。
- `close()` 停止跟踪该网口（该网口的监听器也会随之关闭）。

## 4. 网口上的 UDP

`createUDPSocket()` 返回该网口上的 UDP 套接字，其方法和事件与 `dgram` 套接字相同。下面的设备只在管理网络上响应发现广播：

```typescript
import {type InterfaceUDPSocket, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const socket: InterfaceUDPSocket = await management.createUDPSocket({port: 30303, family: 'IPv4'})
socket.setBroadcast(true)
socket.on('message', (message, remote) => {
    const answer: string = `device at ${management.addresses[0]?.address}`
    if (message.toString() === 'who is there') socket.send(answer, remote.port, remote.address)
})
socket.on('error', error => console.error(error))
```

在 Linux 上，此套接字只接收经该网口进入的数据，包括该网口上的广播，以及通过 `addMembership()` 加入的组播组的数据，无法接收来自其他网口的任何数据。在 Windows 和 macOS 上，网口的每个地址各绑定一个套接字；在 macOS 上，此类套接字无法接收广播和组播。

## 5. 在应用中使用

Lakutata 中自行监听端口的适配器都提供 `interface` 选项：`expressHTTPEntrypoint()`、`fastifyHTTPEntrypoint()`、`httpServiceEntrypoint()`、`socketIOServiceEntrypoint()`、`jsonRPCServiceEntrypoint()`、`@lakutata/grpc` 的 `grpcServiceEntrypoint()` 和 `@lakutata/mcp` 的 `httpMCPEntrypoint()`。设置该选项后，控制器的动作即在该网口上提供，无论网口的地址是什么：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class ManagementController extends Controller {
    @GET('/status')
    public async status(): Promise<{ ok: boolean }> {
        return {ok: true}
    }
}

Application.run(() => ({
    id: 'device.app',
    name: 'Device',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [ManagementController],
            http: expressHTTPEntrypoint({port: 8080, interface: 'eth1'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- `family`、`strict` 和 `onError` 与 `interface` 配合使用。未设置 `onError` 时，重新监听的错误会写入应用的日志。适配器的 `listening` 回调会接收到监听器。这些选项的说明见 [HTTP](HTTP.md) 第 2 节。
- 网口尚不存在时，应用也能启动；网口出现后，即可访问应用的动作。
- 适配器通过 `IInterfaceListening` 按网口监听。这一接口由 Lakutata 定义（来自 `@lakutata/core`），由本包实现，适配器默认加载本包。其他实现可以通过适配器的 `interfaceListening` 选项指定；本包的 `InterfaceListener` 就是一个 `IInterfaceListener`。

不属于入口的服务器应由一个组件持有，在 `startup()` 中开始监听，在 `destroy()` 中停止监听。网口和端口作为组件的选项。

```typescript
import {createServer} from 'node:http'
import express from 'express'
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {type InterfaceListener, listenOn} from '@lakutata/netif'

class ManagementPages extends Component {
    @Inject('log')
    protected readonly log: ILogger

    @Configurable(DTO.String().required())
    protected readonly interfaceName: string

    @Configurable(DTO.Number().port().default(8080))
    protected readonly port: number

    protected listener: InterfaceListener

    protected async startup(): Promise<void> {
        const app = express()
        app.get('/', (request, response) => response.send('management'))
        this.listener = await listenOn(this.interfaceName, createServer(app), {port: this.port})
        this.listener.on('error', (error: Error): void => this.log.error(error.message))
        this.listener.on('listening', (): void => this.log.info('listening on %o', this.listener.addresses))
        this.log.info('enforced: %s', this.listener.enforced)
    }

    protected async destroy(): Promise<void> {
        await this.listener?.close()
    }
}

Application.run(() => ({
    id: 'device.app',
    name: 'Device',
    components: {
        management: {class: ManagementPages, interfaceName: 'eth1', port: 8080}
    },
    bootstrap: ['management']
}))
```

## 6. 系统、运行环境和打包

- **Linux** 将套接字绑定在网口上，因此系统会拒绝来自其他网口的连接，新添加的地址立即可以访问，UDP 也能接收该网口的广播和组播。在 Linux 5.7 之前，请为进程授予 `CAP_NET_RAW` 能力（`setcap cap_net_raw+ep`，或在 systemd 单元中写入 `AmbientCapabilities=CAP_NET_RAW`）。
- **Windows** 监听网口的地址；其强主机模型会拒绝来自其他网口的连接，除非某个网口被设为弱主机模型（`netsh interface ipv4 set interface "<名字>" weakhostreceive=enabled`，某些负载均衡软件会这样设置）或开启了转发。`reason` 会指出是哪个网口。
- **macOS** 监听网口的地址，除非系统做了相应设置，否则没有保证。macOS 27 对进程隐藏 MAC 地址（报告的均为 `02:00:00:00:00:00`），因此在该版本上请按名称指定网口。
- **Bun**：Bun 的 `https` 服务器对监听器移交的连接不执行 TLS，因此在 Bun 上 `listen()` 会拒绝这种服务器（以 `https` 选项创建的 Fastify 实例同样如此）。在 Bun 上请改用 `http2.createSecureServer({key, cert, allowHTTP1: true})` 或 `tls.createServer()`。Bun 的服务器不会关闭这类移交而来的空闲长连接，因此适配器会自行关闭这些连接。交给服务器的连接无法升级为 WebSocket（在 Bun 1.4 上观察到），因此在 Bun 上，适配器按网口监听时会拒绝 WebSocket。
- **Electron**：在主进程中使用。
- `lakutata package` 生成的单文件包、可执行文件和安装包都包含编译好的原生插件（`build/Release/netif.node`）。请在每个目标平台上先安装该包，再在该平台上打包（见[打包](Packaging.md)和[原生插件](NativeAddons.md)）。

## 7. 异常

| 异常 | 抛出时机 |
|---|---|
| `NetIfNotFoundException` | 指定的序号没有对应的网口；指定的 MAC 地址由多个网口共用 |
| `NetIfNotEnforcedException` | 使用了 `strict`，但系统无法拒绝来自其他网口的连接；或者运行中保证丢失（`error` 事件） |
| `NetIfNotSupportedException` | 系统或运行环境无法执行的操作：在 Linux 以外的系统上调用 `bindSocket()`、在 macOS 上为绑定到地址的套接字加入组播、在 Bun 上监听 `https` 服务器 |
| `NetIfTimeoutException` | `waitForAddress()` 等待超过 `timeout` |
| `NetIfException` | 以上所有异常的基类；被系统拒绝时，`errno` 为系统的错误码（`'EADDRINUSE'`、`'EACCES'` 等） |
