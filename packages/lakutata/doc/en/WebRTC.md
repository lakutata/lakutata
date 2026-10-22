# Lakutata WebRTC

WebRTC connects two endpoints directly, peer to peer: browsers, Electron applications and Node.js processes exchange
data, audio and video without a server relaying it, behind NATs and firewalls too. The package `@lakutata/webrtc`
provides everything around these connections: the signaling that introduces the endpoints to each other, a STUN and TURN
server for the networks that need one, the peer connections of Node.js, and a client for the browsers. It is written in
TypeScript without native code, and it is not part of `lakutata`:

```bash
npm install lakutata @lakutata/webrtc
```

| Entry point | Runs in | What it gives |
|---|---|---|
| `@lakutata/webrtc` | Node.js, the main process of Electron, Bun | `Signaling`, `SignalingController`, `TURNServer`, `SignalingClient`, `PeerConnection`, `MediaTrack`, `WHIP`, `WHIPController`, `Cluster`, `ChunkedChannel` |
| `@lakutata/webrtc/client` | Browsers, the renderer of Electron | `SignalingConnection`, `ChunkedChannel`, the types of the protocol |

The browser entry uses only the APIs of the browsers; a frontend installs the same package, and the framework is not
installed with it.

## 1. How a connection is made

Two endpoints cannot connect until each knows how to reach the other. Each one describes itself in an **offer** or an
**answer** (its codecs, its keys, its data channels) and lists its **candidates**, the addresses it may be reached at:
its local addresses, its public address as a STUN server sees it, and an address on a TURN server that relays its
traffic when nothing else gets through. These messages travel through a server both endpoints are connected to, the
**signaling**; once the endpoints have them, they test the candidates in pairs (ICE), keep a working pair, and encrypt
the connection (DTLS). The data channels then carry messages in both directions, reliable and ordered or not, and the
tracks carry audio and video.

The signaling of this package works with **rooms**: a client joins a room, gets the members already there, and the
offers, answers and candidates are exchanged between each pair of members. The rest is done for you:

- The offers and the answers are exchanged as in the W3C "perfect negotiation": either member may add data channels and
  tracks at any time, both at the same moment too.
- A connection that fails, or stays disconnected for 5 seconds, restarts ICE by itself.
- When the signaling connection drops, the peer-to-peer connections stay up, and the client joins its rooms again once
  it reconnects.
- The members get the ICE servers (with TURN credentials) when they join, and new credentials before those expire.

## 2. The server

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
            //Only the members whose id starts with board- join the room board
            authorize: (peer, room): boolean => room !== 'board' || peer.peerId.startsWith('board-')
        }),
        //The browsers over Socket.IO on port 3000, the other clients over JSON-RPC (WebSocket) on port 3001
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: [socketIOServiceEntrypoint({port: 3000}), jsonRPCServiceEntrypoint({transport: 'websocket', port: 3001})]
        })
    },
    bootstrap: ['turn', 'entrypoint']
}))
```

`SignalingController` serves the requests of the signaling; it finds the component under the name `signaling`, which
finds the entrypoint under the name `entrypoint` (its `entrypoint` option). Its actions go through the middlewares of
the entrypoint like any other action. The member's id is the client id of its connection: the `auth.id` of Socket.IO
(its `id` header otherwise), the `id` header or query parameter of a WebSocket. Authenticate the requests with a
middleware, and decide who joins which room with `authorize`:
`(peer, room, context) => boolean | Promise<boolean>`, given the member's id and metadata and the context of its
request.

The options of `buildSignalingOptions`:

| Option | Default | Meaning |
|---|---|---|
| `entrypoint` | `'entrypoint'` | The entrypoint component pushing the events to the members |
| `turn` | — | A `TURNServer` component: the members get its ICE servers, with credentials |
| `iceServers` | `[]` | More ICE servers (another STUN or TURN server), after those of `turn` |
| `authorize` | — | Who joins which room; everyone joins any room without it |
| `maxPeers` | `0` | The members of a room at most; 0 for no limit |
| `maxMessageSize` | `65536` | The size of a signal and of a member's metadata at most, in bytes |
| `maxMessagesPerSecond` | `50` | The signals of a member per second on average (bursts of twice as many) |
| `heartbeatInterval` | `10000` | How often a client sends a heartbeat when the server cannot see its disconnection, in milliseconds |

The component also works without the controller: `join()`, `signal()`, `leave()` and `disconnect()` change the rooms
from the application's own code, and `rooms()` lists them.

## 3. The STUN and TURN server

Most connections succeed directly or with the public address a STUN server reports. Some networks (symmetric NATs,
corporate firewalls, mobile carriers) let nothing through but a relay: a TURN server forwards the traffic of the
connection. `TURNServer` is one, inside the application:

| Option | Default | Meaning |
|---|---|---|
| `host` | `'0.0.0.0'` | The address it listens on |
| `port` | `3478` | The port of STUN and TURN over UDP and TCP |
| `udp`, `tcp` | `true` | Whether to listen over UDP, over TCP |
| `tls` | — | `{cert, key, port}`: TURN over TLS (`turns:`, port 5349 by default), for the networks letting only TLS through |
| `publicAddress` | the first IPv4 address of the host that is not internal | The address the clients reach it at |
| `relayPortRange` | any free port | `[first, last]`: the UDP ports of the relays |
| `secret` | a random one at each start | The secret of the short-lived credentials |
| `users` | `{}` | Users with a fixed password, `{username: password}` |
| `realm` | `'lakutata'` | The realm of the credentials |
| `credentialTtl` | `86400` | How long the short-lived credentials are valid, in seconds; a relay made with them keeps working once they expire |
| `maxAllocations` | no limit | The relays at once at most |

The short-lived credentials follow the REST API of coturn: the username is `<expiry>:<user>` and the password is
`base64(HMAC-SHA1(secret, username))`, so any server holding the secret checks them without storing them.
`turn.iceServers(user)` gives the ICE servers of a client with credentials, `turn.credentials(user)` the credentials
alone, `createTURNCredentials(secret, user, ttl)` makes them for another TURN server (a coturn configured with
`use-auth-secret`), and `turn.allocations` counts the relays in use.

## 4. Browsers

```typescript
import {io} from 'socket.io-client'
import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'

