import {describe, it, type TestContext} from 'node:test'
import assert from 'node:assert'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {type ChildProcess, execFile, spawn} from 'node:child_process'
import {createSocket, type Socket} from 'node:dgram'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {Container} from '@lakutata/core'
import {Inject} from '@lakutata/core/decorator/di'
import {buildEntrypoints, Controller, Entrypoint, type ServiceContext} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {engineConnectionOf} from '../../peer/EngineConnection.js'
import {MediaTrack} from '../../peer/MediaTrack.js'
import type {PeerChannel} from '../../peer/PeerChannel.js'
import {PeerConnection, type PeerTrackEvent} from '../../peer/PeerConnection.js'
import type {RtpPacket} from '../../peer/RtpPacket.js'
import {type Peer, type Room, SignalingClient} from '../../peer/SignalingClient.js'
import type {SignalingCandidate, SignalingDescription} from '../../protocol/SignalingProtocol.js'
import type {WHIPSession} from '../../whip/WHIP.js'
import {webrtcServiceEntrypoint} from '../../service/WebRTCServiceEntrypoint.js'
import {next, startServer, startWHIP, type TestServer, until} from './Server.js'

//The browser tests use Playwright: Chrome is the one installed on the machine, Firefox and WebKit the builds of
//Playwright (`playwright install firefox webkit`); the package playwright, else the one at LAKUTATA_PLAYWRIGHT (its
//directory). The tests of a browser are skipped without it
type Browser = {newPage(): Promise<BrowserPage>, close(): Promise<void>}
type BrowserPage = {goto(url: string): Promise<unknown>, evaluate<T>(code: string): Promise<T>, on(event: string, listener: (message: any) => void): void}

/**
 * The browsers the tests run in
 */
export type Engine = 'chrome' | 'firefox' | 'webkit'

/**
 * The names of the browsers, in the titles of the tests
 */
const ENGINE_NAMES: Record<Engine, string> = {chrome: 'Chrome', firefox: 'Firefox', webkit: 'WebKit'}

/**
 * A browser, through Playwright; with `media`, its fake camera and microphone, allowed without asking
 * @param engine
 * @param options
 */
async function launchBrowser(engine: Engine, options: {media?: boolean} = {}): Promise<Browser | undefined> {
    type Launcher = {launch(options: Record<string, unknown>): Promise<Browser & {newContext(options: Record<string, unknown>): Promise<{newPage(): Promise<BrowserPage>}>}>}
    type Playwright = {chromium: Launcher, firefox: Launcher, webkit: Launcher}
    let playwright: Playwright
    try {
        const location: string | undefined = process.env.LAKUTATA_PLAYWRIGHT
        const module: string = 'playwright'
        const imported: Playwright & {default?: Playwright} = location ? await import(pathToFileURL(createRequire(path.join(location, 'package.json')).resolve('playwright')).href) : await import(module)
        //A CommonJS module: its exports may be its default only
        playwright = imported.chromium ? imported : imported.default!
    } catch {
        return undefined
    }
    try {
        if (engine === 'firefox') {
            return await playwright.firefox.launch({
                headless: true,
                firefoxUserPrefs: options.media ? {'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true} : {}
            })
        }
        if (engine === 'webkit') {
            //Its mock camera and microphone, once the pages are allowed to use them
            const browser = await playwright.webkit.launch({headless: true})
            return {
                newPage: async (): Promise<BrowserPage> => await (await browser.newContext(options.media ? {permissions: ['camera', 'microphone']} : {})).newPage(),
                close: (): Promise<void> => browser.close()
            }
        }
        //Chrome then gathers candidates on all the interfaces, not on the default route only
        const args: string[] = options.media ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []
        return await playwright.chromium.launch({channel: 'chrome', headless: true, args: args})
    } catch {
        return undefined
    }
}

/**
 * The local address of the default route: the source address of a UDP socket connected to an address of the internet
 * (connecting sends nothing)
 */
async function defaultRouteAddress(): Promise<string | undefined> {
    const socket: Socket = createSocket('udp4')
    try {
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            socket.once('error', reject)
            socket.connect(9, '192.0.2.1', resolve)
        })
        return socket.address().address
    } catch {
        return undefined
    } finally {
        socket.close()
    }
}

/**
 * A static server of the compiled package (the browser entry) and of the browser build of socket.io-client
 */
async function staticServer(): Promise<{url: string, server: Server}> {
    const root: string = fileURLToPath(new URL('../../', import.meta.url))
    const entry: string = createRequire(import.meta.url).resolve('socket.io-client')
    const socketIO: string = path.join(entry.slice(0, entry.lastIndexOf(`${path.sep}socket.io-client${path.sep}`) + 'socket.io-client'.length + 1), 'dist', 'socket.io.esm.min.js')
    const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        const pathname: string = new URL(request.url ?? '/', 'http://localhost').pathname
        try {
            if (pathname === '/') {
                response.writeHead(200, {'content-type': 'text/html'}).end('<!doctype html><title>WebRTC</title>')
                return
            }
            const file: string = pathname === '/socket.io.js' ? socketIO : path.join(root, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
            const content: Buffer = await readFile(file)
            response.writeHead(200, {'content-type': 'text/javascript'}).end(content)
        } catch {
            response.writeHead(404).end()
        }
    }
    const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => void serve(request, response))
    await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
    return {url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server: server}
}

