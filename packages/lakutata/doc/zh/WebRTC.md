# Lakutata WebRTC

WebRTC 使两端以点对点方式直接连接。浏览器、Electron 应用和 Node.js 进程之间交换数据和音视频时无需服务器转发，位于 NAT 和防火墙之后也能建立连接。`@lakutata/webrtc` 包提供这些连接所需的全部周边功能：使两端相互认识的信令、供有此需要的网络使用的 STUN 和 TURN 服务器、供成员众多的房间使用的媒体服务器、Node.js 端的对等连接，以及供浏览器使用的客户端。该包使用 TypeScript 编写，不含原生代码，不属于 `lakutata`：

```bash
npm install lakutata @lakutata/webrtc
```

| 入口 | 运行环境 | 提供的内容 |
|---|---|---|
| `@lakutata/webrtc` | Node.js、Electron 的主进程、Bun | `Signaling`、`SignalingController`、`TURNServer`、`SignalingClient`、`PeerConnection`、`PeerThreads`、`MediaTrack`、`SFU`、`WHIP`、`WHIPController`、`WHEP`、`WHEPController`、`Cluster`、`webrtcServiceEntrypoint`、`PeerServiceProxy`、`ChunkedChannel` |
| `@lakutata/webrtc/client` | 浏览器、Electron 的渲染进程 | `SignalingConnection`、`PeerServiceProxy`、`ChunkedChannel`、协议的类型 |

浏览器入口只使用浏览器的接口；前端安装的是同一个包，框架不会随之安装。

## 1. 连接是怎么建立的

两端在知道如何找到对方之前无法建立连接。每一端通过 **offer** 或 **answer** 描述自身（编解码器、密钥、数据通道），并列出其**候选地址**，即其他端可能借以找到该端的地址。候选地址包括本地地址、STUN 服务器所见的公网地址，以及 TURN 服务器上的一个地址。其他方式均无法连通时，由 TURN 服务器转发该端的流量。这些消息经由两端都已连接的一台服务器传递，这就是**信令**。两端收到这些消息后，成对地测试候选地址（ICE），保留其中可用的一对，再对连接加密（DTLS）。此后，数据通道即可双向传输消息，既可以可靠有序，也可以不作此要求；轨道则传输音视频。

本包的信令以**房间**为单位：客户端加入房间，获取已在房间中的成员，每两个成员之间相互交换 offer、answer 和候选地址。其余工作均自动完成：

- offer 和 answer 按照 W3C 的“完美协商”（perfect negotiation）交换。任何一方都可以随时添加数据通道和轨道，双方也可以同时添加。
- 连接失败时，或者断开超过 5 秒时，会自动重启 ICE。
- 信令连接断开时，点对点连接保持不变；客户端重新连接后，会重新加入其原先所在的房间。
- 成员加入房间时获取 ICE 服务器（附带 TURN 凭据），并在凭据到期前获取新的凭据。

## 2. 服务端

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'
import {buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        turn: buildTURNServerOptions({publicAddress: '203.0.113.10', relayPortRange: [49160, 49200], secret: process.env.TURN_SECRET}),
        signaling: buildSignalingOptions({
            turn: 'turn',
            //只有 id 以 board- 开头的成员能加入 board 房间
            authorize: (peer, room): boolean => room !== 'board' || peer.peerId.startsWith('board-')
        }),
        //浏览器通过 3000 端口的 Socket.IO 连接，其他客户端通过 3001 端口的 JSON-RPC（WebSocket）连接
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: [socketIOServiceEntrypoint({port: 3000}), jsonRPCServiceEntrypoint({transport: 'websocket', port: 3001})]
        })
    },
    bootstrap: ['turn', 'entrypoint']
}))
```

`SignalingController` 处理信令请求；该控制器按名称 `signaling` 查找组件，组件再按名称 `entrypoint`（即组件的 `entrypoint` 选项）查找入口。该控制器的动作与其他动作一样经过入口的中间件。成员的 ID 是其连接的客户端 ID：Socket.IO 上为 `auth.id`（未提供时取 `id` 请求头），WebSocket 上为 `id` 请求头或查询参数。请通过中间件认证请求，通过 `authorize` 决定谁能加入哪个房间：`(peer, room, context) => boolean | Promise<boolean>`，其参数为成员的 ID 和 metadata，以及该成员所发请求的上下文。

`buildSignalingOptions` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `entrypoint` | `'entrypoint'` | 将事件推送给成员的入口组件 |
| `turn` | — | 一个 `TURNServer` 组件：成员获取该组件的 ICE 服务器和凭据 |
| `iceServers` | `[]` | 附加的 ICE 服务器（其他 STUN 或 TURN 服务器），排在 `turn` 之后 |
| `authorize` | — | 谁能加入哪个房间；未设置时，任何人都能加入任何房间 |
| `maxPeers` | `0` | 一个房间的最大成员数；0 表示不限 |
| `maxMessageSize` | `65536` | 一条信令和一个成员的 metadata 的最大字节数 |
| `maxMessagesPerSecond` | `50` | 一个成员平均每秒最多可发送的信令条数（短时间内允许达到两倍） |
| `heartbeatInterval` | `10000` | 服务端无法察觉断开时，客户端发送心跳的间隔，单位为毫秒 |
| `cluster`、`turnSecret`、`selectTURN` | — | 多个节点（第 13 节） |

不使用控制器时，组件同样可用：`join()`、`signal()`、`leave()` 和 `disconnect()` 供应用自身的代码修改房间，`rooms()` 列出房间。由应用自行加入的成员，其事件通过 `join()` 的 `receive` 选项接收。以 `sfu:` 和 `whip:` 开头的 ID 保留给服务端自行加入的成员（媒体服务器、WHIP 推送的流），客户端使用此类 ID 加入时会被拒绝。

## 3. STUN 和 TURN 服务器

大多数连接可以直接建立，或者借助 STUN 服务器报告的公网地址建立。有些网络（对称 NAT、企业防火墙、移动运营商）只允许中转，即由 TURN 服务器转发连接的流量。`TURNServer` 是运行在应用中的 TURN 服务器：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host` | `'0.0.0.0'` | 监听的地址 |
| `port` | `3478` | UDP 和 TCP 上 STUN 和 TURN 的端口 |
| `udp`、`tcp` | `true` | 是否监听 UDP、TCP |
| `tls` | — | `{cert, key, port}`：TLS 上的 TURN（`turns:`，默认 5349 端口），供只放行 TLS 的网络使用 |
| `publicAddress` | 主机第一个非内部的 IPv4 地址 | 客户端访问该服务器所用的地址 |
| `relayPortRange` | 任意空闲端口 | `[first, last]`：中转使用的 UDP 端口 |
| `secret` | 每次启动时随机生成 | 短时凭据的密钥 |
| `users` | `{}` | 使用固定密码的用户，`{username: password}` |
| `realm` | `'lakutata'` | 凭据的 realm |
| `credentialTtl` | `86400` | 短时凭据的有效期，单位为秒；凭据过期后，用其建立的中转仍正常工作 |
| `maxAllocations` | 不限 | 同时存在的中转的最大数量 |
| `workers` | `0` | 为客户端提供服务的工作线程，用于利用更多的核（仅限 Linux；见下文） |

短时凭据遵循 coturn 的 REST API：用户名为 `<expiry>:<user>`，密码为 `base64(HMAC-SHA1(secret, username))`，持有密钥的服务器无需保存凭据即可校验。`turn.iceServers(user)` 给出一个客户端的 ICE 服务器和凭据，`turn.credentials(user)` 只给出凭据，`createTURNCredentials(secret, user, ttl)` 为其他 TURN 服务器（配置了 `use-auth-secret` 的 coturn）生成凭据，`turn.allocations` 是正在使用的中转数量。

### 多核

默认情况下，服务器在主线程上中转流量。以下是在 Apple M4 和 Node.js 24 上测得的结果。一个数据通道的两端都经该服务器中转（因此服务器对每个包要转发两次）：16 KiB 的消息约 38 MiB/s，每 GiB 耗费 27 秒 CPU；100 字节的消息每秒 365,000 条，每条耗费 2.8 微秒 CPU。另有其他客户端的 500 个空闲分配时，每个包的开销不变。

设为 `workers: 3` 时，由三个工作线程为客户端提供服务。这些线程的监听套接字共用服务器的端口（`SO_REUSEPORT`），系统根据客户端的地址和端口将每个客户端固定交给一个线程，由该线程中转客户端的流量。各线程的分配合计计入 `maxAllocations`，`relayPortRange` 会划分给各个线程分别使用。只有 Linux 允许线程共用端口；在其他系统上，服务器在主线程上中转，并在调试消息（`webrtc/turn`）中说明这一点。某个线程停止时（只有程序缺陷会导致线程停止），其分配随之丢失，随后该线程会被重新启动。在此期间，系统先将 UDP 客户端重新分配给其余线程，之后再分配给全部线程，因此大多数客户端会发现自身的分配已经丢失，如同 TURN 服务器重启过一样；其他线程上 TCP 和 TLS 的连接不受影响。

在同一台 Mac 上的 arm64 Linux 虚拟机中（Docker Desktop，10 个核），三个连接同时经该服务器中转（六个客户端）：

| 服务器 | 中转的 100 字节消息 | 每条消息的 CPU |
|---|---|---|
| 主线程 | 每秒 460,000～550,000 条 | 1.9～2.3 微秒 |
| 3 个工作线程 | 六次中有五次为每秒 510,000～820,000 条，另一次为 220,000 条 | 2.4～3.8 微秒，另一次为 9 微秒 |

