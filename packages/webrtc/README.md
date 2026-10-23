# @lakutata/webrtc

English | [中文](README.zh-CN.md)

WebRTC for the [lakutata](https://www.npmjs.com/package/lakutata) framework, written in TypeScript with no native code:
it installs without a compiler and runs in Node.js, the main process of Electron and Bun. It has two entry points:

- `@lakutata/webrtc`, for the applications: the signaling (rooms whose members exchange their offers, answers and
  candidates), a STUN and TURN server, a media server (SFU) for the rooms of many members, publishing with WHIP and
  playing with WHEP, and the peer connections of Node.js (data channels, audio and video tracks), with the same
  interface as `RTCPeerConnection` in the browsers. The members of the rooms an application joins can call its service
  actions through data channels. The instances of an application work together through NATS or Redis, their media
  servers included.
- `@lakutata/webrtc/client`, for the browsers and the renderer of Electron: it connects the browser's own
  `RTCPeerConnection` to the signaling. It uses only the browser's APIs, so a frontend bundling it gets no server code.

The implementation of the protocols (ICE, DTLS, SCTP and the data channels, RTP and SRTP, the STUN and TURN server) is
derived from [werift](https://github.com/shinyoshiaki/werift-webrtc); see `THIRD_PARTY_NOTICES.md`.

## Installation

```shell
npm install @lakutata/webrtc
```

An application also needs `lakutata` (or `@lakutata/core` and `@lakutata/entrypoint`). The signaling is served over
Socket.IO (`npm install socket.io`) or JSON-RPC over WebSocket (`npm install ws`), through the adapters of the
entrypoint. An application joining rooms over Socket.IO needs `socket.io-client`; over JSON-RPC, it uses the
`WebSocket` built into Node.js 22 and Bun. Instances working together need `nats` or `ioredis`.

A frontend installs the same package and imports `@lakutata/webrtc/client`; the framework is not installed with it.

## Usage

The server: the signaling, a TURN server, and the controller of the signaling on the entrypoint.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        //STUN and TURN on port 3478 (UDP and TCP), the relays on ports 49160 to 49200
        turn: buildTURNServerOptions({publicAddress: '203.0.113.10', relayPortRange: [49160, 49200], secret: process.env.TURN_SECRET}),
        //The members of the rooms get the ICE servers of turn, with credentials valid for a day
        signaling: buildSignalingOptions({turn: 'turn'}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['turn', 'entrypoint']
}))
```

A browser: it joins a room and opens a data channel to each other member.

```typescript
import {io} from 'socket.io-client'
import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'

//The member's id is the auth.id of its Socket.IO connection
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

An application as a member: a device sending its readings to whoever joins its room.

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

Without the signaling of this package, get a `PeerConnection` (`await this.getObject(PeerConnection, {iceServers})`)
and exchange the offer, the answer and the candidates yourself, as with `RTCPeerConnection` in a browser. With many
connections, a `PeerThreads` component runs their engines in worker threads, to use more cores: give its name as their
`threads` option (an option of `SignalingClient` too).

How the rooms behave:

- **Connections.** A member gets a `Peer` for each other member, with its connection (`peer.connection`: an
  `RTCPeerConnection` in a browser, a `PeerConnection` in Node.js). The connection is set up when either side adds a
  data channel or a track. The offers and the answers are exchanged as in the W3C "perfect negotiation": both sides may
  add channels and tracks at any time, even at the same moment. Use `negotiated: true` with the same `id` on both sides
  for a single shared channel.
- **Repairs.** A connection that fails, or stays disconnected for 5 seconds, restarts ICE by itself. When the signaling
  connection drops, the peer-to-peer connections stay up; once it is back, the client joins its rooms again and the
  other members keep their connections to it. A member that reloads its page joins as a new session, and the other
  members replace their connections to it.
- **Leaving.** `room.leave()` closes the room's connections; the other members get `peer-left`. A member whose
  signaling connection closes (Socket.IO, or JSON-RPC over WebSocket) leaves its rooms; its peer-to-peer connections
  stay up until it comes back or they fail.
- **ICE servers.** The members get the ICE servers from the server when they join, with TURN credentials valid for
  `credentialTtl` (a day by default), and fetch new ones before they expire. A relay keeps working after the
  credentials it was made with expire.
- **Checks.** A member signals only to the members of its rooms; the signals are limited in size (64 KiB) and in rate
  (50 per second on average), and the `authorize` option decides who joins which room.