/**
 * The code of a page joining a room and echoing the messages of the channels it gets, or opening one and sending a
 * message; it resolves with the answer
 * @param options
 */
function memberScript(options: {transport: 'socket.io' | 'jsonrpc', signaling: string, id: string, room: string, send?: string, relay?: boolean}): string {
    return `(async () => {
        const {SignalingConnection} = await import('/exports/Client.js')
        const socket = ${options.transport === 'socket.io'
        ? `(await import('/socket.io.js')).io(${JSON.stringify(options.signaling)}, {auth: {id: ${JSON.stringify(options.id)}}, transports: ['websocket']})`
        : `() => new WebSocket(${JSON.stringify(`${options.signaling}?id=${options.id}`)})`}
        const signaling = new SignalingConnection(socket, {iceTransportPolicy: ${JSON.stringify(options.relay ? 'relay' : 'all')}})
        const room = await signaling.join(${JSON.stringify(options.room)})
        return await new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('timed out')), 20000)
            room.on('peer', (peer) => {
                peer.on('datachannel', (channel) => {
                    channel.addEventListener('message', (event) => channel.send('echo: ' + event.data))
                    resolve('echoing')
                })
                ${options.send ? `const channel = peer.createDataChannel('chat')
                channel.addEventListener('open', () => channel.send(${JSON.stringify(options.send)}))
                channel.addEventListener('message', (event) => resolve(event.data))` : ''}
            })
        })
    })()`
}

/**
 * The code of a page joining a room with the fake camera and microphone: it sends them to the members given (all
 * without), and resolves once a video track of a member given is decoded (at once when it receives none)
 * @param options
 */
function mediaScript(options: {signaling: string, id: string, room: string, sendTo?: string[] | 'all', receiveFrom?: string[] | 'all'}): string {
    return `(async () => {
        //The step it is at and what its peers are at, to diagnose a timeout
        let step = 'loading'
        let tracks = 0
        let room
        let timer
        const timedOut = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('timed out at ' + step + ': ' + JSON.stringify({tracks, peers: room ? room.peers.map((peer) => [peer.id, peer.connection.signalingState, peer.connection.connectionState]) : []}))), 40000)
        })
        const run = async () => {
            const {SignalingConnection} = await import('/exports/Client.js')
            const socket = (await import('/socket.io.js')).io(${JSON.stringify(options.signaling)}, {auth: {id: ${JSON.stringify(options.id)}}, transports: ['websocket']})
            const signaling = new SignalingConnection(socket)
            const sendTo = ${JSON.stringify(options.sendTo ?? [])}
            const receiveFrom = ${JSON.stringify(options.receiveFrom ?? [])}
            step = 'getUserMedia'
            const stream = sendTo.length ? await navigator.mediaDevices.getUserMedia({audio: true, video: {width: 320, height: 240}}) : undefined
            step = 'join'
            room = await signaling.join(${JSON.stringify(options.room)})
            window.room = room
            step = 'peers'
            return await new Promise((resolve) => {
                if (!receiveFrom.length) resolve({sending: true})
                room.on('peer', (peer) => {
                    if (stream && (sendTo === 'all' || sendTo.includes(peer.id))) for (const track of stream.getTracks()) peer.connection.addTrack(track, stream)
                    if (receiveFrom !== 'all' && !receiveFrom.includes(peer.id)) return
                    peer.on('track', (event) => {
                        tracks++
                        if (event.track.kind !== 'video') return
                        const timer = setInterval(async () => {
                            for (const report of (await peer.connection.getStats(event.track)).values()) {
                                if (report.type !== 'inbound-rtp' || !(report.framesDecoded > 0)) continue
                                clearInterval(timer)
                                resolve({from: peer.id, framesDecoded: report.framesDecoded, width: report.frameWidth, streams: event.streams.length})
                            }
                        }, 200)
                    })
                })
            })
        }
        try {
            return await Promise.race([run(), timedOut])
        } finally {
            clearTimeout(timer)
        }
    })()`
}

/**
 * The result of a script of a page, failing when the page does not answer in time (a page stuck)
 * @param page
 * @param script
 * @param timeout
 */
