# @lakutata/netif

[English](README.md) | 中文

按网口监听，而不是按地址监听。Node.js 的 `listen(port, host)` 只能按地址监听，然而管理网口的地址会变化（DHCP），开机时可能尚未获得地址；监听 `0.0.0.0` 又会将服务暴露在所有网口上。使用本包后，服务器监听的是网口“eth1”本身，无论其当前地址是什么；地址变化，或网口拔出后重新插入时，都会自动重新监听。在 Linux 上，从其他网口进入的连接由系统直接拒绝。Node.js 的任何服务器都可以使用本包（`http`、`https`、`http2`、`tls`、Express、Fastify），UDP 套接字也可以。本包还能列出本机的网口及其状态，并在网口变化时发出事件。本包以原生插件实现，支持 Linux、macOS 和 Windows，在安装时编译。本包属于 [Lakutata](https://github.com/lakutata/lakutata) 系列，但无需 Lakutata 应用，导入即可直接使用。

## 安装

```shell
npm install @lakutata/netif
```

- 原生插件在安装时编译（node-gyp），因此机器上需要安装 Python 3 和支持 C++17 的编译器：macOS 上为 Xcode 命令行工具，Debian、Ubuntu 上为 `build-essential`，Windows 上为 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。Alpine Linux 还需要内核头文件：`apk add python3 make g++ linux-headers`。编译失败时，安装也会失败。
- 包管理器需要执行本包的安装脚本。npm 会执行该脚本，但可能提示该脚本“not yet covered by allowScripts”，此时运行 `npm install-scripts approve @lakutata/netif` 即可记录允许其执行。Bun 和 pnpm 只为明确信任的依赖执行安装脚本，需要先允许本包（Bun 在 package.json 的 `trustedDependencies` 中添加本包，pnpm 使用 `pnpm approve-builds`）；未允许时，加载本包会抛出错误，并说明原生插件的编译方法。
- Node.js `>=18.10.0`。原生插件使用 Node-API，因此 Bun 和 Electron 主进程可以直接加载 node-gyp 为 Node.js 编译的插件，无需重新编译。
- `@lakutata/core` 是 peer 依赖（包管理器会随本包一并安装），因为本包的类型引用了其中定义的按网口监听的接口。本包运行时不会加载这一依赖。

## 用法

### 快速上手

```typescript
import {createServer} from 'node:http'
import express from 'express'
import {type InterfaceListener, listenOn} from '@lakutata/netif'

const app = express()
app.get('/', (request, response) => response.send('the management interface'))

const listener: InterfaceListener = await listenOn('eth1', createServer(app), {port: 8080})
listener.on('error', error => console.error(error))
console.log(listener.enforced, listener.addresses)    //true [{address: '192.168.10.2', family: 'IPv4', port: 8080}, …]
```

网口可以暂时不存在（USB 网卡尚未插入），也可以尚未获得地址（DHCP 尚未完成）。此时 `listenOn()` 会立即返回，待网口可以监听时再开始监听。等待期间，监听器会使进程保持运行，与正在监听的服务器一样。

Lakutata 的适配器（Express、Fastify、各个服务适配器、gRPC、MCP）通过 `interface` 选项自动完成这一工作，例如 `expressHTTPEntrypoint({port: 8080, interface: 'eth1'})`。本包实现了 `@lakutata/core` 的 `IInterfaceListening`，适配器正是通过这一接口按网口监听；本包的 `InterfaceListener` 就是一个 `IInterfaceListener`。

### 指定网口

网口可以按名称、MAC 地址或序号指定：

```typescript
import {NetworkInterface} from '@lakutata/netif'

const byName: NetworkInterface = new NetworkInterface('eth1')
const byHardwareAddress: NetworkInterface = new NetworkInterface({mac: '52:54:00:12:34:56'})
const byIndex: NetworkInterface = new NetworkInterface({index: 3})
```

- **名称**：`'eth1'`、`'enp3s0'`、`'en0'`。在 Windows 上，名称是网络连接的名称（`'以太网 2'`、`'Ethernet 2'`），随系统语言变化。
- **MAC 地址**不随系统为网口指定的名称而变化，适合用于指定管理网口。如果有几个网口的 MAC 相同（例如网桥及其成员网口），会抛出 `NetIfNotFoundException`，此时请改用名称。macOS 27 对没有特殊权限的进程，将每个网口的 MAC 都报告为 `02:00:00:00:00:00`，因此在这样的 macOS 上，网口没有 `mac`，也无法按 MAC 查找。
- **序号**在网口拔出后重新插入时会变化。指定一个不存在的序号会抛出 `NetIfNotFoundException`；网口拔出后，该对象也不再跟踪这一网口。

`listenOn(selector, server, options)` 即 `new NetworkInterface(selector).listen(server, options)`，对网口的跟踪会保持到监听器关闭为止。

### 哪些连接会被挡住

监听网口后，该网口所在网络的客户端通过该网口的地址访问服务器，其他网口的地址上不会进行任何监听。但另一个网络中的客户端仍然可以自行添加一条经过本机的路由，使发往该网口地址的数据包从其他网口进入本机。`enforced` 表明系统是否会拒绝此类连接：

| | 如何监听 | `enforced` |
|---|---|---|
| Linux | 套接字绑定在网口上（`SO_BINDTODEVICE`），每个地址族一个，无论网口有哪些地址；新添加的地址立即可以访问 | `true`：内核拒绝从其他网口进入的连接 |
| Windows | 在网口的每个地址上各打开一个套接字，地址变化时重新监听 | 同一地址族的其他网口均按强主机模型收包且均未开启转发时（默认如此）为 `true`，此时 Windows 会丢弃发往某个地址、却从其他网口进入的数据包（见[强主机模型](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10))） |
| macOS | 在网口的每个地址上各打开一个套接字，地址变化时重新监听 | `false`：macOS 从任何网口都接受发往本机地址的数据包。只有在系统设置为拒绝（`sudo sysctl -w net.inet.ip.check_interface=2`，IPv6 还需要 `net.inet6.ip6.check_interface=2`）且未开启转发时才为 `true`（虚拟机或容器共享网络时会开启转发） |

