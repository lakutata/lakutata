# A video meeting

This example builds a video meeting: a page where each person enters a name and a room, then sees and hears the others
and writes to them in a chat. It starts from the `web-react` template, adds `@lakutata/webrtc` to the application and
to the page, and shows its three parts working together: the signaling, which puts the people of a room in touch, the
media server, which forwards their video, and the browser client, which connects the page to both. With the media
server, each person sends their camera once, however many people are in the room.

| Where | What it serves |
|---|---|
| `GET /`, and any other page | The meeting page: the built `ui` package |
| `/socket.io`, on the same port | The signaling, over Socket.IO |
| UDP ports 40000 to 40999 | The connections of the browsers to the media server |
| `GET /health` | Tells whether the process answers (from the template) |

## 1. Create the project

```bash
npx @lakutata/cli create --name meeting --template web-react --yes
cd meeting
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
rm packages/app/src/middlewares/Authenticate.ts
npm install @lakutata/webrtc socket.io -w app
npm install socket.io-client --save-dev -w app
npm install @lakutata/webrtc socket.io-client -w ui
```

The project is a workspace ([ProjectStructure](../ProjectStructure.md)): `packages/app` is the application, and
`packages/ui` the React page. The example controller of the template is removed, and so is its middleware
`Authenticate.ts`: the people of a meeting give a name, not a token (section 8 says what to add on a public network).

The application gets `@lakutata/webrtc` (the signaling and the media server) and `socket.io` (the Socket.IO server the
signaling goes through); its tests get `socket.io-client`, to join meetings from Node.js. The page gets
`@lakutata/webrtc`, of which it imports the browser entry `@lakutata/webrtc/client` only, and `socket.io-client`.

## 2. The server

**`packages/app/src/config/Config.ts`**

```typescript
import {resourcesPath, type ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope, staticUI} from 'lakutata/adapter/express'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildSFUOptions, buildSignalingOptions, type SignalingPeer, SignalingController} from '@lakutata/webrtc'
import compression from 'compression'
import {existsSync} from 'node:fs'
import type {Server} from 'node:http'
import {createRequire} from 'node:module'
import path from 'node:path'
import {HealthController} from '../controllers/HealthController.js'

/**
 * The directory of the built ui package, undefined before it is built (in development, Vite serves the page): among the
 * resources of a packed application (lakutata package bundle or lakutata package exe, from "lakutata.resources" in its
 * package.json), otherwise in the ui package
 */
function uiDirectory(): string | undefined {
    const resources: string | undefined = resourcesPath()
    try {
        const directory: string = resources ? path.join(resources, 'ui') : path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist')
        return existsSync(path.join(directory, 'index.html')) ? directory : undefined
    } catch {
        return undefined
    }
}

/**
 * Whether a person may join a meeting: with a name of 1 to 40 characters
 * @param peer The id of the person and the metadata of their page.
 */
function named(peer: SignalingPeer): boolean {
    const name: unknown = (peer.metadata as {name?: unknown} | undefined)?.name
    return typeof name === 'string' && name.trim().length > 0 && name.length <= 40
}

/**
 * The options of the service
 * @param port the port of the HTTP server and of the signaling, the PORT environment variable or 8080 by default
 */
export function config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    //The HTTP server of express, which Socket.IO shares
    let server: Server | undefined
    return {
        id: 'meeting',
        name: 'meeting',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The rooms: 50 people at most in each one, who give a name
            signaling: buildSignalingOptions({maxPeers: 50, authorize: named}),
            //The media server of the rooms. PUBLIC_ADDRESS: the address the browsers reach this machine at, when it is
            //not one of its own (a NAT forwarding the ports 40000 to 40999)
            sfu: buildSFUOptions({
                icePortRange: [40000, 40999],
                iceAdditionalHostAddresses: process.env.PUBLIC_ADDRESS ? [process.env.PUBLIC_ADDRESS] : []
            }),
            entrypoint: buildEntrypoints({
                controllers: [HealthController, SignalingController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}, with the status 200
                    respond: jsonEnvelope({errorStatus: 200}),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    before: (app, context): void => {
                        server = context.server
                        app.use(compression())
                    },
                    //The paths that no action handles are the pages of the application
                    fallback: ((directory: string | undefined) => directory ? staticUI(directory) : undefined)(uiDirectory())
                }),
                //The signaling, on the port of the page
                service: socketIOServiceEntrypoint({server: (): Server => server!})
            })
        },
        bootstrap: ['sfu', 'entrypoint']
    }
}
```

