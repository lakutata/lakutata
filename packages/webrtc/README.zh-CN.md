# @lakutata/webrtc

[English](README.md) | 中文

[Lakutata](https://www.npmjs.com/package/lakutata) 框架的 WebRTC 实现，使用 TypeScript 编写，不含原生代码。因此，本包安装时无需编译器，可在 Node.js、Electron 的主进程和 Bun 中运行。本包有两个入口：

- `@lakutata/webrtc`，供应用使用：信令（房间中的成员相互交换 offer、answer 和候选地址）、STUN 和 TURN 服务器、供成员众多的房间使用的媒体服务器（SFU），以及通过 WHIP 推流和通过 WHEP 拉流的功能。该入口还提供 Node.js 端的对等连接（数据通道、音视频轨道），其接口与浏览器的 `RTCPeerConnection` 一致。应用所在房间中的成员可以通过数据通道调用应用的服务动作。应用的多个实例可以通过 NATS 或 Redis 协同工作，其媒体服务器同样如此。
- `@lakutata/webrtc/client`，供浏览器和 Electron 的渲染进程使用：将浏览器自带的 `RTCPeerConnection` 连接到信令。该入口只使用浏览器的接口，因此前端打包该入口时不会带入服务端代码。

协议的实现（ICE、DTLS、SCTP 和数据通道、RTP 和 SRTP、STUN 和 TURN 服务器）改编自 [werift](https://github.com/shinyoshiaki/werift-webrtc)，参见 `THIRD_PARTY_NOTICES.md`。

## 安装

```shell
npm install @lakutata/webrtc
```

应用还需要 `lakutata`（或者 `@lakutata/core` 和 `@lakutata/entrypoint`）。信令通过入口的适配器提供，基于 Socket.IO（`npm install socket.io`）或 WebSocket 上的 JSON-RPC（`npm install ws`）。应用作为成员通过 Socket.IO 加入房间时需要 `socket.io-client`；通过 JSON-RPC 加入时，使用 Node.js 22 和 Bun 内置的 `WebSocket`，运行环境未内置该类时使用 `ws` 的 `WebSocket`（Node.js 18 到 21）。多个实例协同工作时需要 `nats` 或 `ioredis`。

前端安装同一个包，并导入 `@lakutata/webrtc/client`；框架不会随之安装。

## 用法

服务端：信令、TURN 服务器，以及入口上的信令控制器。

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

浏览器：加入房间，并与其他每个成员各打开一个数据通道。

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

应用作为成员：一台设备将读数发送给进入其房间的每个人。

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

不使用本包的信令时，可以直接获取一个 `PeerConnection`（`await this.getObject(PeerConnection, {iceServers})`），像在浏览器中使用 `RTCPeerConnection` 那样自行交换 offer、answer 和候选地址。连接较多时，`PeerThreads` 组件可以将这些连接的引擎放到工作线程中运行，以利用更多的核。为此，请将该组件的名称作为连接的 `threads` 选项（`SignalingClient` 也有该选项）。

房间的行为：

- **连接。** 成员为其他每个成员各获得一个 `Peer`，其中带有通往该成员的连接（`peer.connection`：在浏览器中为 `RTCPeerConnection`，在 Node.js 中为 `PeerConnection`）。任何一方添加数据通道或轨道时，连接即会建立。offer 和 answer 按照 W3C 的“完美协商”（perfect negotiation）交换。双方随时都可以添加通道和轨道，也可以同时添加。双方只希望共用一个通道时，两端都使用 `negotiated: true` 和相同的 `id` 创建该通道。
- **修复。** 连接失败时，或者断开超过 5 秒时，会自动重启 ICE。信令连接断开时，点对点连接保持不变；信令恢复后，客户端重新加入其原先所在的房间，其他成员保留通往该客户端的连接。成员刷新页面后以新的会话加入，其他成员会替换通往该成员的连接。
- **离开。** `room.leave()` 关闭该房间的连接，其他成员收到 `peer-left`。成员的信令连接（Socket.IO，或 WebSocket 上的 JSON-RPC）关闭时，该成员会离开其所在的房间；其点对点连接保留到该成员回来或这些连接失败为止。
- **ICE 服务器。** 成员加入房间时从服务端获取 ICE 服务器，TURN 凭据在 `credentialTtl`（默认一天）内有效，客户端会在到期前重新获取。凭据过期后，用其建立的中转仍正常工作。
- **检查。** 成员只能向其所在房间的成员发送信令；信令的大小（64 KiB）和频率（平均每秒 50 条）受到限制，`authorize` 选项决定谁能加入哪个房间。

大消息：数据通道与任何一方之间都能传输 64 KiB 以内的消息；Chrome 和本包的连接能接收 256 KiB 以内的消息。两端都用 `ChunkedChannel` 包装通道后，消息会被切分为小块发送，再在对端重组为原样，因此任意大小的消息和文件都能传输：

```typescript
import {ChunkedChannel, type PeerChannel} from '@lakutata/webrtc'

declare const channel: PeerChannel
const transfer: ChunkedChannel = new ChunkedChannel(channel)
transfer.on('message', (data: string | Uint8Array): void => console.log(`${data.length} received`))
await transfer.send(new Uint8Array(50 * 1024 * 1024))
```

调用应用的动作：`webrtcServiceEntrypoint()` 通过通往应用的数据通道，将应用的服务动作（`@ServiceAction`）提供给应用所在房间的成员，输入校验和访问控制照常生效。调用是 JSON-RPC 2.0 消息，由成员通过 `PeerServiceProxy` 发起：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {PeerServiceProxy, webrtcServiceEntrypoint, type Peer} from '@lakutata/webrtc'

class DoorController extends Controller {
    @ServiceAction({method: 'door.open'})
    public async open(input: {door: string}): Promise<string> {
        return `${input.door} is open`
    }
}

//设备：房间 door-7 里的成员 door-7
Application.run({
    id: 'door.device',
    name: 'Door',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [DoorController],
            service: webrtcServiceEntrypoint({signaling: {url: 'https://meet.example.com', id: 'door-7'}, rooms: ['door-7']})
        })
    },
    bootstrap: ['entrypoint']
})