默认情况下，以系统允许的最佳方式监听，无论如何都不会逊于用 `listen(port, host)` 按地址监听；`enforced` 表明是否具有这层保证（`reason` 说明没有保证的原因，以及获得保证的方法）。设置 `strict: true` 后，无法保证时 `listen()` 抛出 `NetIfNotEnforcedException`；运行中保证丢失时，监听器会停止（触发 `error` 事件），待保证恢复后再继续：

```typescript
import {createServer} from 'node:http'
import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const listener: InterfaceListener = await management.listen(createServer(), {port: 443, strict: true})
listener.on('enforced', enforced => console.log(enforced ? 'guaranteed again' : 'no longer guaranteed'))
```

监听期间始终跟踪这一保证：Windows 上网口设置的变化会触发通知；macOS 的这些设置没有变化通知，因此会在网口变化时重新读取。

在 Linux 上，绑定到 eth1 的套接字会接受从 eth1 进入的所有连接，无论连接发往本机的哪个地址；`addresses` 列出的是 eth1 自身的地址。

### 服务器和它的监听器

监听器接受连接后，将其交给服务器（`server.emit('connection', socket)`），服务器像处理自身的连接一样处理这些连接，请求、长连接、协议升级、TLS 均照常工作。服务器本身并未监听，因此：

- `server.address()` 为 `null`，`server.listening` 为 `false`，请使用 `listener.port` 和 `listener.addresses`。
- `server.close()` 无法停止监听器，请使用 `listener.close()`。对一个从未监听过的服务器调用 Node.js 的 `server.close()`，会将 `ERR_SERVER_NOT_RUNNING` 传给其回调（`promisify` 后为 reject）；`fastify.close()` 不会如此。
- 同一个服务器可以被监听多次（两个网口、两个端口），每个监听器的连接都交给该服务器。`listenOnAll(['eth1', 'eth2'], server, {port: 8080})` 在多个网口上监听，每个网口一个监听器；其中一个网口无法监听时，已经开始监听的监听器都会关闭，并抛出错误。监听多个网口时，端口不能为 0。

对于 Express，请传入 `createServer(app)`；对于 Fastify，请在 `await fastify.ready()` 之后传入 `fastify.server`：

