# Lakutata WebRTC

WebRTC 让两端直接点对点连接：浏览器、Electron 应用和 Node.js 进程之间交换数据和音视频不需要服务器转发，在 NAT 和防火墙后面也能连上。`@lakutata/webrtc` 包提供这些连接周边需要的一切：让两端互相认识的信令，给需要的网络用的 STUN 和 TURN 服务器，Node.js 端的对等连接，以及浏览器的客户端。它用 TypeScript 编写，没有原生代码，不属于 `lakutata`：

```bash
npm install lakutata @lakutata/webrtc
```

| 入口 | 运行在 | 提供什么 |
|---|---|---|
| `@lakutata/webrtc` | Node.js、Electron 的主进程、Bun | `Signaling`、`SignalingController`、`TURNServer`、`SignalingClient`、`PeerConnection`、`MediaTrack`、`WHIP`、`WHIPController`、`Cluster`、`ChunkedChannel` |
| `@lakutata/webrtc/client` | 浏览器、Electron 的渲染进程 | `SignalingConnection`、`ChunkedChannel`、协议的类型 |

浏览器入口只使用浏览器的接口；前端安装同一个包，框架不会随之安装。

## 1. 连接是怎么建立的

两端在知道怎么找到对方之前没法连接。每一端用 **offer** 或 **answer** 描述自己（编解码器、密钥、数据通道），并列出它的**候选地址**，也就是别人可能找到它的地址：它的本地地址、STUN 服务器看到的公网地址，以及 TURN 服务器上的一个地址，在其他办法都不通时由 TURN 服务器转发它的流量。这些消息经由两端都连着的一台服务器传递，这就是**信令**；两端拿到这些消息后，成对地测试候选地址（ICE），保留一对可用的，再给连接加密（DTLS）。之后数据通道就能双向传消息，可以选择可靠有序，也可以不要求；轨道则传音视频。

这个包的信令以**房间**为单位：客户端加入房间，拿到已经在里面的成员，每两个成员之间互相交换 offer、answer 和候选地址。其余的事情都替你做好了：

- offer 和 answer 按 W3C 的“完美协商”（perfect negotiation）交换：任何一方都可以随时添加数据通道和轨道，双方同时添加也没问题。
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
| `credentialTtl` | `86400` | 短时凭据的有效期，单位秒；过期后，用它建立的中转照常工作 |
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

房间为其他每个成员发出 `peer` 事件：先是已经在房间里的成员，然后是每个新加入的成员。后来添加的监听函数会立即为已有的每个成员调用一次。`Peer` 有成员的 `id`、`metadata`、到它的连接 `connection`（一个 `RTCPeerConnection`：可以往里添加音视频轨道、读取统计信息），以及 `createDataChannel()`、`restartIce()` 和 `close()`，会发出 `datachannel`、`track`、`connectionstatechange`、`metadata`（成员带着新的 metadata 重新加入）、`error` 和 `close` 事件。一个成员连接关闭时，房间发出 `peer-left`：成员离开了，或者连接彻底断了。

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

`http:` 或 `https:` 的 URL 使用 Socket.IO（需要安装 `socket.io-client`），`ws:` 或 `wss:` 的 URL 使用 Node.js 22 和 Bun 自带的 `WebSocket` 走 JSON-RPC。它的选项：`url`、`id`（默认是随机的 UUID）、`path`（Socket.IO 的路径）、`auth`（Socket.IO 握手的更多字段，比如令牌）、`timeout`，以及它的连接的选项（`iceTransportPolicy`、`icePortRange`、`iceAdditionalHostAddresses`、`codecs`）。它是 `@Transient` 的：每次 `getObject()` 都得到一个新的客户端，`close()` 会离开它的房间并断开连接。

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