//房间里的另一个成员（浏览器从 @lakutata/webrtc/client 导入 PeerServiceProxy）
declare const peer: Peer
const door: PeerServiceProxy = new PeerServiceProxy(peer.createDataChannel('service'))
console.log(await door.invoke({method: 'door.open', door: 'front'}))
```

调用的客户端 ID 是调用方的成员 ID。在动作依赖该 ID 之前，应先让信令服务器认证其客户端。

音视频：浏览器将摄像头和麦克风的轨道发布到房间中，并通过每个 peer 的 `track` 事件获取其他成员的轨道。

```typescript
import {type Peer, type Room} from '@lakutata/webrtc/client'

declare const room: Room
declare const remoteVideo: HTMLVideoElement
const camera: MediaStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true})
for (const track of camera.getTracks()) await room.publish(track, camera)
room.on('peer', (peer: Peer): void => {
    peer.on('track', (event: RTCTrackEvent): void => {
        remoteVideo.srcObject = event.streams[0]
    })
})
```

Node.js 端不采集、不编码，也不解码。应用的轨道传输的是 RTP 包，即已编码的音视频。待发送的 `MediaTrack` 通过 `writeRtp()` 写入编码器（ffmpeg、GStreamer）输出的包；收到的轨道通过 `rtp` 事件提供对方发来的包，可用于录制或解码，`requestKeyFrame()` 向对方请求关键帧。将收到的轨道添加到另一条连接上后，该轨道的包会转发到那条连接，那条连接的关键帧请求也会转回该轨道的发送方。以下是一个摄像头应用，发送由 ffmpeg 编码的视频：

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

观看方需要从关键帧开始解码。请让编码器每一两秒生成一个关键帧（ffmpeg 的 `-g`），或者在编码器支持时，收到轨道的 `keyframerequest` 事件后即生成一个关键帧。支持的编码为：音频 Opus 和 PCMU，视频 VP8、H.264 和 VP9（`PeerConnection` 和 `SignalingClient` 的 `codecs` 选项）。

供成员众多的房间使用的媒体服务器：没有媒体服务器时，每个成员的视频需要为其他每个成员各发送一份。`SFU` 组件加入其服务的房间，客户端只连接该组件。每个客户端的轨道只发送一份，再从服务器收到其他人的轨道，服务器转发这些包时不解码。房间和 peer 的用法与没有媒体服务器时相同（`room.publish()`、peer 的 `track` 事件、`peer.createDataChannel()`，其中数据通道的消息由服务器转发，服务器也能看到这些消息），因此客户端的代码无需修改。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildSFUOptions, buildSignalingOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        signaling: buildSignalingOptions(),
        //会议经过媒体服务器，它的连接使用 UDP 的 40000 到 40999 端口
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
    bootstrap: ['sfu', 'entrypoint']
}))
```

