# 视频会议

本示例构建一个视频会议：每个人在页面上填写一个名称和一个房间后，即可看到、听到其他人，还能在聊天中向其他人发送消息。示例从 `web-react` 模板开始，为应用和页面都加上 `@lakutata/webrtc`，并展示该包的三个部分如何协同工作：信令使同一房间中的人互相建立联系，媒体服务器转发这些人的视频，浏览器客户端将页面连接到信令和媒体服务器。借助媒体服务器，无论房间中有多少人，每个人的摄像头画面都只发送一份。

| 位置 | 提供的内容 |
|---|---|
| `GET /` 以及其他页面 | 会议页面，即构建好的 `ui` 包 |
| `/socket.io`，同一个端口 | 信令，经由 Socket.IO |
| UDP 的 40000 到 40999 端口 | 浏览器到媒体服务器的连接 |
| `GET /health` | 报告进程是否在响应（模板自带） |

## 1. 创建项目

```bash
npx @lakutata/cli create --name meeting --template web-react --yes
cd meeting
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
rm packages/app/src/middlewares/Authenticate.ts
npm install @lakutata/webrtc socket.io -w app
npm install socket.io-client --save-dev -w app
npm install @lakutata/webrtc socket.io-client -w ui
```

项目是一个工作区（见[项目结构](../ProjectStructure.md)）：`packages/app` 是应用，`packages/ui` 是 React 页面。本例删除了模板中的示例控制器，也删除了中间件 `Authenticate.ts`，因为参加会议的人提供的是名称，而非令牌（在公网上需要添加哪些措施，见第 8 节）。

应用安装 `@lakutata/webrtc`（信令和媒体服务器）和 `socket.io`（信令所使用的 Socket.IO 服务端）；应用的测试安装 `socket.io-client`，用于在 Node.js 中加入会议。页面安装 `@lakutata/webrtc` 和 `socket.io-client`，并且只引用前者的浏览器入口 `@lakutata/webrtc/client`。

## 2. 服务端

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
 * 构建好的 ui 包所在的目录，构建之前为 undefined（开发时由 Vite 提供页面）：打包后的应用（lakutata package bundle 或
 * lakutata package exe）在资源中找（来自 package.json 中的 "lakutata.resources"），否则在 ui 包中找
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
 * 一个人能不能加入会议：要有 1 到 40 个字符的名字
 * @param peer 这个人的 id，以及他的页面给出的 metadata。
 */
function named(peer: SignalingPeer): boolean {
    const name: unknown = (peer.metadata as {name?: unknown} | undefined)?.name
    return typeof name === 'string' && name.trim().length > 0 && name.length <= 40
}

/**
 * 服务的选项
 * @param port HTTP 服务器和信令的端口，默认取环境变量 PORT，没有时为 8080
 */
export function config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    //express 的 HTTP 服务器，Socket.IO 和它共用
    let server: Server | undefined
    return {
        id: 'meeting',
        name: 'meeting',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //房间：每个房间最多 50 人，每人都要给出名字
            signaling: buildSignalingOptions({maxPeers: 50, authorize: named}),
            //房间的媒体服务器。PUBLIC_ADDRESS：浏览器访问这台机器用的地址，在它不是本机自己的地址时（比如转发了 40000 到 40999 端口的 NAT）
            sfu: buildSFUOptions({
                icePortRange: [40000, 40999],
                iceAdditionalHostAddresses: process.env.PUBLIC_ADDRESS ? [process.env.PUBLIC_ADDRESS] : []
            }),
            entrypoint: buildEntrypoints({
                controllers: [HealthController, SignalingController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //结果和错误都是 {errno, errMsg, data}，状态码都是 200
                    respond: jsonEnvelope({errorStatus: 200}),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    before: (app, context): void => {
                        server = context.server
                        app.use(compression())
                    },
                    //没有动作处理的路径都是应用的页面
                    fallback: ((directory: string | undefined) => directory ? staticUI(directory) : undefined)(uiDirectory())
                }),
                //信令，和页面用同一个端口
                service: socketIOServiceEntrypoint({server: (): Server => server!})
            })
        },
        bootstrap: ['sfu', 'entrypoint']
    }
}
```

这是模板中的 `Config.ts`，其中用三个组件替换了示例控制器：

- `signaling` 管理房间。每个人是某个房间中的一个成员；成员的 ID 是其 Socket.IO 连接的 ID，成员的 metadata 是其页面加入时提供的内容，此处为 `{name}`。`authorize` 拒绝没有名称的成员，`maxPeers` 拒绝第 51 个成员。
- `sfu` 是媒体服务器。媒体服务器以独立成员的身份加入每个房间；页面发现该服务器后即与其连接，而不再互相连接。该服务器将每个人的音频和视频转发给其他人，转发时不解码。其连接使用 UDP 的 40000 到 40999 端口，每个人在本机的每个地址上各占一个端口，并以这些地址作为候选地址（`PUBLIC_ADDRESS` 会再添加一个）。
- `SignalingController` 通过 Socket.IO 适配器处理信令请求（`webrtc.join`、`webrtc.signal`……）。`socketIOServiceEntrypoint({server})` 将 Socket.IO 挂载到 express 的 HTTP 服务器上，该服务器由 `before` 提供，因此页面、页面的信令和健康检查共用 8080 端口。

应用先启动 `sfu`，该组件会将自身挂载到 `signaling` 上；然后启动入口，入口开始监听。其余部分来自模板：`uiDirectory()` 和 `fallback` 提供构建好的页面，`jsonEnvelope` 包装动作的结果（[带界面的 Web 应用](WebApp.md)中有相关说明）。

## 3. 会议

页面将其 WebRTC 代码放在一个单独的模块中，该模块不依赖 React。

**`packages/ui/src/meeting.ts`**

```typescript
import {io} from 'socket.io-client'
import {type Peer, type Room, SignalingConnection} from '@lakutata/webrtc/client'

