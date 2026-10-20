# Lakutata WebRTC

WebRTC 让两端直接点对点连接：浏览器、Electron 应用和 Node.js 进程之间交换数据不需要服务器转发，在 NAT 和防火墙后面也能连上。`@lakutata/webrtc` 包提供这些连接周边需要的一切：让两端互相认识的信令，给需要的网络用的 STUN 和 TURN 服务器，Node.js 端的对等连接，以及浏览器的客户端。它用 TypeScript 编写，没有原生代码，不属于 `lakutata`：

```bash
npm install lakutata @lakutata/webrtc
```

| 入口 | 运行在 | 提供什么 |
|---|---|---|
| `@lakutata/webrtc` | Node.js、Electron 的主进程、Bun | `Signaling`、`SignalingController`、`TURNServer`、`SignalingClient`、`PeerConnection`、`ChunkedChannel` |
| `@lakutata/webrtc/client` | 浏览器、Electron 的渲染进程 | `SignalingConnection`、`ChunkedChannel`、协议的类型 |

浏览器入口只使用浏览器的接口；前端安装同一个包，框架不会随之安装。

## 1. 连接是怎么建立的

两端在知道怎么找到对方之前没法连接。每一端用 **offer** 或 **answer** 描述自己（编解码器、密钥、数据通道），并列出它的**候选地址**，也就是别人可能找到它的地址：它的本地地址、STUN 服务器看到的公网地址，以及 TURN 服务器上的一个地址，在其他办法都不通时由 TURN 服务器转发它的流量。这些消息经由两端都连着的一台服务器传递，这就是**信令**；两端拿到这些消息后，成对地测试候选地址（ICE），保留一对可用的，再给连接加密（DTLS）。之后数据通道就能双向传消息，可以选择可靠有序，也可以不要求。

这个包的信令以**房间**为单位：客户端加入房间，拿到已经在里面的成员，每两个成员之间互相交换 offer、answer 和候选地址。其余的事情都替你做好了：

- offer 和 answer 按 W3C 的“完美协商”（perfect negotiation）交换：任何一方都可以随时添加数据通道，双方同时添加也没问题。
- 连接失败，或者断开超过 5 秒，会自动重启 ICE。
- 信令连接断开时，点对点连接保持不变；客户端重新连上后，会重新加入它的房间。
- 成员加入房间时拿到 ICE 服务器（带 TURN 凭据），凭据到期前会拿到新的。

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

`SignalingController` 处理信令的请求；它按名字 `signaling` 找到组件，组件再按名字 `entrypoint`（它的 `entrypoint` 选项）找到 entrypoint。它的动作和其他动作一样经过 entrypoint 的中间件。成员的 id 是它连接的客户端 id：Socket.IO 的 `auth.id`（没有时取 `id` 请求头），WebSocket 的 `id` 请求头或查询参数。用中间件认证请求，用 `authorize` 决定谁能加入哪个房间：`(peer, room, context) => boolean | Promise<boolean>`，参数是成员的 id 和 metadata，以及它请求的上下文。

`buildSignalingOptions` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `entrypoint` | `'entrypoint'` | 把事件推给成员的 entrypoint 组件 |
| `turn` | — | 一个 `TURNServer` 组件：成员拿到它的 ICE 服务器和凭据 |
| `iceServers` | `[]` | 更多的 ICE 服务器（其他 STUN 或 TURN 服务器），排在 `turn` 的后面 |
| `authorize` | — | 谁能加入哪个房间；不设置时谁都能加入任何房间 |
| `maxPeers` | `0` | 一个房间最多多少成员；0 表示不限 |
| `maxMessageSize` | `65536` | 一条信令和一个成员的 metadata 最大多少字节 |
| `maxMessagesPerSecond` | `50` | 一个成员平均每秒最多发多少条信令（短时间内允许两倍） |
| `heartbeatInterval` | `10000` | 服务端察觉不到断开时，客户端发送心跳的间隔，单位毫秒 |

不用控制器时组件也能用：`join()`、`signal()`、`leave()` 和 `disconnect()` 让应用自己的代码修改房间，`rooms()` 列出房间。

## 3. STUN 和 TURN 服务器