系统按客户端的地址和端口分配，不考虑负载。只有六个客户端时，经常有线程一个客户端也未分到，或者分到两倍的份额。因此大消息的吞吐量每次测试都不相同，介于 34～79 MiB/s 之间，主线程则为 46～50 MiB/s；客户端越多，各线程的分配越均匀。每个线程约占用 15 MiB。在该虚拟机中，一个工作线程每个核中转的消息比主线程少四分之一到三分之一；在 macOS 上，两者的开销相同。

## 4. 浏览器

```typescript
import {io} from 'socket.io-client'
import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'

const signaling: SignalingConnection = new SignalingConnection(io('https://meet.example.com', {auth: {id: 'alice'}}))
const room: Room = await signaling.join('room-1', {metadata: {name: 'Alice'}})
room.on('peer', (peer: Peer): void => {
    //无序、不可靠：丢了的位置不再重发
    const positions: RTCDataChannel = peer.createDataChannel('positions', {ordered: false, maxRetransmits: 0})
    positions.addEventListener('open', (): void => positions.send(JSON.stringify({x: 1, y: 2})))
    peer.on('datachannel', (channel: RTCDataChannel): void => {
        channel.addEventListener('message', (event: MessageEvent): void => console.log(peer.id, channel.label, event.data))
    })
    peer.on('connectionstatechange', (state: string): void => console.log(peer.id, state))
})
room.on('peer-left', (peer: Peer): void => console.log(`${peer.id} left`))
```

`SignalingConnection` 接收应用自身的连接：

- Socket.IO 的 socket（`socket.io-client` 的 `io()`）：成员的 ID 是该 socket 的 `auth.id`，Socket.IO 会自行重连；
- 一个使用 JSON-RPC 的 `WebSocket`，成员的 ID 是其 URL 中的 `id` 查询参数；
- 一个创建该 `WebSocket` 的函数，以便断开后重新连接（先等待 1 秒，之后每次加倍，最长 30 秒）：`new SignalingConnection(() => new WebSocket('wss://meet.example.com/rpc?id=alice'))`。

该类的选项：`iceTransportPolicy`（`'relay'` 表示只使用 TURN 中转）、`configuration`（`RTCPeerConnection` 的附加选项）、`createPeerConnection`（`RTCPeerConnection` 的其他实现）、`timeout`（请求的超时时间，默认 15 秒）。

房间为其他每个成员发出 `peer` 事件：先是已在房间中的成员，然后是每个新加入的成员。之后添加的监听函数会立即为每个已有成员各调用一次。在有媒体服务器的房间中，要等到与服务器的连接完成第一次 offer 和 answer 的交换后，才会发出 `peer` 事件，从而避免在监听函数中创建的通道与这一 offer 发生冲突。`room.publish(track, stream)` 将一条轨道发送给每个成员（第 8 节）；房间有媒体服务器时，`room.sfu` 是媒体服务器的 ID（第 9 节）。`Peer` 具有成员的 `id`、`metadata`、通往该成员的连接 `connection`（一个 `RTCPeerConnection`，可用于读取统计信息），以及 `createDataChannel()`、`pause()` 和 `resume()`（暂停、恢复接收成员的某条轨道）、`restartIce()` 和 `close()`。该对象会发出 `datachannel`、`track`、`connectionstatechange`、`metadata`（成员带着新的 metadata 重新加入）、`error` 和 `close` 事件。某个 Peer 关闭时，房间发出 `peer-left`，表示成员已离开，或者连接已彻底断开。

双方都可以创建通道，每一端通过 `datachannel` 获取对方创建的通道。双方只希望共用一个通道时，两端都使用 `negotiated: true` 和相同的 `id` 创建该通道。

在 Electron 中，渲染进程使用 `@lakutata/webrtc/client`，自行连接信令；主进程使用 `@lakutata/webrtc`。

## 5. 应用作为成员

`SignalingClient` 使 Lakutata 应用能够通过 Node.js 端的对等连接加入房间。设备、录制程序、机器人或测试都能像浏览器一样加入房间：

```typescript
import {Component} from 'lakutata'
import {type Peer, type PeerChannel, type Room, SignalingClient} from '@lakutata/webrtc'

export class Telemetry extends Component {
    protected async init(): Promise<void> {
        const signaling: SignalingClient = await this.getObject(SignalingClient, {url: 'https://meet.example.com', id: 'device-7'})
        const room: Room = await signaling.join('device-7')
        room.on('peer', (peer: Peer): void => {
            const channel: PeerChannel = peer.createDataChannel('readings')
            const timer: NodeJS.Timeout = setInterval((): void => {
                if (channel.readyState === 'open') channel.send(JSON.stringify({temperature: 21.5}))
            }, 1000)
            peer.on('close', (): void => clearInterval(timer))
        })
    }
}
```

`http:` 或 `https:` 的 URL 使用 Socket.IO（需要安装 `socket.io-client`）。`ws:` 或 `wss:` 的 URL 通过 Node.js 22 和 Bun 内置的 `WebSocket` 使用 JSON-RPC，运行环境未内置该类时使用 `ws` 包的 `WebSocket`（需要安装 `ws`）。该客户端的选项：`url`、`id`（默认为随机的 UUID）、`path`（Socket.IO 的路径）、`auth`（Socket.IO 握手的附加字段，例如令牌）、`timeout`，以及其连接的选项（`iceTransportPolicy`、`icePortRange`、`iceAdditionalHostAddresses`、`codecs`、`threads`）。客户端的生命周期类型为 `@Transient`，即每次 `getObject()` 都会得到一个新的客户端；`close()` 会离开客户端所在的房间并断开连接。

### 调用应用的动作

`webrtcServiceEntrypoint()` 使应用所在房间中的成员能够通过与应用之间的点对点连接，调用应用的服务动作（`@ServiceAction`）。例如，另一个网络中的浏览器可以直接调用设备上的动作，调用不经过服务器。这是入口 `service` 通道的一种适配器，与 [Service Calls](ServiceCalls.md) 中的适配器一样。动作的输入校验、访问控制和中间件照常生效，同一组动作也可以同时通过 Socket.IO 或 JSON-RPC 提供。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {webrtcServiceEntrypoint} from '@lakutata/webrtc'

class DoorController extends Controller {
    @ServiceAction({method: 'door.open'})
    public async open(input: {door: string}): Promise<string> {
        return `${input.door} is open`
    }
}

Application.run({
    id: 'door.device',
    name: 'Door',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [DoorController],
            //设备以成员 door-7 的身份加入房间 door-7
            service: webrtcServiceEntrypoint({
                signaling: {url: 'https://meet.example.com', id: 'door-7'},
                rooms: ['door-7']
            })
        })
    },
    bootstrap: ['entrypoint']
})
```

房间中的成员创建一条标签为 `service`、通往设备的数据通道，再通过该通道使用 `PeerServiceProxy` 发起调用。本包的两个入口都导出了 `PeerServiceProxy`：

```typescript
import {PeerServiceProxy, type Peer, type Room} from '@lakutata/webrtc/client'

declare const room: Room
room.on('peer', (peer: Peer): void => {
    if (peer.id !== 'door-7') return
    const door: PeerServiceProxy = new PeerServiceProxy(peer.createDataChannel('service'))
    door.on('opened', (by: string): void => console.log(`opened by ${by}`))
    door.invoke({method: 'door.open', door: 'front'}).then((result: string): void => console.log(result))
})
```

- `invoke(input, timeout)` 将输入的 `method` 作为 JSON-RPC 请求的方法、其余字段作为参数发出（如需改用其他字段，请将两端的 `methodField` 设为同一字段），并返回动作的结果。调用失败时抛出 `PeerServiceError`：其 `errno` 是动作所抛错误的 `errno`（`E_ACCESS_DENY`、`E_INVALID_VALUE` 等），`code` 是 JSON-RPC 的错误码，`data` 是完整的错误对象；未收到响应时，`errno` 为 `E_PEER_SERVICE_TIMEOUT`（默认等待 10 分钟）或 `E_PEER_SERVICE_CLOSED`。转换为 JSON 后超过 10 MiB 的请求（代理的 `maxRequestSize`，与适配器的 `limit` 相同）不会发出，而是直接以 `E_PEER_SERVICE_TOO_LARGE` 失败。在通道打开之前发出的调用会等待通道打开。
- `this.context.clientId` 是调用方的成员 ID。`webrtcRequestOfContext(this.context)` 给出调用方的 `peer`（包括其 metadata），以及调用所经过的 `room` 和数据通道 `channel`。`entrypoint.notify(memberId, event, ...args)` 将事件推送到该成员的通道，`broadcast()` 推送到所有通道；代理通过 `on`、`once`、`off` 接收这些事件。
- 应用启动完成后才会加入房间，因此信令服务器可以运行在同一个应用中。无法加入的房间会报告给 `onError`（默认写入应用的日志），并在 1 秒后重试，之后每次间隔加倍，最长 10 秒；被信令拒绝的房间不再重试。
- 通道关闭时（成员已离开），该通道上进行中的请求会被中止，动作的 `this.signal` 随之触发。应用停止时，新的请求以错误码 `-32001` 失败，进行中的请求照常应答，随后通道关闭。
- 与其他服务适配器一样，该适配器提供其入口的所有服务动作，仅信令的动作除外。仅供成员调用的动作请放在单独的入口中，或者通过规则、中间件限制。其他标签的通道由应用自行处理。
- 在有媒体服务器的房间中，通道经过服务器，服务器能够看到消息；只应由双方看到的调用，请使用没有媒体服务器的房间。

`webrtcServiceEntrypoint()` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `signaling` | — | 由适配器自行创建的 `SignalingClient` 的选项，适配器停止时关闭该客户端 |
| `client` | — | 代替 `signaling`：一个返回应用自身客户端的函数，用于应用本身也要使用该客户端的情况（ID 相同的两个客户端会在房间中相互顶替）；适配器不会离开该客户端的房间，也不会关闭该客户端 |
| `rooms` | — | 允许其成员发起调用的房间；客户端已加入的房间不会再次加入，直接提供服务（`metadata` 选项对其不适用） |
| `metadata` | — | 应用在其加入的房间中的 metadata |
| `label` | `'service'` | 承载调用的通道的标签 |
| `limit` | 10 MiB | 请求的最大大小；更大的请求以错误码 `-32600` 应答 |
| `methodField`、`toPattern`、`positionalParams` | `'method'` | 请求如何对应到动作，与 `jsonRPCServiceEntrypoint()` 相同 |
| `onError` | 应用的日志 | 无法加入房间时，以该错误为参数调用此函数 |

成员 ID 的可信程度取决于信令服务器。服务器以其所知的 ID 转发每个成员的信号，因此一个成员无法冒充另一个成员；但该 ID 是成员连接服务器时的客户端 ID，由客户端自行提供，metadata 同样由成员自行提供。在动作依据 `clientId` 决定谁能调用之前，应先让信令服务器核实其客户端：通过中间件认证，通过 `authorize` 决定谁能加入哪个房间（第 2 节）。

## 6. 不用信令的对等连接

`PeerConnection` 的接口与 `RTCPeerConnection` 一致，因此浏览器的代码在 Node.js 中同样可用，并可配合任何信令方式：HTTP 请求、二维码、消息队列。其事件有两种写法：一是 `addEventListener` 和 `on…` 属性，收到的是事件对象；二是 `on()`，收到的是事件的值（`on('datachannel', (channel) => …)`）。

```typescript
import {Component} from 'lakutata'
import {PeerConnection, type PeerChannel, type SignalingCandidate, type SignalingDescription} from '@lakutata/webrtc'

