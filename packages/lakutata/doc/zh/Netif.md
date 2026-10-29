# Lakutata Netif

`@lakutata/netif` 包让 Node.js 的服务器按网口监听，而不是按地址监听。有多个网口的设备，常常只在其中一个网口上提供管理页面：这个网口的地址来自 DHCP，会变，设备开机时可能还没有；而监听 `0.0.0.0` 又会让管理页面出现在所有网口上。用这个包，服务器监听的是“eth1 这个网口”，不管它现在是什么地址，地址变化、网口拔掉再插回，都会继续监听。它不属于 `lakutata`，也不需要应用。它的特点是：

- **任何服务器都能用**：`http`、`https`、`http2`、`tls`、Express 和 Fastify 都把这个网口的连接当成自己的连接处理；UDP 套接字也可以，适合只在一个网口上工作的服务（DHCP、mDNS、SSDP）。
- **lakutata 的入口**有 `interface` 选项，可以让应用的控制器只在一个网口上提供服务（第 5 节）。
- **系统能挡的，就让系统挡住别的网口**：在 Linux 上，套接字绑定在网口上，从别的网口发往这个网口地址的连接会被拒绝。在 Windows 和 macOS 上，监听的是这个网口的地址，`enforced` 告诉你系统会不会挡住那样的连接。
- **网口和它们的变化**：本机每个网口的状态，以及地址、连通状态、网口出现和消失时的事件，都来自系统的通知。
- **原生插件**：在安装这个包时编译，支持 Linux、macOS 和 Windows；也能在 Bun 和 Electron 的主进程里运行。

`@lakutata/netif` 的 README 介绍了每个函数及其选项；这篇指南按用途逐一说明这个包能做什么，每种用途都给出一个例子。

```bash
npm install @lakutata/netif
```

原生插件在安装这个包时编译，所以机器上要有 Python 3 和支持 C++17 的编译器（Alpine Linux 还要内核的头文件：`apk add python3 make g++ linux-headers`）。包管理器必须运行这个包的安装脚本：npm 会运行它，可能会提示这个脚本“not yet covered by allowScripts”（运行 `npm install-scripts approve @lakutata/netif` 记录你允许它运行）；Bun 和 pnpm 只为被告知可以信任的包运行安装脚本（Bun 在 package.json 的 `trustedDependencies` 里设置，pnpm 用 `pnpm approve-builds`）。它的类型引用了 `@lakutata/core` 的类型，这是一个 peer 依赖，包管理器会一起安装；这个包运行时不会加载它。

## 1. 在网口上监听

`listenOn()` 让一个服务器在网口上监听。网口可以按名字、MAC 地址（`{mac: '52:54:00:12:34:56'}`，不随系统给网口起的名字变化）或序号指定；Windows 上的名字是网络连接的名字（`'以太网 2'`、`'Ethernet 2'`）。

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

- 监听器接受连接后交给服务器，服务器像处理自己的连接一样处理它们。服务器自己并没有在监听：它的 `address()` 是 `null`，`server.close()` 也不能让监听器停下；请用 `listener.port`、`listener.addresses` 和 `listener.close()`。
- 网口可以暂时不存在，也可以还没有地址：`listenOn()` 会立即返回，等网口能监听了就开始监听。网口拔掉再插回、地址变化时，会自动重新监听；已经建立的连接交给服务器处理。
- 第一次监听的错误（比如端口被占用）会直接抛出；之后的错误是 `error` 事件，过一会儿会重试。请给监听器加上 `error` 的监听函数，就像对 `net.Server` 那样。
- `family` 选择 `'IPv4'`、`'IPv6'` 或 `'both'`（默认）；`port: 0` 让系统选一个端口，重新监听时保持同一个端口。

## 2. 哪些连接会被挡住

另一个网络的客户端，可以自己加一条经过设备的路由，把发往管理网口地址的包从设备的另一个网口送进来。系统会不会拒绝这样的连接，就是 `enforced` 回答的问题：

| | `enforced` |
|---|---|
| Linux | `true`：套接字绑定在网口上（`SO_BINDTODEVICE`）；Linux 5.7 以前这需要 `CAP_NET_RAW` 能力，没有的话就按地址监听，`enforced` 为 `false` |
| Windows | 其他网口都按强主机模型收包、都没开转发时为 `true`，默认就是这样 |
| macOS | 默认为 `false`；只有在系统设置为拒绝这样的包（`net.inet.ip.check_interface` 设为 2，IPv6 还有 `net.inet6.ip6.check_interface`）并且没开转发时才为 `true` |

默认按系统允许的最好方式监听，无论如何都不会比用 `listen(port, host)` 按地址监听差；`reason` 说明为什么没有保证，以及怎样才能有。如果管理网口是一道安全边界，用 `strict: true`：没有保证就拒绝监听，运行中保证丢了就停止监听：

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