async function evaluated<T>(page: BrowserPage, script: string, timeout: number = 60000): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            page.evaluate<T>(script),
            new Promise<never>((_resolve: unknown, reject: (error: Error) => void): void => {
                timer = setTimeout((): void => reject(new Error(`The page did not answer in ${timeout} ms`)), timeout)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}

/**
 * The code of a page joining a room with the fake camera and microphone, published once to the room, sending a message
 * to each member: it resolves once it decodes the video of each of the other members given and gets their messages
 * @param options
 */
function meetingScript(options: {signaling: string, id: string, room: string, others: string[]}): string {
    return `(async () => {
        const {SignalingConnection} = await import('/exports/Client.js')
        const socket = (await import('/socket.io.js')).io(${JSON.stringify(options.signaling)}, {auth: {id: ${JSON.stringify(options.id)}}, transports: ['websocket']})
        const signaling = new SignalingConnection(socket)
        const camera = await navigator.mediaDevices.getUserMedia({audio: true, video: {width: 320, height: 240}})
        const room = await signaling.join(${JSON.stringify(options.room)})
        const others = ${JSON.stringify(options.others)}
        //The listeners first, then the tracks published, as a page does: the tracks of the others may come meanwhile
        const published = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
            for (const track of camera.getTracks()) await room.publish(track, camera)
        })()
        return await new Promise((resolve, reject) => {
            const decoded = {}
            const messages = {}
            setTimeout(() => reject(new Error('timed out: ' + JSON.stringify({decoded: decoded, messages: messages}))), 40000)
            const done = () => {
                if (others.every((other) => decoded[other] && messages[other])) published.then(() => resolve({sfu: room.sfu, decoded: decoded, messages: messages, peers: room.peers.length}), reject)
            }
            room.on('peer', (peer) => {
                //A message to each member, through the server; the channel of each member tells who opened it
                const channel = peer.createDataChannel('chat')
                channel.addEventListener('open', () => channel.send('hello from ' + ${JSON.stringify(options.id)}))
                peer.on('datachannel', (received) => received.addEventListener('message', (event) => {
                    messages[peer.id] = received.protocol + ': ' + event.data
                    done()
                }))
                peer.on('track', (event) => {
                    if (event.track.kind !== 'video') return
                    const timer = setInterval(async () => {
                        for (const report of (await peer.connection.getStats(event.track)).values()) {
                            if (report.type !== 'inbound-rtp' || !(report.framesDecoded > 0)) continue
                            clearInterval(timer)
                            decoded[peer.id] = {width: report.frameWidth, from: room.streamOf(event.streams[0].id)?.peerId}
                            done()
                        }
                    }, 200)
                })
            })
        })
    })()`
}

/**
 * Whether a VP8 payload starts a key frame (RFC 7741: the payload descriptor, then the inverse key frame bit)
 * @param payload
 */
function startsVP8KeyFrame(payload: Buffer): boolean {
    const start: boolean = (payload[0] & 0x10) !== 0 && (payload[0] & 0x07) === 0
    let offset: number = 1
    if (payload[0] & 0x80) {
        const extension: number = payload[offset++]
        if (extension & 0x80) offset += payload[offset] & 0x80 ? 2 : 1
        if (extension & 0x40) offset++
        if (extension & 0x30) offset++
    }
    return start && (payload[offset] & 0x01) === 0
}

type DecodedVideo = {from: string, framesDecoded: number, width: number, streams: number}

/**
 * The code of a page waiting for the candidates of a connection of its own (`window[name]`), without trickle ICE
 * @param name
 */
function gatheredScript(name: string): string {
    return `await new Promise((resolve) => {
        if (window.${name}.iceGatheringState === 'complete') return resolve()
        window.${name}.addEventListener('icegatheringstatechange', () => window.${name}.iceGatheringState === 'complete' && resolve())
    })`
}

/**
 * Wait until the browser estimates more than a bit rate for what a connection of a page (`window[name]`) sends
 * @param page
 * @param name
 * @param bitrate In bit/s
 * @returns `false` when the browser does not give its estimate (`availableOutgoingBitrate`, which Firefox leaves out)
 */
async function browserEstimates(page: BrowserPage, name: string, bitrate: number): Promise<boolean> {
    const deadline: number = Date.now() + 20000
    let estimate: number | null = 0
    while (estimate !== null && estimate <= bitrate) {
        if (Date.now() > deadline) throw new Error(`The browser estimates ${estimate} bit/s`)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 250))
        estimate = await page.evaluate<number | null>(`(async () => {
            for (const report of (await window.${name}.getStats()).values()) {
                if (report.type !== 'candidate-pair' || report.state !== 'succeeded') continue
                return report.availableOutgoingBitrate === undefined ? null : report.availableOutgoingBitrate
            }
            return 0
        })()`)
    }
    return estimate !== null
}

/**
 * Wait for the candidates of a connection, without trickle ICE
 * @param connection
 */
function gathered(connection: PeerConnection): Promise<void> {
    return next<void>((resolve: () => void): void => {
        connection.on('icecandidate', (candidate: SignalingCandidate | null): void => {
            if (!candidate) resolve()
        })
    }, 10000, 'the candidates')
}

/**
 * Whether ffmpeg with libx264 is installed
 */
function ffmpegWithX264(): Promise<boolean> {
    return new Promise((resolve: (available: boolean) => void): void => {
        execFile('ffmpeg', ['-hide_banner', '-encoders'], (error: Error | null, stdout: string): void => resolve(!error && stdout.includes('libx264')))
    })
}