This is the `Config.ts` of the template, with three components instead of the example controller:

- `signaling` holds the rooms. Each person is a member of a room; the member's id is the id of their Socket.IO
  connection, and its metadata what their page gives when it joins: here `{name}`. `authorize` refuses a member
  without a name, and `maxPeers` a 51st member.
- `sfu` is the media server. It joins each room as a member of its own; the pages see it and connect to it instead of
  to each other, and it forwards the audio and the video of each person to the others, without decoding them. Its
  connections use the UDP ports 40000 to 40999, one port on each address of the machine for each person, and these
  addresses as their candidates (`PUBLIC_ADDRESS` adds another).
- `SignalingController` serves the requests of the signaling (`webrtc.join`, `webrtc.signal`…), through the Socket.IO
  adapter. `socketIOServiceEntrypoint({server})` attaches Socket.IO to the HTTP server of express, which `before` gives:
  the page, its signaling and the health check share port 8080.

The application bootstraps `sfu`, which attaches itself to `signaling`, then the entrypoint, which starts listening. The
rest comes from the template: `uiDirectory()` and `fallback` serve the built page, `jsonEnvelope` the results of the
actions ([WebApp](WebApp.md) explains them).

## 3. The meeting

The page keeps its WebRTC code in a module of its own, which knows nothing of React.

**`packages/ui/src/meeting.ts`**

```typescript
import {io} from 'socket.io-client'
import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'

/**
 * Another person of the meeting: their name, and their camera once it arrives
 */
export type Participant = {
    id: string
    name: string
    stream?: MediaStream
}

/**
 * A message of the chat
 */
export type Message = {
    from: string
    text: string
}

/**
 * What the meeting tells the page
 */
export type MeetingEvents = {
    //The other people, each time one comes, leaves, or their camera arrives
    participants(participants: Participant[]): void
    message(message: Message): void
}

/**
 * A meeting joined
 */
export type Meeting = {
    //The camera and the microphone of this page
    camera: MediaStream
    //Send a message to everyone
    send(text: string): void
    leave(): Promise<void>
}

/**
 * Join a meeting: the camera and the microphone of this page are sent to the others, theirs are received, and a channel
 * to each person carries the chat
 * @param name The name shown to the others.
 * @param roomName The room.
 * @param events What the meeting tells the page.
 */
export async function joinMeeting(name: string, roomName: string, events: MeetingEvents): Promise<Meeting> {
    const camera: MediaStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true})
    //The signaling, on the origin of the page; the id of this member is a new one for each page
    const signaling: SignalingConnection = new SignalingConnection(io({auth: {id: crypto.randomUUID()}, transports: ['websocket']}))
    let room: Room
    try {
        room = await signaling.join(roomName, {metadata: {name: name}})
    } catch (error) {
        await signaling.close()
        camera.getTracks().forEach((track: MediaStreamTrack): void => track.stop())
        throw error
    }
    const participants: Map<string, Participant> = new Map()
    const channels: Map<string, RTCDataChannel> = new Map()
    const changed = (): void => events.participants([...participants.values()])
    room.on('peer', (peer: Peer): void => {
        const participant: Participant = {id: peer.id, name: (peer.metadata as {name: string}).name}
        participants.set(peer.id, participant)
        changed()
        //The audio and the video of the person, in one stream
        peer.on('track', (event: RTCTrackEvent): void => {
            participants.set(peer.id, {...participant, stream: event.streams[0]})
            changed()
        })
        //The chat: a channel to each person, and theirs to this page
        channels.set(peer.id, peer.createDataChannel('chat'))
        peer.on('datachannel', (channel: RTCDataChannel): void => {
            channel.addEventListener('message', (event: MessageEvent): void => events.message({from: participant.name, text: String(event.data)}))
        })
    })
    room.on('peer-left', (peer: Peer): void => {
        participants.delete(peer.id)
        channels.delete(peer.id)
        changed()
    })
    for (const track of camera.getTracks()) await room.publish(track, camera)
    return {
        camera: camera,
        send: (text: string): void => {
            for (const channel of channels.values()) if (channel.readyState === 'open') channel.send(text)
            events.message({from: name, text: text})
        },
        leave: async (): Promise<void> => {
            await room.leave()
            await signaling.close()
            camera.getTracks().forEach((track: MediaStreamTrack): void => track.stop())
        }
    }
}
```

