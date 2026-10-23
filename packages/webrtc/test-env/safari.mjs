//The checks of Safari, which Playwright cannot drive: this script serves a page, opens it in Safari (`open -a Safari`)
//and waits for the page to report. The page joins a room of the signaling of this package (Socket.IO), echoes on a data
//channel the member `node` opens to it, calls a service action of the application `device` through PeerServiceProxy,
//then connects to `node` again through the TURN relay only. The TURN URLs the server gives are tried first: a URL
//Safari refuses makes RTCPeerConnection throw. Close the tab afterwards.
//   npm run compile && node test-env/safari.mjs
import {createServer} from 'node:http'
import {createSocket} from 'node:dgram'
import {execFile} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {socketIOServiceEntrypoint} from '@lakutata/entrypoint/adapter/socket.io'
const {Signaling, SignalingClient, SignalingController, TURNServer, webrtcServiceEntrypoint} = await import('../dist/esm/exports/WebRTC.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/esm')
const entry = createRequire(import.meta.url).resolve('socket.io-client')
const socketIOFile = path.join(entry.slice(0, entry.lastIndexOf(`${path.sep}socket.io-client${path.sep}`) + 'socket.io-client'.length + 1), 'dist', 'socket.io.esm.min.js')

/**
 * The service action the page calls
 */
class GreeterController extends Controller {
    async greet(input) {
        return `hello ${input.name}, ${this.context.clientId}`
    }
}
Object.defineProperty(GreeterController.prototype, 'greet', ServiceAction({method: 'greet'})(GreeterController.prototype, 'greet', Object.getOwnPropertyDescriptor(GreeterController.prototype, 'greet')))

//The address of the default route: Safari sends from it to the TURN server
const probe = createSocket('udp4')
await new Promise((resolve) => probe.connect(9, '192.0.2.1', resolve))
const address = probe.address().address
probe.close()

const container = new Container()
let socketIOPort = 0
const turn = await container.setNamed('turn', TURNServer, {host: '0.0.0.0', port: 0, publicAddress: address, tcp: false})
await container.setNamed('signaling', Signaling, {turn: 'turn'})
await container.setNamed('entrypoint', Entrypoint, buildEntrypoints({
    controllers: [SignalingController],
    service: socketIOServiceEntrypoint({port: 0, host: '127.0.0.1', listening: (_io, server) => void (socketIOPort = server.address().port)})
}))
const signalingURL = `http://127.0.0.1:${socketIOPort}`
//The application serving its action to the members of its room
const device = new Container()
await device.setNamed('entrypoint', Entrypoint, buildEntrypoints({
    controllers: [GreeterController],
    service: webrtcServiceEntrypoint({signaling: {url: signalingURL, id: 'device'}, rooms: ['safari']})
}))
//The member echoing with the page, directly, then through the relay only
const results = {}
const echo = async (room, iceTransportPolicy) => {
    const member = await container.get(SignalingClient, {url: signalingURL, id: `node-${iceTransportPolicy}`, iceTransportPolicy: iceTransportPolicy})
    const joined = await member.join(room)
    joined.on('peer', (peer) => {
        if (!peer.id.startsWith('safari')) return
        const channel = peer.createDataChannel('telemetry')
        channel.on('open', () => channel.send(`hello over ${iceTransportPolicy}`))
        channel.on('message', (data) => void (results[`echo ${iceTransportPolicy}`] = String(data)))
    })
}
await echo('safari', 'all')
await echo('safari-relay', 'relay')

const page = `<!doctype html><meta charset="utf-8"><title>Safari check</title><pre id="log">running…</pre><script type="module">
const report = {}
const say = (text) => document.getElementById('log').textContent += '\\n' + text
const iceServers = ${JSON.stringify(turn.iceServers('safari'))}
try {
    new RTCPeerConnection({iceServers})
    report.turnURLs = 'accepted: ' + JSON.stringify(iceServers.flatMap((server) => [].concat(server.urls)))
} catch (error) {
    report.turnURLs = 'refused: ' + error
}
for (const url of ['turn:${address}:3478', 'turn:${address}:3478?transport=udp', 'turn:${address}:3478?transport=tcp']) {
    try {
        new RTCPeerConnection({iceServers: [{urls: url, username: 'a', credential: 'b'}]})
        report[url] = 'accepted'
    } catch (error) {
        report[url] = String(error)
    }
}
try {
    const {SignalingConnection, PeerServiceProxy} = await import('/exports/Client.js')
    const {io} = await import('/socket.io.js')
    const join = async (id, room, iceTransportPolicy) => {
        const signaling = new SignalingConnection(io(${JSON.stringify(signalingURL)}, {auth: {id}, transports: ['websocket']}), {iceTransportPolicy})
        return await signaling.join(room)
    }
    const room = await join('safari', 'safari', 'all')
    const echoed = (joined) => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('no channel')), 20000)
        joined.on('peer', (peer) => peer.on('datachannel', (channel) => channel.addEventListener('message', (event) => {
            channel.send('echo: ' + event.data)
            resolve(String(event.data))
        })))
    })
    report.received = await echoed(room)
    const peer = await new Promise((resolve) => room.on('peer', (each) => each.id === 'device' && resolve(each)))
    const proxy = new PeerServiceProxy(peer.createDataChannel('service'))
    report.service = await proxy.invoke({method: 'greet', name: 'Safari'}, 20000)
    report.receivedOverRelay = await echoed(await join('safari-relay', 'safari-relay', 'relay'))
} catch (error) {
    report.error = String(error)
}
await new Promise((resolve) => setTimeout(resolve, 1000))
await fetch('/result', {method: 'POST', body: JSON.stringify(report)})
say(JSON.stringify(report, null, 1) + '\\n\\nDone: close this tab.')
</script>`

let finish
const finished = new Promise((resolve) => finish = resolve)
const files = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    try {
        if (pathname === '/') return void response.writeHead(200, {'content-type': 'text/html'}).end(page)
        if (pathname === '/result') {
            let body = ''
            for await (const chunk of request) body += chunk
            let report
            try {
                report = JSON.parse(body)
            } catch {
                report = {error: `The page reported ${body.slice(0, 200)}`}
            }
            response.writeHead(204).end()
            return void finish(report)
        }
        const file = pathname === '/socket.io.js' ? socketIOFile : path.join(root, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
        response.writeHead(200, {'content-type': 'text/javascript'}).end(await readFile(file))
    } catch {
        if (!response.headersSent) response.writeHead(404).end()
    }
})
await new Promise((resolve) => files.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${files.address().port}/`
console.log(`Opening ${url} in Safari`)
execFile('open', ['-a', 'Safari', url])
const timeout = setTimeout(() => finish({error: 'Safari did not report in 90 seconds'}), 90000)
const report = await finished
clearTimeout(timeout)
await new Promise((resolve) => setTimeout(resolve, 1500))
Object.assign(report, results)
console.log(JSON.stringify(report, null, 1))
const passed = !report.error && report.received === 'hello over all' && report['echo all'] === 'echo: hello over all'
    && report.service === 'hello Safari, safari' && report.receivedOverRelay === 'hello over relay' && report['echo relay'] === 'echo: hello over relay'
console.log(passed ? 'Safari: passed' : 'Safari: failed')
await device.destroy()
await container.destroy()
files.close()
process.exit(passed ? 0 : 1)
