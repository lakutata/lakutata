# Lakutata WebRTC

WebRTC 让两端直接点对点连接：浏览器、Electron 应用和 Node.js 进程之间交换数据和音视频不需要服务器转发，在 NAT 和防火墙后面也能连上。`@lakutata/webrtc` 包提供这些连接周边需要的一切：让两端互相认识的信令，给需要的网络用的 STUN 和 TURN 服务器，给人多的房间用的媒体服务器，Node.js 端的对等连接，以及浏览器的客户端。它用 TypeScript 编写，没有原生代码，不属于 `lakutata`：

```bash
npm install lakutata @lakutata/webrtc
```

| 入口 | 运行在 | 提供什么 |
|---|---|---|
| `@lakutata/webrtc` | Node.js、Electron 的主进程、Bun | `Signaling`、`SignalingController`、`TURNServer`、`SignalingClient`、`PeerConnection`、`MediaTrack`、`SFU`、`WHIP`、`WHIPController`、`WHEP`、`WHEPController`、`Cluster`、`ChunkedChannel` |
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

不用控制器时组件也能用：`join()`、`signal()`、`leave()` 和 `disconnect()` 让应用自己的代码修改房间，`rooms()` 列出房间。应用自己加入的成员通过 `join()` 的 `receive` 选项接收它的事件。以 `sfu:` 和 `whip:` 开头的 id 留给服务端自己加入的成员（媒体服务器、WHIP 推的流），客户端用这样的 id 加入会被拒绝。

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

房间为其他每个成员发出 `peer` 事件：先是已经在房间里的成员，然后是每个新加入的成员。后来添加的监听函数会立即为已有的每个成员调用一次。`room.publish(track, stream)` 把一条轨道发给每个成员（第 8 节）；房间有媒体服务器时，`room.sfu` 是它的 id（第 9 节）。`Peer` 有成员的 `id`、`metadata`、到它的连接 `connection`（一个 `RTCPeerConnection`：可以读取统计信息），以及 `createDataChannel()`、`pause()` 和 `resume()`（暂停、恢复接收这个成员的某条轨道）、`restartIce()` 和 `close()`，会发出 `datachannel`、`track`、`connectionstatechange`、`metadata`（成员带着新的 metadata 重新加入）、`error` 和 `close` 事件。一个成员连接关闭时，房间发出 `peer-left`：成员离开了，或者连接彻底断了。

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

一条轨道传一个来源的音频或视频。在浏览器里，把摄像头和麦克风的轨道发布到房间里：`room.publish()` 把一条轨道发给每个成员，之后加入的成员也会收到。其他成员在各自的 peer 上通过 `track` 事件拿到它，`event.streams` 把同一个来源的音频和视频归在一起：

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

`room.unpublish(track)` 停止发送一条轨道，它用过的收发器留给之后发布的轨道。`peer.pause(track)` 和 `peer.resume(track)` 暂停和恢复接收某个成员的一条轨道，比如不在屏幕上的视频。没有媒体服务器时，直接加到 `peer.connection` 上的轨道只发给这一个成员。

没有媒体服务器时，有几个其他成员，每个成员的视频就要发几份：这适合人少的房间。用第 9 节的媒体服务器，每个成员只发一份。

Node.js 端不采集、不编码也不解码：应用的轨道传的是 RTP 包，也就是编码好的音视频，来自编码器或者另一条连接。

- `new MediaTrack(kind, {codec})` 创建一条要发送的轨道，`writeRtp()` 发送一个包：一个 `RtpPacket`，或者一个包的字节，比如 ffmpeg 和 GStreamer 发到 UDP 端口的数据报。每条连接给这些包换上自己的同步源（SSRC）和负载类型，序号和时间戳接着之前写入的包连续往下排。
- 收到的轨道（`Peer` 或 `PeerConnection` 的 `track` 事件）通过 `rtp` 事件交出对方发来的包；`requestKeyFrame()` 向对方请求关键帧。
- 把收到的轨道加到另一条连接上，它的包就会转发过去，那条连接的关键帧请求也会转回这条轨道的发送方（最多每 500 毫秒一次）。
- 轨道的 `keyframerequest` 事件表示它发往的某个对端需要关键帧。

