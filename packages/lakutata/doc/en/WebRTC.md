# Lakutata WebRTC

WebRTC connects two endpoints directly, peer to peer: browsers, Electron applications and Node.js processes exchange
data, audio and video without a server relaying it, even behind NATs and firewalls. The `@lakutata/webrtc` package
provides everything around these connections: the signaling that introduces endpoints to each other, a STUN and TURN
server for networks that need one, a media server for rooms with many members, Node.js peer connections, and a client
for browsers. It is written in TypeScript without native code, and it is not part of `lakutata`:

```bash
npm install lakutata @lakutata/webrtc
```

| Entry point | Runs in | What it provides |
|---|---|---|
| `@lakutata/webrtc` | Node.js, Electron's main process, Bun | `Signaling`, `SignalingController`, `TURNServer`, `SignalingClient`, `PeerConnection`, `PeerThreads`, `MediaTrack`, `SFU`, `WHIP`, `WHIPController`, `WHEP`, `WHEPController`, `Cluster`, `webrtcServiceEntrypoint`, `PeerServiceProxy`, `ChunkedChannel` |
| `@lakutata/webrtc/client` | Browsers, Electron's renderer | `SignalingConnection`, `PeerServiceProxy`, `ChunkedChannel`, the protocol types |

The browser entry point uses only browser APIs; a frontend installs the same package, and the framework is not installed
with it.

## 1. How a connection is made

Two endpoints cannot connect until each knows how to reach the other. Each one describes itself in an **offer** or an
**answer** (its codecs, keys and data channels) and lists its **candidates**, the addresses at which it may be reached:
its local addresses, its public address as a STUN server sees it, and an address on a TURN server that relays its
traffic when nothing else gets through. These messages travel through a server to which both endpoints are connected,
the **signaling**; once the endpoints have them, they test the candidates in pairs (ICE), keep a working pair, and
encrypt the connection (DTLS). The connection's data channels then carry messages in both directions, reliable and
ordered or not, and its tracks carry audio and video.

This package's signaling works with **rooms**: a client joins a room, receives the list of members already there, and
offers, answers and candidates are exchanged between each pair of members. The rest is done for you:

- Offers and answers are exchanged as in the W3C "perfect negotiation": either member may add data channels and tracks
  at any time, even both at the same moment.
- A connection that fails, or stays disconnected for 5 seconds, restarts ICE automatically.
- When the signaling connection drops, the peer-to-peer connections stay up, and the client rejoins its rooms once it
  reconnects.
- Members receive the ICE servers (with TURN credentials) when they join, and new credentials before those expire.

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

`SignalingController` serves signaling requests; it finds the component under the name `signaling`, which finds the
entrypoint under the name `entrypoint` (its `entrypoint` option). Its actions go through the entrypoint's middlewares
like any other action. The member's ID is the client ID of its connection: the Socket.IO `auth.id` (otherwise its `id`
header), or a WebSocket's `id` header or query parameter. Authenticate requests with a middleware, and decide who joins
which room with `authorize`: `(peer, room, context) => boolean | Promise<boolean>`, called with the member's ID and
metadata and its request's context.

The options of `buildSignalingOptions`:

| Option | Default | Meaning |
|---|---|---|
| `entrypoint` | `'entrypoint'` | The entrypoint component that pushes events to the members |
| `turn` | — | A `TURNServer` component: members receive its ICE servers, with credentials |
| `iceServers` | `[]` | Additional ICE servers (another STUN or TURN server), after those of `turn` |
| `authorize` | — | Who joins which room; without it, everyone may join any room |
| `maxPeers` | `0` | The maximum number of members in a room; 0 for no limit |
| `maxMessageSize` | `65536` | The maximum size of a signal and of a member's metadata, in bytes |
| `maxMessagesPerSecond` | `50` | The number of signals a member may send per second, on average (bursts of twice as many) |
| `heartbeatInterval` | `10000` | How often a client sends a heartbeat when the server cannot see its disconnection, in milliseconds |
| `cluster`, `turnSecret`, `selectTURN` | — | Several nodes (section 13) |

The component also works without the controller: `join()`, `signal()`, `leave()` and `disconnect()` change the rooms
from the application's own code, and `rooms()` lists them. A member added by the application receives its events through
the `receive` option of `join()`. IDs starting with `sfu:` and `whip:` are reserved for the members the server adds
itself (the media server, WHIP streams): a client joining with one is refused.

## 3. The STUN and TURN server

Most connections succeed directly or with the public address a STUN server reports. Some networks (symmetric NATs,
corporate firewalls, mobile carriers) let nothing through but a relay: a TURN server forwards the connection's traffic.
`TURNServer` is one that runs inside the application:

| Option | Default | Meaning |
|---|---|---|
| `host` | `'0.0.0.0'` | The address it listens on |
| `port` | `3478` | The STUN and TURN port over UDP and TCP |
| `udp`, `tcp` | `true` | Whether to listen over UDP, over TCP |
| `tls` | — | `{cert, key, port}`: TURN over TLS (`turns:`, port 5349 by default), for networks that let only TLS through |
| `publicAddress` | the host's first non-internal IPv4 address | The address at which clients reach it |
| `relayPortRange` | any free port | `[first, last]`: the UDP ports of the relays |
| `secret` | a random one at each start | The secret for the short-lived credentials |
| `users` | `{}` | Users with a fixed password, `{username: password}` |
| `realm` | `'lakutata'` | The realm of the credentials |
| `credentialTtl` | `86400` | How long the short-lived credentials are valid, in seconds; a relay made with them keeps working once they expire |
| `maxAllocations` | no limit | The maximum number of relays at the same time |
| `workers` | `0` | Worker threads that serve the clients, to use more cores (on Linux; see below) |

The short-lived credentials follow coturn's REST API: the username is `<expiry>:<user>` and the password is
`base64(HMAC-SHA1(secret, username))`, so any server holding the secret checks them without storing them.
`turn.iceServers(user)` returns a client's ICE servers with credentials, `turn.credentials(user)` the credentials alone,
`createTURNCredentials(secret, user, ttl)` creates them for another TURN server (a coturn configured with
`use-auth-secret`), and `turn.allocations` counts the relays in use.

### Several cores

The server relays in the main thread by default. Measured on an Apple M4 with Node.js 24, it relayed a data channel
whose two ends both relayed through it (so it carried each packet twice) at about 38 MiB/s for 16 KiB messages, taking
27 s of CPU per GiB, and 365,000 messages of 100 bytes a second, at 2.8 µs of CPU each. A packet costs the same with 500
idle allocations from other clients.