const signaling: SignalingConnection = new SignalingConnection(io('https://meet.example.com', {auth: {id: 'alice'}}))
const room: Room = await signaling.join('room-1', {metadata: {name: 'Alice'}})
room.on('peer', (peer: Peer): void => {
    //Unordered and unreliable: a lost position is not sent again
    const positions: RTCDataChannel = peer.createDataChannel('positions', {ordered: false, maxRetransmits: 0})
    positions.addEventListener('open', (): void => positions.send(JSON.stringify({x: 1, y: 2})))
    peer.on('datachannel', (channel: RTCDataChannel): void => {
        channel.addEventListener('message', (event: MessageEvent): void => console.log(peer.id, channel.label, event.data))
    })
    peer.on('connectionstatechange', (state: string): void => console.log(peer.id, state))
})
room.on('peer-left', (peer: Peer): void => console.log(`${peer.id} left`))
```

`SignalingConnection` takes the connection of the application:

- a Socket.IO socket (`io()` of `socket.io-client`): the member's id is its `auth.id`, and Socket.IO reconnects by
  itself;
- a `WebSocket` speaking JSON-RPC, the member's id being the `id` query parameter of its URL;
- a function creating that `WebSocket`, so the connection reconnects after a disconnection (after 1 second, then twice
  as long each time, 30 seconds at most):
  `new SignalingConnection(() => new WebSocket('wss://meet.example.com/rpc?id=alice'))`.

Its options: `iceTransportPolicy` (`'relay'` to use only the TURN relays), `configuration` (more options of the
`RTCPeerConnection`s), `createPeerConnection` (another implementation of `RTCPeerConnection`), `timeout` (of the
requests, 15 seconds by default).

A room emits `peer` for each other member: the members already in the room, then each newcomer. A listener added later
is called at once for the peers already there. A `Peer` has the member's `id`, its `metadata`, the `connection` to it
(an `RTCPeerConnection`: add tracks to it, read its statistics), `createDataChannel()`, `restartIce()` and `close()`,
and emits `datachannel`, `track`, `connectionstatechange`, `metadata` (the member joined again with new metadata),
`error` and `close`. A room emits `peer-left` when a peer closes: its member left, or its connection was lost for good.

Both members may create channels: each side gets the channels of the other one through `datachannel`. For a single
channel shared by both, create it on both sides with `negotiated: true` and the same `id`.

In Electron, the renderer uses `@lakutata/webrtc/client` and connects to the signaling itself; the main process uses
`@lakutata/webrtc`.

## 5. An application as a member

`SignalingClient` joins the rooms from a lakutata application, with the peer connections of Node.js. A device, a
recorder, a bot or a test joins the rooms as the browsers do:

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

An `http:` or `https:` URL uses Socket.IO (install `socket.io-client`), a `ws:` or `wss:` URL uses JSON-RPC over the
`WebSocket` of Node.js 22 and Bun. Its options: `url`, `id` (a random UUID by default), `path` (of Socket.IO), `auth`
(more fields of the Socket.IO handshake, a token), `timeout`, and the options of its connections (`iceTransportPolicy`,
`icePortRange`, `iceAdditionalHostAddresses`, `codecs`). It is `@Transient`: each `getObject()` gives a new client, and
`close()` leaves its rooms and disconnects.

## 6. Peer connections without the signaling

`PeerConnection` has the interface of `RTCPeerConnection`, so the code of a browser works in Node.js, and any signaling
works: an HTTP request, a QR code, a message queue. Its events are given in both styles: `addEventListener` and the
`on…` properties with event objects, or `on()` with the values (`on('datachannel', (channel) => …)`).

```typescript
import {Component} from 'lakutata'
import {PeerConnection, type PeerChannel, type SignalingCandidate, type SignalingDescription} from '@lakutata/webrtc'

