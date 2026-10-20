# Lakutata WebRTC

WebRTC connects two endpoints directly, peer to peer: browsers, Electron applications and Node.js processes exchange
data without a server relaying it, behind NATs and firewalls too. The package `@lakutata/webrtc` provides everything
around these connections: the signaling that introduces the endpoints to each other, a STUN and TURN server for the
networks that need one, the peer connections of Node.js, and a client for the browsers. It is written in TypeScript
without native code, and it is not part of `lakutata`:

```bash
npm install lakutata @lakutata/webrtc
```

| Entry point | Runs in | What it gives |
|---|---|---|
| `@lakutata/webrtc` | Node.js, the main process of Electron, Bun | `Signaling`, `SignalingController`, `TURNServer`, `SignalingClient`, `PeerConnection`, `ChunkedChannel` |
| `@lakutata/webrtc/client` | Browsers, the renderer of Electron | `SignalingConnection`, `ChunkedChannel`, the types of the protocol |

The browser entry uses only the APIs of the browsers; a frontend installs the same package, and the framework is not
installed with it.

## 1. How a connection is made

Two endpoints cannot connect until each knows how to reach the other. Each one describes itself in an **offer** or an
**answer** (its codecs, its keys, its data channels) and lists its **candidates**, the addresses it may be reached at:
its local addresses, its public address as a STUN server sees it, and an address on a TURN server that relays its
traffic when nothing else gets through. These messages travel through a server both endpoints are connected to, the
**signaling**; once the endpoints have them, they test the candidates in pairs (ICE), keep a working pair, and encrypt
the connection (DTLS). The data channels then carry messages in both directions, reliable and ordered or not.

The signaling of this package works with **rooms**: a client joins a room, gets the members already there, and the
offers, answers and candidates are exchanged between each pair of members. The rest is done for you:

- The offers and the answers are exchanged as in the W3C "perfect negotiation": either member may add data channels at
  any time, both at the same moment too.
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
| `credentialTtl` | `86400` | How long the short-lived credentials are valid, in seconds |
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
and emits `datachannel`, `connectionstatechange`, `metadata` (the member joined again with new metadata), `error` and
`close`. A room emits `peer-left` when a peer closes: its member left, or its connection was lost for good.

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
(more fields of the Socket.IO handshake, a token), `timeout`, and the options of its connections
(`iceTransportPolicy`, `icePortRange`, `iceAdditionalHostAddresses`). It is `@Transient`: each `getObject()` gives a new
client, and `close()` leaves its rooms and disconnects.

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
public address of a NAT forwarding these ports with the same numbers). A `PeerChannel` sends strings and binary data; a
binary message arrives as a `Buffer`, or as an `ArrayBuffer` when `binaryType` is `'arraybuffer'`.

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

## 8. Deployment

- **Ports.** Open port 3478 over UDP and TCP, the relay ports (`relayPortRange`) over UDP, and the TLS port when TURN
  over TLS is on. In a container, publish them all; the relay range keeps the list short.
- **The public address.** `publicAddress` is the address the clients reach the TURN server at: the public address of
  the host, or that of its NAT when the NAT forwards the ports. On a local network the default is enough.
- **The applications as members.** A server behind a NAT that forwards `icePortRange` with the same port numbers gives
  its public address in `iceAdditionalHostAddresses`; otherwise it relies on the TURN server like any client.
- **Several instances.** Give their TURN servers the same `secret`, so each accepts the credentials made by the others.
  A room lives in the memory of one instance: send all the members of a room to the same instance.
- **Another TURN server.** coturn (`use-auth-secret`, `static-auth-secret` set to the same secret) accepts the
  credentials of `createTURNCredentials()`; list it in the `iceServers` option of `Signaling`.
- **HTTPS.** Browsers allow WebRTC on any page, but the camera and the microphone only on secure pages (HTTPS or
  `localhost`).

## 9. The signaling protocol

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

## 10. When a connection fails

`setDebugHandler()` gives the debug messages of ICE, DTLS, SCTP and TURN:

```typescript
import {format} from 'node:util'
import {setDebugHandler} from '@lakutata/webrtc'

setDebugHandler((namespace: string, args: unknown[]): void => console.debug(namespace, format(...args)))
```

To check the TURN server, join a room from two clients with `iceTransportPolicy: 'relay'`: they connect only through
the relays, and `turn.allocations` counts them. In Chrome, `chrome://webrtc-internals` shows the candidates and the
pairs tried.

## 11. Limits

- Audio and video are not supported yet: the connections of Node.js carry data channels. The browsers may add tracks to
  their connections to each other.
- A `PeerConnection` uses the first STUN URL and the first TURN URL of its ICE servers.
- The throughput of one data channel between two Node.js processes on an Apple M4 is about 60 MiB/s for large
  messages, and 380,000 messages of 100 bytes per second.