```typescript
import Fastify from 'fastify'
import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'

const fastify = Fastify()
fastify.get('/', async () => 'ok')
await fastify.ready()
const listener: InterfaceListener = await new NetworkInterface('eth1').listen(fastify.server, {port: 8080})
```

`listen()` 的选项：

| 选项 | |
|---|---|
| `port` | 端口。0 表示由系统选择（见 `listener.port`），重新监听时沿用同一端口 |
| `family` | `'IPv4'`、`'IPv6'` 或 `'both'`（默认）。使用 `'both'` 时，如果系统没有 IPv6，则只监听 IPv4 |
| `strict` | `true`：系统无法拒绝其他网口的连接时，不进行监听。默认 `false` |
| `backlog` | 尚未被接受的连接的队列长度，默认 511 |

`listener.close()` 停止监听后立即返回，不等待已建立的连接结束，这些连接交给服务器处理。`NetworkInterface.close()` 也会关闭其监听器。

### 网口变化时

| 情况 | Linux（绑定在网口上） | Windows、macOS |
|---|---|---|
| 网口不存在 | 监听器等待，网口出现时开始监听 | 同左 |
| 网口存在、没有地址 | 已经在监听，地址一经添加即可访问 | 监听器等待地址 |
| 增加或删除地址 | 无需任何处理 | 开始或停止监听该地址。新添加的 IPv6 地址在可用后才监听（重复地址检测结束后，约一秒） |
| 网线拔出 | 套接字保留，连通后继续可用 | 同左，前提是地址仍然存在 |
| 网口拔出后重新插入 | 重新监听（序号已变化），触发 `listening` 事件 | 按地址重新监听 |
| 端口被占用 | 触发 `error` 事件，1 秒后重试，间隔逐次加倍，最长 30 秒 | 同左 |

无论发生什么，已建立的连接都交给服务器处理。首次监听的错误（端口已被占用、没有权限监听 1024 以下的端口）会直接抛出；之后的错误以监听器的 `error` 事件发出，因此**请为监听器添加 `error` 事件的监听函数**，与对待 `net.Server` 相同（否则该错误会被抛出，导致进程退出）。

### 网口和它们的变化

`listInterfaces()` 列出本机所有网口（包括没有地址的网口）及其状态，比 `os.networkInterfaces()` 更完整，后者只列出有地址的网口，也不提供状态。`NetworkInterface` 跟踪一个网口，提供其当前状态，以及每次变化时的事件。

```typescript
import {type InterfaceAddress, listInterfaces, NetworkInterface} from '@lakutata/netif'

for (const entry of listInterfaces()) {
    console.log(entry.name, entry.index, entry.mac, entry.running, entry.addresses.map(address => address.cidr))
}

const lan: NetworkInterface = new NetworkInterface('eth0')
lan.on('change', ({addresses, added, removed}) => console.log('now', addresses, 'added', added, 'removed', removed))
lan.on('up', () => console.log('cable plugged in'))
lan.on('down', () => console.log('cable unplugged'))
lan.on('added', () => console.log('interface plugged'))
lan.on('removed', () => console.log('interface unplugged'))
const address: InterfaceAddress = await lan.waitForAddress({family: 'IPv4', timeout: 60000})
```

- `present`、`name`、`index`、`mac`、`up`（是否启用）、`running`（是否连通）、`loopback`、`addresses` 和 `info`（以上全部）给出当前状态；网口不存在时，`present` 为 `false`，`addresses` 为空数组。
- 地址只包括可用的地址，写法与 `os.networkInterfaces()` 相同：`address`、`family`、`netmask`、`cidr`，IPv6 还有 `scopeid`（对于链路本地地址，该值为网口的序号，连接时写为 `fe80::…%<scopeid>`）。正在进行重复地址检测的 IPv6 地址，在可用后才计入。
- 事件来自系统的通知（Linux 的 netlink、macOS 的内核事件、Windows 的 IP Helper 通知），不依赖定时轮询，在变化后几十毫秒内触发。同一个线程中的所有 `NetworkInterface` 共用一个系统通知的监听者，该监听者不会阻止进程退出。
- `waitForAddress()` 返回网口已有的地址，或等待网口获得第一个地址；设置了 `timeout` 时，到时仍没有地址会抛出 `NetIfTimeoutException`。
- `close()` 停止跟踪该网口。

