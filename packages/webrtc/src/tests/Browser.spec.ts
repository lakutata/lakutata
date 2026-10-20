import {describe, it, type TestContext} from 'node:test'
import assert from 'node:assert'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {Container} from '@lakutata/core'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import {next, startServer, type TestServer} from './support/Server.js'

//The browser tests use Playwright with the Chrome installed on the machine: the package playwright, else the one at
//LAKUTATA_PLAYWRIGHT (its directory); they are skipped without them
type Browser = {newPage(): Promise<BrowserPage>, close(): Promise<void>}
type BrowserPage = {goto(url: string): Promise<unknown>, evaluate<T>(code: string): Promise<T>, on(event: string, listener: (message: any) => void): void}

/**
 * Chrome, through Playwright
 */
async function launchChrome(): Promise<Browser | undefined> {
    type Playwright = {chromium: {launch(options: Record<string, unknown>): Promise<Browser>}}
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
        return await playwright.chromium.launch({channel: 'chrome', headless: true})
    } catch {
        return undefined
    }
}

/**
 * A static server of the compiled package (the browser entry) and of the browser build of socket.io-client
 */
async function staticServer(): Promise<{url: string, server: Server}> {
    const root: string = fileURLToPath(new URL('../', import.meta.url))
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

describe('Browser', (): void => {

    it('connects Chrome (Socket.IO) and an application, a data channel between them', {timeout: 60000}, async (t: TestContext): Promise<void> => {
        const chrome: Browser | undefined = await launchChrome()
        if (!chrome) return t.skip('Playwright or Chrome is not available')
        const files: {url: string, server: Server} = await staticServer()
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        try {
            const page: BrowserPage = await chrome.newPage()
            await page.goto(files.url)
            //The application opens a channel; Chrome echoes
            const node: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'device'})
            const room: Room = await node.join('lobby')
            const echoed: Promise<string> = next<string>((resolve: (value: string) => void): void => {
                room.on('peer', (peer: Peer): void => {
                    const channel: PeerChannel = peer.createDataChannel('telemetry')
                    channel.on('open', (): void => channel.send('21.5'))
                    channel.on('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString()))
                })
            }, 30000, 'the echo of Chrome')
            const browser: Promise<string> = page.evaluate<string>(memberScript({transport: 'socket.io', signaling: server.socketIO, id: 'chrome', room: 'lobby'}))
            assert.strictEqual(await echoed, 'echo: 21.5')
            assert.strictEqual(await browser, 'echoing')
        } finally {
            await chrome.close()
            files.server.close()
            await clients.destroy()
            await server.stop()
        }
    })

    it('connects two pages of Chrome (JSON-RPC) through the TURN relay only', {timeout: 60000}, async (t: TestContext): Promise<void> => {
        const chrome: Browser | undefined = await launchChrome()
        if (!chrome) return t.skip('Playwright or Chrome is not available')
        const files: {url: string, server: Server} = await staticServer()
        const server: TestServer = await startServer({turn: {secret: 'browser-secret'}})
        try {
            const first: BrowserPage = await chrome.newPage()
            const second: BrowserPage = await chrome.newPage()
            await Promise.all([first.goto(files.url), second.goto(files.url)])
            const echoing: Promise<string> = first.evaluate<string>(memberScript({transport: 'jsonrpc', signaling: server.jsonRPC, id: 'first', room: 'pages', relay: true}))
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
            const answer: string = await second.evaluate<string>(memberScript({transport: 'jsonrpc', signaling: server.jsonRPC, id: 'second', room: 'pages', relay: true, send: 'hello'}))
            assert.strictEqual(answer, 'echo: hello')
            assert.strictEqual(await echoing, 'echoing')
            assert.strictEqual(server.turn!.allocations, 2)
        } finally {
            await chrome.close()
            files.server.close()
            await server.stop()
        }
    })
})