export class Echo extends Component {
    //回答通过 HTTP 请求收到的 offer，answer 里带上全部候选地址
    public async answer(offer: SignalingDescription): Promise<SignalingDescription | null> {
        const connection: PeerConnection = await this.getObject(PeerConnection, {iceServers: [{urls: 'stun:stun.example.com:3478'}]})
        connection.on('datachannel', (channel: PeerChannel): void => {
            channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(data.toString()))
        })
        await connection.setRemoteDescription(offer)
        await connection.setLocalDescription()
        await new Promise<void>((resolve: () => void): void => {
            connection.on('icecandidate', (candidate: SignalingCandidate | null): void => {
                if (!candidate) resolve()
            })
        })
        return connection.localDescription
    }
}
```

该类的选项：`iceServers`、`iceTransportPolicy`，以及供服务器使用的 `icePortRange`（候选地址使用的 UDP 端口，用于在防火墙中放开）和 `iceAdditionalHostAddresses`（额外作为候选地址的地址，例如按相同端口号转发了这些端口的 NAT 的公网地址）。`codecs` 决定音视频使用哪些编码。`headerExtensions: true` 会加上媒体服务器所需的 RTP 头部扩展。借助这些扩展，两端都根据对方的反馈估计自身发送时的可用带宽（没有这些扩展时，浏览器只能依据丢包情况估计，码率从很低的水平开始，且上升缓慢）。`PeerChannel` 可以发送字符串和二进制数据；收到的二进制消息为 `Buffer`，`binaryType` 为 `'arraybuffer'` 时为 `ArrayBuffer`。`threads` 使连接在工作线程中运行（见下文）。

### 多核

连接默认在主线程中运行其 ICE、DTLS、SCTP 和 SRTP。为连接指定一个 `PeerThreads` 组件的名称（即连接的 `threads` 选项；`SignalingClient` 也有该选项，用于连向其他成员的连接）后，这些协议便在该组件的某个工作线程中运行，而连接对象、连接的事件和其通道上的消息仍在主线程中。使用该连接的代码无需修改。连接的方法会被转到线程中执行，在线程中完成后才返回；连接的各项状态是线程最近一次报告的状态，随连接的事件和每个方法的应答一并送达。连接所接收轨道的包在被读取或转发时送往主线程，其所发送轨道的包则送往线程。

```typescript
import {Application} from 'lakutata'
import {buildPeerThreadsOptions, type PeerChannel, PeerConnection} from '@lakutata/webrtc'

Application
    .run(() => ({
        id: 'gateway.app',
        name: 'Gateway',
        components: {
            //最多四个线程，需要时才启动
            peerThreads: buildPeerThreadsOptions({threads: 4})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        //它的引擎在其中一个线程里运行
        const connection: PeerConnection = await app.getObject(PeerConnection, {threads: 'peerThreads'})
        const channel: PeerChannel = connection.createDataChannel('data')
        channel.on('open', (): void => channel.send('hello'))
    })
```

线程在需要时才启动。新的连接交给一个没有连接的线程（线程数少于 `threads` 时会启动一个新线程，该选项默认为核数减一），否则交给连接最少的线程。连接始终留在其所在的线程中；某个线程停止时（只有程序缺陷会导致线程停止），其上的连接会失败（先 `failed`，再 `closed`），该线程会为之后的连接重新启动。`resourceLimits` 限制每个线程的堆，与媒体服务器的 `workerResourceLimits` 相同（Bun 会忽略此选项）。收到的消息在送往主线程的途中仍占用接收窗口，主线程读取后才归还，因此主线程读取得慢时，对方的发送也会随之减慢，与不使用线程时相同。两个线程之间在途的 RTP 包每个连接每个方向最多 2 MiB，超出的部分会被丢弃，如同 UDP 缓冲区已满一样。

以下是在 Apple M4 和 Node.js 24 上测得的结果。同一个进程中的若干对连接通过数据通道互发消息（仓库中的 `packages/webrtc/test-env/bench/threads.mjs`）：

| 对数 | 引擎 | 100 字节的消息 | 每条消息的 CPU | 16 KiB 的消息 |
|---|---|---|---|---|
| 1 | 在主线程 | 每秒 274,000 条 | 4.2 微秒 | 45 MiB/s |
| 1 | 在 2 个工作线程 | 每秒 539,000 条 | 4.5 微秒 | 85 MiB/s |
| 4 | 在主线程 | 每秒 267,000 条 | 4.3 微秒 | 46 MiB/s |
| 4 | 在 4 个工作线程 | 每秒 782,000 条 | 6.2 微秒 | 138 MiB/s |

一对连接的两端在两个线程中同时工作。一对连接的吞吐量是主线程的两倍，每条消息仅多耗费 0.3 微秒 CPU。四对连接放在四个线程中时，吞吐量是主线程的三倍；线程数超过 M4 的四个性能核后，每条消息耗费的 CPU 会增加。在同一台 Mac 上的 arm64 Linux 虚拟机中（Docker Desktop，Alpine），一对连接使用两个线程时每秒传输 414,000 条 100 字节的消息，主线程为 212,000 条。前者每条消息耗费 6.8 微秒 CPU，后者为 5.5 微秒。四对连接为 460,000 条对 222,000 条，每条 10.7 微秒对 5.4 微秒，大消息 70 MiB/s 对 47 MiB/s，CPU 为 2.5 倍。在该虚拟机中，几个线程同时分配内存时，每条消息的开销更大。线程使一个进程能够承载更多连接、利用更多的核，而不是降低每条消息的开销。

在该虚拟机中，传输小消息时每个线程多占用约 100 MiB，传输大消息时约 55 MiB。在 macOS 上，四对连接在四个线程中传输大消息时（138 MiB/s），进程的内存（其物理占用）多数情况下会在第一分钟内上升到 1.5～3.5 GB，然后回落；在一次三分钟的测试中，第一分钟之后保持在 700 MiB 左右。这是因为 macOS 的内存分配器将释放的内存保留了一段时间，并非泄漏。Node.js 每收到一个 UDP 包，都会先分配一个 64 KiB 的缓冲区；几个线程同时以这样的速率收包，而其他小缓冲区仍在使用时，分配器会保留大量已释放的内存。同样的测试在 Linux 上始终保持在 540 MiB 左右；在 macOS 上使用 Bun（Bun 有自身的分配器）时，始终保持在 200 MiB 左右。

## 7. 大消息和文件

数据通道与任何一方之间都能传输 64 KiB 以内的消息；Chrome 和本包的连接能接收 256 KiB 以内的消息。`ChunkedChannel` 消除了这一限制。两端都用该类包装通道后，该类将每条消息切分为 16 KiB 的小块，随通道缓冲区的腾空陆续发送，再在对端重组为原样。该类可以发送字符串、字节和 `Blob`（浏览器中的文件每次只读取一块）：

```typescript
import {ChunkedChannel, type Peer} from '@lakutata/webrtc/client'

declare const peer: Peer
declare const file: File
const transfer: ChunkedChannel = new ChunkedChannel(peer.createDataChannel('files'))
transfer.channel.addEventListener('open', async (): Promise<void> => {
    await transfer.send(JSON.stringify({name: file.name, size: file.size}))
    await transfer.send(file)
})
```

通道必须有序且可靠（默认即是如此）。收到的消息超过 `maxMessageSize`（默认 64 MiB）时会被丢弃，并发出 `error` 事件。

## 8. 音视频

一条轨道传输一个来源的音频或视频。在浏览器中，可以将摄像头和麦克风的轨道发布到房间中：`room.publish()` 将一条轨道发送给每个成员，之后加入的成员也会收到。其他成员在各自的 peer 上通过 `track` 事件获取该轨道，`event.streams` 将同一来源的音频和视频归为一组：

```typescript
import {type Peer, type Room} from '@lakutata/webrtc/client'

declare const room: Room
declare const grid: HTMLElement
const camera: MediaStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true})
for (const track of camera.getTracks()) await room.publish(track, camera)
room.on('peer', (peer: Peer): void => {
    const video: HTMLVideoElement = document.createElement('video')
    video.autoplay = true
    grid.append(video)
    peer.on('track', (event: RTCTrackEvent): void => {
        video.srcObject = event.streams[0]
    })
    peer.on('close', (): void => video.remove())
})
```

`room.unpublish(track)` 停止发送一条轨道，该轨道用过的收发器留给之后发布的轨道使用。`peer.pause(track)` 和 `peer.resume(track)` 暂停和恢复接收某个成员的一条轨道，例如不在屏幕上显示的视频。没有媒体服务器时，直接添加到 `peer.connection` 上的轨道只发送给该成员。

没有媒体服务器时，每个成员的视频需要为其他每个成员各发送一份，这种方式适合成员较少的房间。使用第 9 节的媒体服务器时，每个成员只需发送一份。

Node.js 端不采集、不编码，也不解码。应用的轨道传输的是 RTP 包，即已编码的音视频，来自编码器或另一条连接。

- `new MediaTrack(kind, {codec})` 创建一条待发送的轨道，`writeRtp()` 发送一个包：一个 `RtpPacket`，或者一个包的字节，例如 ffmpeg 和 GStreamer 发往 UDP 端口的数据报。每条连接为这些包换上自身的同步源（SSRC）和负载类型，序号和时间戳则接续之前写入的包连续编排。
- 收到的轨道（`Peer` 或 `PeerConnection` 的 `track` 事件）通过 `rtp` 事件提供对方发来的包；`requestKeyFrame()` 向对方请求关键帧。
- 将收到的轨道添加到另一条连接上后，该轨道的包会转发到那条连接，那条连接的关键帧请求也会转回该轨道的发送方（最多每 500 毫秒一次）。
- 轨道的 `keyframerequest` 事件表示该轨道发往的某个对端需要关键帧。

以下是一个摄像头应用，发送由 ffmpeg 编码的视频：

```typescript
import {createSocket, type Socket} from 'node:dgram'
import {Component} from 'lakutata'
import {MediaTrack, type Room, SignalingClient} from '@lakutata/webrtc'