With `workers: 3`, three worker threads serve the clients. Their listeners share the server's ports (`SO_REUSEPORT`),
and the system keeps each client on one thread, chosen from its address and port; that thread relays its traffic. The
threads count their allocations together against `maxAllocations`, and `relayPortRange` is divided among them. Only
Linux lets threads share ports: elsewhere, the server relays in the main thread and reports this in the debug messages
(`webrtc/turn`). A thread that stops (only a bug stops one) loses its allocations and is restarted. Meanwhile, the
system spreads the UDP clients among the other threads, then among all of them again, so most of them find their
allocation gone, as when a TURN server restarts; the TCP and TLS connections of the other threads remain.

In an arm64 Linux virtual machine (Docker Desktop, 10 cores) on the same Mac, with three connections relaying through it
at the same time (six clients):

| Server | 100-byte messages relayed | CPU per message |
|---|---|---|
| The main thread | 460,000 to 550,000 a second | 1.9 to 2.3 µs |
| 3 worker threads | 510,000 to 820,000 a second in five of six runs, 220,000 in the other | 2.4 to 3.8 µs, 9 µs in the other run |

The system distributes clients by address and port, not by load: with six clients, a thread often had none, or twice its
share. Large messages were therefore relayed at 34 to 79 MiB/s depending on the run, against 46 to 50 MiB/s in the main
thread; the more clients there are, the more evenly the threads share them. Each thread takes about 15 MiB. In that
virtual machine, a worker thread relayed a quarter to a third fewer messages per core than the main thread; on macOS,
the two cost the same.

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

`SignalingConnection` takes the application's connection:

- a Socket.IO socket (`io()` from `socket.io-client`): the member's ID is its `auth.id`, and Socket.IO reconnects
  automatically;
- a `WebSocket` speaking JSON-RPC: the member's ID is the `id` query parameter of its URL;
- a function that creates that `WebSocket`, so that the connection reconnects after a disconnection (after 1 second,
  then twice as long each time, 30 seconds at most):
  `new SignalingConnection(() => new WebSocket('wss://meet.example.com/rpc?id=alice'))`.

Its options: `iceTransportPolicy` (`'relay'` to use only the TURN relays), `configuration` (additional options for the
`RTCPeerConnection`s), `createPeerConnection` (another implementation of `RTCPeerConnection`), `timeout` (the request
timeout, 15 seconds by default).

A room emits `peer` for each other member: the members already in the room, then each newcomer. A listener added later
is called immediately for the peers already there. In a room with a media server, `peer` is emitted once the connection
to the server has exchanged its first offer and answer, so that a channel created in the listener does not collide with
that offer. `room.publish(track, stream)` sends a track to every member (section 8), and `room.sfu` is the ID of the
room's media server, when it has one (section 9). A `Peer` has the member's `id`, its `metadata`, the `connection` to it
(an `RTCPeerConnection`: read its statistics), `createDataChannel()`, `pause()` and `resume()` (for one of the member's
tracks), `restartIce()` and `close()`, and emits `datachannel`, `track`, `connectionstatechange`, `metadata` (the member
rejoined with new metadata), `error` and `close`. A room emits `peer-left` when a peer closes: its member left, or its
connection was lost permanently.

Both members may create channels: each side receives the other's channels through `datachannel`. For a single
channel shared by both, create it on both sides with `negotiated: true` and the same `id`.

In Electron, the renderer uses `@lakutata/webrtc/client` and connects to the signaling itself; the main process uses
`@lakutata/webrtc`.

## 5. An application as a member

`SignalingClient` joins rooms from a Lakutata application, with Node.js peer connections. A device, a recorder, a bot or
a test joins rooms as browsers do:

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

An `http:` or `https:` URL uses Socket.IO (install `socket.io-client`); a `ws:` or `wss:` URL uses JSON-RPC over the
global `WebSocket` of Node.js 22 and Bun, otherwise over the `WebSocket` of the `ws` package (install `ws`). Its
options: `url`, `id` (a random UUID by default), `path` (the Socket.IO path), `auth` (additional fields for the
Socket.IO handshake, such as a token), `timeout`, and its connections' options (`iceTransportPolicy`, `icePortRange`,
`iceAdditionalHostAddresses`, `codecs`, `threads`). It is `@Transient`: each `getObject()` returns a new client, and
`close()` leaves its rooms and disconnects.

### Calling the actions of an application