大多数连接直接就能连上，或者用 STUN 服务器报告的公网地址连上。有些网络（对称 NAT、企业防火墙、移动运营商）只允许中转：由 TURN 服务器转发连接的流量。`TURNServer` 就是一个运行在应用里的 TURN 服务器：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host` | `'0.0.0.0'` | 监听的地址 |
| `port` | `3478` | UDP 和 TCP 上 STUN 和 TURN 的端口 |
| `udp`、`tcp` | `true` | 是否监听 UDP、TCP |
| `tls` | — | `{cert, key, port}`：TLS 上的 TURN（`turns:`，默认 5349 端口），给只放行 TLS 的网络用 |
| `publicAddress` | 主机第一个非内部的 IPv4 地址 | 客户端访问它用的地址 |
| `relayPortRange` | 任意空闲端口 | `[first, last]`：中转使用的 UDP 端口 |
| `secret` | 每次启动时随机生成 | 短时凭据的密钥 |
| `users` | `{}` | 使用固定密码的用户，`{username: password}` |
| `realm` | `'lakutata'` | 凭据的 realm |
| `credentialTtl` | `86400` | 短时凭据的有效期，单位秒 |
| `maxAllocations` | 不限 | 同时最多多少个中转 |

短时凭据遵循 coturn 的 REST API：用户名是 `<expiry>:<user>`，密码是 `base64(HMAC-SHA1(secret, username))`，持有密钥的服务器不用保存凭据就能校验。`turn.iceServers(user)` 给出一个客户端的 ICE 服务器和凭据，`turn.credentials(user)` 只给凭据，`createTURNCredentials(secret, user, ttl)` 为其他 TURN 服务器（配置了 `use-auth-secret` 的 coturn）生成凭据，`turn.allocations` 是正在使用的中转数量。

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

`SignalingConnection` 接收应用自己的连接：

- Socket.IO 的 socket（`socket.io-client` 的 `io()`）：成员的 id 是它的 `auth.id`，Socket.IO 会自己重连；
- 一个使用 JSON-RPC 的 `WebSocket`，成员的 id 是它 URL 里的 `id` 查询参数；
- 一个创建这个 `WebSocket` 的函数，这样断开后会重新连接（先等 1 秒，之后每次加倍，最多 30 秒）：`new SignalingConnection(() => new WebSocket('wss://meet.example.com/rpc?id=alice'))`。

它的选项：`iceTransportPolicy`（`'relay'` 表示只用 TURN 中转）、`configuration`（`RTCPeerConnection` 的更多选项）、`createPeerConnection`（`RTCPeerConnection` 的其他实现）、`timeout`（请求的超时，默认 15 秒）。

房间为其他每个成员发出 `peer` 事件：先是已经在房间里的成员，然后是每个新加入的成员。后来添加的监听函数会立即为已有的每个成员调用一次。`Peer` 有成员的 `id`、`metadata`、到它的连接 `connection`（一个 `RTCPeerConnection`：可以往里添加音视频轨道、读取统计信息），以及 `createDataChannel()`、`restartIce()` 和 `close()`，会发出 `datachannel`、`connectionstatechange`、`metadata`（成员带着新的 metadata 重新加入）、`error` 和 `close` 事件。一个成员连接关闭时，房间发出 `peer-left`：成员离开了，或者连接彻底断了。

双方都可以创建通道：每一端通过 `datachannel` 拿到对方创建的通道。双方只想共用一个通道时，两边都用 `negotiated: true` 和相同的 `id` 创建它。

在 Electron 里，渲染进程使用 `@lakutata/webrtc/client`，自己连接信令；主进程使用 `@lakutata/webrtc`。

## 5. 应用作为成员

`SignalingClient` 让 lakutata 应用用 Node.js 端的对等连接加入房间。设备、录制程序、机器人或测试都能像浏览器一样加入房间：

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

`http:` 或 `https:` 的 URL 使用 Socket.IO（需要安装 `socket.io-client`），`ws:` 或 `wss:` 的 URL 使用 Node.js 22 和 Bun 自带的 `WebSocket` 走 JSON-RPC。它的选项：`url`、`id`（默认是随机的 UUID）、`path`（Socket.IO 的路径）、`auth`（Socket.IO 握手的更多字段，比如令牌）、`timeout`，以及它的连接的选项（`iceTransportPolicy`、`icePortRange`、`iceAdditionalHostAddresses`）。它是 `@Transient` 的：每次 `getObject()` 都得到一个新的客户端，`close()` 会离开它的房间并断开连接。

## 6. 不用信令的对等连接

`PeerConnection` 的接口和 `RTCPeerConnection` 一致，所以浏览器的代码在 Node.js 里也能用，任何信令方式都行：HTTP 请求、二维码、消息队列。它的事件有两种写法：`addEventListener` 和 `on…` 属性，收到的是事件对象；或者 `on()`，收到的是事件的值（`on('datachannel', (channel) => …)`）。

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

它的选项：`iceServers`、`iceTransportPolicy`，以及服务器用的 `icePortRange`（候选地址使用的 UDP 端口，用来在防火墙里放开）和 `iceAdditionalHostAddresses`（额外作为候选地址的地址，比如按相同端口号转发了这些端口的 NAT 的公网地址）。`PeerChannel` 可以发送字符串和二进制数据；二进制消息收到时是 `Buffer`，`binaryType` 为 `'arraybuffer'` 时是 `ArrayBuffer`。

## 7. 大消息和文件

数据通道和任何一方之间都能传 64 KiB 以内的消息；Chrome 和这个包的连接能接收 256 KiB 以内的消息。`ChunkedChannel` 去掉了这个限制：两端都把它套在通道上，它把每条消息切成 16 KiB 的小块，随着通道缓冲区的腾空陆续发送，再在对端拼回原样。它能发送字符串、字节和 `Blob`（浏览器里的文件一次只读一块）：

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

通道必须是有序、可靠的（默认就是）。收到的消息超过 `maxMessageSize`（默认 64 MiB）时会被丢弃，并发出 `error` 事件。

## 8. 部署

- **端口。** 放开 UDP 和 TCP 的 3478 端口、UDP 的中转端口（`relayPortRange`），开启了 TLS 上的 TURN 时还有 TLS 端口。在容器里要把它们全部发布出来；指定中转端口范围可以让需要发布的端口少一些。
- **公网地址。** `publicAddress` 是客户端访问 TURN 服务器用的地址：主机的公网地址，或者转发了这些端口的 NAT 的地址。在局域网里用默认值就够了。
- **应用作为成员。** 位于 NAT 后面的服务器，如果 NAT 按相同的端口号转发了 `icePortRange`，就把它的公网地址写进 `iceAdditionalHostAddresses`；否则它和其他客户端一样依靠 TURN 服务器。
- **多个实例。** 给它们的 TURN 服务器配置相同的 `secret`，这样每个实例都认其他实例生成的凭据。房间保存在一个实例的内存里：同一个房间的成员都要连到同一个实例。
- **其他 TURN 服务器。** coturn（`use-auth-secret`，`static-auth-secret` 设为相同的密钥）接受 `createTURNCredentials()` 生成的凭据；把它写进 `Signaling` 的 `iceServers` 选项。
- **HTTPS。** 浏览器在任何页面上都允许使用 WebRTC，但摄像头和麦克风只能在安全的页面上使用（HTTPS 或 `localhost`）。

## 9. 信令协议

其他语言的客户端和原生应用可以直接使用这个协议。请求是模式为 `{method}` 的服务调用：Socket.IO 上是带确认回调（`{success, error, payload}`）的 `message` 事件，内容如 `{method: 'webrtc.join', room: 'room-1'}`；JSON-RPC 2.0 上是方法名为 `webrtc.join` 的请求。服务端把事件推给成员：Socket.IO 的事件，或者 `params` 里放着内容的 JSON-RPC 通知。

| 请求 | 参数 | 返回 |
|---|---|---|
| `webrtc.join` | `room`、`metadata`、`session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval}` |
| `webrtc.signal` | `room`、`to`，以及 `description`（`{type, sdp}`）或 `candidate`（`{candidate, sdpMid, sdpMLineIndex, usernameFragment}`） | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}`：新的凭据 |
| `webrtc.heartbeat` | — | `{}` |