//ffmpeg -f v4l2 -i /dev/video0 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -tune zerolatency -g 30
//       -bsf:v dump_extra=freq=keyframe -f rtp rtp://127.0.0.1:5004
export class Camera extends Component {
    protected async init(): Promise<void> {
        const video: MediaTrack = new MediaTrack('video', {codec: 'video/H264'})
        const socket: Socket = createSocket('udp4')
        socket.on('message', (datagram: Buffer): void => video.writeRtp(datagram))
        socket.bind(5004)
        const signaling: SignalingClient = await this.getObject(SignalingClient, {url: 'https://meet.example.com', id: 'camera-3'})
        const room: Room = await signaling.join('camera-3')
        await room.publish(video, 'camera-3')
    }
}
```

观看方需要从关键帧开始解码。请让编码器每一两秒生成一个关键帧（ffmpeg 的 `-g`），或者在编码器支持时，收到 `keyframerequest` 后即生成一个关键帧。码流过滤器 `dump_extra` 将 H.264 的参数放在每个关键帧之前，浏览器需要从该位置读取这些参数。

以下应用将某个成员的摄像头转发给之后加入的观看方，每个观看方从应用而非摄像头获取视频（第 9 节的媒体服务器会为房间中的每个成员完成这项工作）：

```typescript
import {Component} from 'lakutata'
import {type MediaTrack, type Peer, type PeerTrackEvent, type Room, SignalingClient} from '@lakutata/webrtc'

//摄像头的页面只把轨道加到和 relay 的连接上
export class Relay extends Component {
    protected async init(): Promise<void> {
        const signaling: SignalingClient = await this.getObject(SignalingClient, {url: 'https://meet.example.com', id: 'relay'})
        const room: Room = await signaling.join('stage')
        const tracks: MediaTrack[] = []
        const viewers: Set<Peer> = new Set()
        room.on('peer', (peer: Peer): void => {
            if (peer.id === 'camera') {
                peer.on('track', (event: PeerTrackEvent): void => {
                    tracks.push(event.track)
                    for (const viewer of viewers) viewer.connection.addTrack(event.track, 'stage')
                })
                return
            }
            viewers.add(peer)
            for (const track of tracks) peer.connection.addTrack(track, 'stage')
            peer.on('close', (): void => void viewers.delete(peer))
        })
    }
}
```

`PeerConnection` 的方法与 `RTCPeerConnection` 一致：`addTrack(track, ...streamIds)`（对方将同一个流的轨道归为一组）、`addTransceiver(trackOrKind, {direction, streams})`（`recvonly` 表示只收不发）、`removeTrack(sender)`、`getTransceivers()`、`getSenders()` 和 `getReceivers()`；`sender.replaceTrack()` 改为发送另一条轨道，该轨道可使用任一已协商的编码，无需重新协商。支持的编码为：音频 Opus 和 PCMU，视频 VP8、H.264 和 VP9。`PeerConnection` 和 `SignalingClient` 的 `codecs` 选项决定使用哪些编码以及这些编码的顺序；以 `codec` 创建的轨道会使其所在的连接协商这一编码。

## 9. 媒体服务器

没有媒体服务器时，房间中的每个成员都要将自身的轨道发送给其他每个成员：八人开会时，每个人的视频要上传七份，还要维持七条连接。`SFU` 组件是这些房间的媒体服务器（SFU，选择性转发单元）。每个成员只连接该服务器，每条轨道只发送一份，再从该服务器收到其他人的轨道。服务器转发这些包时不解码；无论房间多大，一个成员的视频都只上传一份。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildSFUOptions, buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        turn: buildTURNServerOptions({publicAddress: '203.0.113.10', relayPortRange: [49160, 49200], secret: process.env.TURN_SECRET}),
        signaling: buildSignalingOptions({turn: 'turn'}),
        //会议经过媒体服务器，其他房间仍然点对点
        sfu: buildSFUOptions({
            serves: (room: string): boolean => room.startsWith('meeting-'),
            iceAdditionalHostAddresses: ['203.0.113.10'],
            icePortRange: [40000, 40999]
        }),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['turn', 'sfu', 'entrypoint']
}))
```

客户端无需修改。服务器作为一个 ID 以 `sfu:` 开头的成员加入其服务的每个房间，本包的客户端（浏览器中的 `SignalingConnection`，Node.js 中的 `SignalingClient`）会连接该服务器，而不再相互连接。房间和 peer 的用法与没有媒体服务器时相同：

- `room.publish()` 只向服务器发送一份轨道，由服务器转发给每个成员，之后加入的成员也会收到。
- 每个 peer 发出其对应成员的轨道。这些轨道的 `event.streams` 是与服务器之间那条连接上的流；`room.streamOf(id)` 给出一个流来自哪个成员，以及该流在那个成员自身连接上的 ID。
- `peer.createDataChannel()` 打开一条经过服务器的通道，服务器双向转发该通道的消息。与两个成员直连不同，服务器能够看到这些消息。此类通道不能指定 `protocol`，也不能使用 `negotiated`。
- `peer.pause(track)` 使服务器暂停发送一条轨道，`peer.resume(track)` 使服务器恢复发送。
- `room.sfu` 是服务器的 ID，`peer.connection` 是与服务器之间的连接，所有 peer 共用这一条连接。请通过 `room.publish()` 发布轨道，不要直接添加到该连接上。

`buildSFUOptions` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `signaling` | `'signaling'` | 服务器服务哪个 `Signaling` 组件的房间 |
| `serves` | 所有房间 | `(room) => boolean`：服务哪些房间；其他房间仍为点对点 |
| `select` | 每个成员收到其他人的每条轨道 | `(subscriber, track) => boolean`：一个成员是否接收某条轨道 |
| `maxMembers` | `0` | 所有房间合计的最大成员数，0 表示不限；达到上限后，再加入的成员会被拒绝（`SignalingLimitException`） |
| `codecs` | Opus、PCMU、VP8、H.264、VP9 | 成员可用于发布的编码 |
| `icePortRange`、`iceAdditionalHostAddresses` | | 连接使用的 UDP 端口，以及服务器的公网地址。每条连接（成员、WHIP 的推流、WHEP 的观众）在本机的每个地址上各占用一个端口。端口范围必须足够所有连接使用 |
| `workers` | `0` | 用于转发房间的工作线程数，以利用更多的核 |
| `workerResourceLimits` | V8 的默认限制 | 每个工作线程的堆和栈的上限（`node:worker_threads` 的 `resourceLimits`），可以多耗费一些 CPU 以换取更少的内存（见下文“多核”）；Bun 会忽略这些限制 |
| `cluster`、`selectSFU` | | 多个节点上的媒体服务器（第 13 节） |

对于每个成员和其他人的每条轨道，都会调用一次 `select`；成员带着新的 metadata 重新加入房间时会再次调用，该成员接收哪些轨道以新的返回值为准。`select` 抛出错误时按 `false` 处理，错误记入调试信息（第 15 节）。例如在网络研讨会中，每个人都接收所有人的音频，但只接收主讲人的视频：

```typescript
import {buildSFUOptions, type SFUTrack, type SignalingPeer} from '@lakutata/webrtc'

const sfu = buildSFUOptions({
    select: (subscriber: SignalingPeer, track: SFUTrack): boolean => track.kind === 'audio' || track.peerId.startsWith('speaker-')
})
```

服务器如何转发：

- 服务器不转码。成员只会收到其支持的编码的轨道，对于其他轨道，服务器会发出 `unsupported` 事件。供浏览器使用时，请以 VP8 或 H.264 发布视频。
- 成员的关键帧请求会转给发布者，最多每 500 毫秒一次；有成员开始接收某路视频时，服务器会向发布者请求一个关键帧。发往成员途中丢失的包由服务器重新发送。
- 每条连接都根据对方的反馈估计自身的带宽。浏览器据此调整发往服务器的码率；发往某个成员的带宽持续不足以承载该成员接收的内容时，服务器发出 `congestion` 事件，带宽恢复后再发出一次。服务器按发布时的原样发送每路视频（尚不支持 simulcast）。如需减轻该成员的负担，可以暂停该成员接收的部分视频。
- 成员读取某条通道消息的速度慢于对方发送的速度时，发送方需要等待；服务器最多缓存几兆字节的此类消息。