一个摄像头应用，发送 ffmpeg 编码的视频：

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

观看方要从关键帧开始解码：让编码器每一两秒出一个关键帧（ffmpeg 的 `-g`），或者在编码器支持时，收到 `keyframerequest` 就生成一个。码流过滤器 `dump_extra` 把 H.264 的参数放到每个关键帧前面，浏览器需要从那里读到它们。

一个应用把某个成员的摄像头转发给后来加入的观看方，每个观看方从应用而不是从摄像头那里拿到视频（第 9 节的媒体服务器会为房间里的每个成员做这件事）：

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

`PeerConnection` 的方法和 `RTCPeerConnection` 一致：`addTrack(track, ...streamIds)`（对方把同一个流的轨道归在一起）、`addTransceiver(trackOrKind, {direction, streams})`（`recvonly` 表示只收不发）、`removeTrack(sender)`、`getTransceivers()`、`getSenders()` 和 `getReceivers()`；`sender.replaceTrack()` 换发另一条轨道，用协商过的任一编码都可以，不用重新协商。支持的编码：音频 Opus 和 PCMU，视频 VP8、H.264 和 VP9；`PeerConnection` 和 `SignalingClient` 的 `codecs` 选项决定用哪些、按什么顺序，用 `codec` 创建的轨道会让它的连接协商这一种编码。

## 9. 媒体服务器

没有媒体服务器时，房间里的每个成员都要把自己的轨道发给其他每个成员：八个人开会，每个人的视频要上传七份，还要维持七条连接。`SFU` 组件是这些房间的媒体服务器（SFU，选择性转发单元）：每个成员只连接它，每条轨道只发一份，再从它那里收到其他人的轨道。服务器转发这些包时不解码；不管房间多大，一个成员的视频都只上传一份。

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

客户端不用改。服务器作为一个 id 以 `sfu:` 开头的成员加入它服务的每个房间，这个包的客户端（浏览器里的 `SignalingConnection`，Node.js 里的 `SignalingClient`）会连接它，而不再互相连接。房间和 peer 的用法和没有它时一样：

- `room.publish()` 把一条轨道只发一份给服务器，由服务器转发给每个成员，之后加入的成员也会收到。
- 每个 peer 发出它那个成员的轨道。这些轨道的 `event.streams` 是和服务器之间那条连接上的流；`room.streamOf(id)` 给出一个流来自哪个成员，以及这个流在那个成员自己的连接上的 id。
- `peer.createDataChannel()` 打开一条经过服务器的通道，服务器双向转发它的消息。和两个成员直连不同，服务器能看到这些消息。这样的通道不能指定 `protocol`，也不能用 `negotiated`。
- `peer.pause(track)` 让服务器暂停发送一条轨道，`peer.resume(track)` 让它恢复发送。
- `room.sfu` 是服务器的 id，`peer.connection` 是和服务器之间的连接，所有 peer 共用这一条：用 `room.publish()` 发布轨道，不要直接加到这条连接上。

`buildSFUOptions` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `signaling` | `'signaling'` | 服务器服务哪个 `Signaling` 组件的房间 |
| `serves` | 所有房间 | `(room) => boolean`：服务哪些房间；其他房间仍然点对点 |
| `select` | 每个成员收到其他人的每条轨道 | `(subscriber, track) => boolean`：一个成员收不收某条轨道 |
| `maxMembers` | `0` | 所有房间加起来最多多少成员，0 表示不限；达到上限后再加入的成员会被拒绝（`SignalingLimitException`） |
| `codecs` | Opus、PCMU、VP8、H.264、VP9 | 成员可以用哪些编码发布 |
| `icePortRange`、`iceAdditionalHostAddresses` | | 连接使用的 UDP 端口（每条连接在本机的每个地址上各占一个端口：端口范围要够所有成员用），以及服务器的公网地址 |
| `workers` | `0` | 转发房间用的工作线程数，用来利用更多的核 |
| `cluster`、`selectSFU` | | 多个节点上的媒体服务器（第 13 节） |