`NetworkInterface` 给出一个网口现在的状态（`present`、`running`、`addresses` 等），并在每次变化时发出事件。事件来自系统的通知，不靠定时轮询。

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

- `listInterfaces()` 也列出没有地址的网口，并带上它们的状态；`os.networkInterfaces()` 只列出有地址的网口。
- IPv6 地址等它可用后才算：加上后大约一秒，重复地址检测结束时。
- `close()` 停止跟踪这个网口（它的监听器也会关闭）。

## 4. 网口上的 UDP

`createUDPSocket()` 返回这个网口的 UDP 套接字，方法和事件和 `dgram` 的套接字一样。下面是一个只回答管理网络里发现广播的设备：

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

在 Linux 上，这个套接字只接收从这个网口进来的数据，包括这个网口上的广播和用 `addMembership()` 加入的组播组，别的网口来的一概收不到。在 Windows 和 macOS 上，网口的每个地址各绑一个套接字；macOS 上这样的套接字收不到广播和组播。

## 5. 在应用中使用

lakutata 里自己监听端口的入口都有 `interface` 选项：`expressHTTPEntrypoint()`、`fastifyHTTPEntrypoint()`、`httpServiceEntrypoint()`、`socketIOServiceEntrypoint()`、`jsonRPCServiceEntrypoint()`、`@lakutata/grpc` 的 `grpcServiceEntrypoint()` 和 `@lakutata/mcp` 的 `httpMCPEntrypoint()`。设置后，控制器的动作就在这个网口上提供，不管它是什么地址：

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

- `family`、`strict` 和 `onError` 与 `interface` 配合使用。没有设置 `onError` 时，重新监听的错误会写到应用的日志里。适配器的 `listening` 回调会拿到监听器。这些选项的说明见 [HTTP](HTTP.md) 第 2 节。
- 网口还不存在时应用也能启动，网口出现后就能访问它的动作。
- 入口通过 `IInterfaceListening` 按网口监听。这是 lakutata 定义的接口（来自 `@lakutata/core`），这个包实现了它，入口默认加载这个包。另一种实现可以用入口的 `interfaceListening` 选项给出；这个包的 `InterfaceListener` 就是一个 `IInterfaceListener`。

不属于入口的服务器由一个组件持有：在 `startup()` 里开始监听，在 `destroy()` 里停止。网口和端口作为组件的选项。

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

- **Linux** 把套接字绑定在网口上：系统会挡住别的网口，新加的地址立刻就能访问，UDP 能收到这个网口的广播和组播。Linux 5.7 以前，请给进程 `CAP_NET_RAW` 能力（`setcap cap_net_raw+ep`，或在 systemd 单元里写 `AmbientCapabilities=CAP_NET_RAW`）。
- **Windows** 监听网口的地址；它的强主机模型会挡住别的网口，除非有网口被设成了弱主机模型（`netsh interface ipv4 set interface "<名字>" weakhostreceive=enabled`，有些负载均衡软件会这样做）或者开了转发。`reason` 会说出是哪个网口。
- **macOS** 监听网口的地址，除非系统设置了，否则没有保证。macOS 27 对进程隐藏 MAC 地址（给出的都是 `02:00:00:00:00:00`）：在那里请按名字指定网口。
- **Bun**：它的 `https` 服务器收到交过来的连接时不做 TLS，所以在 Bun 上 `listen()` 会拒绝它（用 `https` 选项创建的 Fastify 实例也一样）；在 Bun 上请改用 `http2.createSecureServer({key, cert, allowHTTP1: true})` 或 `tls.createServer()`。Bun 的服务器不会关闭交给它的空闲长连接，入口会自己关闭它们。交给服务器的连接不能升级为 WebSocket（在 Bun 1.4 上观察到），所以在 Bun 上，入口按网口监听时不支持 WebSocket。
- **Electron**：在主进程里使用。
- `lakutata package` 生成的打包文件、可执行文件和安装包会带上编译好的原生插件（`build/Release/netif.node`）：请在每个目标平台上先安装这个包，再在那里打包（见[打包](Packaging.md)和[原生插件](NativeAddons.md)）。

## 7. 异常

| 异常 | 什么时候 |
|---|---|
| `NetIfNotFoundException` | 指定的序号没有网口，指定的 MAC 有几个网口 |
| `NetIfNotEnforcedException` | 用了 `strict`，但系统挡不住别的网口；或者运行中保证丢了（`error` 事件） |
| `NetIfNotSupportedException` | 系统或运行环境做不到的操作：在 Linux 以外调用 `bindSocket()`，在 macOS 上给绑定在地址上的套接字加组播，在 Bun 上监听 `https` 服务器 |
| `NetIfTimeoutException` | `waitForAddress()` 超过了 `timeout` |
| `NetIfException` | 以上所有异常的基类；系统拒绝时，`errno` 是系统的错误码（`'EADDRINUSE'`、`'EACCES'`…） |