Large messages: a data channel carries messages of up to 64 KiB with any peer; Chrome and the connections of this
package accept up to 256 KiB. A `ChunkedChannel` on both sides cuts the messages into chunks and puts them back
together, for messages and files of any size:

```typescript
import {ChunkedChannel, type PeerChannel} from '@lakutata/webrtc'

declare const channel: PeerChannel
const transfer: ChunkedChannel = new ChunkedChannel(channel)
transfer.on('message', (data: string | Uint8Array): void => console.log(`${data.length} received`))
await transfer.send(new Uint8Array(50 * 1024 * 1024))
```

Calling the actions of an application: `webrtcServiceEntrypoint()` serves the service actions (`@ServiceAction`) of
an application to the members of its rooms, through data channels to it, with their input validation and access
control. The calls are JSON-RPC 2.0 messages; a member makes them with `PeerServiceProxy`:

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

//The device: the member door-7 of the room door-7
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

//Another member of the room (a browser imports PeerServiceProxy from @lakutata/webrtc/client)
declare const peer: Peer
const door: PeerServiceProxy = new PeerServiceProxy(peer.createDataChannel('service'))
console.log(await door.invoke({method: 'door.open', door: 'front'}))
```

A call's client id is the member id of the caller: have the signaling server authenticate its clients before the
actions rely on it.

Audio and video: a browser publishes the tracks of its camera and microphone in the room, and gets the tracks of each
other member with the `track` event of its peer.

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

Node.js captures, encodes and decodes nothing: the tracks of an application carry RTP packets, the encoded audio and
video. A `MediaTrack` to send gets the packets of an encoder (ffmpeg, GStreamer) with `writeRtp()`; a received track
gives the packets of the other member with its `rtp` event, to record or decode them, and `requestKeyFrame()` asks for
a key frame. A received track added to another connection forwards its packets there, and the key frame requests of
that connection go back to its sender. A camera sending what ffmpeg encodes:

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

A viewer starts decoding at a key frame: give the encoder a key frame every second or two (`-g` of ffmpeg), or have the
encoder make one when the track emits `keyframerequest`, if it can. The codecs are Opus and PCMU for the audio, VP8,
H.264 and VP9 for the video (the `codecs` option of `PeerConnection` and of `SignalingClient`).

A media server for the rooms of many members: without one, each member sends its video once per other member. The `SFU`
component joins the rooms it serves, and the clients connect to it only: each one sends its tracks once, and receives
the tracks of the others from the server, which forwards their packets without decoding them. The rooms and the peers
work as without it (`room.publish()`, the `track` events of the peers, `peer.createDataChannel()`, whose messages the
server relays and sees), so the code of the clients does not change.

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
        //The meetings through the media server, its connections on the UDP ports 40000 to 40999
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

`select` decides which member receives which track, `peer.pause()` and `peer.resume()` stop and start a track,
`sfu.track()` gives the packets of a track (to record it), and `workers` forwards the rooms in worker threads, to use
more cores. The server does not transcode: publish the video in VP8 or H.264 for the browsers.

Publishing with WHIP (RFC 9725): encoders (OBS, GStreamer, ffmpeg) and browsers publish a stream with an HTTP POST of
their offer. The `WHIP` component answers them, emits `publish` with the session (its connection and its tracks), and
`unpublish` when it ends; `WHIPController` serves `/whip/:stream`. With its option `sfu`, a stream goes to a room of
the media server instead, as one of its members.

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
        //OBS: the service WHIP, the server https://studio.example.com/whip/live, and the bearer token
        whip: buildWHIPOptions({authorize: ({token}): boolean => token === process.env.WHIP_TOKEN}),
        studio: {class: Studio},
        entrypoint: buildEntrypoints({
            controllers: [WHIPController],
            //The offers come as application/sdp, read as text
            http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
        })
    },
    bootstrap: ['studio', 'entrypoint']
}))
```

The answers carry all the candidates of the server: give it its public address (`iceAdditionalHostAddresses`) and the
UDP ports to open (`icePortRange`). A `PATCH` of a session gives the server the candidates of the publisher (trickle
ICE) or restarts ICE; list `application/trickle-ice-sdpfrag` in `body.text` too, or Fastify refuses it with 415 before
it reaches the controller.
ffmpeg publishes with `-f whip -authorization <token> <url>`.