对每个成员和其他人的每条轨道，都会问一次 `select`；成员带着新的 metadata 重新加入房间时会再问一次，它收哪些轨道按新的回答来。`select` 抛出错误时按 `false` 处理，错误记到调试信息里（第 15 节）。比如在网络研讨会里，每个人都收所有人的音频，但只收主讲人的视频：

```typescript
import {buildSFUOptions, type SFUTrack, type SignalingPeer} from '@lakutata/webrtc'

const sfu = buildSFUOptions({
    select: (subscriber: SignalingPeer, track: SFUTrack): boolean => track.kind === 'audio' || track.peerId.startsWith('speaker-')
})
```

服务器怎么转发：

- 它不转码：成员只收到它支持的编码的轨道，对其他轨道，服务器会发出 `unsupported` 事件。给浏览器用时，视频请用 VP8 或 H.264 发布。
- 成员的关键帧请求会转给发布者，最多每 500 毫秒一次；有成员开始接收某路视频时，服务器会向发布者要一个关键帧。发往成员途中丢失的包由服务器重发。
- 每条连接都根据对方的反馈估计自己的带宽：浏览器据此调整发给服务器的码率；发往某个成员的带宽一直不够它接收的内容时，服务器发出 `congestion` 事件，带宽恢复后再发一次。服务器按发布时的样子发送每路视频（还没有 simulcast）：要减轻这个成员的负担，可以暂停它接收的部分视频。
- 成员读取某条通道的消息比对方发送得慢时，发送方要等待；服务器最多替它们缓存几兆字节的消息。

它的事件：成员开始和停止发布一条轨道时发出 `publish` 和 `unpublish`（一个 `SFUTrack`：它的 `room`、`peerId`、`id`、`kind`、`codec` 和 `stream`）；成员不支持它该收的某条轨道的编码时发出 `unsupported`（房间、成员的 id、轨道）；`congestion`（房间、成员的 id、带宽是否不够、估计的码率，单位比特每秒）。`rooms()` 列出各个房间，以及它们的成员、轨道和 WHEP 观众。`track(room, peerId, trackId)` 把一条已发布的轨道作为 `MediaTrack` 交出来，它的 `rtp` 事件给出这条轨道的包，可以用来录制，或者转发到另一条连接：

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

服务器默认在主线程里转发。设成 `workers: 4` 时，由四个工作线程转发各个房间：每个房间整个放在其中一个线程里（房间开启时转发的成员和观众最少的那个），连同它的连接和 UDP 端口；钩子和事件仍然在主线程。`icePortRange` 会分给各个线程。某个线程停止时会关闭它上面的房间；服务器在另一个线程里重新开启这些房间，房间里的成员会重新连上它。`rooms()` 显示的是各个线程报上来的情况，所以线程里发生的变化（比如有观众离开）要稍晚一点才看得到。

下面是在 Apple M4 和 Node.js 24 上测得的结果：每个发布者发送约 2 Mbit/s 的视频（每秒 200 个 1250 字节的包），成员在其他进程里。

| 房间 | 要转发的包 | 实际转发 | CPU |
|---|---|---|---|
| 1 个房间，4 个发布者、10 个订阅者，在主线程 | 每秒 7,200 个 | 全部 | 一个核的 31% |
| 4 个房间，每个 12 个发布者、10 个订阅者，在主线程 | 每秒约 95,000 个 | 每秒 59,300 个 | 133%：主线程满了，其余是垃圾回收 |
| 同样的 4 个房间，4 个工作线程 | 每秒约 95,000 个 | 全部（每秒 93,000 个） | 257% |

