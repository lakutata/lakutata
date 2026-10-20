# @lakutata/webrtc

[English](README.md) | 中文

[lakutata](https://www.npmjs.com/package/lakutata) 框架的 WebRTC，用 TypeScript 编写，没有原生代码：安装时不需要编译器，能在 Node.js、Electron 的主进程和 Bun 中运行。它有两个入口：

- `@lakutata/webrtc`，给应用用：信令（房间里的成员互相交换 offer、answer 和候选地址）、STUN 和 TURN 服务器，以及 Node.js 端的对等连接和数据通道，接口和浏览器的 `RTCPeerConnection` 一致。
- `@lakutata/webrtc/client`，给浏览器和 Electron 的渲染进程用：把浏览器自带的 `RTCPeerConnection` 接到信令上。它只使用浏览器的接口，前端打包它时不会带上服务端代码。

协议的实现（ICE、DTLS、SCTP、数据通道、STUN 和 TURN 服务器）改编自 [werift](https://github.com/shinyoshiaki/werift-webrtc)，见 `THIRD_PARTY_NOTICES.md`。

## 安装

```shell
npm install @lakutata/webrtc
```

应用还需要 `lakutata`（或者 `@lakutata/core` 和 `@lakutata/entrypoint`）。信令通过 entrypoint 的适配器提供，走 Socket.IO（`npm install socket.io`）或 WebSocket 上的 JSON-RPC（`npm install ws`）。应用作为成员通过 Socket.IO 加入房间时需要 `socket.io-client`；通过 JSON-RPC 加入时，使用 Node.js 22 和 Bun 自带的 `WebSocket`。

前端安装同一个包，引用 `@lakutata/webrtc/client`；框架不会随之安装。

## 用法

服务端：信令、TURN 服务器，以及 entrypoint 上的信令控制器。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        //STUN 和 TURN 使用 3478 端口（UDP 和 TCP），中转使用 49160 到 49200 端口
        turn: buildTURNServerOptions({publicAddress: '203.0.113.10', relayPortRange: [49160, 49200], secret: process.env.TURN_SECRET}),
        //房间成员拿到 turn 的 ICE 服务器，凭据一天内有效
        signaling: buildSignalingOptions({turn: 'turn'}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['turn', 'entrypoint']
}))
```

浏览器：加入房间，和其他每个成员各开一个数据通道。

```typescript
import {io} from 'socket.io-client'
import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'

//成员的 id 是它的 Socket.IO 连接的 auth.id
const signaling: SignalingConnection = new SignalingConnection(io('https://meet.example.com', {auth: {id: 'alice'}}))
const room: Room = await signaling.join('room-1', {metadata: {name: 'Alice'}})
room.on('peer', (peer: Peer): void => {
    const channel: RTCDataChannel = peer.createDataChannel('chat')
    channel.addEventListener('open', (): void => channel.send(`hello ${peer.id}`))
    peer.on('datachannel', (remote: RTCDataChannel): void => {
        remote.addEventListener('message', (event: MessageEvent): void => console.log(peer.id, event.data))
    })
})
room.on('peer-left', (peer: Peer): void => console.log(`${peer.id} left`))
```

应用作为成员：一台设备把读数发给进入它房间的每个人。

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

不用这个包的信令时，可以直接获取一个 `PeerConnection`（`await this.getObject(PeerConnection, {iceServers})`），像浏览器里使用 `RTCPeerConnection` 那样自己交换 offer、answer 和候选地址。

房间的行为：

- **连接。** 成员为其他每个成员得到一个 `Peer`，带有到它的连接（`peer.connection`：浏览器里是 `RTCPeerConnection`，Node.js 里是 `PeerConnection`）。任何一方添加数据通道时，连接就会建立。offer 和 answer 按 W3C 的“完美协商”（perfect negotiation）交换：双方随时都可以添加通道，同时添加也没问题。双方只想共用一个通道时，两边都用 `negotiated: true` 和相同的 `id` 创建它。
- **修复。** 连接失败，或者断开超过 5 秒，会自动重启 ICE。信令连接断开时，点对点连接保持不变；信令恢复后，客户端重新加入它的房间，其他成员保留到它的连接。成员刷新页面后以新的会话加入，其他成员会替换到它的连接。
- **离开。** `room.leave()` 关闭这个房间的连接，其他成员收到 `peer-left`。成员的信令连接（Socket.IO，或 WebSocket 上的 JSON-RPC）关闭时，它会离开它的房间；它的点对点连接保持不变，直到它回来或者连接失败。
- **ICE 服务器。** 成员加入房间时从服务端拿到 ICE 服务器，TURN 凭据在 `credentialTtl`（默认一天）内有效，到期前客户端会重新获取。
- **检查。** 成员只能给自己所在房间的成员发信令；信令的大小（64 KiB）和频率（平均每秒 50 条）有限制，`authorize` 选项决定谁能加入哪个房间。

大消息：数据通道和任何一方之间都能传 64 KiB 以内的消息；Chrome 和这个包的连接能接收 256 KiB 以内的消息。两端都套上 `ChunkedChannel` 后，消息会被切成小块发送，再在对端拼回原样，任意大小的消息和文件都能传：

```typescript
import {ChunkedChannel, type PeerChannel} from '@lakutata/webrtc'