Playing with WHEP: a player posts a receive-only offer to `/whep/:stream` (`WHEPController`), and the `WHEP`
component sends it the audio and the video of a member of the room of the media server: by default the stream
published into it with WHIP, or the member `select` chooses. The viewers are not members of the room, and a stream may
have many of them.

```typescript
import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions, buildWHIPOptions} from '@lakutata/webrtc'

//OBS publishes to /whip/concert, the browsers play /whep/concert (WHIPController and WHEPController)
const components = {
    signaling: buildSignalingOptions(),
    sfu: buildSFUOptions({icePortRange: [40000, 40999]}),
    whip: buildWHIPOptions({sfu: 'sfu', authorize: ({token}): boolean => token === process.env.WHIP_TOKEN}),
    whep: buildWHEPOptions({maxSessions: 500})
}
```

Several instances of an application (the pods of a deployment) work together through a `Cluster`: each instance is a
node, and the nodes talk through NATS or Redis. Given its name, the signaling puts the members connected to all the
nodes in the same rooms, the TURN servers tell the other nodes their address and their load, the media servers share
the rooms (each member connects to the media server of one node, and the nodes of a room forward its tracks to each
other), and a session of WHIP or WHEP is ended or patched whichever node its DELETE or PATCH reaches. The bus carries
only these messages: the audio, the video and the data go directly between the clients and the nodes, and between the
media servers.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSignalingOptions, SignalingController} from '@lakutata/webrtc'

Application.run(() => ({
    id: 'meet.app',
    name: 'Meet',
    components: {
        //npm install nats; or {type: 'redis', url: process.env.REDIS_URL} with npm install ioredis
        cluster: buildClusterOptions({transport: {type: 'nats', servers: process.env.NATS_URL}}),
        //Each member gets the two least loaded TURN servers of the cluster, which share this secret
        signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['signaling', 'entrypoint']
}))
```

A TURN server joins the cluster with its `cluster` option and the shared `secret`. The members of a node that stops,
or that the other nodes cannot reach for three heartbeats, leave their rooms as `disconnected`: their connections stay
up while their clients reconnect to another node. The members connected to the media server of such a node move to
the media server of another one, and their peers open again on every side, as when a member reloads its page.
`maxPeers` counts the members of all the nodes; `maxMembers` of the media server, and `maxSessions` of WHIP and WHEP,
count those of each node.

## Deployment

- **Ports.** The TURN server listens on port 3478 over UDP and TCP (and over TLS when given a certificate); the
  relays use the UDP ports of `relayPortRange`. Open them in the firewall, or publish them from the container.
- **Addresses.** `publicAddress` is the address the clients reach the server at: the public address of the host, or of
  its NAT when the NAT forwards the ports. By default it is the first IPv4 address of the host that is not internal,
  which is enough on a local network.
- **The media server.** The clients connect to it directly: open its `icePortRange` over UDP, and give it the public
  address of a NAT forwarding these ports in `iceAdditionalHostAddresses`. The same goes for WHIP and WHEP.
- **Several instances.** Give them a `Cluster` (see above), and their TURN servers the same `secret`. Behind a load
  balancer, Socket.IO needs sticky sessions, unless the clients connect with `transports: ['websocket']`. In
  Kubernetes, run a TURN server and a media server on the network of each node (DaemonSets with `hostNetwork`); the
  guide has the manifests.
- **Another TURN server.** A coturn configured with `use-auth-secret` and the same secret accepts the credentials of
  this package: list it in the `iceServers` option of `Signaling`.

## Signaling protocol

The requests are service calls whose pattern is `{method}`: over Socket.IO, the event `message` with
`{method: 'webrtc.join', room: 'room-1'}` and an acknowledgement; over JSON-RPC, a request whose method is
`webrtc.join`. The member's id is the client id of its connection (the `auth.id` of Socket.IO, the `id` query
parameter or header of the WebSocket). The server pushes the events to the members: Socket.IO events, or JSON-RPC
notifications whose `params` hold the payload.

| Request | Parameters | Answer |
|---|---|---|
| `webrtc.join` | `room`, `metadata`, `session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval, sfu}` |
| `webrtc.signal` | `room`, `to`, `description` or `candidate` | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}` |
| `webrtc.heartbeat` | — | `{}` |