一个线程约占 22 MiB，启动约需 90 毫秒。在上面的负载下，有线程时进程用了 1.4 GiB 内存，没有线程时 0.6 GiB，因为每个线程各自的堆都会增长。一条轨道从一个节点转发到另一个节点（第 13 节），两个节点每个包合计约耗 11 微秒 CPU：这样一路视频约占一个核的 0.2%。

## 10. 用 WHIP 推流

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
| `POST /whip/:stream`，请求体是 offer（`application/sdp`） | `201 Created`：answer、`Location`（会话）、`Link`（ICE 服务器）、`ETag`（它的 ICE 会话） |
| `DELETE /whip/:stream/:session` | `200`：会话结束 |
| `OPTIONS` | `204`，带 CORS 头和 `Accept-Post: application/sdp` |
| `GET` | `204` |
| `PATCH /whip/:stream/:session`，请求体是 SDP 片段（`application/trickle-ice-sdpfrag`） | `204`：推流端的候选地址（Trickle ICE）；`200`：ICE 重启，带应答的片段和新的 `ETag`；`If-Match` 既不是 `*` 也不是这个 `ETag` 时回 `412` |

拒绝的情况：`authorize` 拒绝时回 401，带 `WWW-Authenticate: Bearer`；请求体不是 `application/sdp`（PATCH 的不是 `application/trickle-ice-sdpfrag`）时回 415；offer 里没有音视频时回 400；已经有 `maxSessions` 个会话时回 503；会话不存在时回 404。会话的 URL 就是结束它的凭证：它的 id 是随机的，DELETE 和 PATCH 不再做授权检查。子类加上 `@Prefix({route: '/live'})`，就能在另一个路径下提供同样的接口。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `authorize` | 无 | `({stream, token}, context) => boolean`：谁能推哪路流 |
| `turn` | 无 | 一个 `TURNServer` 组件的名字：推流方在 `Link` 头里拿到它的 ICE 服务器 |
| `iceServers` | `[]` | 给推流方的更多 ICE 服务器 |
| `maxSessions` | `100` | 同时最多多少个会话，`0` 表示不限 |
| `allowOrigin` | `'*'` | 允许哪些来源的浏览器推流 |
| `icePortRange`、`iceAdditionalHostAddresses` | | 服务器的候选地址：它的 UDP 端口、它的公网地址 |
| `codecs` | Opus、PCMU、VP8、H.264、VP9 | 接受的编码 |
| `sfu` | 无 | 一个 `SFU` 组件的名字：推的流进入它的房间 |
| `roomOf` | 流的名字 | `({stream, token}, context) => string`：一路流进入媒体服务器的哪个房间 |

answer 里带有服务器的全部候选地址，服务器收集完才回答：在 NAT 后面或者容器里，要告诉它自己的公网地址，并放开它的端口。

配置了 `sfu` 时，推的流不再交给应用，而是进入媒体服务器（第 9 节）的一个房间：默认是和流同名的房间，`roomOf` 可以指定别的房间。它作为一个 id 以 `whip:` 开头的成员加入房间，房间里的成员像收其他成员的轨道一样收到它的轨道，WHEP 观众也能拉这路流（第 11 节）。这时它的连接归媒体服务器管，所以会话里没有 `connection` 和 `tracks`，而是这路流的 `room` 和 `peerId`；要拿它的包，用 `sfu.track()`。

## 11. 用 WHEP 拉流

WHEP（WebRTC-HTTP Egress Protocol）用一个 HTTP 请求拉一路流：播放端提交一个只收不发的 offer，拿回 answer 和它的会话 URL。`WHEP` 组件播放媒体服务器的房间：每个观众收到房间里一个成员的音频和视频，默认是用 WHIP 推进这个房间的流。观众不是房间的成员，所以成员看不到他们，一路流可以有很多观众。`WHEPController` 是它的 HTTP 接口，路径在 `/whep` 下面。

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