export class Echo extends Component {
    //Answer an offer received through an HTTP request, with all the candidates in the answer
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

Its options: `iceServers`, `iceTransportPolicy`, and those of a server: `icePortRange` (the UDP ports of its
candidates, to open in a firewall) and `iceAdditionalHostAddresses` (more addresses offered as candidates, such as the
public address of a NAT forwarding these ports with the same numbers); `codecs` chooses the audio and video codecs.
`headerExtensions: true` adds the RTP header extensions a media server uses: each side then estimates, from the feedback
of the other one, the bandwidth available for what it sends (without them, a browser goes by the packets lost only,
starting low and rising slowly). A `PeerChannel` sends strings and binary data; a binary message arrives as a `Buffer`,
or as an `ArrayBuffer` when `binaryType` is `'arraybuffer'`.

## 7. Large messages and files

A data channel carries messages of up to 64 KiB with any peer; Chrome and the connections of this package accept up to
256 KiB. `ChunkedChannel` removes the limit: wrapped around the channel on both sides, it cuts each message into chunks
of 16 KiB, sends them as the channel's buffer empties, and puts them back together on the other side. It sends strings,
bytes and `Blob`s (a file of a browser is read a chunk at a time):

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

The channel must be ordered and reliable (the default). A message received over `maxMessageSize` (64 MiB by default)
is dropped with an `error` event.

## 8. Audio and video

A track carries the audio or the video of one source. In a browser, add the tracks of the camera and the microphone to
the connection of each peer; the other member gets them with the `track` event of its peer, `event.streams` grouping
the audio and the video of a source:

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

When every member sends to every other one, each sends its video once per other member: this suits small rooms.

Node.js captures, encodes and decodes nothing: the tracks of an application carry RTP packets, the encoded audio and
video, from an encoder or from another connection.

- `new MediaTrack(kind, {codec})` creates a track to send, and `writeRtp()` sends a packet: an `RtpPacket`, or the
  bytes of one, such as the datagrams ffmpeg and GStreamer send to a UDP port. Each connection gives the packets its own
  synchronization source and payload type, and the sequence numbers and the timestamps go on from the ones written.
- A received track (the `track` event of a `Peer` or of a `PeerConnection`) gives the packets of the other member with
  its `rtp` event; `requestKeyFrame()` asks the other member for a key frame.
- A received track added to another connection forwards its packets there, and the key frame requests of that
  connection go back to the sender of the track (one every 500 ms at most).
- The `keyframerequest` event of a track fires when a peer the track is sent to wants a key frame.

A camera sending what ffmpeg encodes:

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

A viewer starts decoding at a key frame: give the encoder a key frame every second or two (`-g` of ffmpeg), or have the
encoder make one when the track emits `keyframerequest`, if it can. The bitstream filter `dump_extra` puts the
parameters of H.264 before each key frame, where the browsers need them.

An application sending the camera of a member on to the viewers who join, each viewer getting the video from the
application instead of the camera:

```typescript
import {Component} from 'lakutata'
import {type MediaTrack, type Peer, type PeerTrackEvent, type Room, SignalingClient} from '@lakutata/webrtc'

//The page of the camera adds its tracks to the peer of the relay only
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

The methods of `PeerConnection` are those of `RTCPeerConnection`: `addTrack(track, ...streamIds)` (the other member
groups the tracks of a stream), `addTransceiver(trackOrKind, {direction, streams})` (`recvonly` to receive without
sending), `removeTrack(sender)`, `getTransceivers()`, `getSenders()` and `getReceivers()`; `sender.replaceTrack()` sends
another track, of any codec negotiated, without negotiating again. The codecs are Opus and PCMU for the audio, VP8, H.264 and
VP9 for the video; the `codecs` option of `PeerConnection` and of `SignalingClient` chooses them and their order, and a
track created with a `codec` makes its connections negotiate that one.

## 9. Publishing with WHIP

WHIP (RFC 9725) publishes a stream with one HTTP request: the encoder (OBS, GStreamer, ffmpeg) or the browser posts its
offer to the URL of the stream, and gets the answer and the URL of its session. The `WHIP` component answers the offers
and emits `publish` with the session (its `id`, `stream`, `connection` and `tracks`) and `unpublish` when it ends: the
publisher deleted it, its connection failed or closed, or the application stopped. `WHIPController` is its HTTP
interface; the HTTP adapter must read `application/sdp` as text (its `body.text` option).

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

In OBS, choose the service WHIP, the server `https://studio.example.com/whip/live` and the bearer token; ffmpeg
publishes with `-f whip -authorization <token> https://studio.example.com/whip/live` (stereo audio: `-ac 2`). The tracks
of the session give their RTP packets, to record them or to send them on to other connections (section 8).

| Request | Answer |
|---|---|
| `POST /whip/:stream` with the offer (`application/sdp`) | `201 Created`: the answer, `Location` (the session), `Link` (the ICE servers) |
| `DELETE /whip/:stream/:session` | `200`: the session ends |
| `OPTIONS` | `204`, with the CORS headers and `Accept-Post: application/sdp` |
| `GET` | `204` |
| `PATCH` | `405`: neither trickle ICE nor ICE restarts |

The refusals: 401 with `WWW-Authenticate: Bearer` when `authorize` refuses, 415 for a body that is not
`application/sdp`, 400 for an offer without audio or video, 503 once there are `maxSessions` sessions, 404 for an
unknown session. The URL of a session is the capability to end it: its id is random, and its DELETE is not authorized
again. A subclass with `@Prefix({route: '/live'})` serves the same interface under another path.

| Option | Default | Meaning |
|---|---|---|
| `authorize` | none | `({stream, token}, context) => boolean`: who may publish which stream |
| `turn` | none | The name of a `TURNServer` component: the publishers get its ICE servers in the `Link` headers |
| `iceServers` | `[]` | More ICE servers for the publishers |
| `maxSessions` | `100` | The sessions at once at most, `0` for no limit |
| `allowOrigin` | `'*'` | The origins the browsers may publish from |
| `icePortRange`, `iceAdditionalHostAddresses` | | The candidates of the server: its UDP ports, its public address |
| `codecs` | Opus, PCMU, VP8, H.264, VP9 | The codecs accepted |

The answer carries all the candidates of the server, which gathers them before answering: behind a NAT or in a
container, give it its public address and open its ports.

## 10. Deployment

- **Ports.** Open port 3478 over UDP and TCP, the relay ports (`relayPortRange`) over UDP, and the TLS port when TURN
  over TLS is on. In a container, publish them all; the relay range keeps the list short.
- **The public address.** `publicAddress` is the address the clients reach the TURN server at: the public address of
  the host, or that of its NAT when the NAT forwards the ports. On a local network the default is enough.
- **The applications as members.** A server behind a NAT that forwards `icePortRange` with the same port numbers gives
  its public address in `iceAdditionalHostAddresses`; otherwise it relies on the TURN server like any client.
- **Several instances.** Give them a `Cluster` (section 11), and their TURN servers the same `secret`, so each accepts
  the credentials made by the others.
- **Another TURN server.** coturn (`use-auth-secret`, `static-auth-secret` set to the same secret) accepts the
  credentials of `createTURNCredentials()`; list it in the `iceServers` option of `Signaling`.
- **HTTPS.** Browsers allow WebRTC on any page, but the camera and the microphone only on secure pages (HTTPS or
  `localhost`).

## 11. Several instances

Several instances of an application (the pods of a deployment, the processes behind a load balancer) work together
through a `Cluster`: each instance is a node of the cluster, and the nodes talk through NATS or Redis. The components
given its name work across the nodes:

- the signaling puts the members connected to all the nodes in the same rooms;
- the TURN servers tell the other nodes their address and their load, and each member gets the least loaded ones;
- a WHIP session is ended whichever node its DELETE reaches.

The bus carries only these messages. The audio, the video and the data go directly between the clients and the nodes,
or through the TURN servers.

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

| Option of `buildClusterOptions` | Default | |
|---|---|---|
| `transport` | (required) | `{type: 'nats', servers, user, pass, token}`; `{type: 'redis', url}` or `{type: 'redis', host, port, username, password, database, tls}`; `{type: 'memory'}` for the applications of one process (tests) |
| `prefix` | `'lakutata.webrtc'` | The prefix of the subjects or channels: the clusters sharing a server stay separate with it |
| `nodeId` | the host name and a random suffix | The id of the node; in Kubernetes the host name is the name of the pod |
| `labels` | `{}` | What the other nodes see of this one (a zone, a region), to choose the TURN servers |
| `heartbeatInterval` | `2000` | How often the node tells the others it is there, in milliseconds |
| `requestTimeout` | `5000` | How long `request()` and `requestAll()` wait, in milliseconds |

NATS needs `npm install nats`, and its core subjects are enough (no JetStream); Redis needs `npm install ioredis`, and
only its channels are used (`PUBLISH`, `SUBSCRIBE`). The component connects when the application starts, and fails
to start when the server cannot be reached then (in Kubernetes, the pod restarts until it can); afterwards it
reconnects by itself. The other nodes take a node as gone after three heartbeat intervals without news of it, or at
once when it stops.

### The rooms across the nodes

Each node tells the others who joins and leaves through it, and gets all the members of a node when that node comes up
or when some of its news was lost (the bus restarting, for example). A signal to a member of another node goes through
that node.

- When a node stops, or the others cannot reach it any more, its members leave their rooms as `disconnected`: their
  connections stay up while their clients reconnect to another node and join again.
- A client joining again through another node before the first one saw it go is moved there: the others see it join
  again, not leave.
- `maxPeers` counts the members of all the nodes. Each room falls to one node (by hashing over the nodes), which admits
  its members one at a time, so two members joining at once through different nodes cannot both take the last place.
  When a node joins or leaves the cluster, some rooms fall to another node, and a member joining at that very moment
  may be admitted over the limit.
- Socket.IO behind a load balancer: its long polling sends the requests of a client one by one, and they must all reach
  the same instance. Connect the clients with `transports: ['websocket']` (a single connection, so no sticky sessions),
  or turn on sticky sessions in the load balancer.

### The TURN servers of the cluster

A TURN server joins the cluster with its `cluster` option and the `secret` shared by all of them (it refuses to start
without one); it tells the others its address, its ports and its allocations every second. The `Signaling` and `WHIP`
components given `turnSecret` give each client the two least loaded TURN servers that are not full, after the one of
their own node (`turn`). `selectTURN` chooses otherwise, for example by the labels of the nodes:

```typescript
import {buildSignalingOptions, type ClusterTURNServer} from '@lakutata/webrtc'

//The members whose id starts with eu- get the TURN servers of the nodes labeled {region: 'eu'}, and so on
const signaling = buildSignalingOptions({
    cluster: 'cluster',
    turnSecret: process.env.TURN_SECRET,
    selectTURN: (servers: ClusterTURNServer[], user: string): ClusterTURNServer[] => {
        return servers.filter((server: ClusterTURNServer): boolean => user.startsWith(`${server.labels.region}-`))
    }
})
```

### WHIP behind a load balancer

A WHIP session lives on the node that answered its POST. Given `cluster`, the `WHIP` component of another node
receiving its DELETE asks the other nodes, and the one holding the session ends it. `maxSessions` counts the sessions
of each node.

### Kubernetes and k3s

The manifests below deploy NATS, the signaling (two pods) and a TURN server on each node. The application is one image
for both roles, chosen by the variable `ROLE`:

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
        //On the network of the node: its address, and its ports 3478 and 49160-49200
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

- The TURN servers run on the network of their node (`hostNetwork`): the clients reach them at the address of the node,
  on its ports. Open UDP and TCP 3478 and UDP 49160–49200 in the firewall of the nodes.
- `status.hostIP` is the address of the node inside the cluster; it is the right one when the clients reach the nodes at
  it (a local network, nodes with public addresses). Behind the NAT of a cloud, give `PUBLIC_ADDRESS` the public address
  of each node instead, the NAT forwarding the same ports.
- A pod on the network of its node resolves the names of the services with `dnsPolicy: ClusterFirstWithHostNet`.
- The browsers reach the signaling through an Ingress or a load balancer in front of the Service `signaling`, connecting
  with `transports: ['websocket']`.
- A single NATS pod is enough for a test; in production, run a NATS cluster (its Helm chart) or a Redis with a replica.

In the repository, `packages/webrtc/test-env/k3s/run.sh` deploys these manifests in k3s in Docker (two nodes, the code
mounted instead of an image) and connects two members through two pods and the TURN servers only.

### The cluster for the application

The application talks to its other instances through the same component: messages to all the other nodes, and requests
to one node or to all of them.

```typescript
import {Component} from 'lakutata'
import type {Cluster, ClusterReply} from '@lakutata/webrtc'

export class Viewers extends Component {
    //The viewers of each stream on this node, counted by the application
    protected readonly counts: Map<string, number> = new Map()

    protected async init(): Promise<void> {
        const cluster: Cluster = await this.getObject<Cluster>('cluster')
        //Each node answers with its own count
        cluster.handle<{stream: string}, number>('viewers', ({stream}: {stream: string}): number => this.counts.get(stream) ?? 0)
        cluster.subscribe<{text: string}>('announcements', (message: {text: string}): void => console.log(message.text))
    }

    //The viewers of a stream on all the nodes
    public async total(stream: string): Promise<number> {
        const cluster: Cluster = await this.getObject<Cluster>('cluster')
        const replies: ClusterReply<number>[] = await cluster.requestAll<number>('viewers', {stream: stream})
        return replies.reduce((sum: number, reply: ClusterReply<number>): number => sum + reply.result, this.counts.get(stream) ?? 0)
    }
}
```

`cluster.nodes()` lists the nodes with their labels and what they announce (`announce()`), and the component emits
`node-up`, `node-down` and `node-update`. The messages are sent as JSON; a message larger than the server carries (1 MiB
by default on NATS) is sent in parts.

## 12. The signaling protocol

Clients in other languages and native applications speak the protocol directly. The requests are service calls whose
pattern is `{method}`: over Socket.IO, the event `message` with `{method: 'webrtc.join', room: 'room-1'}` and an
acknowledgement (`{success, error, payload}`); over JSON-RPC 2.0, a request whose method is `webrtc.join`. The server
pushes the events to the members: Socket.IO events, or JSON-RPC notifications whose `params` hold the payload.

| Request | Parameters | Answer |
|---|---|---|
| `webrtc.join` | `room`, `metadata`, `session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval}` |
| `webrtc.signal` | `room`, `to`, and `description` (`{type, sdp}`) or `candidate` (`{candidate, sdpMid, sdpMLineIndex, usernameFragment}`) | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}`: new credentials |
| `webrtc.heartbeat` | — | `{}` |

| Event | Payload |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session}`: a member joined, or joined again |
| `webrtc:peer-left` | `{room, peerId, reason}`: `left` when it asked, `disconnected` when its client went away |
| `webrtc:signal` | `{room, from, session, description}` or `{room, from, session, candidate}` |