| Event | Payload |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session, role, sfu}` |
| `webrtc:peer-left` | `{room, peerId, reason}`: `left`, or `disconnected` |
| `webrtc:signal` | `{room, from, session, description, streams}` or `{room, from, session, candidate}` |

A client sends `webrtc.heartbeat` every `heartbeatInterval` milliseconds when it is not 0: over a transport whose
disconnections the server cannot see (Socket.IO and JSON-RPC over WebSocket answer 0). The `session` is a random
string the client chooses once: joining again with the same session keeps the other members' connections. In a room
with a media server, `sfu` is the id of the media server the client connects to (its `role` is `sfu`), and the
descriptions of the server carry `streams`, the member each stream comes from; the guide describes the data channels
of the media server.

## Limits

- Node.js does not capture, encode or decode audio and video: its tracks carry RTP packets, from an encoder or from
  another connection.
- Throughput of one data channel between two Node.js processes on an Apple M4: about 80 MiB/s for large messages,
  626,000 messages of 100 bytes per second (in an arm64 Linux virtual machine on the same Mac: about 43 MiB/s and
  548,000 messages).
- The media server on an Apple M4: its main thread forwards about 87,000 packets per second (the equivalent of 435
  videos of 2 Mbit/s), and 4 worker threads forwarded the 92,000 of a test on 1.7 cores. It does not transcode, and
  sends each video as published (no simulcast yet).

## API

| Export | Description |
|---|---|
| `Signaling`, `buildSignalingOptions` | The component of the rooms: members, signals, limits, `authorize`, the ICE servers |
| `Cluster`, `buildClusterOptions` | The instances working together through NATS or Redis: `nodes()`, `publish()`, `request()`, `announce()` |
| `SignalingController` | The controller serving the signaling over Socket.IO and JSON-RPC |
| `TURNServer`, `buildTURNServerOptions` | The STUN and TURN server: `iceServers()`, `credentials()`, `allocations` |
| `createTURNCredentials` | Short-lived TURN credentials (the REST API of coturn) |
| `SignalingClient` | An application as a member of the rooms: `join()`, `close()` |
| `PeerConnection`, `PeerChannel` | The peer connection and the data channel of Node.js |
| `PeerThreads`, `buildPeerThreadsOptions` | Worker threads running the engines of the connections whose `threads` option names it |
| `MediaTrack`, `RtpPacket` | An audio or video track of Node.js, and its RTP packets |
| `RtpTransceiver`, `RtpSender`, `RtpReceiver` | The audio and video lines of a connection |
| `WHIP`, `buildWHIPOptions` | The ingestion of WHIP: the sessions, the `publish` and `unpublish` events |
| `WHIPController` | The HTTP interface of WHIP: `/whip/:stream` |
| `SFU`, `buildSFUOptions` | The media server of the rooms: `rooms()`, `track()`, the `publish`, `unpublish`, `unsupported` and `congestion` events |
| `WHEP`, `buildWHEPOptions` | Playing the rooms of the media server with WHEP: the sessions, the `play` and `stop` events |
| `WHEPController` | The HTTP interface of WHEP: `/whep/:stream` |
| `Room`, `Peer` | A room joined, and another member with the connection to it |
| `ChunkedChannel` | Messages of any size over a data channel |
| `webrtcServiceEntrypoint`, `webrtcRequestOfContext` | The service actions of an application called through the data channels of its rooms, and the member behind a call |
| `PeerServiceProxy`, `PeerServiceError` (also `/client`) | The calls of these actions: `invoke()`, and `on()` for the events pushed |
| `setDebugHandler` | The debug messages of ICE, DTLS, SCTP and TURN |
| `SignalingMethod`, `SignalingEvent` | The names of the requests and of the events of the protocol |
| `SignalingConnection` (`/client`) | The signaling of a browser: `join()`, `close()` |

## Errors

| Exception | When |
|---|---|
| `SignalingDeniedException` | `authorize` refuses the room |
| `SignalingLimitException` | A full room, a member no media server takes, a signal too large, too many signals |
| `SignalingNotAMemberException` | A signal from or to someone who is not in the room |
| `SignalingClientRequiredException` | A request without a connection to push the events through (HTTP), or through a data channel of `webrtcServiceEntrypoint` |
| `SignalingConnectionException` | `SignalingClient` without `socket.io-client`, or without `WebSocket` |
| `WHIPDeniedException` | `authorize` refuses the stream (401) |
| `WHIPLimitException` | `maxSessions` sessions already (503) |
| `WHIPOfferException` | An offer without audio or video, or that the connection refuses (400) |
| `WHIPMediaTypeException` | An offer that is not `application/sdp` (415) |
| `WHIPSessionNotFoundException` | A request for a session that does not exist (404) |
| `WHEPDeniedException` | `authorize` refuses the stream (401) |
| `WHEPLimitException` | `maxSessions` sessions already (503) |
| `WHEPOfferException` | An offer without audio or video, of a room the media server does not serve, or that the connection refuses (400) |
| `WHEPMediaTypeException` | An offer that is not `application/sdp` (415) |
| `WHEPSessionNotFoundException` | A request for a session that does not exist (404) |
| `ClusterRequestException` | `Cluster.request()` to a node not in the cluster, without a handler, or whose handler failed |
| `ClusterTimeoutException` | `Cluster.request()` not answered in time |
| `ClusterTransportNotFoundException` | A cluster on NATS or Redis without the package `nats` or `ioredis` |
| `SignalingRequestError` | On the clients: the error of a request, with the `errno` of the server's exception |
| `PeerServiceError` | On the members: the error of a call of `PeerServiceProxy`, with the `errno` of the action's error, or `E_PEER_SERVICE_TIMEOUT`, `E_PEER_SERVICE_CLOSED`, `E_PEER_SERVICE_TOO_LARGE` |

## Testing

`npm run test:unit` runs the tests of the protocols, of the signaling and of the connections between Node.js
processes. The tests with browsers use Playwright: the Chrome installed on the machine, and the Firefox and WebKit of
Playwright (`npx playwright install firefox webkit`). They run when the package `playwright` can be imported (or is
found in the directory given by `LAKUTATA_PLAYWRIGHT`); the ones of a browser not installed are skipped. The one
sending the H.264 of an encoder also needs `ffmpeg` with `libx264` and a browser with H.264 (the Firefox of Playwright
has none), and the ones of WHIP need an `ffmpeg` with its WHIP muxer (FFmpeg 8 and later) and `libopus`. The WebKit of
Playwright refuses the URLs of TURN with a transport (`?transport=udp`), which Safari accepts: its test through the
relay only is skipped.

The other runtimes and implementations, compiled first (`npm run compile`):

- `npm run test:bun` runs the tests in Bun (without those of the browsers). Four tests of the TURN refresh fail there:
  the fake clock of the tests reaches the imports of `node:timers/promises` only in Node.js.
- `npm run test:electron` runs them in the main process of Electron (the repository's Electron).
- `npm run test:linux` runs them, the performance targets and the benchmarks of forwarding, of the TURN server and of
  the worker threads of the connections, in Linux (`node:24-alpine` in Docker).
- `npm run test:interop` connects Pion (Go) and aiortc (Python), in Docker, to the signaling, the TURN server and a
  member of this package: a data channel directly and through the relay only, and a call of a service action from
  aiortc.
- `node test-env/safari.mjs` opens a page in Safari (macOS): a data channel, a service call, a connection through the
  relay only. Close its tab afterwards.

`npm run test:servers` runs the tests of the cluster on NATS and Redis, started in Docker (`test-env/cluster.sh`).
`test-env/k3s/run.sh` runs k3s in Docker with two nodes, deploys the signaling, and a TURN server and a media server on
each node. It connects two members through two different pods and the TURN servers only, then two members through the
media servers of the two nodes, and deletes the pod of one of these media servers.

The benchmarks are in `test-env/bench` and run on the compiled package (`npm run compile` first). `targets.mjs` measures
the engine against its performance targets (70 MiB/s for large messages, at 40 s of CPU per GiB at most; 50,000 messages
of 100 bytes a second; 200 connections set up in 2 seconds) and exits with 1 when one is missed: run it before a
release. `engine.mjs` measures the data channels, the sending of RTP and the setup of connections, each end in a process
of its own, `forward.mjs` what the media server forwards, `turn.mjs` what the TURN server relays (with `--idle`
allocations of other clients, `--workers` threads, `--parallel` connections at once), and `threads.mjs` what pairs of
connections in one process carry, their engines in the main thread or in worker threads (`--pairs`, `--threads`,
`--size`).
`floor.mjs` measures the least a packet costs in JavaScript (encrypting it and sending it over UDP), and
`send-modes.mjs` the cost of each way of sending a UDP packet; neither needs a build.

## See also

- The guide on the website: [WebRTC](https://lakutata.com/guide/WebRTC).
- `doc/en/WebRTC.md` in the `lakutata` package (Chinese in `doc/zh`): the WebRTC guide.
- `@lakutata/entrypoint`: the Socket.IO and JSON-RPC adapters serving the signaling.