浏览器用自己的 `RTCPeerConnection` 播放，offer 里带上全部候选地址：

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

| 请求 | 回答 |
|---|---|
| `POST /whep/:stream`，请求体是 offer（`application/sdp`） | `201 Created`：answer、`Location`（会话）、`Link`（ICE 服务器）、`ETag`（它的 ICE 会话） |
| `DELETE /whep/:stream/:session` | `200`：会话结束 |
| `PATCH /whep/:stream/:session`，请求体是 SDP 片段（`application/trickle-ice-sdpfrag`） | 和 WHIP 一样：观众的候选地址回 `204`；ICE 重启回 `200`，带应答的片段；`If-Match` 既不是 `*` 也不是这个 `ETag` 时回 `412` |
| `OPTIONS` | `204`，带 CORS 头和 `Accept-Post: application/sdp` |
| `GET` | `204` |

拒绝的情况：`authorize` 拒绝时回 401，带 `WWW-Authenticate: Bearer`；请求体类型不对时回 415；offer 里没有音视频，或者媒体服务器不服务这个房间时回 400；已经有 `maxSessions` 个会话时回 503；会话不存在时回 404。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `sfu` | `'sfu'` | 播放哪个 `SFU` 组件的房间 |
| `roomOf` | 流的名字 | `({stream, token}, context) => string`：一路流来自哪个房间 |
| `select` | 最新的 WHIP 推流，没有时是第一个在发布的成员 | `({stream, token}, tracks) => string \| undefined`：观众收哪个成员（它的 id） |
| `authorize` | 无 | `({stream, token}, context) => boolean`：谁能拉哪路流 |
| `maxSessions` | `100` | 本节点同时最多多少个会话，`0` 表示不限 |
| `allowOrigin` | `'*'` | 允许哪些来源的浏览器拉流 |
| `turn`、`iceServers` | | 在 `Link` 头里给观众的 ICE 服务器 |
| `cluster`、`turnSecret`、`selectTURN` | | 多个节点（第 13 节） |

一个观众只收一个成员：默认是用 WHIP 推进房间的最新那路流，没有时是第一个发布音视频的成员。`select` 可以另选一个；房间里的轨道每次变化都会重新问它，它抛出错误时观众收默认的那个成员。这个成员停止发布后，观众在同一条连接上接着收下一个：画面会停一下，从下一个关键帧开始恢复。观众的 offer 决定了它收什么，也就是一路音频和一路视频；它的连接会协商 offer 里所有服务器也支持的编码，所以之后用其中任何一种编码推的流也能发给它。

组件在回答之后发出 `play`（会话：它的 `id`、`stream`、`room`、`viewerId` 和 `source`，也就是它正在收的成员），会话结束时发出 `stop`：观众删除了它，它的连接失败或关闭了，或者应用停止了。`whep.sessions` 列出本节点的会话，`sfu.rooms()` 统计每个房间的观众数。

## 12. 部署

- **端口。** 放开 UDP 和 TCP 的 3478 端口、UDP 的中转端口（`relayPortRange`），开启了 TLS 上的 TURN 时还有 TLS 端口。在容器里要把它们全部发布出来；指定中转端口范围可以让需要发布的端口少一些。
- **公网地址。** `publicAddress` 是客户端访问 TURN 服务器用的地址：主机的公网地址，或者转发了这些端口的 NAT 的地址。在局域网里用默认值就够了。
- **应用作为成员。** 位于 NAT 后面的服务器，如果 NAT 按相同的端口号转发了 `icePortRange`，就把它的公网地址写进 `iceAdditionalHostAddresses`；否则它和其他客户端一样依靠 TURN 服务器。
- **媒体服务器、WHIP 和 WHEP。** 客户端直接连接它们：放开它们 `icePortRange` 的 UDP 端口；NAT 按相同端口号转发这些端口时，把 NAT 的公网地址写进 `iceAdditionalHostAddresses`。连不上它们的客户端经 TURN 服务器中转。
- **多个实例。** 给它们配置 `Cluster`（第 13 节），并给它们的 TURN 服务器配置相同的 `secret`，这样每个实例都认其他实例生成的凭据。
- **其他 TURN 服务器。** coturn（`use-auth-secret`，`static-auth-secret` 设为相同的密钥）接受 `createTURNCredentials()` 生成的凭据；把它写进 `Signaling` 的 `iceServers` 选项。
- **HTTPS。** 浏览器在任何页面上都允许使用 WebRTC，但摄像头和麦克风只能在安全的页面上使用（HTTPS 或 `localhost`）。

