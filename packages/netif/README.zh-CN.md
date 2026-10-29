# @lakutata/netif

[English](README.md) | 中文

按网口监听，而不是按地址监听。Node.js 的 `listen(port, host)` 只能按地址监听：管理网口的地址会变（DHCP），开机时可能还没有地址；监听 `0.0.0.0` 又会把服务暴露在所有网口上。用这个包，服务器监听的是“eth1 这个网口”，不管它现在是什么地址：地址变了、网口拔掉再插回，都会自动重新监听；在 Linux 上，从别的网口进来的连接由系统直接挡掉。Node.js 的任何服务器都能用（`http`、`https`、`http2`、`tls`、Express、Fastify），UDP 套接字也可以。这个包还能列出本机的网口和它们的状态，并在网口变化时发出事件。它是一个原生插件，支持 Linux、macOS 和 Windows，在安装这个包时编译。它属于 [lakutata](https://github.com/lakutata/lakutata) 系列，但不需要 lakutata 应用：导入就能直接使用。

## 安装

```shell
npm install @lakutata/netif
```

- 原生插件在安装时编译（node-gyp），所以机器上需要 Python 3 和支持 C++17 的编译器：macOS 上是 Xcode 的命令行工具，Debian、Ubuntu 上是 `build-essential`，Windows 上是 Visual Studio 生成工具（“使用 C++ 的桌面开发”）。Alpine Linux 还需要内核的头文件：`apk add python3 make g++ linux-headers`。编译失败时，安装也会失败。
- 包管理器需要执行这个包的安装脚本。npm 会执行，但可能提示这个脚本“not yet covered by allowScripts”：用 `npm install-scripts approve @lakutata/netif` 记下你允许它执行。Bun 和 pnpm 只为信任的依赖执行，需要先允许它（Bun 在 package.json 的 `trustedDependencies` 里加上它，pnpm 用 `pnpm approve-builds`）；没有允许时，加载这个包会抛出错误，说明怎样编译原生插件。
- Node.js `^22.13.0 || >=24.11.0`。原生插件用的是 Node-API，所以 Bun 和 Electron 的主进程可以直接加载 node-gyp 为 Node.js 编译的插件，不用重新编译。

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

网口可以暂时不存在（USB 网卡还没插上），也可以还没有地址（DHCP 还没完成）：`listenOn()` 会立即返回，等网口能监听了就开始监听。等待期间，监听器会让进程保持运行，就像一个正在监听的服务器那样。

lakutata 的入口（Express、Fastify、各个服务适配器、gRPC、MCP）用 `interface` 选项替你做这件事：`expressHTTPEntrypoint({port: 8080, interface: 'eth1'})`。

### 指定网口

网口可以按名字、MAC 地址或序号指定：

```typescript
import {NetworkInterface} from '@lakutata/netif'

const byName: NetworkInterface = new NetworkInterface('eth1')
const byHardwareAddress: NetworkInterface = new NetworkInterface({mac: '52:54:00:12:34:56'})
const byIndex: NetworkInterface = new NetworkInterface({index: 3})
```

- **名字**：`'eth1'`、`'enp3s0'`、`'en0'`。Windows 上是网络连接的名字（`'以太网 2'`、`'Ethernet 2'`），随系统语言变化。
- **MAC 地址**不随系统给网口起的名字变化，适合用来指定管理网口。如果有几个网口的 MAC 相同（比如网桥和它的成员网口），会抛出 `NetIfNotFoundException`，这时请改用名字。macOS 27 对没有特殊权限的进程，把每个网口的 MAC 都报成 `02:00:00:00:00:00`，所以在这样的 macOS 上网口没有 `mac`，也不能按 MAC 找到。
- **序号**在网口拔掉再插回后会变：指定一个不存在的序号会抛出 `NetIfNotFoundException`；网口拔掉后，这个对象也不会再跟着它。

`listenOn(selector, server, options)` 就是 `new NetworkInterface(selector).listen(server, options)`，网口会一直跟踪到监听器关闭。

### 哪些连接会被挡住

监听网口后，这个网口所在网络的客户端通过它的地址访问服务器，其他网口的地址上不会监听任何东西。但另一个网络的客户端仍然可以把发往这个网口地址的包，从别的网口送进本机（自己加一条经过本机的路由就行）。系统会不会挡住这样的连接，就是 `enforced` 回答的问题：

| | 怎样监听 | `enforced` |
|---|---|---|
| Linux | 套接字绑定在网口上（`SO_BINDTODEVICE`），每个地址族一个，不管网口有哪些地址；新加的地址立刻就能访问 | `true`：内核挡掉从别的网口进来的连接 |
| Windows | 在网口的每个地址上各开一个套接字，地址变化时重新监听 | 同一地址族的其他网口都按强主机模型收包、都没开转发时（默认就是这样）为 `true`：这时 Windows 会丢掉发往某个地址、却从别的网口进来的包（见[强主机模型](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10))） |
| macOS | 在网口的每个地址上各开一个套接字，地址变化时重新监听 | `false`：macOS 从任何网口都接受发往本机地址的包。只有在系统设置为拒绝（`sudo sysctl -w net.inet.ip.check_interface=2`，IPv6 还要 `net.inet6.ip6.check_interface=2`）并且没开转发时才为 `true`（虚拟机或容器共享网络时会打开转发） |