该组件的事件：成员开始和停止发布一条轨道时，发出 `publish` 和 `unpublish`（参数为一个 `SFUTrack`，包括其 `room`、`peerId`、`id`、`kind`、`codec` 和 `stream`）；成员不支持其应接收的某条轨道的编码时，发出 `unsupported`（房间、成员的 ID、轨道）；`congestion`（房间、成员的 ID、带宽是否不足、估计的码率，单位为比特每秒）。`rooms()` 列出各个房间，以及各房间的成员、轨道和 WHEP 观众。`track(room, peerId, trackId)` 将一条已发布的轨道作为 `MediaTrack` 返回，其 `rtp` 事件给出该轨道的包，可用于录制，或者转发到另一条连接：

```typescript
import {Component} from 'lakutata'
import type {RtpPacket, SFU, SFUTrack} from '@lakutata/webrtc'

export class Recorder extends Component {
    protected async init(): Promise<void> {
        const sfu: SFU = await this.getObject<SFU>('sfu')
        sfu.on('publish', (track: SFUTrack): void => {
            if (track.kind !== 'audio') return
            sfu.track(track.room, track.peerId, track.id)?.on('rtp', (packet: RtpPacket): void => console.log(track.peerId, packet.timestamp))
        })
    }
}
```

### 多核

服务器默认在主线程中转发。设为 `workers: 4` 时，由四个工作线程转发各个房间。每个房间连同其连接和 UDP 端口，整体放在其中一个线程中（即房间开启时所转发的成员和观众最少的线程）；钩子和事件仍在主线程中。`icePortRange` 会划分给各个线程分别使用。某个线程停止时，会关闭该线程上的房间；服务器在另一个线程中重新开启这些房间，这些房间的成员会重新连接到服务器。`rooms()` 显示的是各线程报告的情况，因此线程中发生的变化（例如有观众离开）要稍晚才能看到。

以下是在 Apple M4 和 Node.js 24 上测得的结果。每个发布者发送约 2 Mbit/s 的视频（每秒 200 个 1250 字节的包），成员位于其他进程中。

| 房间 | 待转发的包 | 实际转发 | CPU |
|---|---|---|---|
| 1 个房间，4 个发布者、10 个订阅者，在主线程 | 每秒 7,600 个 | 全部 | 一个核的 45% |
| 4 个房间，每个 12 个发布者、10 个订阅者，在主线程 | 每秒约 92,000 个 | 每秒 86,000～88,000 个 | 145%：主线程满载，其余为垃圾回收 |
| 同样的 4 个房间，4 个工作线程 | 每秒约 92,000 个 | 全部 | 174% |

负载与第一个房间一样轻时，占用一个核的比例取决于系统让核运行的速度，而机器繁忙时核会运行得更快。另有两个核持续繁忙时，同一个房间只占用一个核的 21%。

在同一台 Mac 上的 arm64 Linux 虚拟机中（Docker Desktop，10 个核，成员也在其中运行），主线程转发了 4 个房间的全部包（每秒 93,000 个），占用 160% 个核。4 个线程占用了 380%～390% 个核，在每秒约 94,000 个包中，各次测试转发的数量从 69,000 个到全部不等。在该机器上、在这样的负载下，启用线程得不偿失。

一个线程约占用 22 MiB，启动约需 90 毫秒。在上述负载下，使用线程时进程占用 1.4 GiB 内存，不使用线程时为 0.6 GiB，因为每个线程都有自身的堆，而 V8 为了速度会将其中的新生代设得较大。设置 `workerResourceLimits: {maxYoungGenerationSizeMb: 32}` 后，进程占用 1.0～1.2 GiB，CPU 多耗费约 4%（一个核的 181%，原为 174%）。一条轨道从一个节点转发到另一个节点时（第 13 节），两个节点处理每个包合计约耗费 11 微秒 CPU，即一路这样的视频约占用一个核的 0.2%。

## 10. 用 WHIP 推流

WHIP（RFC 9725）通过一个 HTTP 请求推送一路流。编码器（OBS、GStreamer、ffmpeg）或浏览器将 offer 提交到该路流的 URL，取回 answer 和会话 URL。`WHIP` 组件回答这些 offer。推流开始时，组件发出 `publish` 并附带会话（会话的 `id`、`stream`、`connection` 和 `tracks`）；会话结束时，组件发出 `unpublish`。会话在以下情形结束：推流方删除了会话，会话的连接失败或关闭，或者应用停止。`WHIPController` 是该组件的 HTTP 接口；HTTP 适配器必须将 `application/sdp` 按文本读取（`body.text` 选项）。

```typescript
import {Application, Component} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {buildWHIPOptions, type MediaTrack, type WHIP, type WHIPSession, WHIPController} from '@lakutata/webrtc'

export class Studio extends Component {
    protected async init(): Promise<void> {
        const whip: WHIP = await this.getObject<WHIP>('whip')
        whip.on('publish', (session: WHIPSession): void => {
            session.tracks?.forEach((track: MediaTrack): void => console.log(`${session.stream}: ${track.kind} ${track.codec}`))
        })
        whip.on('unpublish', (session: WHIPSession): void => console.log(`${session.stream} ended`))
    }
}

Application.run(() => ({
    id: 'studio.app',
    name: 'Studio',
    components: {
        whip: buildWHIPOptions({
            authorize: ({stream, token}): boolean => stream === 'live' && token === process.env.WHIP_TOKEN,
            iceAdditionalHostAddresses: ['203.0.113.10'],
            icePortRange: [40000, 40999]
        }),
        studio: {class: Studio},
        entrypoint: buildEntrypoints({
            controllers: [WHIPController],
            http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
        })
    },
    bootstrap: ['studio', 'entrypoint']
}))
```

在 OBS 中，服务选择 WHIP，服务器填写 `https://studio.example.com/whip/live`，再填写 Bearer 令牌；ffmpeg 使用 `-f whip -authorization <令牌> https://studio.example.com/whip/live` 推流（音频必须为立体声，即 `-ac 2`）。会话的轨道提供 RTP 包，这些包可以录制，也可以转发给其他连接（第 8 节）。

| 请求 | 响应 |
|---|---|
| `POST /whip/:stream`，请求体是 offer（`application/sdp`） | `201 Created`：answer、`Location`（会话）、`Link`（ICE 服务器）、`ETag`（其 ICE 会话） |
| `DELETE /whip/:stream/:session` | `200`：会话结束 |
| `OPTIONS` | `204`，附带 CORS 头和 `Accept-Post: application/sdp` |
| `GET` | `204` |
| `PATCH /whip/:stream/:session`，请求体是 SDP 片段（`application/trickle-ice-sdpfrag`） | `204`：推流端的候选地址（Trickle ICE）；`200`：ICE 重启，附带应答片段和新的 `ETag`；`If-Match` 既不是 `*` 也不是会话的 `ETag` 时返回 `412` |

拒绝的情形：`authorize` 拒绝时返回 401，附带 `WWW-Authenticate: Bearer`；请求体不是 `application/sdp`（PATCH 的请求体不是 `application/trickle-ice-sdpfrag`）时返回 415；offer 中没有音视频时返回 400；已有 `maxSessions` 个会话时返回 503；会话不存在时返回 404。会话的 URL 即为结束该会话的凭证。会话的 ID 是随机的，DELETE 和 PATCH 不再执行授权检查。为子类加上 `@Prefix({route: '/live'})`，即可在另一个路径下提供相同的接口。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `authorize` | 无 | `({stream, token}, context) => boolean`：谁能推送哪路流 |
| `turn` | 无 | 一个 `TURNServer` 组件的名称：推流方在 `Link` 头中得到该组件的 ICE 服务器 |
| `iceServers` | `[]` | 提供给推流方的附加 ICE 服务器 |
| `maxSessions` | `100` | 同时存在的最大会话数，`0` 表示不限 |
| `allowOrigin` | `'*'` | 允许哪些来源的浏览器推流 |
| `icePortRange`、`iceAdditionalHostAddresses` | | 服务器的候选地址：服务器的 UDP 端口（每个会话在本机的每个地址上各占用一个端口；设置了 `sfu` 时使用媒体服务器的端口）、服务器的公网地址 |
| `codecs` | Opus、PCMU、VP8、H.264、VP9 | 接受的编码 |
| `sfu` | 无 | 一个 `SFU` 组件的名称：推送的流进入该组件的房间 |
| `roomOf` | 流的名称 | `({stream, token}, context) => string`：一路流进入媒体服务器的哪个房间 |
| `cluster`、`turnSecret`、`selectTURN` | | 多个节点（第 13 节） |

answer 中带有服务器的全部候选地址，服务器收集完毕后才回答。在 NAT 之后或容器中运行时，需要为服务器配置其公网地址，并放开其端口。

配置了 `sfu` 时，推送的流不再交给应用，而是进入媒体服务器（第 9 节）的一个房间：默认为与流同名的房间，`roomOf` 可以指定其他房间。该流作为一个 ID 以 `whip:` 开头的成员加入房间，房间中的成员接收流的轨道，如同接收其他成员的轨道一样，WHEP 观众也能拉取这路流（第 11 节）。此时流的连接由媒体服务器管理，因此会话中没有 `connection` 和 `tracks`，而是该流的 `room` 和 `peerId`；如需获取流的包，请使用 `sfu.track()`。