`select` 决定哪个成员接收哪条轨道，`peer.pause()` 和 `peer.resume()` 暂停和恢复一条轨道，`sfu.track()` 提供一条轨道的包（用于录制），`workers` 让工作线程转发房间，以利用更多的核。服务器不转码。供浏览器使用时，请以 VP8 或 H.264 发布视频。

通过 WHIP 推流（RFC 9725）：编码器（OBS、GStreamer、ffmpeg）和浏览器通过一个 HTTP POST 提交 offer，即可推送一路流。`WHIP` 组件回答这些推流方，推流开始时发出 `publish` 并附带会话（会话的连接和轨道），会话结束时发出 `unpublish`；`WHIPController` 提供 `/whip/:stream` 接口。配置了 `sfu` 选项时，推送的流改为作为成员进入媒体服务器的一个房间。

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
    }
}

Application.run(() => ({
    id: 'studio.app',
    name: 'Studio',
    components: {
        //OBS：服务选 WHIP，服务器填 https://studio.example.com/whip/live，再填上 Bearer 令牌
        whip: buildWHIPOptions({authorize: ({token}): boolean => token === process.env.WHIP_TOKEN}),
        studio: {class: Studio},
        entrypoint: buildEntrypoints({
            controllers: [WHIPController],
            //offer 的类型是 application/sdp，按文本读取
            http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
        })
    },
    bootstrap: ['studio', 'entrypoint']
}))
```

answer 中带有服务器的全部候选地址。请为服务器提供其公网地址（`iceAdditionalHostAddresses`）和需要放开的 UDP 端口（`icePortRange`）。会话的 `PATCH` 请求将推流端的候选地址提交给服务器（Trickle ICE），或者重启 ICE；`body.text` 中也必须列出 `application/trickle-ice-sdpfrag`，否则 PATCH 请求会以 415 被拒绝：使用 Express 时由控制器拒绝，使用 Fastify 时由 Fastify 在请求到达控制器之前拒绝。ffmpeg 使用 `-f whip -authorization <令牌> <URL>` 推流。

通过 WHEP 拉流：播放端将一个只收不发的 offer 提交到 `/whep/:stream`（`WHEPController`），`WHEP` 组件将媒体服务器房间中一个成员的音频和视频发送给该播放端。该成员默认为通过 WHIP 推送到该房间的流，或者 `select` 选中的成员。观众不是房间的成员，一路流可以有很多观众。

```typescript
import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions, buildWHIPOptions} from '@lakutata/webrtc'

//OBS 推到 /whip/concert，浏览器从 /whep/concert 拉流（WHIPController 和 WHEPController）
const components = {
    signaling: buildSignalingOptions(),
    sfu: buildSFUOptions({icePortRange: [40000, 40999]}),
    whip: buildWHIPOptions({sfu: 'sfu', authorize: ({token}): boolean => token === process.env.WHIP_TOKEN}),
    whep: buildWHEPOptions({maxSessions: 500})
}
```

应用的多个实例（例如一个部署中的多个 pod）通过 `Cluster` 协同工作。每个实例是一个节点，节点之间通过 NATS 或 Redis 通信。将该组件的名称提供给其他组件后，信令会将连接在各个节点上的成员放入同一批房间；TURN 服务器会将自身的地址和负载通报给其他节点；媒体服务器共同承载房间（每个成员连接到某一个节点的媒体服务器，同一个房间的节点之间相互转发轨道）；WHIP 或 WHEP 会话的 DELETE 和 PATCH 请求无论到达哪个节点，都能结束或修改该会话。总线上只传输这些消息，音视频和数据仍在客户端与节点之间、各媒体服务器之间直接传输。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSignalingOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        //npm install nats；用 Redis 时写 {type: 'redis', url: process.env.REDIS_URL}，并 npm install ioredis
        cluster: buildClusterOptions({transport: {type: 'nats', servers: process.env.NATS_URL}}),
        //每个成员拿到集群里负载最低的两个 TURN 服务器，它们共用这个密钥
        signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['signaling', 'entrypoint']
}))
```

TURN 服务器通过 `cluster` 选项和共用的 `secret` 加入集群。某个节点停止，或者其他节点连续三次未收到其心跳时，该节点上的成员以 `disconnected` 离开房间。这些成员的连接不会断开，其客户端会重新连接到其他节点。连接在该节点媒体服务器上的成员会转到另一个节点的媒体服务器，这些成员在各方的 peer 会重新打开，如同成员刷新了页面一样。`maxPeers` 统计的是所有节点上的成员；媒体服务器的 `maxMembers`，以及 WHIP 和 WHEP 的 `maxSessions`，统计的是每个节点各自的数量。