默认按系统允许的最好方式监听：无论如何都不会比用 `listen(port, host)` 按地址监听差，`enforced` 告诉你有没有这层保证（`reason` 说明为什么没有，以及怎样才能有）。加上 `strict: true` 后，保证不了时 `listen()` 抛出 `NetIfNotEnforcedException`；运行中保证丢了，监听器会停下来（触发 `error` 事件），等保证恢复后再继续：

```typescript
import {createServer} from 'node:http'
import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const listener: InterfaceListener = await management.listen(createServer(), {port: 443, strict: true})
listener.on('enforced', enforced => console.log(enforced ? 'guaranteed again' : 'no longer guaranteed'))
```

监听期间会一直跟踪这个保证：Windows 上网口设置的变化会有通知；macOS 的这些设置没有变化通知，会在网口变化时重新读取。

在 Linux 上，绑定到 eth1 的套接字会接受所有从 eth1 进来的连接，不管连接发往本机的哪个地址；`addresses` 列出的是 eth1 自己的地址。

### 服务器和它的监听器

监听器接受连接后，交给服务器（`server.emit('connection', socket)`），服务器像处理自己的连接一样处理它们：请求、长连接、协议升级、TLS 都照常。服务器自己并没有在监听，所以：

- `server.address()` 是 `null`，`server.listening` 是 `false`：请用 `listener.port` 和 `listener.addresses`。
- `server.close()` 不能让监听器停下：请用 `listener.close()`。对一个从没监听过的服务器调用 Node.js 的 `server.close()`，会把 `ERR_SERVER_NOT_RUNNING` 交给它的回调（`promisify` 后是 reject）；`fastify.close()` 不会。
- 同一个服务器可以被监听多次（两个网口、两个端口），每个监听器的连接都交给它。`listenOnAll(['eth1', 'eth2'], server, {port: 8080})` 在多个网口上监听，每个网口一个监听器；其中一个无法监听时，已经开始的都会关闭，并抛出错误。多个网口时端口不能是 0。

Express 请传 `createServer(app)`；Fastify 请在 `await fastify.ready()` 之后传 `fastify.server`：

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
| `port` | 端口。0 表示由系统选一个（见 `listener.port`），重新监听时保持同一个端口 |
| `family` | `'IPv4'`、`'IPv6'` 或 `'both'`（默认）。用 `'both'` 时，系统没有 IPv6 就只监听 IPv4 |
| `strict` | `true`：系统挡不住从别的网口进来的连接时拒绝监听。默认 `false` |
| `backlog` | 还没被接受的连接的队列长度，默认 511 |

`listener.close()` 停止监听后立即返回，不等已经建立的连接结束，这些连接交给服务器处理。`NetworkInterface.close()` 也会关闭它的监听器。

### 网口变化时

| 情况 | Linux（绑定在网口上） | Windows、macOS |
|---|---|---|
| 网口不存在 | 监听器等待，网口出现时开始监听 | 同左 |
| 网口存在、没有地址 | 已经在监听：地址一加上就能访问 | 监听器等待地址 |
| 增加或删除地址 | 什么都不用做 | 开始或停止监听这个地址。新加的 IPv6 地址等它可用后才监听（重复地址检测结束后，大约一秒） |
| 网线拔掉 | 套接字保留，连通后继续可用 | 同左，只要地址还在 |
| 网口拔掉再插回 | 重新监听（序号变了），触发 `listening` 事件 | 按地址重新监听 |
| 端口被占用 | 触发 `error` 事件，1 秒后重试，间隔逐次加倍，最长 30 秒 | 同左 |

无论发生什么，已经建立的连接都交给服务器处理。第一次监听的错误（端口被占用、没有权限监听 1024 以下的端口）会直接抛出；之后的错误是监听器的 `error` 事件：**请给监听器加上 `error` 的监听函数**，就像对 `net.Server` 那样（没有的话，这个错误会被抛出，导致进程退出）。