## 13. 多个实例

应用部署成多个实例时（Kubernetes 部署里的多个 pod、负载均衡后面的多个进程），给它们配置一个 `Cluster`：每个实例是集群里的一个节点，节点之间通过 NATS 或 Redis 通信。把它的名字告诉其他组件后，这些组件就能跨节点工作：

- 信令把连在各个节点上的成员放进同一批房间；
- TURN 服务器把自己的地址和负载告诉其他节点，每个成员拿到负载最低的几个；
- 媒体服务器共同承载房间：每个成员、每路 WHIP 推流和每个 WHEP 观众都连到某一个节点的媒体服务器上，同一个房间的媒体服务器之间互相转发房间的轨道；
- WHIP 或 WHEP 会话的 DELETE 和 PATCH 请求不管到了哪个节点，都能结束或修改这个会话。

总线上只传这些消息。音视频和数据仍然在客户端和节点之间、各节点的媒体服务器之间直接传输，或者经 TURN 服务器中转。

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

### 集群里的媒体服务器

配置了 `cluster` 后，各节点的媒体服务器共同承载房间：每个媒体服务器的 id 是 `sfu:` 加上它所在节点的 id，每个成员连到某一个节点的媒体服务器上。

- 一个房间尽量只放在少数几个节点上。第一个成员分到它加入时所经过的节点，那个节点满了就分到负载最低的节点；之后的成员分到这个房间已经在用的节点里负载最低的那个，这些节点都满了时，分到所有节点里负载最低的那个。负载均衡把客户端随机分到各个节点：没有这条规则，三个人的会议可能会用上三个节点。
- `selectSFU` 可以改成由应用来挑节点，比如挑离成员最近的；它挑的节点满了或者没有回应时，按默认的规则挑。
- 只有信令、没有媒体服务器的节点，会去问负载最低的那个有媒体服务器的节点，由那个节点来挑（`selectSFU` 在那里执行）。
- `maxMembers` 是每个节点的上限：成员加入时没有节点肯接收，加入就会被拒绝（`SignalingLimitException`）。WHIP 推流和 WHEP 观众也按同样的方式分配节点（观众不计入 `maxMembers`，由 WHEP 的 `maxSessions` 限制）。
- 每个媒体服务器的事件和它的 `rooms()` 只包括本节点上的成员。

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

同一个房间的媒体服务器之间互相转发房间的轨道。一条轨道只要某个节点上有人接收（被 `select` 选中的成员、观众、`sfu.track()`），就给那个节点发一份，不管那里有多少人接收，而且从发布者所在的节点直接发过去。节点之间和客户端一样用 WebRTC 连接（DTLS-SRTP），走各自的 `icePortRange`。分在不同节点上的两个成员之间的数据通道，会经过两个节点的媒体服务器。

某个节点下线时（它停止了，或者其他节点连续三次没收到它的心跳，约 6 秒），它的媒体服务器离开它的房间。它上面的成员通过信令重新加入房间，分到另一个节点的媒体服务器，重新发布自己的轨道；其他人会看到这些成员的轨道中断几秒。换了节点的成员，它自己的 peer 和别人到它的 peer 都会关闭再重新打开，就像成员刷新了页面一样：`peer` 的监听函数会重新创建它的通道。如果这时所有节点都满了，客户端不会像第一次 `join()` 那样直接失败：它先等 1 秒再试，之后每次等待时间加倍（最多 10 秒），每次失败它的信令都发出一个 `error`，直到有节点接收这个成员，或者它离开了这个房间。