- `session` is a random string a client chooses once. A member joining again with the same session (after a
  reconnection of its signaling) keeps the connections of the others; a new session (a reloaded page) replaces them.
- `heartbeatInterval` is 0 over Socket.IO and JSON-RPC over WebSocket: the server sees their connections close. Over
  another transport, the client sends `webrtc.heartbeat` that often; after three intervals without a request, it leaves
  its rooms.
- The member whose id comes first (by string comparison) is the polite one of a pair: when both send an offer at the
  same time, it gives up its own and answers the other one.
- The errors carry the `errno` of the server's exception: `E_SIGNALING_DENIED`, `E_SIGNALING_LIMIT`,
  `E_SIGNALING_NOT_A_MEMBER`, `E_SIGNALING_CLIENT_REQUIRED`, `E_INVALID_VALUE`. JSON-RPC over HTTP cannot carry the
  signaling: the events need a connection to be pushed through.

## 13. When a connection fails

`setDebugHandler()` gives the debug messages of ICE, DTLS, SCTP and TURN:

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

To check the TURN server, join a room from two clients with `iceTransportPolicy: 'relay'`: they connect only through
the relays, and `turn.allocations` counts them. In Chrome, `chrome://webrtc-internals` shows the candidates and the
pairs tried.

## 14. Limits

- Node.js does not capture, encode or decode audio and video: its tracks carry RTP packets, from an encoder or from
  another connection.
- WHIP supports neither trickle ICE nor ICE restarts.
- The throughput of one data channel between two Node.js processes on an Apple M4 is about 60 MiB/s for large
  messages, and 440,000 messages of 100 bytes per second.