### UDP

`createUDPSocket()` 返回该网口上的 UDP 套接字，其方法和事件与 `dgram` 套接字相同：

```typescript
import {type InterfaceUDPSocket, NetworkInterface} from '@lakutata/netif'

const lan: NetworkInterface = new NetworkInterface('eth1')
const socket: InterfaceUDPSocket = await lan.createUDPSocket({port: 5353})
socket.addMembership('224.0.0.251')
socket.on('message', (message, remote) => {
    socket.send(message, remote.port, remote.address)
})
socket.on('error', error => console.error(error))
```

- 在 Linux 上，其套接字（每个地址族一个）绑定在网口上，只接收从该网口进入的数据，包括该网口上的广播和已加入的组播组的数据，无论网口有哪些地址；发出的数据也从该网口发出。在单个网口上运行 DHCP、mDNS、SSDP 正是采用这种方式。
- 在 Windows 和 macOS 上，网口的每个地址各绑定一个套接字；`send()` 从与目标位于同一网段的地址发出。macOS 上绑定在地址上的套接字无法接收广播和组播，因此在 macOS 上调用 `addMembership()` 会抛出 `NetIfNotSupportedException`；Windows 上会在每个地址上加入组播组。`setBroadcast(true)` 在所有系统上都能使套接字发送广播。
- 套接字重新绑定时（地址变化、网口重新插入），广播设置和组播组会重新应用。在此期间到达的数据报会丢失。
- 发往 IPv6 链路本地地址时需要带上作用域，与 `dgram` 相同，例如 `fe80::1%eth1`。
- `port`、`family` 和 `strict` 与 `listen()` 相同；`enforced`、`reason`、`port`、`addresses`、`listening`，以及事件 `listening`、`error`、`enforced` 和 `close` 也是如此。

### 绑定网口的套接字

在 Linux 上，`bindSocket()` 返回一个绑定在网口上的套接字，供需要服务器自行监听的代码使用（服务器的 `address()` 和 `close()` 照常工作）。网口重新插入后不会重新创建该套接字，重新创建由 `listen()` 负责。

```typescript
import {createServer} from 'node:http'
import {type BoundSocket, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const bound: BoundSocket = management.bindSocket({port: 8080, family: 'IPv4', type: 'tcp'})
createServer((request, response) => response.end('ok')).listen({fd: bound.fd})
```

TCP 套接字返回时已在监听，交给 `net.Server` 的 `server.listen({fd})`；UDP 套接字返回时已绑定，交给 `dgram` 套接字的 `socket.bind({fd})`。获得描述符的服务器或套接字即拥有该描述符；不再使用时，请用 `fs.closeSync(fd)` 关闭。macOS 和 Windows 没有这样的套接字，因此在这两个系统上调用 `bindSocket()` 会抛出 `NetIfNotSupportedException`。

### 系统和运行环境

- **Linux**：从 Linux 5.7 起，将套接字绑定到网口无需特权。更早的内核需要进程具有 `CAP_NET_RAW` 能力（对可执行文件执行 `setcap cap_net_raw+ep`，或在 systemd 单元中写入 `AmbientCapabilities=CAP_NET_RAW`）；否则按地址监听，`enforced` 为 `false`，`strict` 会抛出异常。
- **Windows**：弱主机模型按网口设置（`netsh interface ipv4 set interface "<名字>" weakhostreceive=enabled`），某些软件会开启该模型（例如负载均衡软件）。`reason` 会指出是哪个网口的设置使保证失效，以及恢复保证的命令。
- **macOS**：见上面的表格；默认即为 `listen(port, host)` 那样的按地址监听。
- **Bun** 的监听和连接移交与 Node.js 相同，只有三点不同。Bun 的 `https` 服务器对移交而来的连接不执行 TLS，因此在 Bun 上 `listen()` 会拒绝这种服务器（`NetIfNotSupportedException`）。在 Bun 上请改用 `http2.createSecureServer({key, cert, allowHTTP1: true})` 或 `tls.createServer()`，二者都能正常接收连接。Bun 的服务器不会关闭移交而来的空闲长连接（`keepAliveTimeout` 不起作用）。Bun 的 `http` 服务器不能直接使用 `bindSocket()` 的描述符，请将其交给 `net.Server` 或 `dgram` 套接字。
- **Electron**：在主进程中使用。
- **worker 线程**：每个线程都可以使用本包，线程结束时不会因本包而受阻。