## 11. 用 WHEP 拉流

WHEP（WebRTC-HTTP Egress Protocol）通过一个 HTTP 请求拉取一路流。播放端提交一个只收不发的 offer，取回 answer 和会话 URL。`WHEP` 组件播放媒体服务器的房间。每个观众接收房间中一个成员的音频和视频，默认为通过 WHIP 推送到该房间的流。观众不是房间的成员，因此成员无法看到观众，一路流可以有很多观众。`WHEPController` 是该组件的 HTTP 接口，路径位于 `/whep` 之下。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions, buildWHIPOptions, WHEPController, WHIPController} from '@lakutata/webrtc'

//OBS 推到 https://live.example.com/whip/concert，浏览器从 https://live.example.com/whep/concert 拉流
Application.run(() => ({
    id: 'live.app',
    name: 'Live',
    components: {
        signaling: buildSignalingOptions(),
        sfu: buildSFUOptions({iceAdditionalHostAddresses: ['203.0.113.10'], icePortRange: [40000, 40999]}),
        whip: buildWHIPOptions({sfu: 'sfu', authorize: ({token}): boolean => token === process.env.WHIP_TOKEN}),
        whep: buildWHEPOptions({maxSessions: 500}),
        entrypoint: buildEntrypoints({
            controllers: [WHIPController, WHEPController],
            http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
        })
    },
    bootstrap: ['sfu', 'entrypoint']
}))
```

浏览器使用自身的 `RTCPeerConnection` 播放，offer 中带上全部候选地址：

```typescript
declare const player: HTMLVideoElement
const connection: RTCPeerConnection = new RTCPeerConnection()
const stream: MediaStream = new MediaStream()
player.srcObject = stream
connection.addEventListener('track', (event: RTCTrackEvent): void => stream.addTrack(event.track))
connection.addTransceiver('audio', {direction: 'recvonly'})
connection.addTransceiver('video', {direction: 'recvonly'})
await connection.setLocalDescription()
await new Promise<void>((resolve: () => void): void => {
    if (connection.iceGatheringState === 'complete') return resolve()
    connection.addEventListener('icegatheringstatechange', (): void => {
        if (connection.iceGatheringState === 'complete') resolve()
    })
})
const response: Response = await fetch('https://live.example.com/whep/concert', {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: connection.localDescription!.sdp})
await connection.setRemoteDescription({type: 'answer', sdp: await response.text()})
```

| 请求 | 响应 |
|---|---|
| `POST /whep/:stream`，请求体是 offer（`application/sdp`） | `201 Created`：answer、`Location`（会话）、`Link`（ICE 服务器）、`ETag`（其 ICE 会话） |
| `DELETE /whep/:stream/:session` | `200`：会话结束 |
| `PATCH /whep/:stream/:session`，请求体是 SDP 片段（`application/trickle-ice-sdpfrag`） | 与 WHIP 相同：观众的候选地址返回 `204`；ICE 重启返回 `200`，附带应答片段；`If-Match` 既不是 `*` 也不是会话的 `ETag` 时返回 `412` |
| `OPTIONS` | `204`，附带 CORS 头和 `Accept-Post: application/sdp` |
| `GET` | `204` |

拒绝的情形：`authorize` 拒绝时返回 401，附带 `WWW-Authenticate: Bearer`；请求体类型不正确时返回 415；offer 中没有音视频，或者媒体服务器不服务该房间时返回 400；已有 `maxSessions` 个会话时返回 503；会话不存在时返回 404。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `sfu` | `'sfu'` | 播放哪个 `SFU` 组件的房间 |
| `roomOf` | 流的名称 | `({stream, token}, context) => string`：一路流来自哪个房间 |
| `select` | 最新的 WHIP 推流，没有时为第一个正在发布的成员 | `({stream, token}, tracks) => string \| undefined`：观众接收哪个成员（返回该成员的 ID） |
| `authorize` | 无 | `({stream, token}, context) => boolean`：谁能拉取哪路流 |
| `maxSessions` | `100` | 本节点同时存在的最大会话数，`0` 表示不限 |
| `allowOrigin` | `'*'` | 允许哪些来源的浏览器拉流 |
| `turn`、`iceServers` | | 在 `Link` 头中提供给观众的 ICE 服务器 |
| `cluster`、`turnSecret`、`selectTURN` | | 多个节点（第 13 节） |

一个观众只接收一个成员：默认为通过 WHIP 推送到房间的最新一路流，没有时为第一个发布音视频的成员。`select` 可以另选一个成员；房间中的轨道每次变化时都会重新调用该函数，函数抛出错误时，观众接收默认的成员。该成员停止发布后，观众在同一条连接上继续接收下一个成员。此时画面会短暂停顿，并从下一个关键帧开始恢复。观众的 offer 决定其接收的内容，即一路音频和一路视频；观众的连接会协商 offer 中服务器同样支持的所有编码，因此之后以其中任何一种编码推送的流也能发送给观众。

组件在回答之后发出 `play`（参数为会话，包括其 `id`、`stream`、`room`、`viewerId` 和 `source`，即该会话正在接收的成员），会话结束时发出 `stop`。会话在以下情形结束：观众删除了会话，会话的连接失败或关闭，或者应用停止。`whep.sessions` 列出本节点的会话，`sfu.rooms()` 统计每个房间的观众数。

## 12. 部署

- **端口。** 放开 UDP 和 TCP 的 3478 端口、UDP 的中转端口（`relayPortRange`），启用了 TLS 上的 TURN 时还需放开 TLS 端口。在容器中需要将这些端口全部发布；指定中转端口范围可以减少需要发布的端口。
- **公网地址。** `publicAddress` 是客户端访问 TURN 服务器所用的地址：主机的公网地址，或者转发这些端口的 NAT 的地址。在局域网中使用默认值即可。
- **应用作为成员。** 对于位于 NAT 之后的服务器，如果 NAT 按相同的端口号转发了 `icePortRange`，请将该服务器的公网地址写入 `iceAdditionalHostAddresses`；否则该服务器与其他客户端一样依靠 TURN 服务器。
- **媒体服务器、WHIP 和 WHEP。** 客户端直接连接这些组件。请放开其 `icePortRange` 的 UDP 端口；NAT 按相同端口号转发这些端口时，请将 NAT 的公网地址写入 `iceAdditionalHostAddresses`。无法连接这些组件的客户端经 TURN 服务器中转。
- **多个实例。** 为这些实例配置 `Cluster`（第 13 节），并为其 TURN 服务器配置相同的 `secret`，使每个实例都接受其他实例生成的凭据。
- **其他 TURN 服务器。** coturn（`use-auth-secret`，`static-auth-secret` 设为相同的密钥）接受 `createTURNCredentials()` 生成的凭据；请将该服务器写入 `Signaling` 的 `iceServers` 选项。
- **HTTPS。** 浏览器在任何页面上都允许使用 WebRTC，但摄像头和麦克风只能在安全页面上使用（HTTPS 或 `localhost`）。
- **UDP 缓冲区。** 连接和 TURN 服务器会为其 UDP 套接字申请 4 MiB 的接收缓冲区。缓冲区过小时，遇到突发的包，或者大量数据到达的速度快于进程读取的速度，就会丢包。Linux 通过 `net.core.rmem_max` 限制该大小，该值在大多数系统上为 208 KiB，因此在 Linux 服务器上需要将其调大（`sysctl -w net.core.rmem_max=4194304`；使用节点网络的 pod 需在节点上调整）。

## 13. 多个实例

应用部署为多个实例时（Kubernetes 部署中的多个 pod、负载均衡之后的多个进程），请为这些实例配置一个 `Cluster`。每个实例是集群中的一个节点，节点之间通过 NATS 或 Redis 通信。将该组件的名称提供给其他组件后，这些组件即可跨节点工作：

- 信令将连接在各个节点上的成员放入同一批房间；
- TURN 服务器将自身的地址和负载通报给其他节点，每个成员获得负载最低的几个 TURN 服务器；
- 媒体服务器共同承载房间：每个成员、每路 WHIP 推流和每个 WHEP 观众都连接到某一个节点的媒体服务器，同一个房间的媒体服务器之间相互转发该房间的轨道；
- WHIP 或 WHEP 会话的 DELETE 和 PATCH 请求无论到达哪个节点，都能结束或修改该会话。

总线上只传输这些消息。音视频和数据仍在客户端与节点之间、各节点的媒体服务器之间直接传输，或者经 TURN 服务器中转。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSignalingOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        cluster: buildClusterOptions({transport: {type: 'nats', servers: process.env.NATS_URL}}),
        signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['signaling', 'entrypoint']
}))
```

| `buildClusterOptions` 的选项 | 默认值 | |
|---|---|---|
| `transport` | （必填） | `{type: 'nats', servers, user, pass, token}`；`{type: 'redis', url}` 或 `{type: 'redis', host, port, username, password, database, tls}`；`{type: 'memory'}` 用于同一进程中的多个应用（测试） |
| `prefix` | `'lakutata.webrtc'` | 主题（NATS）或频道（Redis）的前缀：共用一台服务器的多个集群依靠该前缀相互隔离 |
| `nodeId` | 主机名加一个随机后缀 | 节点的 ID；在 Kubernetes 中，主机名即 pod 的名称 |
| `labels` | `{}` | 其他节点能看到的本节点标签（可用区、地区），可用于选择 TURN 服务器 |
| `heartbeatInterval` | `2000` | 节点向其他节点通报自身仍在线的间隔，单位为毫秒 |
| `requestTimeout` | `5000` | `request()` 和 `requestAll()` 的等待时间，单位为毫秒 |