WHIP 或 WHEP 会话保存在回答了它的 POST 请求的节点上，它的连接则在为它挑选的节点上。它的 PATCH 和 DELETE 请求可以到达任何节点；PATCH 到了不持有会话的节点时，要等所有节点回应，最多 12 秒。观众默认收它所在节点最后得知的那路 WHIP 推流。

### 负载均衡后面的 WHIP 和 WHEP

WHIP 或 WHEP 会话保存在回答了它的 POST 请求的那个节点上。配置了 `cluster` 后，另一个节点的 `WHIP` 或 `WHEP` 组件收到这个会话的 DELETE 或 PATCH 请求时，会去问其他节点，由持有会话的节点处理。`maxSessions` 统计的是每个节点自己的会话。

### Kubernetes 和 k3s

下面的清单部署 NATS、信令（两个 pod），以及每个节点上的一个 TURN 服务器和一个媒体服务器。应用只有一个镜像，三种角色由环境变量 `ROLE` 决定：

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

- TURN 服务器和媒体服务器运行在所在节点的网络上（`hostNetwork`）：客户端通过节点的地址和节点的端口访问它们。在节点的防火墙里放开 UDP 和 TCP 的 3478 端口、UDP 的 49160–49200 端口和 UDP 的 40000–40999 端口；各节点的媒体服务器之间也通过 40000–40999 端口互相连接。
- `status.hostIP` 是节点在集群里的地址：客户端能通过这个地址访问节点时（局域网、有公网地址的节点）直接用它就行。在云服务商的 NAT 后面，要把每个节点的公网地址填进 `PUBLIC_ADDRESS`，让 NAT 转发相同的端口，并把这个地址写进媒体服务器的 `iceAdditionalHostAddresses`。
- 运行在节点网络上的 pod 要设置 `dnsPolicy: ClusterFirstWithHostNet`，才能解析服务的名字。
- 浏览器经由 `signaling` 服务前面的 Ingress 或负载均衡访问信令，并用 `transports: ['websocket']` 连接。
- 测试时一个 NATS pod 就够了；生产环境请运行 NATS 集群（用它的 Helm chart），或者带副本的 Redis。
- 整个集群同时启动时，pod 可能在集群的 DNS 能解析 `nats` 之前就启动了（日志里是 `getaddrinfo EAI_AGAIN nats`）：应用启动时连不上 NATS 就会停止，Kubernetes 会一直重启它，直到能连上。这时每个 pod 重启几次是正常的。

仓库里的 `packages/webrtc/test-env/k3s/run.sh` 在 Docker 里的 k3s 上部署这些清单（两个节点，挂载代码而不是使用镜像）。它先让两个成员分别通过两个 pod 连接，并且只经 TURN 服务器中转；再让两个成员分别连到两个节点的媒体服务器，然后删掉其中一个成员所在的 pod：这个成员会转到替代它的那个 pod 上。

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

## 14. 信令协议

其他语言的客户端和原生应用可以直接使用这个协议。请求是模式为 `{method}` 的服务调用：Socket.IO 上是带确认回调（`{success, error, payload}`）的 `message` 事件，内容如 `{method: 'webrtc.join', room: 'room-1'}`；JSON-RPC 2.0 上是方法名为 `webrtc.join` 的请求。服务端把事件推给成员：Socket.IO 的事件，或者 `params` 里放着内容的 JSON-RPC 通知。

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
| `webrtc:peer-left` | `{room, peerId, reason}`：主动离开时是 `left`，客户端断开时是 `disconnected` |
| `webrtc:signal` | `{room, from, session, description, streams}` 或 `{room, from, session, candidate}` |