### 网口和它们的变化

`listInterfaces()` 列出本机所有网口，包括没有地址的，并带上它们的状态：比 `os.networkInterfaces()` 更全，后者只列出有地址的网口，也没有状态。`NetworkInterface` 跟踪一个网口：它现在的状态，以及每次变化时的事件。

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

- `present`、`name`、`index`、`mac`、`up`（是否启用）、`running`（是否连通）、`loopback`、`addresses` 和 `info`（以上全部）给出现在的状态；网口不存在时，`present` 是 `false`，`addresses` 是空数组。
- 地址只包括可用的，写法和 `os.networkInterfaces()` 相同：`address`、`family`、`netmask`、`cidr`，IPv6 还有 `scopeid`（链路本地地址是网口的序号，连接时写成 `fe80::…%<scopeid>`）。正在做重复地址检测的 IPv6 地址，等它可用后才算。
- 事件来自系统的通知（Linux 的 netlink、macOS 的内核事件、Windows 的 IP Helper 通知），不靠定时轮询，变化后几十毫秒内触发。同一个线程里的所有 `NetworkInterface` 共用一个系统通知的监听者，它不会让进程一直不退出。
- `waitForAddress()` 返回网口已有的地址，或者等到它的第一个地址；设了 `timeout` 时，到时还没有地址会抛出 `NetIfTimeoutException`。
- `close()` 停止跟踪这个网口。

### UDP

`createUDPSocket()` 返回这个网口的 UDP 套接字，方法和事件和 `dgram` 的套接字一样：

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

- 在 Linux 上，它的套接字（每个地址族一个）绑定在网口上：只接收从这个网口进来的数据，包括这个网口上的广播和已加入的组播组，不管网口有哪些地址；发出的数据也从这个网口出去。在单个网口上做 DHCP、mDNS、SSDP 就是这样。
- 在 Windows 和 macOS 上，网口的每个地址各绑一个套接字；`send()` 从和目标同一网段的那个地址发出。macOS 上绑定在地址上的套接字收不到广播和组播，所以在那里调用 `addMembership()` 会抛出 `NetIfNotSupportedException`；Windows 上会在每个地址上加入组播组。`setBroadcast(true)` 在哪里都能让套接字发送广播。
- 套接字重新绑定时（地址变了、网口插回），广播设置和组播组会重新应用。这期间到达的数据报会丢失。
- 发往 IPv6 链路本地地址时要带上作用域，和 `dgram` 一样：`fe80::1%eth1`。
- `port`、`family` 和 `strict` 与 `listen()` 的相同；`enforced`、`reason`、`port`、`addresses`、`listening`，以及事件 `listening`、`error`、`enforced` 和 `close` 也一样。

### 绑定网口的套接字

在 Linux 上，`bindSocket()` 返回一个绑定在网口上的套接字，给需要服务器自己监听的代码用（服务器的 `address()` 和 `close()` 照常工作）。网口插回后不会重新创建这个套接字：那是 `listen()` 做的事。

```typescript
import {createServer} from 'node:http'
import {type BoundSocket, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const bound: BoundSocket = management.bindSocket({port: 8080, family: 'IPv4', type: 'tcp'})
createServer((request, response) => response.end('ok')).listen({fd: bound.fd})
```

TCP 套接字返回时已经在监听，交给 `net.Server` 的 `server.listen({fd})`；UDP 套接字返回时已经绑定，交给 `dgram` 套接字的 `socket.bind({fd})`。拿到描述符的服务器或套接字就拥有它；不用的话请用 `fs.closeSync(fd)` 关掉。macOS 和 Windows 没有这样的套接字：在那里调用 `bindSocket()` 会抛出 `NetIfNotSupportedException`。

### 系统和运行环境

- **Linux**：从 Linux 5.7 起，把套接字绑定到网口不需要特权。更早的内核需要进程有 `CAP_NET_RAW` 能力（对可执行文件执行 `setcap cap_net_raw+ep`，或在 systemd 单元里写 `AmbientCapabilities=CAP_NET_RAW`）；没有的话，就按地址监听，`enforced` 为 `false`，`strict` 会抛出异常。
- **Windows**：弱主机模型是按网口设置的（`netsh interface ipv4 set interface "<名字>" weakhostreceive=enabled`），有些软件会打开它（比如负载均衡软件）。`reason` 会说出是哪个网口的设置让保证失效，以及恢复它的命令。
- **macOS**：见上面的表格；默认就是 `listen(port, host)` 那样的按地址监听。
- **Bun** 的监听和连接交接和 Node.js 一样，只有三点不同。Bun 的 `https` 服务器收到交过来的连接时不做 TLS，所以在 Bun 上 `listen()` 会拒绝它（`NetIfNotSupportedException`）：在 Bun 上请改用 `http2.createSecureServer({key, cert, allowHTTP1: true})` 或 `tls.createServer()`，它们都能正常接收。Bun 的服务器不会关闭交给它的空闲长连接（`keepAliveTimeout` 不起作用）。Bun 的 `http` 服务器不能直接使用 `bindSocket()` 的描述符：请交给 `net.Server` 或 `dgram` 套接字。
- **Electron**：在主进程里使用。
- **worker 线程**：每个线程都可以使用这个包，线程结束时不会被它拖住。