使用 NATS 需要 `npm install nats`，只需其普通主题即可（无需 JetStream）；使用 Redis 需要 `npm install ioredis`，只用到其频道（`PUBLISH`、`SUBSCRIBE`）。组件在应用启动时连接服务器，无法连接时启动失败（在 Kubernetes 中，pod 会反复重启，直到能够连接为止）；此后连接断开时会自动重连。某个节点连续三个心跳间隔没有消息时，其他节点即认为该节点已下线；节点正常停止时，其他节点会立即得知。

### 跨节点的房间

每个节点将经由自身加入和离开的成员通报给其他节点；某个节点刚上线，或者该节点的消息有丢失时（例如总线重启），其他节点会向该节点索取一份完整的成员列表。发给另一个节点上成员的信令，经由那个节点转发。

- 某个节点停止，或者其他节点无法联系该节点时，该节点上的成员以 `disconnected` 离开房间。这些成员的连接不会断开，客户端重新连接到其他节点后会再次加入。
- 客户端在第一个节点察觉其断开之前就通过另一个节点重新加入时，该客户端会转到新节点上。其他成员看到的是该客户端重新加入，而不是离开。
- `maxPeers` 统计的是所有节点上的成员。每个房间按哈希固定归属于一个节点，由该节点逐个放行成员，因此两个成员同时通过不同节点加入时，不会都占到最后一个名额。有节点加入或离开集群时，部分房间会改归其他节点，恰好在此刻加入的成员可能会使成员数超出上限。
- 负载均衡之后的 Socket.IO：其长轮询将一个客户端的请求逐个发出，这些请求必须全部到达同一个实例。请让客户端使用 `transports: ['websocket']` 连接（只有一条连接，无需会话保持），或者在负载均衡上启用会话保持（sticky session）。

### 集群里的 TURN 服务器

TURN 服务器通过 `cluster` 选项和所有 TURN 服务器共用的 `secret` 加入集群（没有 `secret` 时该服务器不会启动），并且每秒将自身的地址、端口和中转数量通报给其他节点。配置了 `turnSecret` 的 `Signaling`、`WHIP` 和 `WHEP` 组件，会在本节点的 TURN 服务器（`turn`）之后，再将集群中负载最低且未满的两个 TURN 服务器提供给每个客户端。通过 `selectTURN` 可以改用其他选择方式，例如按节点的标签选择：

```typescript
import {buildSignalingOptions, type ClusterTURNServer} from '@lakutata/webrtc'

//id 以 eu- 开头的成员拿到标签为 {region: 'eu'} 的节点上的 TURN 服务器，其他地区以此类推
const signaling = buildSignalingOptions({
    cluster: 'cluster',
    turnSecret: process.env.TURN_SECRET,
    selectTURN: (servers: ClusterTURNServer[], user: string): ClusterTURNServer[] => {
        return servers.filter((server: ClusterTURNServer): boolean => user.startsWith(`${server.labels.region}-`))
    }
})
```

### 集群里的媒体服务器

配置了 `cluster` 后，各节点的媒体服务器共同承载房间：每个媒体服务器的 ID 是 `sfu:` 加上其所在节点的 ID，每个成员连接到某一个节点的媒体服务器。

- 一个房间尽量只放在少数几个节点上。第一个成员分配到其加入时所经过的节点，该节点已满时分配到负载最低的节点；之后的成员在该房间已在使用的节点中，分配到负载最低的那个，这些节点都已满时，分配到所有节点中负载最低的那个。负载均衡将客户端随机分配到各个节点；如果没有这条规则，三个人的会议可能会用到三个节点。
- 通过 `selectSFU`，可以改由应用选择节点，例如选择距离成员最近的节点；该函数选择的节点已满或没有回应时，按默认规则选择。
- 只有信令而没有媒体服务器的节点，会询问负载最低的、有媒体服务器的节点，由该节点选择（`selectSFU` 在该节点上执行）。
- `maxMembers` 是每个节点的上限。成员加入时，如果没有节点可以接收该成员，加入会被拒绝（`SignalingLimitException`）。WHIP 推流和 WHEP 观众也按同样的方式分配节点（观众不计入 `maxMembers`，而由 WHEP 的 `maxSessions` 限制）。
- 每个媒体服务器的事件及其 `rooms()` 只包括本节点上的成员。

```typescript
import {buildSFUOptions, type SFUNode, type SFUPlacement} from '@lakutata/webrtc'

//id 以 eu- 开头的成员分到标签为 {region: 'eu'} 的节点里负载最低的那个，其他地区以此类推
const sfu = buildSFUOptions({
    cluster: 'cluster',
    selectSFU: (placement: SFUPlacement, nodes: SFUNode[]): string | undefined => {
        const region: string = placement.peerId.split('-')[0]
        return nodes
            .filter((node: SFUNode): boolean => node.labels.region === region)
            .sort((a: SFUNode, b: SFUNode): number => a.members - b.members)[0]?.id
    }
})
```

同一个房间的媒体服务器之间相互转发该房间的轨道。只要某个节点上有接收方（被 `select` 选中的成员、观众、`sfu.track()`），一条轨道就会向该节点发送一份，无论该节点上有多少接收方，并且从发布者所在的节点直接发送过去。节点之间与客户端一样使用 WebRTC 连接（DTLS-SRTP），使用各自的 `icePortRange`。分配在不同节点上的两个成员之间的数据通道，会经过两个节点的媒体服务器。

某个节点下线时（节点停止，或者其他节点连续三次未收到其心跳，约 6 秒），该节点的媒体服务器离开其所在的房间。该节点上的成员通过信令重新加入房间，分配到另一个节点的媒体服务器，并重新发布自身的轨道；其他人会看到这些成员的轨道中断几秒。对于更换了节点的成员，其自身的 peer 和其他成员通往此成员的 peer 都会关闭后重新打开，如同成员刷新了页面。`peer` 的监听函数会重新创建各自的通道。如果此时所有节点都已满，客户端不会像第一次 `join()` 那样直接失败，而是先等待 1 秒再重试，之后每次等待时间加倍（最长 10 秒），每次失败时其信令都会发出一个 `error`。重试会一直持续到有节点接收这名成员，或者成员离开房间为止。

WHIP 或 WHEP 会话保存在回答其 POST 请求的节点上，会话的连接则位于为其选定的节点上。会话的 PATCH 和 DELETE 请求可以到达任何节点；PATCH 到达不持有该会话的节点时，需要等待所有节点回应，最长 12 秒。观众默认接收其所在节点最后得知的那路 WHIP 推流。

### 负载均衡后面的 WHIP 和 WHEP

WHIP 或 WHEP 会话保存在回答其 POST 请求的那个节点上。配置了 `cluster` 后，另一个节点的 `WHIP` 或 `WHEP` 组件收到该会话的 DELETE 或 PATCH 请求时，会询问其他节点，由持有该会话的节点处理。`maxSessions` 统计的是每个节点自身的会话。

### Kubernetes 和 k3s

以下清单部署 NATS、信令（两个 pod），以及每个节点上的一个 TURN 服务器和一个媒体服务器。应用只有一个镜像，三种角色由环境变量 `ROLE` 决定：

```typescript
import {Application, type ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSFUOptions, buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

const cluster = buildClusterOptions({transport: {type: 'nats', servers: process.env.NATS_URL}})
const signaling = buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET})
const roles: Record<string, ApplicationOptions['components']> = {
    signaling: {
        cluster: cluster,
        signaling: signaling,
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    //在节点的网络上：用节点的地址，以及节点的 3478 端口和 49160-49200 端口
    turn: {
        cluster: cluster,
        turn: buildTURNServerOptions({
            cluster: 'cluster',
            secret: process.env.TURN_SECRET,
            publicAddress: process.env.PUBLIC_ADDRESS,
            relayPortRange: [49160, 49200]
        })
    },
    //同样在节点的网络上，用节点的 40000-40999 端口；它的信令没有 entrypoint：成员通过信令的 pod 加入，由信令给每个成员分配一个节点的媒体服务器
    sfu: {
        cluster: cluster,
        signaling: signaling,
        sfu: buildSFUOptions({cluster: 'cluster', icePortRange: [40000, 40999], workers: 2})
    }
}
const components: ApplicationOptions['components'] = roles[process.env.ROLE ?? 'signaling']

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: components,
    bootstrap: Object.keys(components ?? {})
}))
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: turn
stringData:
  secret: change-me
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nats
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nats
  template:
    metadata:
      labels:
        app: nats
    spec:
      containers:
        - name: nats
          image: nats:latest
          ports:
            - containerPort: 4222
---
apiVersion: v1
kind: Service
metadata:
  name: nats
spec:
  selector:
    app: nats
  ports:
    - port: 4222
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: signaling
spec:
  replicas: 2
  selector:
    matchLabels:
      app: signaling
  template:
    metadata:
      labels:
        app: signaling
    spec:
      containers:
        - name: signaling
          image: registry.example.com/meet:1.0.0
          env:
            - name: ROLE
              value: signaling
            - name: NATS_URL
              value: nats://nats:4222
            - name: TURN_SECRET
              valueFrom:
                secretKeyRef:
                  name: turn
                  key: secret
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: signaling
spec:
  selector:
    app: signaling
  ports:
    - port: 3000
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: turn
spec:
  selector:
    matchLabels:
      app: turn
  template:
    metadata:
      labels:
        app: turn
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: turn
          image: registry.example.com/meet:1.0.0
          env:
            - name: ROLE
              value: turn
            - name: NATS_URL
              value: nats://nats:4222
            - name: PUBLIC_ADDRESS
              valueFrom:
                fieldRef:
                  fieldPath: status.hostIP
            - name: TURN_SECRET
              valueFrom:
                secretKeyRef:
                  name: turn
                  key: secret
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: sfu
spec:
  selector:
    matchLabels:
      app: sfu
  template:
    metadata:
      labels:
        app: sfu
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: sfu
          image: registry.example.com/meet:1.0.0
          env:
            - name: ROLE
              value: sfu
            - name: NATS_URL
              value: nats://nats:4222
            - name: TURN_SECRET
              valueFrom:
                secretKeyRef:
                  name: turn
                  key: secret
```