`webrtcServiceEntrypoint()` lets the members of the rooms an application joins call its service actions
(`@ServiceAction`) over their peer-to-peer connection to it: a browser on another network calls a device's actions
directly, and the calls do not go through a server. It is a `service` adapter for the entrypoint, like those in
[Service Calls](ServiceCalls.md): the actions keep their input validation, access control and middlewares, and the same
actions can be served over Socket.IO or JSON-RPC at the same time.

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
            //The device joins the room door-7 as the member door-7
            service: webrtcServiceEntrypoint({
                signaling: {url: 'https://meet.example.com', id: 'door-7'},
                rooms: ['door-7']
            })
        })
    },
    bootstrap: ['entrypoint']
})
```

A member of the room creates a data channel labeled `service` to the device, and calls through it with
`PeerServiceProxy`, which both of the package's entry points export:

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

- `invoke(input, timeout)` sends the input's `method` as the method of a JSON-RPC request and the other fields as its
  parameters (to use another field, specify the same `methodField` on both sides), and resolves to the result. It fails
  with a `PeerServiceError`: its `errno` is that of the action's error (`E_ACCESS_DENY`, `E_INVALID_VALUE`…), its `code`
  the JSON-RPC code, its `data` the whole error object; or its `errno` is `E_PEER_SERVICE_TIMEOUT` (10 minutes by
  default) or `E_PEER_SERVICE_CLOSED`. A request larger than 10 MiB as JSON (the proxy's `maxRequestSize`, the same as
  the adapter's `limit`) is not sent and fails immediately with `E_PEER_SERVICE_TOO_LARGE`. Calls made before the
  channel opens wait for it.
- `this.context.clientId` is the caller's member ID. `webrtcRequestOfContext(this.context)` returns its `peer` (with its
  metadata), the `room` it called through and the `channel`. `entrypoint.notify(memberId, event, ...args)` pushes an
  event to that member's channels, and `broadcast()` to every channel; the proxy's `on`, `once` and `off` receive them.
- The rooms are joined once the application has launched, so the signaling server may run in the same application. A
  room that cannot be joined is reported to `onError` (the application's log by default) and retried after 1 second,
  then after twice as long each time, up to 10 seconds; a room the signaling refuses is not retried.
- When a channel closes (its member left), its requests in progress are aborted: the action's `this.signal` fires. When
  the application stops, new requests fail with the code `-32001`, the requests in progress receive their responses, and
  then the channels are closed.
- The adapter serves every service action of its entrypoint, as the other service adapters do, except the signaling
  actions: serve the actions meant for members through a separate entrypoint, or limit them with rules or middlewares.
  Channels with another label are left to the application.
- In a room with a media server, the channel goes through the server, which sees the messages; for calls that only the
  two members should see, use a room without one.

The options of `webrtcServiceEntrypoint()`:

| Option | Default | Meaning |
|---|---|---|
| `signaling` | — | Options for a `SignalingClient` that the adapter creates, and closes when it stops |
| `client` | — | Instead of `signaling`, a function returning the application's client, when the application uses it too (two clients with the same ID would replace each other in the rooms); the adapter does not leave its rooms or close it |
| `rooms` | — | The rooms whose members may call; a room the client has already joined is served without being joined again (the `metadata` option does not apply to it) |
| `metadata` | — | The application's metadata in the rooms it joins |
| `label` | `'service'` | The label of the channels that carry the calls |
| `limit` | 10 MiB | The largest request; a larger one receives a response with the code `-32600` |
| `methodField`, `toPattern`, `positionalParams` | `'method'` | How a request maps to an action, as with `jsonRPCServiceEntrypoint()` |
| `onError` | the application's log | Called with the error when a room cannot be joined |

The member ID is only as reliable as the signaling server makes it. The server sends each member's signals under the ID
it knows that member by, so a member cannot impersonate another one; but the ID is the client ID of the member's
connection to the server, which the client provides, and the metadata is what the member provided. Before an action
relies on `clientId` to decide who may call it, make the signaling server check its clients: authenticate them with a
middleware and decide who joins which room with `authorize` (section 2).

## 6. Peer connections without the signaling

`PeerConnection` has the same interface as `RTCPeerConnection`, so browser code works in Node.js, and any signaling
works: an HTTP request, a QR code, a message queue. Its events are available in both styles: `addEventListener` and the
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

Its options are `iceServers`, `iceTransportPolicy` and, for a server, `icePortRange` (the UDP ports of its candidates,
to open in a firewall) and `iceAdditionalHostAddresses` (additional addresses offered as candidates, such as the public
address of a NAT forwarding these ports with the same numbers); `codecs` chooses the audio and video codecs.
`headerExtensions: true` adds the RTP header extensions a media server uses: each side then estimates, from the other
side's feedback, the bandwidth available for what it sends (without them, a browser relies only on lost packets,
starting low and rising slowly). A `PeerChannel` sends strings and binary data; a binary message arrives as a `Buffer`,
or as an `ArrayBuffer` when `binaryType` is `'arraybuffer'`. `threads` serves it in a worker thread (see below).

### Several cores

A connection runs its ICE, DTLS, SCTP and SRTP in the main thread by default. Given the name of a `PeerThreads`
component (its `threads` option, which `SignalingClient` also has, for the connections to the other members), it runs
them in one of that component's worker threads, while its object, its events and its channels' messages stay in the main
thread: the code using it is the same. Its methods are carried to the thread and resolve once done there; its states are
those the thread last reported, with its events and with the reply to each method. The packets of the tracks it receives
come to the main thread while they are read or sent on, and the packets of the tracks it sends go to the thread.

```typescript
import {Application} from 'lakutata'
import {buildPeerThreadsOptions, type PeerChannel, PeerConnection} from '@lakutata/webrtc'