| 事件 | 内容 |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session}`：有成员加入或重新加入 |
| `webrtc:peer-left` | `{room, peerId, reason}`：主动离开时是 `left`，客户端断开时是 `disconnected` |
| `webrtc:signal` | `{room, from, session, description}` 或 `{room, from, session, candidate}` |

- `session` 是客户端自己选的一个随机字符串，只选一次。成员用同一个会话重新加入时（信令重新连上之后），其他成员保留到它的连接；用新的会话加入时（页面刷新了），其他成员会替换到它的连接。
- Socket.IO 和 WebSocket 上的 JSON-RPC 的 `heartbeatInterval` 是 0：服务端能察觉它们的连接关闭。在其他传输方式上，客户端每隔这么久发送一次 `webrtc.heartbeat`；连续三个间隔没有任何请求时，它会离开它的房间。
- 一对成员里，id 排在前面（按字符串比较）的一方是“礼让”的一方：双方同时发出 offer 时，它放弃自己的 offer，回答对方的。
- 错误带有服务端异常的 `errno`：`E_SIGNALING_DENIED`、`E_SIGNALING_LIMIT`、`E_SIGNALING_NOT_A_MEMBER`、`E_SIGNALING_CLIENT_REQUIRED`、`E_INVALID_VALUE`。HTTP 上的 JSON-RPC 不能承载信令：事件需要通过一条连接推送。

## 10. 连接失败时

`setDebugHandler()` 给出 ICE、DTLS、SCTP 和 TURN 的调试信息：

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

要检查 TURN 服务器，可以让两个客户端用 `iceTransportPolicy: 'relay'` 加入同一个房间：它们只能经过中转连接，`turn.allocations` 会统计到它们。在 Chrome 里，`chrome://webrtc-internals` 能看到候选地址和尝试过的地址对。

## 11. 限制

- 还不支持音视频：Node.js 端的连接只传数据通道。浏览器之间的连接可以自己添加音视频轨道。
- `PeerConnection` 只使用 ICE 服务器里的第一个 STUN 地址和第一个 TURN 地址。
- 两个 Node.js 进程之间单个数据通道的吞吐量（Apple M4）：大消息约 60 MiB/s，100 字节的消息每秒约 38 万条。