/**
 * The service actions of an application called by the pages
 */
class GreeterController extends Controller {

    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @ServiceAction({method: 'greet'})
    public async greet(input: {name: string}): Promise<string> {
        const clientId: string = (this.context as ServiceContext).clientId!
        this.entrypoint.notify(clientId, 'greeted', input.name)
        return `hello ${input.name}, ${clientId}`
    }

    @ServiceAction({method: 'large'})
    public async large(input: {size: number}): Promise<string> {
        return 'x'.repeat(input.size)
    }
}

/**
 * The code of a page calling the service actions of the member device through a data channel: it resolves with the
 * results, the event pushed to it and the error code of an unknown method
 * @param signaling
 */
function callerScript(signaling: string): string {
    return `(async () => {
        const {SignalingConnection, PeerServiceProxy} = await import('/exports/Client.js')
        const socket = (await import('/socket.io.js')).io(${JSON.stringify(signaling)}, {auth: {id: 'browser'}, transports: ['websocket']})
        const room = await new SignalingConnection(socket).join('device')
        const peer = await new Promise((resolve) => room.on('peer', (each) => {
            if (each.id === 'device') resolve(each)
        }))
        const device = new PeerServiceProxy(peer.createDataChannel('service'))
        const greeted = new Promise((resolve) => device.once('greeted', resolve))
        const greeting = await device.invoke({method: 'greet', name: 'page'}, 20000)
        const event = await greeted
        const large = await device.invoke({method: 'large', size: 500000}, 20000)
        let code
        try {
            await device.invoke({method: 'nothing'}, 20000)
        } catch (error) {
            code = error.code
        }
        return {greeting: greeting, event: event, large: large.length, code: code}
    })()`
}

/**
 * The tests with a browser: its pages and applications of this package connected through the signaling, the media
 * server, WHIP; a spec file per browser runs them, so the browsers run in parallel
 * @param engine
 */