它的选项：`iceServers`、`iceTransportPolicy`，以及服务器用的 `icePortRange`（候选地址使用的 UDP 端口，用来在防火墙里放开）和 `iceAdditionalHostAddresses`（额外作为候选地址的地址，比如按相同端口号转发了这些端口的 NAT 的公网地址）；`codecs` 决定音视频用哪些编码。`headerExtensions: true` 会加上媒体服务器要用的 RTP 头部扩展：两端都根据对方的反馈估计自己发送时的可用带宽（没有这些扩展时，浏览器只能看丢包来估计，从很低的码率开始，涨得很慢）。`PeerChannel` 可以发送字符串和二进制数据；二进制消息收到时是 `Buffer`，`binaryType` 为 `'arraybuffer'` 时是 `ArrayBuffer`。

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

## 8. 音视频

一条轨道传一个来源的音频或视频。在浏览器里，把摄像头和麦克风的轨道加到和每个成员的连接上；对方在自己的 peer 上通过 `track` 事件拿到这些轨道，`event.streams` 把同一个来源的音频和视频归在一起：

```typescript
import {type Peer, type Room} from '@lakutata/webrtc/client'

declare const room: Room
declare const grid: HTMLElement
const camera: MediaStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true})
room.on('peer', (peer: Peer): void => {
    for (const track of camera.getTracks()) peer.connection.addTrack(track, camera)
    const video: HTMLVideoElement = document.createElement('video')
    video.autoplay = true
    grid.append(video)
    peer.on('track', (event: RTCTrackEvent): void => {
        video.srcObject = event.streams[0]
    })
    peer.on('close', (): void => video.remove())
})
```

每个成员都给其他每个成员发送时，有几个其他成员，它的视频就要发几份：这适合人少的房间。

Node.js 端不采集、不编码也不解码：应用的轨道传的是 RTP 包，也就是编码好的音视频，来自编码器或者另一条连接。

- `new MediaTrack(kind, {codec})` 创建一条要发送的轨道，`writeRtp()` 发送一个包：一个 `RtpPacket`，或者一个包的字节，比如 ffmpeg 和 GStreamer 发到 UDP 端口的数据报。每条连接给这些包换上自己的同步源（SSRC）和负载类型，序号和时间戳接着之前写入的包连续往下排。
- 收到的轨道（`Peer` 或 `PeerConnection` 的 `track` 事件）通过 `rtp` 事件交出对方发来的包；`requestKeyFrame()` 向对方请求关键帧。
- 把收到的轨道加到另一条连接上，它的包就会转发过去，那条连接的关键帧请求也会转回这条轨道的发送方（最多每 500 毫秒一次）。
- 轨道的 `keyframerequest` 事件表示它发往的某个对端需要关键帧。

一个摄像头应用，发送 ffmpeg 编码的视频：

```typescript
import {createSocket, type Socket} from 'node:dgram'
import {Component} from 'lakutata'
import {MediaTrack, type Peer, type Room, SignalingClient} from '@lakutata/webrtc'

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
        room.on('peer', (peer: Peer): void => void peer.connection.addTrack(video, 'camera-3'))
    }
}
```

观看方要从关键帧开始解码：让编码器每一两秒出一个关键帧（ffmpeg 的 `-g`），或者在编码器支持时，收到 `keyframerequest` 就生成一个。码流过滤器 `dump_extra` 把 H.264 的参数放到每个关键帧前面，浏览器需要从那里读到它们。

一个应用把某个成员的摄像头转发给后来加入的观看方，每个观看方从应用而不是从摄像头那里拿到视频：

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

`PeerConnection` 的方法和 `RTCPeerConnection` 一致：`addTrack(track, ...streamIds)`（对方把同一个流的轨道归在一起）、`addTransceiver(trackOrKind, {direction, streams})`（`recvonly` 表示只收不发）、`removeTrack(sender)`、`getTransceivers()`、`getSenders()` 和 `getReceivers()`；`sender.replaceTrack()` 换发同一编码的另一条轨道，不用重新协商。支持的编码：音频 Opus 和 PCMU，视频 VP8、H.264 和 VP9；`PeerConnection` 和 `SignalingClient` 的 `codecs` 选项决定用哪些、按什么顺序，用 `codec` 创建的轨道会让它的连接协商这一种编码。

## 9. 用 WHIP 推流