- `SignalingConnection` takes the Socket.IO connection of the page. `io()` without an address connects to the origin of
  the page; `transports: ['websocket']` makes it a single connection, which needs no sticky sessions behind a load
  balancer. The id of the member is the `auth.id` of the connection.
- `signaling.join()` joins the room with the name in its metadata, and gives the `Room`. The room emits `peer` for each
  other person, the ones already there first, and `peer-left` when one leaves.
- `room.publish()` sends the camera and the microphone to every person, the ones joining later too. The room has a
  media server (`room.sfu` is its id), so each track goes once, to the server.
- Each `Peer` emits the tracks of its person (`track`), and the channels that person opens (`datachannel`). Its
  `createDataChannel()` opens a channel to that person, through the media server, which relays the messages. Without a
  media server, this code would connect the pages to each other and work the same.
- When the node of the media server goes down (with several instances, see the guide), each person moves to another
  one: the room emits `peer-left`, then `peer` again, and the channels are created again.

## 4. The page

**`packages/ui/src/App.tsx`**

```tsx
import {type FormEvent, useEffect, useRef, useState} from 'react'
import {joinMeeting, type Meeting, type Message, type Participant} from './meeting'

/**
 * A camera, with a name under it
 * @param props The stream (none before it arrives), the name, and whether its sound is off (the camera of this page).
 */
function Camera(props: {stream?: MediaStream, name: string, muted?: boolean}) {
    const video = useRef<HTMLVideoElement>(null)
    useEffect((): void => {
        if (video.current) video.current.srcObject = props.stream ?? null
    }, [props.stream])
    return (
        <figure>
            <video ref={video} autoPlay playsInline muted={props.muted} width={320} height={240}/>
            <figcaption>{props.name}</figcaption>
        </figure>
    )
}

export function App() {
    const [name, setName] = useState<string>('')
    const [room, setRoom] = useState<string>('')
    const [meeting, setMeeting] = useState<Meeting>()
    const [participants, setParticipants] = useState<Participant[]>([])
    const [messages, setMessages] = useState<Message[]>([])
    const [text, setText] = useState<string>('')
    const [error, setError] = useState<string>('')

    async function join(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault()
        try {
            setMeeting(await joinMeeting(name, room, {
                participants: setParticipants,
                message: (message: Message): void => setMessages((before: Message[]): Message[] => [...before, message])
            }))
            setError('')
        } catch (failure) {
            setError((failure as Error).message)
        }
    }

    async function leave(): Promise<void> {
        await meeting?.leave()
        setMeeting(undefined)
        setParticipants([])
        setMessages([])
    }

    function send(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        meeting?.send(text)
        setText('')
    }

    if (!meeting) {
        return (
            <main>
                <h1>Meeting</h1>
                <form onSubmit={join}>
                    <input value={name} onChange={(event): void => setName(event.target.value)} placeholder="Your name" aria-label="Name" required/>
                    <input value={room} onChange={(event): void => setRoom(event.target.value)} placeholder="Room" aria-label="Room" required/>
                    <button>Join</button>
                </form>
                {error && <p role="alert">{error}</p>}
            </main>
        )
    }
    return (
        <main>
            <h1>{room} <button onClick={(): void => void leave()}>Leave</button></h1>
            <section style={{display: 'flex', flexWrap: 'wrap'}}>
                <Camera stream={meeting.camera} name={`${name} (you)`} muted/>
                {participants.map((participant: Participant) => <Camera key={participant.id} stream={participant.stream} name={participant.name}/>)}
            </section>
            <ul>
                {messages.map((message: Message, index: number) => <li key={index}><b>{message.from}</b>: {message.text}</li>)}
            </ul>
            <form onSubmit={send}>
                <input value={text} onChange={(event): void => setText(event.target.value)} placeholder="Message" aria-label="Message" required/>
                <button>Send</button>
            </form>
        </main>
    )
}
```