## 部署

- **端口。** TURN 服务器在 3478 端口上监听 UDP 和 TCP（提供了证书时还监听 TLS）；中转使用 `relayPortRange` 中的 UDP 端口。请在防火墙中放开这些端口，或者从容器中发布这些端口。
- **地址。** `publicAddress` 是客户端访问服务器所用的地址：主机的公网地址，或者转发这些端口的 NAT 的地址。默认取主机第一个非内部的 IPv4 地址，在局域网中已足够。
- **媒体服务器。** 客户端直接连接媒体服务器。请放开其 `icePortRange` 的 UDP 端口；NAT 按相同端口号转发这些端口时，请将 NAT 的公网地址写入 `iceAdditionalHostAddresses`。WHIP 和 WHEP 同样如此。
- **多个实例。** 为这些实例配置 `Cluster`（见上文），并为其 TURN 服务器配置相同的 `secret`。在负载均衡之后，Socket.IO 需要会话保持（sticky session），除非客户端使用 `transports: ['websocket']` 连接。在 Kubernetes 中，请在每个节点的网络上运行一个 TURN 服务器和一个媒体服务器（使用 `hostNetwork` 的 DaemonSet）；部署清单见指南。
- **其他 TURN 服务器。** 配置了 `use-auth-secret` 和相同密钥的 coturn 也接受本包生成的凭据；请将该服务器写入 `Signaling` 的 `iceServers` 选项。

## 信令协议

请求是模式为 `{method}` 的服务调用：在 Socket.IO 上为带确认回调的 `message` 事件，内容如 `{method: 'webrtc.join', room: 'room-1'}`；在 JSON-RPC 上为方法名为 `webrtc.join` 的请求。成员的 ID 是其连接的客户端 ID（Socket.IO 的 `auth.id`，WebSocket 的 `id` 查询参数或请求头）。服务端将事件推送给成员，形式为 Socket.IO 的事件，或者 `params` 中携带内容的 JSON-RPC 通知。

| 请求 | 参数 | 返回 |
|---|---|---|
| `webrtc.join` | `room`、`metadata`、`session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval, sfu}` |
| `webrtc.signal` | `room`、`to`、`description` 或 `candidate` | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}` |
| `webrtc.heartbeat` | — | `{}` |

| 事件 | 内容 |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session, role, sfu}` |
| `webrtc:peer-left` | `{room, peerId, reason}`：`left` 或 `disconnected` |
| `webrtc:signal` | `{room, from, session, description, streams}` 或 `{room, from, session, candidate}` |

`heartbeatInterval` 不为 0 时，客户端每隔该毫秒数发送一次 `webrtc.heartbeat`，这种情况出现在服务端无法察觉断开的传输方式上（在 Socket.IO 和基于 WebSocket 的 JSON-RPC 上，服务器返回 0）。`session` 是客户端自行选择的一个随机字符串，只选择一次；以同一个会话重新加入时，其他成员会保留通往该成员的连接。在有媒体服务器的房间中，`sfu` 是客户端应连接的媒体服务器的 ID（该服务器的 `role` 为 `sfu`），服务器发出的 description 带有 `streams`，说明每个流来自哪个成员；媒体服务器的数据通道见指南。

## 限制

- Node.js 端不采集、不编码，也不解码音视频。Node.js 端的轨道传输的是 RTP 包，来自编码器或另一条连接。
- 媒体服务器不转码，按发布时的原样发送每路视频（尚不支持 simulcast）。

## API