WHIP（RFC 9725）用一个 HTTP 请求推一路流：编码器（OBS、GStreamer、ffmpeg）或浏览器把 offer 提交到这路流的 URL，拿回 answer 和它的会话 URL。`WHIP` 组件回答这些 offer，推流开始时发出 `publish`，带上会话（它的 `id`、`stream`、`connection` 和 `tracks`），结束时发出 `unpublish`：推流方删除了它，它的连接失败或关闭了，或者应用停止了。`WHIPController` 是它的 HTTP 接口；HTTP 适配器要把 `application/sdp` 按文本读取（`body.text` 选项）。

```typescript
import {Application, Component} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {buildWHIPOptions, type MediaTrack, type WHIP, type WHIPSession, WHIPController} from '@lakutata/webrtc'

export class Studio extends Component {
    protected async init(): Promise<void> {
        const whip: WHIP = await this.getObject<WHIP>('whip')
        whip.on('publish', (session: WHIPSession): void => {
            session.tracks.forEach((track: MediaTrack): void => console.log(`${session.stream}: ${track.kind} ${track.codec}`))
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
            icePortRange: [40000, 40100]
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

在 OBS 里，服务选 WHIP，服务器填 `https://studio.example.com/whip/live`，再填上 Bearer 令牌；ffmpeg 用 `-f whip -authorization <令牌> https://studio.example.com/whip/live` 推流（音频要是立体声：`-ac 2`）。会话的轨道交出 RTP 包，可以录制，也可以转发给其他连接（第 8 节）。

| 请求 | 回答 |
|---|---|
| `POST /whip/:stream`，请求体是 offer（`application/sdp`） | `201 Created`：answer、`Location`（会话）、`Link`（ICE 服务器） |
| `DELETE /whip/:stream/:session` | `200`：会话结束 |
| `OPTIONS` | `204`，带 CORS 头和 `Accept-Post: application/sdp` |
| `GET` | `204` |
| `PATCH` | `405`：既不支持 Trickle ICE，也不支持 ICE 重启 |

拒绝的情况：`authorize` 拒绝时回 401，带 `WWW-Authenticate: Bearer`；请求体不是 `application/sdp` 时回 415；offer 里没有音视频时回 400；已经有 `maxSessions` 个会话时回 503；会话不存在时回 404。会话的 URL 就是结束它的凭证：它的 id 是随机的，DELETE 不再做授权检查。子类加上 `@Prefix({route: '/live'})`，就能在另一个路径下提供同样的接口。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `authorize` | 无 | `({stream, token}, context) => boolean`：谁能推哪路流 |
| `turn` | 无 | 一个 `TURNServer` 组件的名字：推流方在 `Link` 头里拿到它的 ICE 服务器 |
| `iceServers` | `[]` | 给推流方的更多 ICE 服务器 |
| `maxSessions` | `100` | 同时最多多少个会话，`0` 表示不限 |
| `allowOrigin` | `'*'` | 允许哪些来源的浏览器推流 |
| `icePortRange`、`iceAdditionalHostAddresses` | | 服务器的候选地址：它的 UDP 端口、它的公网地址 |
| `codecs` | Opus、PCMU、VP8、H.264、VP9 | 接受的编码 |

answer 里带有服务器的全部候选地址，服务器收集完才回答：在 NAT 后面或者容器里，要告诉它自己的公网地址，并放开它的端口。

## 10. 部署

- **端口。** 放开 UDP 和 TCP 的 3478 端口、UDP 的中转端口（`relayPortRange`），开启了 TLS 上的 TURN 时还有 TLS 端口。在容器里要把它们全部发布出来；指定中转端口范围可以让需要发布的端口少一些。
- **公网地址。** `publicAddress` 是客户端访问 TURN 服务器用的地址：主机的公网地址，或者转发了这些端口的 NAT 的地址。在局域网里用默认值就够了。
- **应用作为成员。** 位于 NAT 后面的服务器，如果 NAT 按相同的端口号转发了 `icePortRange`，就把它的公网地址写进 `iceAdditionalHostAddresses`；否则它和其他客户端一样依靠 TURN 服务器。
- **多个实例。** 给它们配置 `Cluster`（第 11 节），并给它们的 TURN 服务器配置相同的 `secret`，这样每个实例都认其他实例生成的凭据。
- **其他 TURN 服务器。** coturn（`use-auth-secret`，`static-auth-secret` 设为相同的密钥）接受 `createTURNCredentials()` 生成的凭据；把它写进 `Signaling` 的 `iceServers` 选项。
- **HTTPS。** 浏览器在任何页面上都允许使用 WebRTC，但摄像头和麦克风只能在安全的页面上使用（HTTPS 或 `localhost`）。