### 打包

`lakutata package` 生成的打包文件、可执行文件和安装包会带上编译好的原生插件（`build/Release/netif.node`）：请在每个目标平台上先安装这个包，再在那里打包。

## API

| 导出 | 说明 |
|---|---|
| `listInterfaces()`、`NetworkInterfaceInfo`、`InterfaceAddress` | 本机的网口和它们的状态；一个网口（`name`、`index`、`mac`、`up`、`running`、`loopback`、`addresses`）；一个地址（`address`、`family`、`netmask`、`cidr`、`scopeid`） |
| `NetworkInterface`、`InterfaceSelector`、`NetworkInterfaceEvents`、`AddressChange`、`WaitForAddressOptions` | 被跟踪的网口（`list`、`selector`、`present`、`name`、`index`、`mac`、`up`、`running`、`loopback`、`addresses`、`info`、`closed`、`waitForAddress`、`listen`、`createUDPSocket`、`bindSocket`、`close`）；指定网口的方式（名字、`{mac}`、`{index}`）；它的事件（`change`、`up`、`down`、`added`、`removed`）；地址的变化（`addresses`、`added`、`removed`）；`waitForAddress()` 的选项（`family`、`timeout`） |
| `listenOn()`、`listenOnAll()`、`InterfaceListener`、`ListenOptions`、`InterfaceListenerEvents`、`ListeningAddress` | 在一个或多个网口上监听的服务器：监听器（`server`、`networkInterface`、`enforced`、`reason`、`port`、`listening`、`addresses`、`closed`、`close`），它的选项（`port`、`family`、`strict`、`backlog`），它的事件（`listening`、`error`、`enforced`、`close`），能访问到它的地址（`address`、`family`、`port`、`scopeid`） |
| `InterfaceUDPSocket`、`UDPSocketOptions`、`InterfaceUDPSocketEvents` | 网口的 UDP 套接字（`send`、`setBroadcast`、`addMembership`、`dropMembership`、`enforced`、`reason`、`port`、`listening`、`addresses`、`closed`、`close`），它的选项（`port`、`family`、`strict`），它的事件（`message`、`listening`、`error`、`enforced`、`close`） |
| `BoundSocket`、`BindSocketOptions` | 绑定网口的套接字（`fd`、`port`、`family`、`type`），以及 `bindSocket()` 的选项（`port`、`family`、`type`、`backlog`） |

类型声明里有每个声明的说明和示例。

## 异常

| 异常 | 什么时候 |
|---|---|
| `NetIfNotFoundException` | 指定的序号没有网口，指定的 MAC 有几个网口；网口不存在时调用 `bindSocket()` |
| `NetIfNotEnforcedException` | 用了 `strict`，但系统挡不住从别的网口进来的连接或数据（运行中保证丢失时，是一个 `error` 事件）；没有绑定网口的权限时调用 `bindSocket()`（Linux 5.7 以前要 `CAP_NET_RAW`）。消息里说明原因和怎么办 |
| `NetIfNotSupportedException` | 在 Linux 以外调用 `bindSocket()`；在 macOS（以及没有权限的 Linux）上按地址绑定时调用 `addMembership()`；在 Bun 上监听 `https` 服务器 |
| `NetIfTimeoutException` | `waitForAddress()` 超过了 `timeout` |
| `NetIfException` | 以上所有异常的基类；系统拒绝时，`errno` 是系统的错误码（`'EADDRINUSE'`、`'EACCES'`…）；`'E_NETIF'` 是这个包自己的错误（比如 `waitForAddress()` 等待时 `NetworkInterface` 被关闭） |

选择网口的方式、端口或地址族写错时，抛出 `TypeError`。

## 另见

- [socket(7)](https://man7.org/linux/man-pages/man7/socket.7.html)：Linux 的 `SO_BINDTODEVICE`。
- [Windows 的强主机模型和弱主机模型](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10))。
