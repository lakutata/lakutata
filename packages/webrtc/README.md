# @lakutata/webrtc

English | [中文](README.zh-CN.md)

WebRTC for the [lakutata](https://www.npmjs.com/package/lakutata) framework, written in TypeScript with no native code:
it installs without a compiler and runs in Node.js, the main process of Electron and Bun. It has two entry points:

- `@lakutata/webrtc`, for the applications: the signaling (rooms whose members exchange their offers, answers and
  candidates), a STUN and TURN server, and the peer connections and data channels of Node.js, with the same interface as
  `RTCPeerConnection` in the browsers.
- `@lakutata/webrtc/client`, for the browsers and the renderer of Electron: it connects the browser's own
  `RTCPeerConnection` to the signaling. It uses only the browser's APIs, so a frontend bundling it gets no server code.

The implementation of the protocols (ICE, DTLS, SCTP, the data channels, the STUN and TURN server) is derived from
[werift](https://github.com/shinyoshiaki/werift-webrtc); see `THIRD_PARTY_NOTICES.md`.

## Installation

```shell
npm install @lakutata/webrtc
```

An application also needs `lakutata` (or `@lakutata/core` and `@lakutata/entrypoint`). The signaling is served over
Socket.IO (`npm install socket.io`) or JSON-RPC over WebSocket (`npm install ws`), through the adapters of the
entrypoint. An application joining rooms over Socket.IO needs `socket.io-client`; over JSON-RPC, it uses the
`WebSocket` built into Node.js 22 and Bun.

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
and exchange the offer, the answer and the candidates yourself, as with `RTCPeerConnection` in a browser.

How the rooms behave:

- **Connections.** A member gets a `Peer` for each other member, with its connection (`peer.connection`: an
  `RTCPeerConnection` in a browser, a `PeerConnection` in Node.js). The connection is set up when either side adds a
  data channel. The offers and the answers are exchanged as in the W3C "perfect negotiation": both sides may add
  channels at any time, even at the same moment. Use `negotiated: true` with the same `id` on both sides for a single
  shared channel.
- **Repairs.** A connection that fails, or stays disconnected for 5 seconds, restarts ICE by itself. When the signaling
  connection drops, the peer-to-peer connections stay up; once it is back, the client joins its rooms again and the
  other members keep their connections to it. A member that reloads its page joins as a new session, and the other
  members replace their connections to it.
- **Leaving.** `room.leave()` closes the room's connections; the other members get `peer-left`. A member whose
  signaling connection closes (Socket.IO, or JSON-RPC over WebSocket) leaves its rooms; its peer-to-peer connections
  stay up until it comes back or they fail.
- **ICE servers.** The members get the ICE servers from the server when they join, with TURN credentials valid for
  `credentialTtl` (a day by default), and fetch new ones before they expire.
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

## Deployment

- **Ports.** The TURN server listens on port 3478 over UDP and TCP (and over TLS when given a certificate); the
  relays use the UDP ports of `relayPortRange`. Open them in the firewall, or publish them from the container.
- **Addresses.** `publicAddress` is the address the clients reach the server at: the public address of the host, or of
  its NAT when the NAT forwards the ports. By default it is the first IPv4 address of the host that is not internal,
  which is enough on a local network.
- **Several instances.** Give their TURN servers the same `secret`, so the credentials made by one are accepted by the
  others. A room lives in the memory of one instance: send all the members of a room to the same instance.
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
| `webrtc.join` | `room`, `metadata`, `session` | `{v, peerId, peers, iceServers, credentialTtl, heartbeatInterval}` |
| `webrtc.signal` | `room`, `to`, `description` or `candidate` | `{delivered}` |
| `webrtc.leave` | `room` | `{}` |
| `webrtc.iceServers` | — | `{iceServers, credentialTtl}` |
| `webrtc.heartbeat` | — | `{}` |

| Event | Payload |
|---|---|
| `webrtc:peer-joined` | `{room, peerId, metadata, session}` |
| `webrtc:peer-left` | `{room, peerId, reason}`: `left`, or `disconnected` |
| `webrtc:signal` | `{room, from, session, description}` or `{room, from, session, candidate}` |

A client sends `webrtc.heartbeat` every `heartbeatInterval` milliseconds when it is not 0: over a transport whose
disconnections the server cannot see (Socket.IO and JSON-RPC over WebSocket answer 0). The `session` is a random
string the client chooses once: joining again with the same session keeps the other members' connections.

## Limits

- Audio and video are not supported yet: the connections of Node.js carry data channels.
- A `PeerConnection` uses the first STUN URL and the first TURN URL of its ICE servers.
- Throughput of one data channel between two Node.js processes on an Apple M4: about 60 MiB/s for large messages,
  380,000 messages of 100 bytes per second.

## API

| Export | Description |
|---|---|
| `Signaling`, `buildSignalingOptions` | The component of the rooms: members, signals, limits, `authorize`, the ICE servers |
| `SignalingController` | The controller serving the signaling over Socket.IO and JSON-RPC |
| `TURNServer`, `buildTURNServerOptions` | The STUN and TURN server: `iceServers()`, `credentials()`, `allocations` |
| `createTURNCredentials` | Short-lived TURN credentials (the REST API of coturn) |
| `SignalingClient` | An application as a member of the rooms: `join()`, `close()` |
| `PeerConnection`, `PeerChannel` | The peer connection and the data channel of Node.js |
| `Room`, `Peer` | A room joined, and another member with the connection to it |
| `ChunkedChannel` | Messages of any size over a data channel |
| `setDebugHandler` | The debug messages of ICE, DTLS, SCTP and TURN |
| `SignalingMethod`, `SignalingEvent` | The names of the requests and of the events of the protocol |
| `SignalingConnection` (`/client`) | The signaling of a browser: `join()`, `close()` |

## Errors

| Exception | When |
|---|---|
| `SignalingDeniedException` | `authorize` refuses the room |
| `SignalingLimitException` | A full room, a signal too large, too many signals |
| `SignalingNotAMemberException` | A signal from or to someone who is not in the room |
| `SignalingClientRequiredException` | A request without a connection to push the events through (HTTP) |
| `SignalingConnectionException` | `SignalingClient` without `socket.io-client`, or without `WebSocket` |
| `SignalingRequestError` | On the clients: the error of a request, with the `errno` of the server's exception |

## Testing

`npm run test:unit` runs the tests of the protocols, of the signaling and of the connections between Node.js
processes. The tests with Chrome use Playwright and the Chrome installed on the machine: they run when the package
`playwright` can be imported (or is found in the directory given by `LAKUTATA_PLAYWRIGHT`), and are skipped otherwise.

## See also

- The guide on the website: [WebRTC](https://lakutata.com/guide/WebRTC).
- `doc/en/WebRTC.md` in the `lakutata` package (Chinese in `doc/zh`): the WebRTC guide.
- `@lakutata/entrypoint`: the Socket.IO and JSON-RPC adapters serving the signaling.