| 导出 | 说明 |
|---|---|
| `Signaling`、`buildSignalingOptions` | 房间组件：成员、信令、限制、`authorize`、ICE 服务器 |
| `Cluster`、`buildClusterOptions` | 通过 NATS 或 Redis 协同工作的多个实例：`nodes()`、`publish()`、`request()`、`announce()` |
| `SignalingController` | 通过 Socket.IO 和 JSON-RPC 提供信令的控制器 |
| `TURNServer`、`buildTURNServerOptions` | STUN 和 TURN 服务器：`iceServers()`、`credentials()`、`allocations` |
| `createTURNCredentials` | 短时有效的 TURN 凭据（coturn 的 REST API） |
| `SignalingClient` | 应用作为房间成员：`join()`、`close()` |
| `PeerConnection`、`PeerChannel` | Node.js 端的对等连接和数据通道 |
| `PeerThreads`、`buildPeerThreadsOptions` | 运行连接引擎的工作线程（运行 `threads` 选项为该组件名称的那些连接的引擎） |
| `MediaTrack`、`RtpPacket` | Node.js 端的音视频轨道及其 RTP 包 |
| `RtpTransceiver`、`RtpSender`、`RtpReceiver` | 连接中的音视频收发器（transceiver） |
| `WHIP`、`buildWHIPOptions` | WHIP 推流接收：会话，`publish` 和 `unpublish` 事件 |
| `WHIPController` | WHIP 的 HTTP 接口：`/whip/:stream` |
| `SFU`、`buildSFUOptions` | 房间的媒体服务器：`rooms()`、`track()`，`publish`、`unpublish`、`unsupported` 和 `congestion` 事件 |
| `WHEP`、`buildWHEPOptions` | 通过 WHEP 拉取媒体服务器房间中的流：会话，`play` 和 `stop` 事件 |
| `WHEPController` | WHEP 的 HTTP 接口：`/whep/:stream` |
| `Room`、`Peer` | 已加入的房间，以及另一个成员和通往该成员的连接 |
| `ChunkedChannel` | 在数据通道上传输任意大小的消息 |
| `webrtcServiceEntrypoint`、`webrtcRequestOfContext` | 通过房间中的数据通道调用应用的服务动作，以及一次调用背后的成员 |
| `PeerServiceProxy`、`PeerServiceError`（`/client` 也有） | 调用这些动作：`invoke()`，以及接收推送事件的 `on()` |
| `setDebugHandler` | ICE、DTLS、SCTP 和 TURN 的调试信息 |
| `SignalingMethod`、`SignalingEvent` | 协议中请求和事件的名称 |
| `SignalingConnection`（`/client`） | 浏览器端的信令：`join()`、`close()` |

## 错误

| 异常 | 抛出时机 |
|---|---|
| `SignalingDeniedException` | `authorize` 拒绝了该房间 |
| `SignalingLimitException` | 房间已满、没有媒体服务器可以接收该成员、信令过大、信令过于频繁 |
| `SignalingNotAMemberException` | 发送方或接收方不在该房间中 |
| `SignalingClientRequiredException` | 请求所在的连接无法推送事件（HTTP），或者请求经由 `webrtcServiceEntrypoint` 的数据通道到达 |
| `SignalingConnectionException` | `SignalingClient` 缺少 `socket.io-client` 或 `WebSocket` |
| `WHIPDeniedException` | `authorize` 拒绝了该路流（401） |
| `WHIPLimitException` | 会话数已达 `maxSessions` 个（503） |
| `WHIPOfferException` | offer 中没有音视频，或者连接不接受该 offer（400） |
| `WHIPMediaTypeException` | offer 不是 `application/sdp`（415） |
| `WHIPSessionNotFoundException` | 请求的会话不存在（404） |
| `WHEPDeniedException` | `authorize` 拒绝了该路流（401） |
| `WHEPLimitException` | 会话数已达 `maxSessions` 个（503） |
| `WHEPOfferException` | offer 中没有音视频、媒体服务器不服务该房间，或者连接不接受该 offer（400） |
| `WHEPMediaTypeException` | offer 不是 `application/sdp`（415） |
| `WHEPSessionNotFoundException` | 请求的会话不存在（404） |
| `ClusterRequestException` | `Cluster.request()` 请求的节点不在集群中、没有对应的处理函数，或者处理函数出错 |
| `ClusterTimeoutException` | `Cluster.request()` 未能按时得到答复 |
| `ClusterTransportNotFoundException` | 集群使用 NATS 或 Redis，但未安装 `nats` 或 `ioredis` 包 |
| `SignalingRequestError` | 客户端上请求的错误，带有服务端异常的 `errno` |
| `PeerServiceError` | 成员端 `PeerServiceProxy` 调用的错误，带有动作所抛错误的 `errno`，或者为 `E_PEER_SERVICE_TIMEOUT`、`E_PEER_SERVICE_CLOSED`、`E_PEER_SERVICE_TOO_LARGE` |

## 另见

- 网站上的指南：[WebRTC](https://lakutata.com/zh/guide/WebRTC)。
- `lakutata` 包中的 `doc/zh/WebRTC.md`：WebRTC 指南。
- `@lakutata/entrypoint`：提供信令的 Socket.IO 和 JSON-RPC 适配器。