### 打包

`lakutata package` 生成的单文件包、可执行文件和安装包都包含编译好的原生插件（`build/Release/netif.node`）。请在每个目标平台上先安装本包，再在该平台上打包。

## API

| 导出 | 说明 |
|---|---|
| `listInterfaces()`、`NetworkInterfaceInfo`、`InterfaceAddress` | 本机的网口及其状态；一个网口（`name`、`index`、`mac`、`up`、`running`、`loopback`、`addresses`）；一个地址（`address`、`family`、`netmask`、`cidr`、`scopeid`） |
| `NetworkInterface`、`InterfaceSelector`、`NetworkInterfaceEvents`、`AddressChange`、`WaitForAddressOptions` | 被跟踪的网口（`list`、`selector`、`present`、`name`、`index`、`mac`、`up`、`running`、`loopback`、`addresses`、`info`、`closed`、`waitForAddress`、`listen`、`createUDPSocket`、`bindSocket`、`close`）；指定网口的方式（名称、`{mac}`、`{index}`）；网口的事件（`change`、`up`、`down`、`added`、`removed`）；地址的变化（`addresses`、`added`、`removed`）；`waitForAddress()` 的选项（`family`、`timeout`） |
| `listenOn()`、`listenOnAll()`、`InterfaceListener`、`ListenOptions`、`InterfaceListenerEvents`、`ListeningAddress` | 在一个或多个网口上监听的服务器：监听器（`server`、`networkInterface`、`enforced`、`reason`、`port`、`listening`、`addresses`、`closed`、`close`），其选项（`port`、`family`、`strict`、`backlog`），其事件（`listening`、`error`、`enforced`、`close`），可以访问该监听器的地址（`address`、`family`、`port`、`scopeid`） |
| `InterfaceUDPSocket`、`UDPSocketOptions`、`InterfaceUDPSocketEvents` | 网口的 UDP 套接字（`send`、`setBroadcast`、`addMembership`、`dropMembership`、`enforced`、`reason`、`port`、`listening`、`addresses`、`closed`、`close`），其选项（`port`、`family`、`strict`），其事件（`message`、`listening`、`error`、`enforced`、`close`） |
| `BoundSocket`、`BindSocketOptions` | 绑定网口的套接字（`fd`、`port`、`family`、`type`），以及 `bindSocket()` 的选项（`port`、`family`、`type`、`backlog`） |

类型声明中的每一项都附有说明和示例。

## 异常

| 异常 | 抛出时机 |
|---|---|
| `NetIfNotFoundException` | 指定的序号没有对应的网口，指定的 MAC 地址由多个网口共用；网口不存在时调用 `bindSocket()` |
| `NetIfNotEnforcedException` | 使用了 `strict`，但系统无法拒绝来自其他网口的连接或数据（运行中保证丢失时，以 `error` 事件发出）；没有绑定网口的权限时调用 `bindSocket()`（Linux 5.7 以前需要 `CAP_NET_RAW`）。消息中说明原因和处理方法 |
| `NetIfNotSupportedException` | 在 Linux 以外的系统上调用 `bindSocket()`；在 macOS（以及没有权限的 Linux）上按地址绑定时调用 `addMembership()`；在 Bun 上监听 `https` 服务器 |
| `NetIfTimeoutException` | `waitForAddress()` 等待超过 `timeout` |
| `NetIfException` | 以上所有异常的基类；被系统拒绝时，`errno` 为系统的错误码（`'EADDRINUSE'`、`'EACCES'` 等）；`'E_NETIF'` 表示本包自身的错误（例如 `waitForAddress()` 等待时 `NetworkInterface` 被关闭） |

选择网口的方式、端口或地址族有误时，抛出 `TypeError`。

## 另见

- [socket(7)](https://man7.org/linux/man-pages/man7/socket.7.html)：Linux 的 `SO_BINDTODEVICE`。
- [Windows 的强主机模型和弱主机模型](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10))。