/**
 * 会议里的另一个人：名字，以及收到之后的摄像头画面
 */
export type Participant = {
    id: string
    name: string
    stream?: MediaStream
}

/**
 * 聊天里的一条消息
 */
export type Message = {
    from: string
    text: string
}

/**
 * 会议告诉页面的事情
 */
export type MeetingEvents = {
    //其他人：每当有人来、有人走，或者收到某人的摄像头画面时
    participants(participants: Participant[]): void
    message(message: Message): void
}

/**
 * 加入了的会议
 */
export type Meeting = {
    //这个页面的摄像头和麦克风
    camera: MediaStream
    //给所有人发一条消息
    send(text: string): void
    leave(): Promise<void>
}

/**
 * 加入会议：把这个页面的摄像头和麦克风发给其他人，接收他们的，再给每个人开一条通道用来聊天
 * @param name 显示给其他人的名字。
 * @param roomName 房间。
 * @param events 会议告诉页面的事情。
 */
export async function joinMeeting(name: string, roomName: string, events: MeetingEvents): Promise<Meeting> {
    const camera: MediaStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true})
    //信令连到页面所在的源；这个成员的 id 每个页面都是新的
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
        //这个人的音频和视频，在同一个流里
        peer.on('track', (event: RTCTrackEvent): void => {
            participants.set(peer.id, {...participant, stream: event.streams[0]})
            changed()
        })
        //聊天：给每个人开一条通道，也接收每个人开过来的通道
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

- `SignalingConnection` 接收页面的 Socket.IO 连接。`io()` 不带地址时连接页面所在的源；`transports: ['websocket']` 使其只使用一条连接，因此在负载均衡器之后也无需会话保持。成员的 ID 是该连接的 `auth.id`。
- `signaling.join()` 以 metadata 中的名称加入房间，并返回 `Room`。房间为其他每个人发出 `peer` 事件，首先是已在房间中的人；有人离开时，房间发出 `peer-left`。
- `room.publish()` 将摄像头和麦克风发送给每个人，之后加入的人也会收到。该房间有媒体服务器（`room.sfu` 是其 ID），因此每条轨道只向服务器发送一份。
- 每个 `Peer` 发出对应成员的轨道（`track`），以及该成员打开的通道（`datachannel`）。其 `createDataChannel()` 打开一条通往该成员的通道，通道经过媒体服务器，由服务器转发消息。没有媒体服务器时，这段代码会使页面之间直接连接，用法完全相同。
- 媒体服务器所在的节点下线时（部署了多个实例时，见指南），每个人会切换到另一个媒体服务器：房间先发出 `peer-left`，再重新发出 `peer`，通道也会重新创建。

## 4. 页面

**`packages/ui/src/App.tsx`**

```tsx
import {type FormEvent, useEffect, useRef, useState} from 'react'
import {joinMeeting, type Meeting, type Message, type Participant} from './meeting'

/**
 * 一路摄像头画面，下面写着名字
 * @param props 流（收到之前没有）、名字，以及是否静音（这个页面自己的摄像头）。
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

- 加入之前，页面会要求填写名称和房间。`joinMeeting()` 向浏览器申请摄像头和麦克风，因此浏览器会先征求用户同意；用户拒绝或服务端拒绝该名称时，都会显示为错误。
- 进入会议后，页面显示自身的摄像头画面（不播放声音，否则会产生回声）和其他每个人的摄像头画面，收到画面之前显示为黑色；下方是聊天记录和输入框。
- 模板中渲染 `App` 的 `main.tsx` 无需修改。

## 5. 开发时的信令

**`packages/ui/vite.config.ts`**

```typescript
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

