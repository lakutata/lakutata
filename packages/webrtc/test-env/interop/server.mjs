//The side of this package in the interop tests (test-env/interop/run.sh): a signaling server (JSON-RPC over WebSocket
//on port 3001), a TURN server (port 3478), and the member `node` of the room `interop`. For each other member, the
//member opens a data channel `echo`, sends `hello <member>`, waits for `echo: hello <member>` and answers `bye`; it
//also serves its service actions over the channels `service` the members create (webrtcServiceEntrypoint). It prints
//a line per member, and exits with 0 once every member of --expect echoed (and called the service, for those of
//--service), 1 after --timeout seconds.
//   node test-env/interop/server.mjs --expect pion,aiortc --service aiortc [--relay] [--timeout 90]
import {networkInterfaces} from 'node:os'
import {parseArgs} from 'node:util'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {jsonRPCServiceEntrypoint} from '@lakutata/entrypoint/adapter/jsonrpc'
const {Signaling, SignalingClient, SignalingController, TURNServer, webrtcRequestOfContext, webrtcServiceEntrypoint} = await import('../../dist/esm/exports/WebRTC.js')

const {values: options} = parseArgs({
    options: {
        expect: {type: 'string', default: ''},
        service: {type: 'string', default: ''},
        relay: {type: 'boolean', default: false},
        timeout: {type: 'string', default: '90'}
    }
})
const expected = options.expect.split(',').filter(Boolean)
const calling = options.service.split(',').filter(Boolean)
const echoed = new Set()
const called = new Map()

/**
 * The service action the members call: it echoes the text, with the member that called
 */
class InteropController extends Controller {
    async echo(input) {
        const caller = webrtcRequestOfContext(this.context)?.peer.id
        called.set(caller, input.text)
        console.log(JSON.stringify({member: caller, called: input.text}))
        check()
        return {text: input.text, caller: caller}
    }
}
//The decorator, applied as TypeScript applies it
Object.defineProperty(InteropController.prototype, 'echo', ServiceAction({method: 'interop.echo'})(InteropController.prototype, 'echo', Object.getOwnPropertyDescriptor(InteropController.prototype, 'echo')))

/**
 * Exit once every member did what it should
 */
function check() {
    if (expected.every(member => echoed.has(member)) && calling.every(member => called.has(member))) finish(0)
}

let container
let finished = false
//The member's client, which the service adapter uses too (two clients with one id would replace each other)
let provideMember
const memberClient = new Promise(resolve => provideMember = resolve)

/**
 * Stop the servers and exit
 * @param code
 */
async function finish(code) {
    if (finished) return
    finished = true
    if (code) console.log(JSON.stringify({missing: {echo: expected.filter(member => !echoed.has(member)), service: calling.filter(member => !called.has(member))}}))
    //The members see the bye before the room closes
    await new Promise(resolve => setTimeout(resolve, 1000))
    await container?.destroy()
    process.exit(code)
}

setTimeout(() => void finish(1), Number(options.timeout) * 1000).unref()
//The address of the container on its network: the address of the TURN server
const address = Object.values(networkInterfaces()).flat().find(info => info.family === 'IPv4' && !info.internal).address
container = new Container()
const turn = await container.setNamed('turn', TURNServer, {host: '0.0.0.0', port: 3478, publicAddress: address, tcp: false})
await container.setNamed('signaling', Signaling, {turn: 'turn'})
await container.setNamed('entrypoint', Entrypoint, buildEntrypoints({
    controllers: [SignalingController, InteropController],
    service: [
        jsonRPCServiceEntrypoint({transport: 'websocket', port: 3001, host: '0.0.0.0'}),
        webrtcServiceEntrypoint({client: () => memberClient, rooms: ['interop']})
    ]
}))
//The member echoing with the others
const member = await container.get(SignalingClient, {url: 'ws://127.0.0.1:3001/', id: 'node', iceTransportPolicy: options.relay ? 'relay' : 'all'})
provideMember(member)
console.log(JSON.stringify({ready: `ws://${address}:3001/`, turn: `${address}:3478`, relay: options.relay}))
const room = await member.join('interop')
room.on('peer', peer => {
    const channel = peer.createDataChannel('echo')
    channel.on('open', () => channel.send(`hello ${peer.id}`))
    channel.on('message', data => {
        if (String(data) !== `echo: hello ${peer.id}`) return console.log(JSON.stringify({member: peer.id, unexpected: String(data)}))
        echoed.add(peer.id)
        console.log(JSON.stringify({member: peer.id, echoed: true, turnAllocations: turn.allocations}))
        channel.send('bye')
        check()
    })
    peer.on('connectionstatechange', state => console.log(JSON.stringify({member: peer.id, state: state})))
})