## 11. 多个实例

应用部署成多个实例时（Kubernetes 部署里的多个 pod、负载均衡后面的多个进程），给它们配置一个 `Cluster`：每个实例是集群里的一个节点，节点之间通过 NATS 或 Redis 通信。把它的名字告诉其他组件后，这些组件就能跨节点工作：

- 信令把连在各个节点上的成员放进同一批房间；
- TURN 服务器把自己的地址和负载告诉其他节点，每个成员拿到负载最低的几个；
- WHIP 会话的 DELETE 请求不管到了哪个节点，都能结束这个会话。

总线上只传这些消息。音视频和数据仍然在客户端和节点之间直接传输，或者经 TURN 服务器中转。

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
| `transport` | （必填） | `{type: 'nats', servers, user, pass, token}`；`{type: 'redis', url}` 或 `{type: 'redis', host, port, username, password, database, tls}`；`{type: 'memory'}` 用于同一个进程里的多个应用（测试） |
| `prefix` | `'lakutata.webrtc'` | 主题（NATS）或频道（Redis）的前缀：共用一台服务器的多个集群靠它互相隔开 |
| `nodeId` | 主机名加一个随机后缀 | 节点的 id；在 Kubernetes 里主机名就是 pod 的名字 |
| `labels` | `{}` | 其他节点能看到的本节点标签（可用区、地区），挑选 TURN 服务器时可以用 |
| `heartbeatInterval` | `2000` | 节点多久告诉其他节点一次自己还在，单位毫秒 |
| `requestTimeout` | `5000` | `request()` 和 `requestAll()` 等待多久，单位毫秒 |

用 NATS 需要 `npm install nats`，只用它的普通主题就够了（不需要 JetStream）；用 Redis 需要 `npm install ioredis`，只用到它的频道（`PUBLISH`、`SUBSCRIBE`）。组件在应用启动时连接服务器，连不上就启动失败（在 Kubernetes 里 pod 会一直重启，直到能连上）；之后断开了会自己重连。某个节点连续三个心跳间隔没有消息，其他节点就认为它已经不在了；节点正常停止时，其他节点会立即知道。

### 跨节点的房间

每个节点把通过自己加入和离开的成员告诉其他节点；某个节点刚上线，或者它的消息有丢失时（比如总线重启），其他节点会向它要一份完整的成员列表。发给另一个节点上成员的信令，经由那个节点转发。

- 某个节点停止，或者其他节点联系不上它时，它上面的成员以 `disconnected` 离开房间：它们的连接不会断开，客户端重新连到别的节点后会再次加入。
- 客户端在第一个节点察觉它断开之前就通过另一个节点重新加入时，它会转到新节点上：其他成员看到的是它重新加入，而不是离开。
- `maxPeers` 统计的是所有节点上的成员。每个房间按哈希固定归属到一个节点，由这个节点逐个放行成员，所以两个成员同时通过不同节点加入时，不会都占到最后一个名额。有节点加入或离开集群时，部分房间会改归其他节点，恰好在这一刻加入的成员可能会超出上限。
- 负载均衡后面的 Socket.IO：它的长轮询把一个客户端的请求逐个发出，这些请求必须都到同一个实例。让客户端用 `transports: ['websocket']` 连接（只有一条连接，不需要会话保持），或者在负载均衡上开启会话保持（sticky session）。

### 集群里的 TURN 服务器

TURN 服务器通过 `cluster` 选项和所有 TURN 服务器共用的 `secret` 加入集群（没有 `secret` 时它不会启动），并且每秒把自己的地址、端口和中转数量告诉其他节点。配置了 `turnSecret` 的 `Signaling` 和 `WHIP` 组件，会在本节点的 TURN 服务器（`turn`）之后，再把集群里负载最低、还没满的两个 TURN 服务器给每个客户端。用 `selectTURN` 可以换一种挑法，比如按节点的标签挑：

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