- Before joining, the page asks for a name and a room. `joinMeeting()` asks the browser for the camera and the
  microphone, so the browser asks the person first; a refusal, or a name the server refuses, shows as an error.
- In the meeting, the page shows its own camera (without its sound, which would echo) and the camera of each other
  person, whose video stays black until it arrives; then the chat, and the field to write in it.
- The `main.tsx` of the template, which renders `App`, does not change.

## 5. The signaling during development

**`packages/ui/vite.config.ts`**

```typescript
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

//In development, the signaling is the one of the service started by "npm run dev"
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/socket.io': {target: `http://127.0.0.1:${process.env.PORT ?? 8080}`, ws: true}
        }
    }
})
```

The page connects to `/socket.io` on its own origin. During development, that origin is Vite: its proxy forwards the
WebSocket of Socket.IO to the application (`ws: true`). The page has no API under `/api`, so the template's proxy of
`/api` is replaced.

## 6. Run it

```bash
npm run dev
```

This builds and starts the application on port 8080, and Vite serves the page on http://localhost:5173. Open it in two
windows, give two names and the same room, and allow the camera: each window shows both cameras, and a message written
in one appears in the other. On another computer, the page needs HTTPS (section 8): browsers give the camera to
`localhost` and to HTTPS pages only.

## 7. Test it

The test of the template is replaced by a test of the meeting. It starts the application on its own port, and joins a
meeting with two members in Node.js: `SignalingClient` is the client of `@lakutata/webrtc` for the applications, with
the same rooms and peers as the page. Node.js has no camera, so each member sends a video track whose packets carry its
name, and checks it receives the name of the other one:

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {MediaTrack, type Peer, type PeerChannel, type PeerTrackEvent, type Room, type RtpPacket, SignalingClient} from '@lakutata/webrtc'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18084)

/**
 * A member of a meeting in Node.js, as a page is one: the name carried by the video of each other member, the messages
 * it got, and a way to stop its video
 */
type Member = {
    room: Room
    videos: Map<string, string>
    messages: string[]
    stop(): void
}

/**
 * The bytes of an RTP packet of VP8 whose payload is a text
 * @param sequence
 * @param text
 */
function packet(sequence: number, text: string): Buffer {
    const header: Buffer = Buffer.alloc(12)
    header[0] = 0x80
    header[1] = 96
    header.writeUInt16BE(sequence & 0xffff, 2)
    header.writeUInt32BE(sequence * 3000, 4)
    return Buffer.concat([header, Buffer.from(text)])
}

/**
 * Wait until a condition holds, 20 seconds at most
 * @param condition
 * @param what What is waited for, for the error.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
    const end: number = Date.now() + 20000
    while (!condition()) {
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
    }
}

describe('meeting', (): void => {

    let app: Application

    const clients: SignalingClient[] = []

    before(async (): Promise<void> => {
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        for (const client of clients) await client.close()
        await app?.dispose()
    })

    /**
     * A client of the signaling of the application
     */
    async function client(): Promise<SignalingClient> {
        const created: SignalingClient = await app.getObject(SignalingClient, {url: `http://127.0.0.1:${PORT}`})
        clients.push(created)
        return created
    }

    /**
     * Join the room test as the page does: a video track published, a chat channel to each other member
     * @param name
     */
    async function member(name: string): Promise<Member> {
        const room: Room = await (await client()).join('test', {metadata: {name: name}})
        const videos: Map<string, string> = new Map()
        const messages: string[] = []
        room.on('peer', (peer: Peer): void => {
            const from: string = (peer.metadata as {name: string}).name
            peer.on('track', (event: PeerTrackEvent): void => {
                event.track.on('rtp', (rtp: RtpPacket): void => void videos.set(from, new TextDecoder().decode(rtp.payload)))
            })
            peer.on('datachannel', (channel: PeerChannel): void => {
                channel.on('message', (data: string | Buffer | ArrayBuffer): number => messages.push(`${from}: ${String(data)}`))
            })
            const chat: PeerChannel = peer.createDataChannel('chat')
            chat.on('open', (): void => chat.send(`hello from ${name}`))
        })
        const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
        await room.publish(video, 'camera')
        let sequence: number = 0
        const timer: NodeJS.Timeout = setInterval((): void => video.writeRtp(packet(sequence++, name)), 20)
        return {room: room, videos: videos, messages: messages, stop: (): void => clearInterval(timer)}
    }

    it('answers the health check', async (): Promise<void> => {
        assert.deepStrictEqual(await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(), {errno: null, errMsg: null, data: {status: 'ok'}})
    })

    it('serves the page', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/`, {headers: {Accept: 'text/html'}})
        assert.strictEqual(response.status, 200)
        assert.match(await response.text(), /<div id="root"><\/div>/)
    })

    it('forwards the video and the messages of the members of a meeting through the media server', {timeout: 60000}, async (): Promise<void> => {
        const alice: Member = await member('Alice')
        const bob: Member = await member('Bob')
        try {
            assert.match(alice.room.sfu ?? '', /^sfu:/)
            await until((): boolean => alice.videos.get('Bob') === 'Bob' && bob.videos.get('Alice') === 'Alice', 'the videos')
            await until((): boolean => alice.messages.includes('Bob: hello from Bob') && bob.messages.includes('Alice: hello from Alice'), 'the messages')
            //Bob leaves: Alice sees him go
            const left: Promise<string> = new Promise((resolve: (name: string) => void): unknown => alice.room.once('peer-left', (peer: Peer): void => resolve((peer.metadata as {name: string}).name)))
            await bob.room.leave()
            assert.strictEqual(await left, 'Bob')
        } finally {
            alice.stop()
            bob.stop()
        }
    })

    it('refuses a member without a name', async (): Promise<void> => {
        await assert.rejects((await client()).join('test'), {errno: 'E_SIGNALING_DENIED'})
    })
})
```

```
app │   ✔ answers the health check
app │   ✔ serves the page
app │   ✔ forwards the video and the messages of the members of a meeting through the media server
app │   ✔ refuses a member without a name
app │ ℹ pass 4
✔ test ran in app
```

`npm test` builds the packages first, so the built page is there for the second test. The test covers the server and
the client of the package, not the React code; `npm run typecheck -w ui` checks the types of the page.

## 8. Build it and deploy it

```bash
npm run build
npm start
```

The application now serves the page, the signaling and the media server, from one process: the page on
http://localhost:8080, its connections on the UDP ports 40000 to 40999. To deploy it:

- **HTTPS.** Browsers give the camera and the microphone to `localhost` and to HTTPS pages only. The adapters serve
  HTTP: put a reverse proxy in front of the application (nginx, Caddy), which serves HTTPS and forwards the WebSockets
  of Socket.IO ([HTTP](../HTTP.md)).
- **The ports of the media server.** The browsers connect to the media server directly: open the UDP ports 40000 to
  40999 in the firewall. Behind a NAT that forwards them with the same numbers, start the application with
  `PUBLIC_ADDRESS` set to the public address.
- **The networks that let no UDP through.** Some company and mobile networks need a TURN server: add the `TURNServer`
  component and give its name to the signaling ([WebRTC](../WebRTC.md), sections 3 and 12).
- **Who may join.** Anyone who reaches the page may join any room under any name. On a public network, authenticate the
  people with a middleware of the entrypoint (the `Authenticate.ts` of the template checks a token), and decide who
  joins which room in `authorize`, which also gets the context of the request.
- **Larger meetings.** One process forwards a few hundred videos (the WebRTC guide has the numbers); the `workers`
  option of the media server uses more cores, and several instances share the rooms through a `Cluster`
  ([WebRTC](../WebRTC.md), section 13).

<!--
check:
  create: meeting web-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  remove: packages/app/src/middlewares/Authenticate.ts
  run: npm test
  run: npm run typecheck -w ui
-->