declare const channel: PeerChannel
const transfer: ChunkedChannel = new ChunkedChannel(channel)
transfer.on('message', (data: string | Uint8Array): void => console.log(`${data.length} received`))
await transfer.send(new Uint8Array(50 * 1024 * 1024))
```

## 部署

- **端口。** TURN 服务器在 3478 端口上监听 UDP 和 TCP（给了证书时还有 TLS）；中转使用 `relayPortRange` 里的 UDP 端口。在防火墙里放开这些端口，或者从容器发布它们。
- **地址。** `publicAddress` 是客户端访问服务器用的地址：主机的公网地址，或者转发了这些端口的 NAT 的地址。默认取主机第一个非内部的 IPv4 地址，在局域网里够用。
- **多个实例。** 给它们的 TURN 服务器配置相同的 `secret`，这样一个实例生成的凭据其他实例也认。房间保存在一个实例的内存里：同一个房间的成员都要连到同一个实例。
- **其他 TURN 服务器。** 配置了 `use-auth-secret` 和相同密钥的 coturn 也接受这个包生成的凭据：把它写进 `Signaling` 的 `iceServers` 选项。

## 信令协议

请求是模式为 `{method}` 的服务调用：Socket.IO 上是带确认回调的 `message` 事件，内容如 `{method: 'webrtc.join', room: 'room-1'}`；JSON-RPC 上是方法名为 `webrtc.join` 的请求。成员的 id 是它连接的客户端 id（Socket.IO 的 `auth.id`，WebSocket 的 `id` 查询参数或请求头）。服务端把事件推给成员：Socket.IO 的事件，或者 `params` 里放着内容的 JSON-RPC 通知。

| 请求 | 参数 | 返回 |
|---|---|---|
| `webrtc.join` | `room`、`metadata`、`session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval}` |
| `webrtc.signal` | `room`、`to`、`description` 或 `candidate` | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}` |
| `webrtc.heartbeat` | — | `{}` |

| 事件 | 内容 |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session}` |
| `webrtc:peer-left` | `{room, peerId, reason}`：`left` 或 `disconnected` |
| `webrtc:signal` | `{room, from, session, description}` 或 `{room, from, session, candidate}` |

`heartbeatInterval` 不为 0 时，客户端每隔这么多毫秒发送一次 `webrtc.heartbeat`：这发生在服务端察觉不到断开的传输方式上（Socket.IO 和 WebSocket 上的 JSON-RPC 返回 0）。`session` 是客户端自己选的一个随机字符串，只选一次：用同一个会话重新加入时，其他成员会保留到它的连接。

## 限制

- 还不支持音视频：Node.js 端的连接只传数据通道。
- `PeerConnection` 只使用 ICE 服务器里的第一个 STUN 地址和第一个 TURN 地址。
- 两个 Node.js 进程之间单个数据通道的吞吐量（Apple M4）：大消息约 60 MiB/s，100 字节的消息每秒约 38 万条。

## API

| 导出 | 说明 |
|---|---|
| `Signaling`、`buildSignalingOptions` | 房间组件：成员、信令、限制、`authorize`、ICE 服务器 |
| `SignalingController` | 通过 Socket.IO 和 JSON-RPC 提供信令的控制器 |
| `TURNServer`、`buildTURNServerOptions` | STUN 和 TURN 服务器：`iceServers()`、`credentials()`、`allocations` |
| `createTURNCredentials` | 短时有效的 TURN 凭据（coturn 的 REST API） |
| `SignalingClient` | 应用作为房间成员：`join()`、`close()` |
| `PeerConnection`、`PeerChannel` | Node.js 端的对等连接和数据通道 |
| `Room`、`Peer` | 加入的房间，以及另一个成员和到它的连接 |
| `ChunkedChannel` | 在数据通道上传任意大小的消息 |
| `setDebugHandler` | ICE、DTLS、SCTP 和 TURN 的调试信息 |
| `SignalingMethod`、`SignalingEvent` | 协议里请求和事件的名称 |
| `SignalingConnection`（`/client`） | 浏览器端的信令：`join()`、`close()` |

## 错误

| 异常 | 什么时候 |
|---|---|
| `SignalingDeniedException` | `authorize` 拒绝了这个房间 |
| `SignalingLimitException` | 房间已满、信令太大、信令太频繁 |
| `SignalingNotAMemberException` | 发送方或接收方不在这个房间里 |
| `SignalingClientRequiredException` | 请求所在的连接没法推送事件（HTTP） |
| `SignalingConnectionException` | `SignalingClient` 缺少 `socket.io-client` 或 `WebSocket` |
| `SignalingRequestError` | 客户端上请求的错误，带有服务端异常的 `errno` |

## 测试

`npm run test:unit` 运行协议、信令以及 Node.js 进程之间连接的测试。Chrome 的测试使用 Playwright 和本机安装的 Chrome：能引用 `playwright` 包（或者在 `LAKUTATA_PLAYWRIGHT` 指定的目录里找到它）时运行，否则跳过。

## 另见

- 网站上的指南：[WebRTC](https://lakutata.com/zh/guide/WebRTC)。
- `lakutata` 包中的 `doc/zh/WebRTC.md`：WebRTC 指南。
- `@lakutata/entrypoint`：提供信令的 Socket.IO 和 JSON-RPC 适配器。