Application
    .run(() => ({
        id: 'gateway.app',
        name: 'Gateway',
        components: {
            //Four threads at most, started when needed
            peerThreads: buildPeerThreadsOptions({threads: 4})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        //Its engine runs in one of the threads
        const connection: PeerConnection = await app.getObject(PeerConnection, {threads: 'peerThreads'})
        const channel: PeerChannel = connection.createDataChannel('data')
        channel.on('open', (): void => channel.send('hello'))
    })
```

Threads start when needed: a new connection goes to a thread serving none (a new one is started while there are fewer
than `threads`, by default the number of cores minus one), otherwise to the thread serving the fewest. A connection
stays in its thread; when a thread stops (only a bug stops one), its connections fail (`failed`, then `closed`), and the
thread is restarted for the next ones. `resourceLimits` limits each thread's heap, as `workerResourceLimits` does for
the media server (Bun ignores it). The bytes of received messages on their way to the main thread still count against
the receive window until it reads them, so a main thread that reads slowly slows the other peer down, as it would
without threads. RTP packets on
their way between threads are limited to 2 MiB per connection and direction; beyond that, they are dropped, as a full
UDP buffer would drop them.

Measured on an Apple M4 with Node.js 24, pairs of connections in one process exchanging messages over a data channel
(`packages/webrtc/test-env/bench/threads.mjs` in the repository):

| Pairs | Engines | 100-byte messages | CPU per message | 16 KiB messages |
|---|---|---|---|---|
| 1 | in the main thread | 274,000 a second | 4.2 µs | 45 MiB/s |
| 1 | in 2 worker threads | 539,000 a second | 4.5 µs | 85 MiB/s |
| 4 | in the main thread | 267,000 a second | 4.3 µs | 46 MiB/s |
| 4 | in 4 worker threads | 782,000 a second | 6.2 µs | 138 MiB/s |

The two connections of a pair work in parallel in two threads: one pair carries twice as much as in the main thread, for
0.3 µs more CPU per message. Four pairs in four threads carry three times as much; the CPU per message rises once the
threads outnumber the M4's four performance cores. In an arm64 Linux virtual machine (Docker Desktop, Alpine) on the
same Mac, one pair carried 414,000 messages of 100 bytes a second in two threads, against 212,000 in the main thread, at
6.8 µs of CPU each against 5.5; four pairs carried 460,000 against 222,000, at 10.7 µs against 5.4, and 70 MiB/s of
large messages against 47, for 2.5 times the CPU: there, several threads allocating memory at the same time cost more
per message. Threads give a process more connections, using more cores, not cheaper messages.

In that virtual machine, each thread took about 100 MiB more with small messages, 55 MiB with large ones. On macOS, with
large messages through four pairs in four threads (138 MiB/s), the process's memory (its physical footprint) rose in
most runs to between 1.5 and 3.5 GB in the first minute, then fell back: in a three-minute run, it stayed at about 700
MiB after the first minute. That is memory freed and kept for a while by the macOS allocator, not a leak. Node.js
allocates a 64 KiB buffer for each UDP datagram it receives; when several threads do so at that rate while other small
buffers are still in use, the allocator keeps much of the freed memory. The same run stays at about 540 MiB on Linux,
and at about 200 MiB in Bun on macOS, which has its own allocator.

## 7. Large messages and files

A data channel carries messages of up to 64 KiB with any peer; Chrome and this package's connections accept up to 256
KiB. `ChunkedChannel` removes the limit: wrapped around the channel on both sides, it splits each message into 16 KiB
chunks, sends them as the channel's buffer empties, and reassembles them on the other side. It sends strings, bytes and
`Blob`s (a browser file is read one chunk at a time):

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

The channel must be ordered and reliable (the default). A received message larger than `maxMessageSize` (64 MiB by
default) is dropped with an `error` event.

## 8. Audio and video

A track carries the audio or the video of one source. In a browser, publish the camera and microphone tracks in the
room: `room.publish()` sends a track to every member, including those who join later. The other members receive it
through their peer's `track` event, and `event.streams` groups a source's audio and video:

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

`room.unpublish(track)` stops sending a track; its transceivers are kept for the next track published.
`peer.pause(track)` and `peer.resume(track)` stop and start receiving one of a member's tracks, for example a video that
is not on the screen. Without a media server, a track added to `peer.connection` goes to that member only.

Without a media server, each member sends its video once per other member: this suits small rooms. With the media
server of section 9, each member sends it once.

Node.js captures, encodes and decodes nothing: an application's tracks carry RTP packets, the encoded audio and video,
from an encoder or from another connection.

- `new MediaTrack(kind, {codec})` creates a track to send, and `writeRtp()` sends a packet: an `RtpPacket`, or the bytes
  of one, such as the datagrams ffmpeg and GStreamer send to a UDP port. Each connection assigns the packets its own
  synchronization source and payload type, and the sequence numbers and timestamps continue from those written.
- A received track (from the `track` event of a `Peer` or a `PeerConnection`) delivers the other member's packets
  through its `rtp` event; `requestKeyFrame()` asks the other member for a key frame.
- A received track added to another connection forwards its packets there, and that connection's key frame requests go
  back to the track's sender (one every 500 ms at most).
- A track's `keyframerequest` event fires when a peer to which the track is sent requests a key frame.

A camera sending what ffmpeg encodes:

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

A viewer starts decoding at a key frame: configure the encoder for a key frame every second or two (ffmpeg's `-g`), or
have the encoder produce one when the track emits `keyframerequest`, if it can. The `dump_extra` bitstream filter puts
the H.264 parameters before each key frame, where browsers need them.

An application that sends a member's camera on to the viewers who join, so that each viewer receives the video from the
application instead of the camera (the media server of section 9 does this for every member of a room):

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
groups a stream's tracks), `addTransceiver(trackOrKind, {direction, streams})` (`recvonly` to receive without sending),
`removeTrack(sender)`, `getTransceivers()`, `getSenders()` and `getReceivers()`; `sender.replaceTrack()` sends another
track, in any negotiated codec, without negotiating again. The codecs are Opus and PCMU for audio, VP8, H.264 and VP9
for video; the `codecs` option of `PeerConnection` and `SignalingClient` chooses them and their order, and a track
created with a `codec` makes its connections negotiate that codec.

## 9. The media server

Without a media server, each member of a room sends its tracks to each other member: in a meeting of eight, each one
uploads its video seven times and keeps seven connections. The `SFU` component is a media server (a selective forwarding
unit) for the signaling's rooms: each member connects only to it, sends each track once, and receives the others' tracks
from it. The server forwards their packets without decoding them, and a member uploads its video once, however large the
room.

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
        //The meetings go through the media server; the other rooms stay peer to peer
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

Clients need no change. The server joins each room it serves as a member whose ID starts with `sfu:`, and this package's
clients (`SignalingConnection` in browsers, `SignalingClient` in Node.js) connect to it instead of to each other. Rooms
and peers work as they do without it:

- `room.publish()` sends a track once, to the server, which forwards it to every member, including those who join later.
- Each peer emits its member's tracks. Their `event.streams` are the streams of the connection to the server;
  `room.streamOf(id)` returns the member a stream comes from, and the stream's ID on that member's connection.
- `peer.createDataChannel()` opens a channel through the server, which relays its messages both ways. The server sees
  them, unlike messages exchanged directly between two members. A `protocol` cannot be specified for such a channel,
  and it cannot be `negotiated`.
- `peer.pause(track)` asks the server to stop sending a track, `peer.resume(track)` to send it again.
- `room.sfu` is the server's ID, and `peer.connection` is the connection to it, the same for all peers: publish tracks
  with `room.publish()` rather than adding them to it.

The options of `buildSFUOptions`:

| Option | Default | Meaning |
|---|---|---|
| `signaling` | `'signaling'` | The `Signaling` component whose rooms the server serves |
| `serves` | all rooms | `(room) => boolean`: the rooms served; the others stay peer to peer |
| `select` | every member receives every track | `(subscriber, track) => boolean`: whether a member receives a track |
| `maxMembers` | `0` | The maximum number of members across all rooms, 0 for no limit; a member joining once it is reached is refused (`SignalingLimitException`) |
| `codecs` | Opus, PCMU, VP8, H.264, VP9 | The codecs members may publish |
| `icePortRange`, `iceAdditionalHostAddresses` | | The UDP ports of the connections, and the server's public address. Each connection (a member, a WHIP stream, a WHEP viewer) takes a port on each of the machine's addresses: make the range large enough for all of them |
| `workers` | `0` | Worker threads that forward the rooms, to use more cores |
| `workerResourceLimits` | V8's limits | Each worker thread's heap and stack limits (`resourceLimits` of `node:worker_threads`), to use less memory for slightly more CPU (see Several cores below); Bun ignores them |
| `cluster`, `selectSFU` | | The media servers of several nodes (section 13) |

`select` is called for each member and each of the others' tracks, and called again when a member rejoins the room with
different metadata: the tracks the member receives follow the new results. A `select` that throws counts as `false`, and
its error goes to the debug messages (section 15). In a webinar, for example, everyone receives everyone's audio and
only the speakers' video:

```typescript
import {buildSFUOptions, type SFUTrack, type SignalingPeer} from '@lakutata/webrtc'

const sfu = buildSFUOptions({
    select: (subscriber: SignalingPeer, track: SFUTrack): boolean => track.kind === 'audio' || track.peerId.startsWith('speaker-')
})
```

How the server forwards:

- It does not transcode: a member receives the tracks in codecs it supports, and the server emits `unsupported` for the
  others. For browsers, publish video in VP8 or H.264.
- Members' key frame requests go to the publisher, one every 500 ms at most, and the server asks the publisher for a key
  frame when a member starts receiving a video. Packets lost on the way to a member are retransmitted by the server.
- Each connection estimates its bandwidth from the other side's feedback: browsers adapt what they send to the server,
  and the server emits `congestion` when the bandwidth to a member stays too low for what it receives, and again once it
  is sufficient. The server sends each video as it is published (there is no simulcast yet): pause some of the videos
  the member receives to reduce the load.
- A member that reads a channel's messages more slowly than they are sent makes their sender wait; the server keeps a
  few megabytes of them at most.

Its events: `publish` and `unpublish` (an `SFUTrack` with its `room`, `peerId`, `id`, `kind`, `codec` and `stream`) when
a member starts and stops publishing a track; `unsupported` (the room, the member's ID, the track) when a member does
not support the codec of a track it should receive; `congestion` (the room, the member's ID, whether the bandwidth is
too low, the estimated bit rate in bits per second). `rooms()` lists the rooms with their members, tracks and WHEP
viewers. `track(room, peerId, trackId)` returns a published track as a `MediaTrack`, whose `rtp` event delivers its
packets, to record it or to send it on another connection:

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

### Several cores

The server forwards in the main thread by default. With `workers: 4`, four worker threads forward the rooms: each room
in one of them (the one forwarding the fewest members and viewers when the room opens), with its connections and its UDP
ports, while the hooks and events stay in the main thread. `icePortRange` is divided among the threads. A thread that
stops closes its rooms; the server reopens them in another thread, and their members reconnect to it. `rooms()` shows
what each thread reports, so a change made in a thread (a viewer leaving) appears a moment later.

Measured on an Apple M4 with Node.js 24, with each publisher sending a video of about 2 Mbit/s (200 packets of 1250
bytes a second) and the members in other processes:

| Rooms | Packets to forward | Forwarded | CPU |
|---|---|---|---|
| 1 room of 4 publishers and 10 subscribers, in the main thread | 7,600 a second | all | 45% of a core |
| 4 rooms of 12 publishers and 10 subscribers each, in the main thread | about 92,000 a second | 86,000 to 88,000 a second | 145%: the main thread is full, the rest is the garbage collector |
| The same 4 rooms, in 4 worker threads | about 92,000 a second | all | 174% |

At a load as light as the first room's, the share of a core depends on how fast the system runs the cores, and it runs
them faster when the machine is busy: with two other cores kept busy, the same room took 21%.

In an arm64 Linux virtual machine (Docker Desktop, 10 cores) on the same Mac, with the members also running in it, the
main thread forwarded all the packets of the 4 rooms (93,000 a second) at 160% of a core. Four threads took 380% to 390%
of a core, and forwarded from 69,000 to all of the 94,000 a second, depending on the run: there, at that load, the
threads do not pay off.

A thread takes about 22 MiB and 90 ms to start. Under the load above, the process used 1.4 GiB with the threads and
0.6 GiB without: each thread has its own heap, with the large young generation V8 assigns it for speed. With
`workerResourceLimits: {maxYoungGenerationSizeMb: 32}`, the process used 1.0 to 1.2 GiB, for 4% more CPU (181% of a
core instead of 174%). A track forwarded from one node to another (section 13) costs the two nodes about 11 µs of CPU
per packet: 0.2% of a core for such a video.

## 10. Publishing with WHIP

WHIP (RFC 9725) publishes a stream with one HTTP request: the encoder (OBS, GStreamer, ffmpeg) or the browser posts its
offer to the stream's URL, and receives the answer and its session's URL. The `WHIP` component answers the offers and
emits `publish` with the session (its `id`, `stream`, `connection` and `tracks`) and `unpublish` when the session ends:
the publisher deleted it, its connection failed or closed, or the application stopped. `WHIPController` is its HTTP
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

In OBS, choose the WHIP service, the server `https://studio.example.com/whip/live` and the bearer token; ffmpeg
publishes with `-f whip -authorization <token> https://studio.example.com/whip/live` (stereo audio: `-ac 2`). The
session's tracks deliver their RTP packets, to record them or to send them on to other connections (section 8).

| Request | Response |
|---|---|
| `POST /whip/:stream` with the offer (`application/sdp`) | `201 Created`: the answer, `Location` (the session), `Link` (the ICE servers), `ETag` (its ICE session) |
| `DELETE /whip/:stream/:session` | `200`: the session ends |
| `OPTIONS` | `204`, with the CORS headers and `Accept-Post: application/sdp` |
| `GET` | `204` |
| `PATCH /whip/:stream/:session` with an SDP fragment (`application/trickle-ice-sdpfrag`) | `204`: the publisher's candidates (trickle ICE); `200`: an ICE restart, with the answer fragment and a new `ETag`; `412` for an `If-Match` other than `*` and the `ETag` |

The refusals: 401 with `WWW-Authenticate: Bearer` when `authorize` refuses, 415 for a body that is not `application/sdp`
(`application/trickle-ice-sdpfrag` for a PATCH), 400 for an offer without audio or video, 503 once there are
`maxSessions` sessions, 404 for an unknown session. A session's URL is the capability to end it: its ID is random, and
its DELETE and PATCH requests are not authorized again. A subclass with `@Prefix({route: '/live'})` serves the same
interface under another path.

| Option | Default | Meaning |
|---|---|---|
| `authorize` | none | `({stream, token}, context) => boolean`: who may publish which stream |
| `turn` | none | The name of a `TURNServer` component: publishers receive its ICE servers in the `Link` headers |
| `iceServers` | `[]` | Additional ICE servers for publishers |
| `maxSessions` | `100` | The maximum number of sessions at the same time, `0` for no limit |
| `allowOrigin` | `'*'` | The origins browsers may publish from |
| `icePortRange`, `iceAdditionalHostAddresses` | | The server's candidates: its UDP ports (each session takes a port on each of the machine's addresses; with `sfu`, the media server's ports are used), its public address |
| `codecs` | Opus, PCMU, VP8, H.264, VP9 | The codecs accepted |
| `sfu` | none | The name of an `SFU` component: the streams go to its rooms |
| `roomOf` | the stream | `({stream, token}, context) => string`: the room of the media server a stream goes to |
| `cluster`, `turnSecret`, `selectTURN` | | Several nodes (section 13) |

The answer carries all the candidates of the server, which gathers them before answering: behind a NAT or in a
container, specify its public address and open its ports.

With `sfu`, a stream goes to a room of the media server (section 9) instead of the application: the room named after the
stream, or the one `roomOf` returns. It joins the room as a member whose ID starts with `whip:`, the room's members
receive its tracks like those of any member, and WHEP viewers play it (section 11). Its connection then belongs to the
media server, so the session has the stream's `room` and `peerId` instead of `connection` and `tracks`; `sfu.track()`
delivers its packets.

## 11. Playing with WHEP

WHEP (the WebRTC-HTTP Egress Protocol) plays a stream with one HTTP request: the player posts a receive-only offer, and
receives the answer and its session's URL. The `WHEP` component plays the media server's rooms: each viewer receives the
audio and the video of one member of a room, by default the stream published into it with WHIP. Viewers are not members
of the room, so the members do not see them, and a stream may have many viewers. `WHEPController` is its HTTP interface,
under `/whep`.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions, buildWHIPOptions, WHEPController, WHIPController} from '@lakutata/webrtc'

//OBS publishes to https://live.example.com/whip/concert, the browsers play https://live.example.com/whep/concert
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

A browser plays it with its own `RTCPeerConnection`, its offer carrying all its candidates:

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

| Request | Response |
|---|---|
| `POST /whep/:stream` with the offer (`application/sdp`) | `201 Created`: the answer, `Location` (the session), `Link` (the ICE servers), `ETag` (its ICE session) |
| `DELETE /whep/:stream/:session` | `200`: the session ends |
| `PATCH /whep/:stream/:session` with an SDP fragment (`application/trickle-ice-sdpfrag`) | As for WHIP: `204` for the viewer's candidates, `200` with the answer fragment for an ICE restart, `412` for an `If-Match` other than `*` and the `ETag` |
| `OPTIONS` | `204`, with the CORS headers and `Accept-Post: application/sdp` |
| `GET` | `204` |

The refusals: 401 with `WWW-Authenticate: Bearer` when `authorize` refuses, 415 for a body of another type, 400 for an
offer without audio or video or a room the media server does not serve, 503 once there are `maxSessions` sessions, 404
for an unknown session.

| Option | Default | Meaning |
|---|---|---|
| `sfu` | `'sfu'` | The name of the `SFU` component whose rooms are played |
| `roomOf` | the stream | `({stream, token}, context) => string`: the room a stream comes from |
| `select` | the newest WHIP stream, otherwise the first member publishing | `({stream, token}, tracks) => string \| undefined`: the ID of the member a viewer receives |
| `authorize` | none | `({stream, token}, context) => boolean`: who may play which stream |
| `maxSessions` | `100` | The maximum number of sessions at the same time on this node, `0` for no limit |
| `allowOrigin` | `'*'` | The origins browsers may play from |
| `turn`, `iceServers` | | The ICE servers provided to viewers in the `Link` headers |
| `cluster`, `turnSecret`, `selectTURN` | | Several nodes (section 13) |

A viewer receives one member: by default the newest stream published into the room with WHIP, otherwise the first member
publishing audio or video. `select` chooses another one; it is called again each time the room's tracks change, and when
it throws, the viewer receives the default one. When the member stops publishing, the viewer continues with the next one
on the same connection: its picture stops for a moment and resumes at a key frame. A viewer's offer determines what it
receives, one audio and one video, and its connection negotiates every codec in the offer that the server supports: a
stream published later in any of them is sent too.

The component emits `play` (the session, with its `id`, `stream`, `room`, `viewerId` and `source`, the member it
receives) once it answers, and `stop` when the session ends: the viewer deleted it, its connection failed or closed, or
the application stopped. `whep.sessions` lists this node's sessions, and `sfu.rooms()` counts each room's viewers.

## 12. Deployment

- **Ports.** Open port 3478 over UDP and TCP, the relay ports (`relayPortRange`) over UDP, and the TLS port when TURN
  over TLS is enabled. In a container, publish them all; the relay range keeps the list short.
- **The public address.** `publicAddress` is the address at which clients reach the TURN server: the host's public
  address, or that of its NAT when the NAT forwards the ports. On a local network, the default is sufficient.
- **The applications as members.** A server behind a NAT that forwards `icePortRange` with the same port numbers
  specifies its public address in `iceAdditionalHostAddresses`; otherwise, it relies on the TURN server like any client.
- **The media server, WHIP and WHEP.** Clients connect to them directly: open their `icePortRange` over UDP, and specify
  in their `iceAdditionalHostAddresses` the public address of a NAT forwarding these ports with the same numbers. A
  client that cannot reach them goes through the TURN server.
- **Several instances.** Configure a `Cluster` for them (section 13) and the same `secret` for their TURN servers, so
  that each accepts the credentials created by the others.
- **Another TURN server.** coturn (`use-auth-secret`, `static-auth-secret` set to the same secret) accepts the
  credentials created by `createTURNCredentials()`; list it in the `iceServers` option of `Signaling`.
- **HTTPS.** Browsers allow WebRTC on any page, but the camera and microphone only on secure pages (HTTPS or
  `localhost`).
- **The UDP buffers.** The connections and the TURN server request a 4 MiB receive buffer for their UDP sockets: a
  smaller one loses packets in a burst, or when a large transfer arrives faster than the process reads it. Linux caps
  the size at `net.core.rmem_max`, which is 208 KiB on most systems, so raise it on a Linux server
  (`sysctl -w net.core.rmem_max=4194304`, on the nodes for pods on their node's network).

## 13. Several instances

Several instances of an application (a deployment's pods, the processes behind a load balancer) work together through a
`Cluster`: each instance is a node of the cluster, and the nodes communicate through NATS or Redis. The components
configured with its name work across the nodes:

- the signaling puts the members connected to all the nodes in the same rooms;
- the TURN servers report their address and load to the other nodes, and each member receives the least loaded ones;
- the media servers share the rooms: each member, WHIP stream and WHEP viewer connects to one node's media server, and
  the media servers of a room forward its tracks to each other;
- a WHIP or WHEP session is ended or patched whichever node its DELETE or PATCH reaches.

The bus carries only these messages. Audio, video and data go directly between the clients and the nodes, between the
nodes' media servers, or through the TURN servers.

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
| `transport` | (required) | `{type: 'nats', servers, user, pass, token}`; `{type: 'redis', url}` or `{type: 'redis', host, port, username, password, database, tls}`; `{type: 'memory'}` for applications in one process (tests) |
| `prefix` | `'lakutata.webrtc'` | The prefix of the subjects or channels: with it, clusters that share a server stay separate |
| `nodeId` | the host name and a random suffix | The node's ID; in Kubernetes, the host name is the pod's name |
| `labels` | `{}` | What the other nodes see of this one (a zone, a region), to choose the TURN servers |
| `heartbeatInterval` | `2000` | How often the node tells the others it is there, in milliseconds |
| `requestTimeout` | `5000` | How long `request()` and `requestAll()` wait, in milliseconds |

NATS requires `npm install nats`, and its core subjects are sufficient (no JetStream); Redis requires
`npm install ioredis`, and only its channels are used (`PUBLISH`, `SUBSCRIBE`). The component connects when the
application launches, and fails to start when the server cannot be reached at that time (in Kubernetes, the pod
restarts until it can); afterwards, it reconnects automatically. The other nodes consider a node gone after three
heartbeat intervals without news of it, or immediately when it stops.

### The rooms across the nodes

Each node tells the others who joins and leaves through it, and receives all the members of a node when that node comes
up or when some of its news was lost (a bus restart, for example). A signal to a member of another node goes through
that node.

- When a node stops, or the others can no longer reach it, its members leave their rooms as `disconnected`: their
  connections stay up while their clients reconnect to another node and rejoin.
- A client that rejoins through another node before the first node noticed it was gone is moved there: the others see
  it rejoin, not leave.
- `maxPeers` counts the members of all nodes. Each room is assigned to one node (by hashing over the nodes), which
  admits its members one at a time, so two members joining at the same time through different nodes cannot both take the
  last place. When a node joins or leaves the cluster, some rooms are reassigned to another node, and a member joining
  at that exact moment may be admitted beyond the limit.
- Socket.IO behind a load balancer: its long polling sends a client's requests one by one, and they must all reach the
  same instance. Connect the clients with `transports: ['websocket']` (a single connection, so no sticky sessions), or
  enable sticky sessions in the load balancer.

### The TURN servers of the cluster

A TURN server joins the cluster with its `cluster` option and the `secret` shared by all of them (it refuses to start
without one); it reports its address, ports and allocations to the others every second. The `Signaling`, `WHIP` and
`WHEP` components configured with `turnSecret` provide each client with the two least loaded TURN servers that are not
full, after the one on their own node (`turn`). `selectTURN` chooses differently, for example by the nodes' labels:

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

### The media servers of the cluster

Given `cluster`, the nodes' media servers share the rooms: the ID of each one is `sfu:` followed by its node's ID, and
each member is connected to one node's media server.

- A room stays on as few nodes as it can. Its first member goes to the node it joins through, or to the least loaded
  node when that one is full; the next members go to the least loaded node the room already has, and to the least loaded
  node overall once those are full. A load balancer spreads clients over the nodes at random: without this rule, a
  meeting of three could occupy three nodes.
- `selectSFU` chooses the node instead, for example the one closest to the member; when the node it chooses is full or
  does not respond, the default choice is made.
- A node with the signaling but no media server asks the least loaded node that has one, which makes the choice
  (`selectSFU` runs there).
- `maxMembers` is the limit of each node: a member joining when no node accepts it is refused
  (`SignalingLimitException`). WHIP streams and WHEP viewers are assigned a node the same way (viewers are not counted
  by `maxMembers`: WHEP's `maxSessions` limits them).
- The events of each media server and its `rooms()` cover the members of its own node.

```typescript
import {buildSFUOptions, type SFUNode, type SFUPlacement} from '@lakutata/webrtc'

//The members whose id starts with eu- go to the least loaded node labeled {region: 'eu'}, and so on
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

The media servers of a room forward its tracks to each other. A track goes once to each node where someone receives it
(a member selected for it, a viewer, `sfu.track()`), however many receive it there, straight from its publisher's node.
The nodes connect to each other as clients do, with WebRTC connections (DTLS-SRTP) over their `icePortRange`. A data
channel between two members of different nodes goes through both media servers.

When a node goes down (it stops, or the others miss three of its heartbeats, about 6 seconds), its media server leaves
its rooms. Its members rejoin their rooms through the signaling, are assigned another node's media server and publish
their tracks again; the others see their tracks stop for a few seconds. The peers of a member that moved close and
reopen on every side, as when a member reloads its page: the `peer` listeners create their channels again. When every
node is full at that moment, the client does not give up as a first `join()` does: it retries after 1 second, then after
twice as long each time (10 seconds at most), until a node accepts the member or the room is left; its signaling emits
`error` after each failure.

A WHIP or WHEP session stays on the node that responded to its POST, and its connection goes to the node chosen for it.
Its PATCH and DELETE may reach any node; a PATCH reaching a node without the session waits for the responses of all
nodes, 12 seconds at most. By default, a viewer receives the WHIP stream its node learned of last.

### WHIP and WHEP behind a load balancer

A WHIP or WHEP session lives on the node that responded to its POST. Given `cluster`, the `WHIP` or `WHEP` component of
another node that receives its DELETE or PATCH asks the other nodes, and the one holding the session applies it.
`maxSessions` counts each node's sessions.

### Kubernetes and k3s

The manifests below deploy NATS, the signaling (two pods), and a TURN server and a media server on each node. The
application is a single image for the three roles, selected by the `ROLE` variable:

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
    //On the network of the node: its address, and its ports 3478 and 49160-49200
    turn: {
        cluster: cluster,
        turn: buildTURNServerOptions({
            cluster: 'cluster',
            secret: process.env.TURN_SECRET,
            publicAddress: process.env.PUBLIC_ADDRESS,
            relayPortRange: [49160, 49200]
        })
    },
    //On the network of the node too, its ports 40000-40999; its signaling has no entrypoint: the members join through
    //the pods of the signaling, which give each of them the media server of a node
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

- The TURN servers and the media servers run on their node's network (`hostNetwork`): clients reach them at the node's
  address, on its ports. Open UDP and TCP 3478, UDP 49160–49200 and UDP 40000–40999 in the firewall of the nodes; the
  nodes' media servers also reach each other on 40000–40999.
- `status.hostIP` is the node's address inside the cluster; it is the right one when clients reach the nodes at that
  address (a local network, nodes with public addresses). Behind a cloud NAT that forwards the same ports, set
  `PUBLIC_ADDRESS` to each node's public address instead, and specify that address in the media server's
  `iceAdditionalHostAddresses`.
- A pod on its node's network resolves service names with `dnsPolicy: ClusterFirstWithHostNet`.
- Browsers reach the signaling through an Ingress or a load balancer in front of the `signaling` Service, connecting
  with `transports: ['websocket']`.
- A single NATS pod is sufficient for a test; in production, run a NATS cluster (with its Helm chart) or a Redis server
  with a replica.
- When the whole cluster starts, a pod may start before the cluster's DNS resolves `nats` (its log then shows
  `getaddrinfo EAI_AGAIN nats`): the application stops when it cannot reach NATS as it launches, and Kubernetes restarts
  it until it can. A few restarts of each pod at that moment are expected.

In the repository, `packages/webrtc/test-env/k3s/run.sh` deploys these manifests in k3s in Docker (two nodes, with the
code mounted instead of an image). It connects two members through two pods and the TURN servers only, then two members
through the two nodes' media servers, and deletes the pod of one of them: that member moves to the pod started in its
place.

### The cluster for the application

The application communicates with its other instances through the same component: messages to all the other nodes, and
requests to one node or to all of them.

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
`node-up`, `node-down` and `node-update`. Messages are sent as JSON; a message larger than the server carries (1 MiB by
default on NATS) is sent in parts.

## 14. The signaling protocol

Clients in other languages and native applications speak the protocol directly. Requests are service calls whose
pattern is `{method}`: over Socket.IO, the `message` event with `{method: 'webrtc.join', room: 'room-1'}` and an
acknowledgement (`{success, error, payload}`); over JSON-RPC 2.0, a request whose method is `webrtc.join`. The server
pushes events to the members: Socket.IO events, or JSON-RPC notifications whose `params` hold the payload.

| Request | Parameters | Response |
|---|---|---|
| `webrtc.join` | `room`, `metadata`, `session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval, sfu}` |
| `webrtc.signal` | `room`, `to`, and `description` (`{type, sdp}`) or `candidate` (`{candidate, sdpMid, sdpMLineIndex, usernameFragment}`) | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}`: new credentials |
| `webrtc.heartbeat` | — | `{}` |

| Event | Payload |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session, role, sfu}`: a member joined, or rejoined |
| `webrtc:peer-left` | `{room, peerId, reason}`: `left` when it asked, `disconnected` when its client went away |
| `webrtc:signal` | `{room, from, session, description, streams}` or `{room, from, session, candidate}` |

- `session` is a random string a client chooses once. A member rejoining with the same session (after its signaling
  reconnects) keeps the others' connections; a new session (a reloaded page) replaces them.
- `heartbeatInterval` is 0 over Socket.IO and JSON-RPC over WebSocket: the server sees their connections close. Over
  another transport, the client sends `webrtc.heartbeat` that often; after three intervals without a request, it leaves
  its rooms.
- The member whose ID comes first (by string comparison) is the polite one in a pair: when both send an offer at the
  same time, it gives up its own and answers the other one.
- The media server fields, all set by the server: `role` is `sfu` for a media server and `whip` for a WHIP stream
  (none for clients); `sfu` is the ID of the media server a member is connected to, and in the response to
  `webrtc.join`, the one the client connects to. A client in a room with a media server connects only to it, and is
  the polite one with it. The media server's descriptions carry `streams`: for each stream it sends, its `id` on that
  connection, the `peerId` of the member it comes from, and its ID on that member's connection (`stream`).
- On the connection to the media server, data channel 1023 (label `webrtc.control`, created by both sides with
  `negotiated: true` and this `id`) carries `{type: 'pause' | 'resume', mid}` in JSON: the server stops or starts
  sending that transceiver's track. A data channel to a member through the server has that member's ID as its
  `protocol`; the server opens the channel on that member's side with the sender's ID. The nodes' media servers also
  use channel 1023 between them, and channels whose `protocol` is `["sender", "member"]` in JSON.
- Calls of `webrtcServiceEntrypoint()` (section 5) are JSON-RPC 2.0 messages on a data channel labeled `service`,
  ordered and reliable, which the caller creates. Each message is split into frames as `ChunkedChannel` does: a frame
  is a binary message whose first byte holds flags (1 for the last frame of a message, 2 for a text message) and whose
  remaining bytes are the next part of the message (16 KiB at most from this package). A call is a text message: its
  frames carry the flags 2, and the last one 3. Responses and events (notifications whose `params` are the arguments)
  come back the same way.
- Errors carry the `errno` of the server's exception: `E_SIGNALING_DENIED`, `E_SIGNALING_LIMIT` (a full room, or a
  member no media server accepts), `E_SIGNALING_NOT_A_MEMBER`, `E_SIGNALING_CLIENT_REQUIRED`, `E_INVALID_VALUE`.
  JSON-RPC over HTTP cannot carry the signaling: events need a connection through which they are pushed.

## 15. When a connection fails

`setDebugHandler()` provides the ICE, DTLS, SCTP and TURN debug messages:

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

A media server's worker threads send theirs to the same handler, and each message starts with its thread's number
(`[thread 0] …`). A `select` of the media server or of WHEP that throws is reported under `webrtc/sfu` and
`webrtc/whep`.

To check the TURN server, join a room from two clients with `iceTransportPolicy: 'relay'`: they connect only through the
relays, and `turn.allocations` counts them. In Chrome, `chrome://webrtc-internals` shows the candidates and the pairs
tried.

## 16. Limits

- Node.js does not capture, encode or decode audio and video: its tracks carry RTP packets, from an encoder or from
  another connection.
- The throughput of one data channel between two Node.js processes on an Apple M4 is about 80 MiB/s for large
  messages, and 626,000 messages of 100 bytes per second; in an arm64 Linux virtual machine (Docker Desktop) on the
  same Mac, about 43 MiB/s, and 548,000 messages a second. `packages/webrtc/test-env/bench/engine.mjs` in the
  repository measures it on another machine.
- The media server does not transcode, and sends each video as it is published: there is no simulcast yet, so for a
  member with little bandwidth the media server emits `congestion` events rather than sending a lower quality. Its
  capacity on one machine is given in section 9; `packages/webrtc/test-env/bench/forward.mjs` in the repository measures
  it on another.
- The media servers of a cluster send a track straight from its publisher's node to each node that wants it, which suits
  rooms spread over tens of nodes; beyond that, the nodes would have to forward through each other.