- TURN 服务器和媒体服务器运行在所在节点的网络上（`hostNetwork`）。客户端通过节点的地址和端口访问这些服务器。请在节点的防火墙中放开 UDP 和 TCP 的 3478 端口、UDP 的 49160–49200 端口和 UDP 的 40000–40999 端口；各节点的媒体服务器之间也通过 40000–40999 端口相互连接。
- `status.hostIP` 是节点在集群中的地址；客户端能够通过该地址访问节点时（局域网、有公网地址的节点），直接使用该地址即可。位于转发相同端口的云服务商 NAT 之后时，请将每个节点的公网地址填入 `PUBLIC_ADDRESS`，并将该地址写入媒体服务器的 `iceAdditionalHostAddresses`。
- 运行在节点网络上的 pod 必须设置 `dnsPolicy: ClusterFirstWithHostNet`，才能解析服务的名称。
- 浏览器经由位于 `signaling` 服务之前的 Ingress 或负载均衡访问信令，并使用 `transports: ['websocket']` 连接。
- 测试时一个 NATS pod 即可；生产环境请运行 NATS 集群（使用 NATS 的 Helm chart），或者带副本的 Redis。
- 整个集群同时启动时，pod 可能在集群的 DNS 能够解析 `nats` 之前就已启动（日志中为 `getaddrinfo EAI_AGAIN nats`）。应用启动时无法连接 NATS 就会停止，Kubernetes 会持续重启应用，直到能够连接为止。此时每个 pod 重启几次属于正常现象。

仓库中的 `packages/webrtc/test-env/k3s/run.sh` 在 Docker 中的 k3s 上部署这些清单（两个节点，挂载代码而非使用镜像）。该脚本先让两个成员分别通过两个 pod 连接，并且只经 TURN 服务器中转；再让两个成员分别连接到两个节点的媒体服务器，然后删除其中一个成员所在的 pod，该成员会转到接替该 pod 的新 pod 上。

### 应用自己使用集群

应用也可以通过同一个组件与自身的其他实例通信：向其他所有节点发送消息，向一个或所有节点发送请求。

```typescript
import {Component} from 'lakutata'
import type {Cluster, ClusterReply} from '@lakutata/webrtc'

export class Viewers extends Component {
    //本节点上每路流的观众数，由应用自己统计
    protected readonly counts: Map<string, number> = new Map()

    protected async init(): Promise<void> {
        const cluster: Cluster = await this.getObject<Cluster>('cluster')
        //每个节点回答自己的观众数
        cluster.handle<{stream: string}, number>('viewers', ({stream}: {stream: string}): number => this.counts.get(stream) ?? 0)
        cluster.subscribe<{text: string}>('announcements', (message: {text: string}): void => console.log(message.text))
    }

    //一路流在所有节点上的观众数
    public async total(stream: string): Promise<number> {
        const cluster: Cluster = await this.getObject<Cluster>('cluster')
        const replies: ClusterReply<number>[] = await cluster.requestAll<number>('viewers', {stream: stream})
        return replies.reduce((sum: number, reply: ClusterReply<number>): number => sum + reply.result, this.counts.get(stream) ?? 0)
    }
}
```

`cluster.nodes()` 列出所有节点，以及各节点的标签和公布的信息（`announce()`）；组件还会发出 `node-up`、`node-down` 和 `node-update` 事件。消息以 JSON 格式发送；超过服务器单条消息上限的消息（NATS 默认为 1 MiB）会分成几段发送。

## 14. 信令协议

其他语言的客户端和原生应用可以直接使用该协议。请求是模式为 `{method}` 的服务调用：在 Socket.IO 上为带确认回调（`{success, error, payload}`）的 `message` 事件，内容如 `{method: 'webrtc.join', room: 'room-1'}`；在 JSON-RPC 2.0 上为方法名为 `webrtc.join` 的请求。服务端将事件推送给成员，形式为 Socket.IO 的事件，或者 `params` 中携带内容的 JSON-RPC 通知。

| 请求 | 参数 | 返回 |
|---|---|---|
| `webrtc.join` | `room`、`metadata`、`session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval, sfu}` |
| `webrtc.signal` | `room`、`to`，以及 `description`（`{type, sdp}`）或 `candidate`（`{candidate, sdpMid, sdpMLineIndex, usernameFragment}`） | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}`：新的凭据 |
| `webrtc.heartbeat` | — | `{}` |

| 事件 | 内容 |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session, role, sfu}`：有成员加入或重新加入 |
| `webrtc:peer-left` | `{room, peerId, reason}`：主动离开时为 `left`，客户端断开时为 `disconnected` |
| `webrtc:signal` | `{room, from, session, description, streams}` 或 `{room, from, session, candidate}` |

- `session` 是客户端自行选择的一个随机字符串，只选择一次。成员以同一个会话重新加入时（信令重新连接之后），其他成员保留通往该成员的连接；以新的会话加入时（页面已刷新），其他成员会替换通往该成员的连接。
- Socket.IO 和 WebSocket 上的 JSON-RPC 的 `heartbeatInterval` 为 0，因为服务端能够察觉这些传输方式的连接关闭。在其他传输方式上，客户端每隔该时长发送一次 `webrtc.heartbeat`；连续三个间隔没有任何请求时，该客户端会离开其所在的房间。
- 在一对成员中，ID 排在前面（按字符串比较）的一方是“礼让”的一方：双方同时发出 offer 时，该方放弃自身的 offer，回答对方的 offer。
- 与媒体服务器相关的字段均由服务端设置：`role` 对媒体服务器为 `sfu`，对 WHIP 推流为 `whip`（客户端没有该字段）；`sfu` 是一个成员所连接的媒体服务器的 ID，在 `webrtc.join` 的返回值中是客户端应连接的那个媒体服务器。在有媒体服务器的房间中，客户端只连接该媒体服务器，并在与其之间的连接中作为礼让的一方。媒体服务器发出的 description 带有 `streams`，包括其发出的每个流在这条连接上的 `id`、来自哪个成员（`peerId`），以及该流在那个成员自身连接上的 ID（`stream`）。
- 在与媒体服务器的连接上，1023 号数据通道（标签为 `webrtc.control`，两端都使用 `negotiated: true` 和该 `id` 创建）传输 JSON 格式的 `{type: 'pause' | 'resume', mid}`，服务器据此暂停或恢复发送该收发器的轨道。经过服务器发给某个成员的数据通道，其 `protocol` 为那个成员的 ID；服务器在那个成员一侧打开通道时，`protocol` 填写的是发送方的 ID。各节点的媒体服务器之间也使用 1023 号通道，以及 `protocol` 为 JSON 格式 `["发送方", "成员"]` 的通道。
- `webrtcServiceEntrypoint()` 的调用（第 5 节）是 JSON-RPC 2.0 消息，承载于一条由调用方建立、标签为 `service` 且可靠有序的数据通道上。每条消息按 `ChunkedChannel` 的方式切分为帧：每帧是一条二进制消息，第一个字节为标志（1 表示一条消息的最后一帧，2 表示文本消息），其余字节为消息的下一段（本包每段最多 16 KiB）。一次调用是一条文本消息，其各帧的标志为 2，最后一帧为 3。响应和事件（`params` 为事件参数的通知）以同样的方式发回。
- 错误带有服务端异常的 `errno`：`E_SIGNALING_DENIED`、`E_SIGNALING_LIMIT`（房间已满，或者没有媒体服务器可以接收该成员）、`E_SIGNALING_NOT_A_MEMBER`、`E_SIGNALING_CLIENT_REQUIRED`、`E_INVALID_VALUE`。HTTP 上的 JSON-RPC 无法承载信令，因为事件需要通过一条连接推送。

## 15. 连接失败时

`setDebugHandler()` 给出 ICE、DTLS、SCTP 和 TURN 的调试信息：

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

媒体服务器的工作线程也将调试信息发送到同一个处理函数，每条信息以线程编号开头（`[thread 0] …`）。媒体服务器或 WHEP 的 `select` 抛出的错误记录在 `webrtc/sfu` 和 `webrtc/whep` 之下。

如需检查 TURN 服务器，可以让两个客户端使用 `iceTransportPolicy: 'relay'` 加入同一个房间。这两个客户端只能经过中转连接，`turn.allocations` 会将其计入。在 Chrome 中，`chrome://webrtc-internals` 可以显示候选地址和尝试过的地址对。

## 16. 限制

- Node.js 端不采集、不编码，也不解码音视频。Node.js 端的轨道传输的是 RTP 包，来自编码器或另一条连接。
- 两个 Node.js 进程之间单个数据通道的吞吐量（Apple M4）：大消息约 80 MiB/s，100 字节的消息每秒约 62.6 万条；在同一台 Mac 上的 arm64 Linux 虚拟机（Docker Desktop）中，大消息约 43 MiB/s，小消息每秒约 54.8 万条。可以使用仓库中的 `packages/webrtc/test-env/bench/engine.mjs` 在其他机器上测量。
- 媒体服务器不转码，按发布时的原样发送每路视频。由于尚不支持 simulcast，对于带宽不足的成员，服务器发出的是 `congestion` 事件，而不是改发更低的画质。媒体服务器在一台机器上的转发能力见第 9 节；可以使用仓库中的 `packages/webrtc/test-env/bench/forward.mjs` 在其他机器上测量。
- 在集群中，媒体服务器将一条轨道从发布者所在的节点直接发送给每个需要该轨道的节点，一个房间分布在几十个节点上没有问题；规模更大时，则需要节点之间逐级转发。