### 负载均衡后面的 WHIP

WHIP 会话保存在回答了它的 POST 请求的那个节点上。配置了 `cluster` 后，另一个节点的 `WHIP` 组件收到这个会话的 DELETE 请求时，会去问其他节点，由持有会话的节点结束它。`maxSessions` 统计的是每个节点自己的会话。

### Kubernetes 和 k3s

下面的清单部署 NATS、信令（两个 pod），以及每个节点上的一个 TURN 服务器。应用只有一个镜像，两种角色由环境变量 `ROLE` 决定：

```typescript
import {Application, type ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

const turn: boolean = process.env.ROLE === 'turn'
const cluster = buildClusterOptions({transport: {type: 'nats', servers: process.env.NATS_URL}})
const components: ApplicationOptions['components'] = turn
    ? {
        cluster: cluster,
        //在节点的网络上：用节点的地址，以及节点的 3478 端口和 49160-49200 端口
        turn: buildTURNServerOptions({
            cluster: 'cluster',
            secret: process.env.TURN_SECRET,
            publicAddress: process.env.PUBLIC_ADDRESS,
            relayPortRange: [49160, 49200]
        })
    }
    : {
        cluster: cluster,
        signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    }

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: components,
    bootstrap: turn ? ['turn'] : ['signaling', 'entrypoint']
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
```

- TURN 服务器运行在所在节点的网络上（`hostNetwork`）：客户端通过节点的地址和节点的端口访问它。在节点的防火墙里放开 UDP 和 TCP 的 3478 端口，以及 UDP 的 49160–49200 端口。
- `status.hostIP` 是节点在集群里的地址：客户端能通过这个地址访问节点时（局域网、有公网地址的节点）直接用它就行。在云服务商的 NAT 后面，要把每个节点的公网地址填进 `PUBLIC_ADDRESS`，并让 NAT 转发相同的端口。
- 运行在节点网络上的 pod 要设置 `dnsPolicy: ClusterFirstWithHostNet`，才能解析服务的名字。
- 浏览器经由 `signaling` 服务前面的 Ingress 或负载均衡访问信令，并用 `transports: ['websocket']` 连接。
- 测试时一个 NATS pod 就够了；生产环境请运行 NATS 集群（用它的 Helm chart），或者带副本的 Redis。

仓库里的 `packages/webrtc/test-env/k3s/run.sh` 在 Docker 里的 k3s 上部署这些清单（两个节点，挂载代码而不是使用镜像），然后让两个成员分别通过两个 pod 连接，并且只经 TURN 服务器中转。

### 应用自己使用集群

应用也可以通过同一个组件和自己的其他实例通信：给其他所有节点发消息，向一个或所有节点发请求。

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

`cluster.nodes()` 列出所有节点，以及它们的标签和公布的信息（`announce()`）；组件还会发出 `node-up`、`node-down` 和 `node-update` 事件。消息以 JSON 发送；比服务器单条消息上限还大的消息（NATS 默认 1 MiB）会分成几段发送。

## 12. 信令协议

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

## 13. 连接失败时

`setDebugHandler()` 给出 ICE、DTLS、SCTP 和 TURN 的调试信息：

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

要检查 TURN 服务器，可以让两个客户端用 `iceTransportPolicy: 'relay'` 加入同一个房间：它们只能经过中转连接，`turn.allocations` 会统计到它们。在 Chrome 里，`chrome://webrtc-internals` 能看到候选地址和尝试过的地址对。

## 14. 限制

- Node.js 端不采集、不编码也不解码音视频：它的轨道传的是 RTP 包，来自编码器或者另一条连接。
- WHIP 不支持 Trickle ICE，也不支持 ICE 重启。
- 两个 Node.js 进程之间单个数据通道的吞吐量（Apple M4）：大消息约 60 MiB/s，100 字节的消息每秒约 44 万条。