export function browserSuite(engine: Engine): void {
    const name: string = ENGINE_NAMES[engine]
    describe(`Browser: ${name}`, (): void => {

        it(`connects ${name} (Socket.IO) and an application, a data channel between them`, {timeout: 60000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine)
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer()
            const clients: Container = new Container()
            try {
                const page: BrowserPage = await browser.newPage()
                await page.goto(files.url)
                //The application opens a channel; the page echoes
                const node: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'device'})
                const room: Room = await node.join('lobby')
                const echoed: Promise<string> = next<string>((resolve: (value: string) => void): void => {
                    room.on('peer', (peer: Peer): void => {
                        const channel: PeerChannel = peer.createDataChannel('telemetry')
                        channel.on('open', (): void => channel.send('21.5'))
                        channel.on('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString()))
                    })
                }, 30000, `the echo of ${name}`)
                const echoing: Promise<string> = page.evaluate<string>(memberScript({transport: 'socket.io', signaling: server.socketIO, id: 'browser', room: 'lobby'}))
                assert.strictEqual(await echoed, 'echo: 21.5')
                assert.strictEqual(await echoing, 'echoing')
            } finally {
                await browser.close()
                files.server.close()
                await clients.destroy()
                await server.stop()
            }
        })

        it(`calls the service actions of an application from ${name} through a data channel, and gets its events`, {timeout: 60000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine)
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer()
            const application: Container = new Container()
            try {
                await application.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
                    controllers: [GreeterController],
                    service: webrtcServiceEntrypoint({signaling: {url: server.socketIO, id: 'device'}, rooms: ['device']})
                }))
                const page: BrowserPage = await browser.newPage()
                await page.goto(files.url)
                const result: Record<string, unknown> = await evaluated<Record<string, unknown>>(page, callerScript(server.socketIO), 45000)
                assert.deepStrictEqual(result, {greeting: 'hello page, browser', event: 'page', large: 500000, code: -32601})
            } finally {
                await browser.close()
                files.server.close()
                await application.destroy()
                await server.stop()
            }
        })

        it(`connects two pages of ${name} (JSON-RPC) through the TURN relay only`, {timeout: 60000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine)
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            //On the address of the default route: Firefox sends from it, not from a loopback address or the ones of other
            //interfaces (of a VPN)
            const address: string | undefined = await defaultRouteAddress()
            if (!address) return t.skip('No default route for the address of the TURN server')
            const server: TestServer = await startServer({turn: {secret: 'browser-secret', host: '0.0.0.0', publicAddress: address}})
            try {
                const first: BrowserPage = await browser.newPage()
                const second: BrowserPage = await browser.newPage()
                await Promise.all([first.goto(files.url), second.goto(files.url)])
                //The WebKit of Playwright refuses the URLs of TURN with a transport (?transport=udp, RFC 7065), which Safari
                //accepts (test-env/safari.mjs checks Safari)
                const refused: string | null = await first.evaluate<string | null>(`(() => {
                    try {
                        new RTCPeerConnection({iceServers: [{urls: 'turn:127.0.0.1:3478?transport=udp', username: 'a', credential: 'b'}]})
                        return null
                    } catch (error) {
                        return String(error)
                    }
                })()`)
                if (refused) return t.skip(`${name} refuses the URL of a TURN server with its transport: ${refused}`)
                const echoing: Promise<string> = first.evaluate<string>(memberScript({transport: 'jsonrpc', signaling: server.jsonRPC, id: 'first', room: 'pages', relay: true}))
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
                const answer: string = await second.evaluate<string>(memberScript({transport: 'jsonrpc', signaling: server.jsonRPC, id: 'second', room: 'pages', relay: true, send: 'hello'}))
                assert.strictEqual(answer, 'echo: hello')
                assert.strictEqual(await echoing, 'echoing')
                assert.strictEqual(server.turn!.allocations, 2)
            } finally {
                await browser.close()
                files.server.close()
                await server.stop()
            }
        })

        it(`sends the camera and the microphone of ${name} to an application, which asks for key frames`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer()
            const clients: Container = new Container()
            try {
                const recorder: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'recorder'})
                const room: Room = await recorder.join('studio')
                const tracks: Promise<MediaTrack[]> = next<MediaTrack[]>((resolve: (tracks: MediaTrack[]) => void): void => {
                    const received: MediaTrack[] = []
                    room.on('peer', (peer: Peer): void => {
                        peer.on('track', (event: PeerTrackEvent): void => {
                            received.push(event.track)
                            if (received.length === 2) resolve(received)
                        })
                    })
                }, 40000, `the tracks of ${name}`)
                const page: BrowserPage = await browser.newPage()
                await page.goto(files.url)
                await evaluated(page, mediaScript({signaling: server.socketIO, id: 'camera', room: 'studio', sendTo: 'all'}))
                const [audio, video] = (await tracks).sort((a: MediaTrack, b: MediaTrack): number => a.kind.localeCompare(b.kind))
                assert.strictEqual(audio.codec, 'audio/opus')
                assert.strictEqual(video.codec, 'video/VP8')
                await Promise.all([audio, video].map((track: MediaTrack): Promise<RtpPacket> => next<RtpPacket>((resolve: (packet: RtpPacket) => void): unknown => track.once('rtp', resolve), 20000, `the ${track.kind}`)))
                //Past the key frame of the start, Chrome makes one when asked
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1500))
                const keyFrame: Promise<RtpPacket> = next<RtpPacket>((resolve: (packet: RtpPacket) => void): void => {
                    video.on('rtp', (packet: RtpPacket): void => {
                        if (startsVP8KeyFrame(packet.payload)) resolve(packet)
                    })
                }, 5000, 'a key frame')
                video.requestKeyFrame()
                await keyFrame
            } finally {
                await browser.close()
                files.server.close()
                await clients.destroy()
                await server.stop()
            }
        })

        it(`forwards the camera of a page of ${name} to another one through an application`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer()
            const clients: Container = new Container()
            try {
                //The application sends on to the viewer what the camera sends it
                const hub: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'hub'})
                const room: Room = await hub.join('stage')
                let viewer: Peer | undefined
                const pending: PeerTrackEvent[] = []
                const forward = (event: PeerTrackEvent): void => {
                    if (viewer) viewer.connection.addTrack(event.track, ...event.streams.map((stream: {id: string}): string => stream.id))
                    else pending.push(event)
                }
                room.on('peer', (peer: Peer): void => {
                    if (peer.id === 'camera') peer.on('track', forward)
                    if (peer.id !== 'viewer') return
                    viewer = peer
                    pending.splice(0).forEach(forward)
                })
                const camera: BrowserPage = await browser.newPage()
                const watching: BrowserPage = await browser.newPage()
                await Promise.all([camera.goto(files.url), watching.goto(files.url)])
                await evaluated(camera, mediaScript({signaling: server.socketIO, id: 'camera', room: 'stage', sendTo: ['hub']}))
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1500))
                //The viewer decodes from a key frame the camera makes when the viewer asks, through the application
                const decoded: DecodedVideo = await evaluated<DecodedVideo>(watching, mediaScript({signaling: server.socketIO, id: 'viewer', room: 'stage', receiveFrom: ['hub']}))
                assert.strictEqual(decoded.from, 'hub')
                assert.strictEqual(decoded.width, 320)
                assert.strictEqual(decoded.streams, 1)
            } finally {
                await browser.close()
                files.server.close()
                await clients.destroy()
                await server.stop()
            }
        })

        it(`sends the cameras of two pages of ${name} to each other through the signaling`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer()
            try {
                const first: BrowserPage = await browser.newPage()
                const second: BrowserPage = await browser.newPage()
                await Promise.all([first.goto(files.url), second.goto(files.url)])
                const decoded: DecodedVideo[] = await Promise.all([
                    evaluated<DecodedVideo>(first, mediaScript({signaling: server.socketIO, id: 'first', room: 'call', sendTo: 'all', receiveFrom: 'all'})),
                    evaluated<DecodedVideo>(second, mediaScript({signaling: server.socketIO, id: 'second', room: 'call', sendTo: 'all', receiveFrom: 'all'}))
                ])
                assert.deepStrictEqual(decoded.map((video: DecodedVideo): string => video.from), ['second', 'first'])
                for (const video of decoded) {
                    assert.strictEqual(video.width, 320)
                    assert.strictEqual(video.streams, 1)
                }
            } finally {
                await browser.close()
                files.server.close()
                await server.stop()
            }
        })

        it(`sends the H.264 of an encoder (ffmpeg) from an application to ${name}`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            if (!await ffmpegWithX264()) return t.skip('ffmpeg with libx264 is not available')
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer()
            const clients: Container = new Container()
            const socket: Socket = createSocket('udp4')
            let encoder: ChildProcess | undefined
            try {
                //The packets of ffmpeg, written to the track
                const video: MediaTrack = new MediaTrack('video', {codec: 'video/H264'})
                socket.on('message', (datagram: Buffer): void => video.writeRtp(datagram))
                await new Promise<void>((resolve: () => void): unknown => socket.bind(0, '127.0.0.1', resolve))
                encoder = spawn('ffmpeg', [
                    '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30',
                    '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p', '-tune', 'zerolatency', '-g', '30',
                    '-bsf:v', 'dump_extra=freq=keyframe', '-f', 'rtp', `rtp://127.0.0.1:${socket.address().port}?pkt_size=1200`
                ], {stdio: 'ignore'})
                const app: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'app'})
                const room: Room = await app.join('broadcast')
                room.on('peer', (peer: Peer): void => void peer.connection.addTrack(video, 'test-pattern'))
                const page: BrowserPage = await browser.newPage()
                await page.goto(files.url)
                //A build without H.264 cannot receive it (the Firefox of Playwright has no OpenH264)
                if (!await page.evaluate<boolean>('RTCRtpReceiver.getCapabilities(\'video\').codecs.some((codec) => codec.mimeType === \'video/H264\')')) return t.skip(`${name} has no H.264`)
                const decoded: DecodedVideo = await evaluated<DecodedVideo>(page, mediaScript({signaling: server.socketIO, id: 'viewer', room: 'broadcast', receiveFrom: ['app']}))
                assert.strictEqual(decoded.width, 320)
                assert.strictEqual(decoded.streams, 1)
            } finally {
                encoder?.kill()
                socket.close()
                await browser.close()
                files.server.close()
                await clients.destroy()
                await server.stop()
            }
        })

        it(`gives ${name} the transport-wide feedback of its camera and gets the one of what it sends, offering and answering`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const container: Container = new Container()
            //About 1.6 Mbit/s of video sent to Chrome
            const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
            let sequenceNumber: number = 0
            const timer: NodeJS.Timeout = setInterval((): void => {
                for (let index: number = 0; index < 2; index++, sequenceNumber++) {
                    const header: Buffer = Buffer.alloc(12)
                    header[0] = 0x80
                    header[1] = 96
                    header.writeUInt16BE(sequenceNumber & 0xffff, 2)
                    header.writeUInt32BE((sequenceNumber * 1500) >>> 0, 4)
                    video.writeRtp(Buffer.concat([header, Buffer.alloc(1000, 1)]))
                }
            }, 10)
            try {
                const page: BrowserPage = await browser.newPage()
                await page.goto(files.url)
                //The application offers its video, Chrome answers with its camera on the same transceiver
                const offering: PeerConnection = await container.get(PeerConnection, {headerExtensions: true})
                offering.addTrack(video, 'application')
                const candidates: Promise<void> = gathered(offering)
                await offering.setLocalDescription()
                await candidates
                const answer: SignalingDescription = await page.evaluate<SignalingDescription>(`(async () => {
                    const camera = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}})
                    window.answering = new RTCPeerConnection()
                    await window.answering.setRemoteDescription(${JSON.stringify(offering.localDescription)})
                    const [transceiver] = window.answering.getTransceivers()
                    await transceiver.sender.replaceTrack(camera.getVideoTracks()[0])
                    transceiver.direction = 'sendrecv'
                    await window.answering.setLocalDescription()
                    ${gatheredScript('answering')}
                    return {type: 'answer', sdp: window.answering.localDescription.sdp}
                })()`)
                assert.match(answer.sdp!, /^a=extmap:\d+ http:\/\/www\.ietf\.org\/id\/draft-holmer-rmcat-transport-wide-cc-extensions-01$/m)
                await offering.setRemoteDescription(answer)
                //The application estimates about the bit rate it sends, from the feedback of Chrome
                await until((): boolean => engineConnectionOf(offering).dtlsTransports[0].senderBWE.availableBitrate > 1000000, 20000, 'the estimate of the application')
                //The browser estimates more than it starts with (300 kbit/s) from the feedback of the application, at once
                if (!await browserEstimates(page, 'answering', 1000000)) t.diagnostic(`${name} does not give its estimate`)

                //Chrome offers its camera, with all its extensions: the application answers with the ones it has, their ids
                //the ones of the offer
                const offer: SignalingDescription = await page.evaluate<SignalingDescription>(`(async () => {
                    const camera = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}})
                    window.offering = new RTCPeerConnection()
                    window.offering.addTrack(camera.getVideoTracks()[0], camera)
                    await window.offering.setLocalDescription()
                    ${gatheredScript('offering')}
                    return {type: 'offer', sdp: window.offering.localDescription.sdp}
                })()`)
                const answering: PeerConnection = await container.get(PeerConnection, {headerExtensions: true})
                await answering.setRemoteDescription(offer)
                const answered: Promise<void> = gathered(answering)
                await answering.setLocalDescription()
                await answered
                const offered: string[] = [...offer.sdp!.matchAll(/^a=extmap:(\d+) (\S+)$/gm)].map(([, id, uri]: string[]): string => `${id} ${uri}`)
                const accepted: string[] = [...answering.localDescription!.sdp!.matchAll(/^a=extmap:(\d+) (\S+)$/gm)].map(([, id, uri]: string[]): string => `${id} ${uri}`)
                assert.strictEqual(accepted.length, 3)
                for (const extension of accepted) assert.ok(offered.includes(extension), extension)
                await page.evaluate(`window.offering.setRemoteDescription(${JSON.stringify(answering.localDescription)})`)
                if (!await browserEstimates(page, 'offering', 1000000)) t.diagnostic(`${name} does not give its estimate`)
            } finally {
                clearInterval(timer)
                await browser.close()
                files.server.close()
                await container.destroy()
            }
        })

        for (const workers of [0, 2]) it(`holds a meeting of three pages of ${name} through the media server${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer({sfu: {workers: workers}})
            try {
                const ids: string[] = ['ann', 'ben', 'cid']
                const pages: BrowserPage[] = await Promise.all(ids.map((): Promise<BrowserPage> => browser.newPage()))
                await Promise.all(pages.map((page: BrowserPage): Promise<unknown> => page.goto(files.url)))
                type Meeting = {sfu: string, decoded: Record<string, {width: number, from: string}>, messages: Record<string, string>, peers: number}
                const meetings: Meeting[] = await Promise.all(pages.map((page: BrowserPage, index: number): Promise<Meeting> => page.evaluate<Meeting>(meetingScript({
                    signaling: server.socketIO,
                    id: ids[index],
                    room: 'meeting',
                    others: ids.filter((id: string): boolean => id !== ids[index])
                }))))
                for (const [index, meeting] of meetings.entries()) {
                    assert.match(meeting.sfu, /^sfu:/)
                    assert.strictEqual(meeting.peers, 2)
                    for (const other of ids.filter((id: string): boolean => id !== ids[index])) {
                        assert.deepStrictEqual(meeting.decoded[other], {width: 320, from: other}, `${ids[index]} decodes ${other}`)
                        assert.strictEqual(meeting.messages[other], `${other}: hello from ${other}`)
                    }
                }
                //Each page publishes its audio and its video once, to the server
                assert.strictEqual(server.sfu!.rooms().meeting.tracks.length, 6)
            } finally {
                await browser.close()
                files.server.close()
                await server.stop()
            }
        })

        for (const workers of [0, 2]) it(`holds a meeting of two pages of ${name} joining one after the other, the server offering the tracks of the first one as the second one publishes${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer({sfu: {workers: workers}})
            try {
                const [first, second] = await Promise.all([browser.newPage(), browser.newPage()])
                await Promise.all([first.goto(files.url), second.goto(files.url)])
                type Meeting = {decoded: Record<string, {width: number, from: string}>}
                const ann: Promise<Meeting> = first.evaluate<Meeting>(meetingScript({signaling: server.socketIO, id: 'ann', room: 'meeting', others: ['ben']}))
                await until((): boolean => server.sfu!.rooms().meeting?.tracks.length === 2, 20000, 'the tracks of ann')
                const ben: Meeting = await second.evaluate<Meeting>(meetingScript({signaling: server.socketIO, id: 'ben', room: 'meeting', others: ['ann']}))
                assert.deepStrictEqual((await ann).decoded.ben, {width: 320, from: 'ben'}, 'ann decodes ben')
                assert.deepStrictEqual(ben.decoded.ann, {width: 320, from: 'ann'}, 'ben decodes ann')
            } finally {
                await browser.close()
                files.server.close()
                await server.stop()
            }
        })

        for (const workers of [0, 2]) it(`publishes the camera of a page of ${name} with WHIP and plays it on another one with WHEP${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const server: TestServer = await startServer({sfu: {workers: workers}, whip: {}, whep: {}})
            try {
                const [camera, player] = await Promise.all([browser.newPage(), browser.newPage()])
                await Promise.all([camera.goto(files.url), player.goto(files.url)])
                //The camera publishes, from another origin
                await camera.evaluate(`(async () => {
                    const camera = await navigator.mediaDevices.getUserMedia({audio: true, video: {width: 320, height: 240}})
                    window.publisher = new RTCPeerConnection()
                    for (const track of camera.getTracks()) window.publisher.addTransceiver(track, {direction: 'sendonly', streams: [camera]})
                    await window.publisher.setLocalDescription()
                    ${gatheredScript('publisher')}
                    const response = await fetch(${JSON.stringify(`${server.http}/whip/stage`)}, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: window.publisher.localDescription.sdp})
                    if (response.status !== 201) throw new Error('POST answered ' + response.status)
                    await window.publisher.setRemoteDescription({type: 'answer', sdp: await response.text()})
                })()`)
                //The player receives it through the media server, and decodes it
                const decoded: {framesDecoded: number, width: number} = await player.evaluate(`(async () => {
                    window.player = new RTCPeerConnection()
                    window.player.addTransceiver('audio', {direction: 'recvonly'})
                    window.player.addTransceiver('video', {direction: 'recvonly'})
                    await window.player.setLocalDescription()
                    ${gatheredScript('player')}
                    const response = await fetch(${JSON.stringify(`${server.http}/whep/stage`)}, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: window.player.localDescription.sdp})
                    if (response.status !== 201) throw new Error('POST answered ' + response.status)
                    await window.player.setRemoteDescription({type: 'answer', sdp: await response.text()})
                    return await new Promise((resolve, reject) => {
                        setTimeout(() => reject(new Error('timed out')), 30000)
                        const timer = setInterval(async () => {
                            for (const report of (await window.player.getStats()).values()) {
                                if (report.type !== 'inbound-rtp' || report.kind !== 'video' || !(report.framesDecoded > 0)) continue
                                clearInterval(timer)
                                resolve({framesDecoded: report.framesDecoded, width: report.frameWidth})
                            }
                        }, 200)
                    })
                })()`)
                assert.strictEqual(decoded.width, 320)
                assert.strictEqual(server.sfu!.rooms().stage.viewers, 1)
            } finally {
                await browser.close()
                files.server.close()
                await server.stop()
            }
        })

        it(`publishes the camera of ${name} with WHIP, from another origin (CORS)`, {timeout: 90000}, async (t: TestContext): Promise<void> => {
            const browser: Browser | undefined = await launchBrowser(engine, {media: true})
            if (!browser) return t.skip(`Playwright or ${name} is not available`)
            const files: {url: string, server: Server} = await staticServer()
            const {url, whip, container} = await startWHIP('express', {authorize: ({token}): boolean => token === 'browser-token'})
            try {
                const published: Promise<WHIPSession> = next<WHIPSession>((resolve: (session: WHIPSession) => void): unknown => whip.once('publish', resolve), 30000, 'publish')
                const page: BrowserPage = await browser.newPage()
                await page.goto(files.url)
                //The client of WHIP of a page: its offer with all its candidates, the answer, the URL of its session
                const location: string = await page.evaluate<string>(`(async () => {
                    const camera = await navigator.mediaDevices.getUserMedia({audio: true, video: {width: 320, height: 240}})
                    const connection = new RTCPeerConnection()
                    for (const track of camera.getTracks()) connection.addTransceiver(track, {direction: 'sendonly', streams: [camera]})
                    await connection.setLocalDescription()
                    await new Promise((resolve) => {
                        if (connection.iceGatheringState === 'complete') return resolve()
                        connection.addEventListener('icegatheringstatechange', () => connection.iceGatheringState === 'complete' && resolve())
                    })
                    const response = await fetch(${JSON.stringify(`${url}/whip/studio`)}, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/sdp', 'Authorization': 'Bearer browser-token'},
                        body: connection.localDescription.sdp
                    })
                    if (response.status !== 201) throw new Error('POST answered ' + response.status)
                    await connection.setRemoteDescription({type: 'answer', sdp: await response.text()})
                    await new Promise((resolve, reject) => {
                        setTimeout(() => reject(new Error('not connected')), 20000)
                        connection.addEventListener('connectionstatechange', () => connection.connectionState === 'connected' && resolve())
                    })
                    return response.headers.get('Location')
                })()`)
                const session: WHIPSession = await published
                assert.strictEqual(location, `/whip/studio/${session.id}`)
                assert.deepStrictEqual(session.tracks!.map((track: MediaTrack): string => track.kind).sort(), ['audio', 'video'])
                await Promise.all(session.tracks!.map((track: MediaTrack): Promise<RtpPacket> => next<RtpPacket>((resolve: (packet: RtpPacket) => void): unknown => track.once('rtp', resolve), 20000, `the ${track.kind} of Chrome`)))
                //The page ends its session
                const unpublished: Promise<WHIPSession> = next<WHIPSession>((resolve: (ended: WHIPSession) => void): unknown => whip.once('unpublish', resolve), 10000, 'unpublish')
                assert.strictEqual(await page.evaluate<number>(`fetch(${JSON.stringify(url)} + ${JSON.stringify(location)}, {method: 'DELETE'}).then((response) => response.status)`), 200)
                assert.strictEqual((await unpublished).id, session.id)
            } finally {
                await browser.close()
                files.server.close()
                await container.destroy()
            }
        })
    })
}