- `session` 是客户端自己选的一个随机字符串，只选一次。成员用同一个会话重新加入时（信令重新连上之后），其他成员保留到它的连接；用新的会话加入时（页面刷新了），其他成员会替换到它的连接。
- Socket.IO 和 WebSocket 上的 JSON-RPC 的 `heartbeatInterval` 是 0：服务端能察觉它们的连接关闭。在其他传输方式上，客户端每隔这么久发送一次 `webrtc.heartbeat`；连续三个间隔没有任何请求时，它会离开它的房间。
- 一对成员里，id 排在前面（按字符串比较）的一方是“礼让”的一方：双方同时发出 offer 时，它放弃自己的 offer，回答对方的。
- 媒体服务器相关的字段都由服务端设置：`role` 对媒体服务器是 `sfu`，对 WHIP 推流是 `whip`（客户端没有这个字段）；`sfu` 是一个成员所连的媒体服务器的 id，在 `webrtc.join` 的返回里是客户端要连的那个。在有媒体服务器的房间里，客户端只连接它，并且在和它的连接里做礼让的一方。媒体服务器发出的 description 带有 `streams`：它发出的每个流在这条连接上的 `id`、来自哪个成员（`peerId`），以及这个流在那个成员自己的连接上的 id（`stream`）。
- 在和媒体服务器的连接上，1023 号数据通道（标签 `webrtc.control`，两边都用 `negotiated: true` 和这个 `id` 创建）传 JSON 格式的 `{type: 'pause' | 'resume', mid}`：服务器暂停或恢复发送这个收发器的轨道。经过服务器发给某个成员的数据通道，`protocol` 是那个成员的 id；服务器在那个成员一侧打开通道时，`protocol` 写的是发送方的 id。各节点的媒体服务器之间也用 1023 号通道，以及 `protocol` 为 JSON 格式 `["发送方", "成员"]` 的通道。
- 错误带有服务端异常的 `errno`：`E_SIGNALING_DENIED`、`E_SIGNALING_LIMIT`（房间满了，或者没有媒体服务器肯接收这个成员）、`E_SIGNALING_NOT_A_MEMBER`、`E_SIGNALING_CLIENT_REQUIRED`、`E_INVALID_VALUE`。HTTP 上的 JSON-RPC 不能承载信令：事件需要通过一条连接推送。

## 15. 连接失败时

`setDebugHandler()` 给出 ICE、DTLS、SCTP 和 TURN 的调试信息：

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

媒体服务器的工作线程也把调试信息发到同一个处理函数，每条信息以线程编号开头（`[thread 0] …`）。媒体服务器或 WHEP 的 `select` 抛出的错误记在 `webrtc/sfu` 和 `webrtc/whep` 下面。

要检查 TURN 服务器，可以让两个客户端用 `iceTransportPolicy: 'relay'` 加入同一个房间：它们只能经过中转连接，`turn.allocations` 会统计到它们。在 Chrome 里，`chrome://webrtc-internals` 能看到候选地址和尝试过的地址对。

## 16. 限制

- Node.js 端不采集、不编码也不解码音视频：它的轨道传的是 RTP 包，来自编码器或者另一条连接。
- 两个 Node.js 进程之间单个数据通道的吞吐量（Apple M4）：大消息约 60 MiB/s，100 字节的消息每秒约 44 万条。
- 媒体服务器不转码，按发布时的样子发送每路视频：还没有 simulcast，所以带宽不够的成员收到的是 `congestion` 事件，而不是更低的画质。它在一台机器上的转发能力见第 9 节；仓库里的 `packages/webrtc/test-env/bench/forward.mjs` 可以在别的机器上测。
- 集群里的媒体服务器把一条轨道从发布者所在的节点直接发给每个需要它的节点，一个房间分布在几十个节点上没有问题；再多的话，就需要节点之间逐级转发了。
