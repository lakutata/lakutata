//The client of the end-to-end test in k3s: two members connected to two different pods of the signaling, relayed only
//through the TURN servers of the cluster, a data channel between them; the pod of the second one is deleted (run.sh
//does it when it reads the line DELETE), the first pod takes it out of the room, and the channel still carries the
//messages. The last line is RESULT ok, or RESULT failed with the reason.
import {promises as dns} from 'node:dns'
import {Container} from '@lakutata/core'
import {SignalingClient} from '@lakutata/webrtc'

/**
 * Wait for a condition, polling it
 */
async function until(condition, timeout, what) {
    const deadline = Date.now() + timeout
    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
}

/**
 * The state of a pod of the signaling: its rooms and the nodes of the cluster
 */
async function stateOf(address) {
    return await (await fetch(`http://${address}:8080/`)).json()
}

const clients = new Container()
try {
    const pods = (await dns.resolve4(process.env.SIGNALING_HOST)).sort()
    if (pods.length !== 2) throw new Error(`Two pods of the signaling expected, found ${pods.join(', ')}`)
    const [first, second] = pods
    //The cluster: two pods of the signaling, a TURN server on each node of k3s
    await until(async () => (await stateOf(first)).nodes.filter((node) => node.services.turn).length === 2, 60000, 'the TURN servers in the cluster')
    console.log('NODES', JSON.stringify((await stateOf(first)).nodes.map((node) => [node.id, node.services.turn?.address ?? null])))
    const alice = await clients.get(SignalingClient, {url: `http://${first}:3000`, id: 'alice', iceTransportPolicy: 'relay'})
    const bob = await clients.get(SignalingClient, {url: `http://${second}:3000`, id: 'bob', iceTransportPolicy: 'relay'})
    const aliceRoom = await alice.join('e2e')
    const bobRoom = await bob.join('e2e')
    const turnUrls = alice.iceServers.flatMap((server) => [server.urls].flat()).filter((url) => url.startsWith('turn:'))
    console.log('TURN', JSON.stringify(turnUrls))
    if (new Set(turnUrls.map((url) => url.split(':')[1])).size !== 2) throw new Error('The TURN servers of both nodes expected')
    //Alice echoes, Bob sends
    aliceRoom.on('peer', (peer) => {
        peer.on('datachannel', (channel) => channel.on('message', (data) => channel.send(`echo: ${data.toString()}`)))
    })
    const replies = []
    let channel
    bobRoom.on('peer', (peer) => {
        channel = peer.createDataChannel('chat')
        channel.on('message', (data) => replies.push(data.toString()))
        channel.on('open', () => channel.send('hello'))
    })
    await until(() => replies.includes('echo: hello'), 30000, 'the echo')
    console.log('ECHO', replies[0])
    //The pod of Bob deleted: Alice's pod takes Bob out of the room
    console.log(`DELETE ${second}`)
    await until(async () => JSON.stringify((await stateOf(first)).rooms.e2e) === JSON.stringify(['alice']), 60000, 'Bob out of the room')
    console.log('ROOM', JSON.stringify((await stateOf(first)).rooms))
    //The relayed connection does not need the signaling
    channel.send('again')
    await until(() => replies.includes('echo: again'), 10000, 'the echo after the pod went away')
    console.log('ECHO', 'echo: again')
    console.log('RESULT ok')
} catch (error) {
    console.log(`RESULT failed: ${error.message}`)
    process.exitCode = 1
} finally {
    await clients.destroy().catch(() => undefined)
    process.exit()
}