//开发时，信令由 "npm run dev" 启动的服务提供
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/socket.io': {target: `http://127.0.0.1:${process.env.PORT ?? 8080}`, ws: true}
        }
    }
})
```

页面连接其所在源上的 `/socket.io`。开发时该源为 Vite，Vite 的代理将 Socket.IO 的 WebSocket 转发给应用（`ws: true`）。页面没有 `/api` 下的 API，因此模板中 `/api` 的代理替换成了上述代理。

## 6. 运行

```bash
npm run dev
```

该命令会构建应用并在 8080 端口启动应用，由 Vite 在 http://localhost:5173 上提供页面。请在两个窗口中打开该页面，填写两个名称和同一个房间，并允许使用摄像头：每个窗口都会显示两路摄像头画面，在一个窗口中输入的消息会出现在另一个窗口中。在另一台电脑上打开页面需要 HTTPS（见第 8 节），因为浏览器只允许 `localhost` 和 HTTPS 页面使用摄像头。

## 7. 测试

模板中的测试已替换为针对会议的测试。该测试在单独的端口上启动应用，然后在 Node.js 中让两个成员加入同一个会议：`SignalingClient` 是 `@lakutata/webrtc` 为应用提供的客户端，房间和 peer 的用法与页面相同。Node.js 没有摄像头，因此每个成员发送一条视频轨道，轨道的数据包中带有该成员的名称，然后检查是否收到了对方的名称：

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {MediaTrack, type Peer, type PeerChannel, type PeerTrackEvent, type Room, type RtpPacket, SignalingClient} from '@lakutata/webrtc'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18084)

/**
 * Node.js 里的一个会议成员，和页面一样：其他每个成员的视频里带着的名字、收到的消息，以及停止发送视频的方法
 */
type Member = {
    room: Room
    videos: Map<string, string>
    messages: string[]
    stop(): void
}

/**
 * 一个 VP8 RTP 包的字节，负载是一段文字
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
 * 等到条件成立，最多 20 秒
 * @param condition
 * @param what 等的是什么，用于错误信息。
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
     * 应用的信令的一个客户端
     */
    async function client(): Promise<SignalingClient> {
        const created: SignalingClient = await app.getObject(SignalingClient, {url: `http://127.0.0.1:${PORT}`})
        clients.push(created)
        return created
    }

    /**
     * 像页面一样加入房间 test：发布一条视频轨道，给其他每个成员开一条聊天通道
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
            //Bob 离开：Alice 看到他走了
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

`npm test` 会先构建各个包，因此第二个测试运行时，构建好的页面已经就绪。测试覆盖的是该包的服务端和客户端，不包括 React 代码；`npm run typecheck -w ui` 检查页面的类型。

## 8. 构建和部署

```bash
npm run build
npm start
```

现在，由一个进程提供页面、信令和媒体服务器：页面位于 http://localhost:8080，页面的连接使用 UDP 的 40000 到 40999 端口。部署时：

- **HTTPS。** 浏览器只允许 `localhost` 和 HTTPS 页面使用摄像头和麦克风。适配器提供的是 HTTP，因此请在应用前部署一个反向代理（nginx、Caddy），由该代理提供 HTTPS，并转发 Socket.IO 的 WebSocket（见 [HTTP](../HTTP.md)）。
- **媒体服务器的端口。** 浏览器直接连接媒体服务器，因此请在防火墙中开放 UDP 的 40000 到 40999 端口。如果应用位于 NAT 之后，并且 NAT 按相同的端口号转发这些端口，请在启动应用时将 `PUBLIC_ADDRESS` 设为公网地址。
- **不放行 UDP 的网络。** 有些公司网络和移动网络需要 TURN 服务器：请添加 `TURNServer` 组件，并将其名称传给信令（见 [WebRTC](../WebRTC.md) 第 3 节和第 12 节）。
- **谁能加入。** 能打开页面的人，可以使用任何名称加入任何房间。在公网上，请使用入口的中间件认证用户（模板中的 `Authenticate.ts` 检查的是令牌），并在 `authorize` 中决定谁能加入哪个房间，该函数也能获取请求的上下文。
- **更大的会议。** 媒体服务器的 `workers` 选项可以利用更多的 CPU 核心，多个实例还可以通过 `Cluster` 共同承载房间（见 [WebRTC](../WebRTC.md) 第 13 节）。

<!--
check:
  create: meeting web-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  remove: packages/app/src/middlewares/Authenticate.ts
  run: npm test
  run: npm run typecheck -w ui
-->
