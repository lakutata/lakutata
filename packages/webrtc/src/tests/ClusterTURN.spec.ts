import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {Container, InvalidValueException} from '@lakutata/core'
import {Cluster, type ClusterNode, type ClusterOptions} from '../cluster/Cluster.js'
import {type ClusterTURNServer, leastLoadedTURN} from '../cluster/ClusterTURN.js'
import type {SignalingIceServer} from '../protocol/SignalingProtocol.js'
import {MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import {TURNServer} from '../turn/TURNServer.js'
import type {WHIPSession} from '../whip/WHIP.js'
import {next, startServer, startWHIP, type TestServer, until} from './support/Server.js'

/**
 * The options of a node of a cluster in the memory of the process
 * @param prefix
 * @param nodeId
 * @param labels
 */
function nodeOptions(prefix: string, nodeId: string, labels: Record<string, string> = {}): ClusterOptions {
    return {transport: {type: 'memory'}, prefix: prefix, nodeId: nodeId, labels: labels, heartbeatInterval: 100}
}

/**
 * The TURN URLs of some ICE servers
 * @param iceServers
 */
function turnUrlsOf(iceServers: SignalingIceServer[]): string[] {
    return iceServers.flatMap((server: SignalingIceServer): string[] => [server.urls].flat()).filter((url: string): boolean => url.startsWith('turn:'))
}

/**
 * A TURN server of the cluster, for the selection
 * @param node
 * @param allocations
 * @param maxAllocations
 */
function turnServer(node: string, allocations: number, maxAllocations?: number): ClusterTURNServer {
    return {node: node, labels: {}, address: '127.0.0.1', port: 3478, udp: true, tcp: false, allocations: allocations, maxAllocations: maxAllocations, credentialTtl: 3600}
}

describe('TURN and WHIP in a cluster', (): void => {

    it('gives the members the TURN servers of the cluster, which relay their connections', {timeout: 60000}, async (): Promise<void> => {
        const prefix: string = `test-${randomUUID()}`
        //Two nodes with a TURN server, one without
        const a: TestServer = await startServer({cluster: nodeOptions(prefix, 'a', {zone: 'east'}), turn: {secret: 'shared', cluster: 'cluster'}})
        const b: TestServer = await startServer({cluster: nodeOptions(prefix, 'b', {zone: 'west'}), turn: {secret: 'shared', cluster: 'cluster', credentialTtl: 600}})
        const c: TestServer = await startServer({cluster: nodeOptions(prefix, 'c'), signaling: {turnSecret: 'shared'}})
        const clients: Container = new Container()
        try {
            await until((): boolean => c.cluster!.nodes().filter((node: ClusterNode): boolean => !!node.services.turn).length === 2, 5000, 'the TURN servers')
            const turnA: string = `turn:127.0.0.1:${a.turn!.location.port}?transport=udp`
            const turnB: string = `turn:127.0.0.1:${b.turn!.location.port}?transport=udp`
            //The node without a TURN server gives both, with credentials of the shared secret valid as long as the shorter
            const {iceServers, credentialTtl} = await c.signaling.iceServersOf('alice')
            assert.deepStrictEqual(turnUrlsOf(iceServers).sort(), [turnA, turnB].sort())
            assert.strictEqual(credentialTtl, 600)
            assert.ok(iceServers.every((server: SignalingIceServer): boolean => !server.username || server.username.endsWith(':alice')))
            //A node with a TURN server gives its own first, then the other one
            assert.deepStrictEqual(turnUrlsOf((await a.signaling.iceServersOf('bob')).iceServers), [turnA, turnB])
            //Their load is told
            assert.deepStrictEqual(Object.keys(a.cluster!.nodes().find((node: ClusterNode): boolean => node.id === 'b')!.services.turn as object).sort(), ['address', 'allocations', 'credentialTtl', 'port', 'tcp', 'udp'])
            //Two members of different nodes, relayed only
            const alice: SignalingClient = await clients.get(SignalingClient, {url: c.socketIO, id: 'alice', iceTransportPolicy: 'relay'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: a.jsonRPC, id: 'bob', iceTransportPolicy: 'relay'})
            const first: Room = await alice.join('relayed')
            const second: Room = await bob.join('relayed')
            first.on('peer', (peer: Peer): void => {
                peer.on('datachannel', (channel: PeerChannel): void => {
                    channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(`echo: ${data.toString()}`))
                })
            })
            const echo: string = await next<string>((resolve: (value: string) => void): void => {
                second.on('peer', (peer: Peer): void => {
                    const channel: PeerChannel = peer.createDataChannel('chat')
                    channel.on('open', (): void => channel.send('hello'))
                    channel.on('message', (data: string | Buffer | ArrayBuffer): void => resolve(data.toString()))
                })
            }, 20000, 'the echo')
            assert.strictEqual(echo, 'echo: hello')
            assert.ok(a.turn!.allocations + b.turn!.allocations >= 2)
            await until((): boolean => {
                const told: unknown = c.cluster!.nodes().find((node: ClusterNode): boolean => node.id === 'a')?.services.turn
                return (told as {allocations: number}).allocations === a.turn!.allocations
            }, 5000, 'the load told')
        } finally {
            await clients.destroy()
            for (const server of [a, b, c]) await server.stop()
        }
    })

    it('chooses the least loaded TURN servers, or as the application decides', async (): Promise<void> => {
        const chosen: ClusterTURNServer[] = leastLoadedTURN([turnServer('busy', 5), turnServer('idle', 0), turnServer('full', 10, 10), turnServer('half', 5, 10), turnServer('some', 3)])
        assert.deepStrictEqual(chosen.map((server: ClusterTURNServer): string => server.node), ['idle', 'half'])
        assert.deepStrictEqual(leastLoadedTURN([turnServer('full', 1, 1)]), [])
        //The equally loaded in turns
        const firsts: Set<string> = new Set(Array.from({length: 50}, (): string => leastLoadedTURN([turnServer('x', 0), turnServer('y', 0), turnServer('z', 0)])[0].node))
        assert.strictEqual(firsts.size, 3)
        const prefix: string = `test-${randomUUID()}`
        const east: TestServer = await startServer({cluster: nodeOptions(prefix, 'east', {zone: 'east'}), turn: {secret: 'shared', cluster: 'cluster'}})
        const west: TestServer = await startServer({cluster: nodeOptions(prefix, 'west', {zone: 'west'}), turn: {secret: 'shared', cluster: 'cluster'}})
        const signaling: TestServer = await startServer({
            cluster: nodeOptions(prefix, 'signaling'),
            signaling: {
                turnSecret: 'shared',
                selectTURN: (servers: ClusterTURNServer[], user: string): ClusterTURNServer[] => servers.filter((server: ClusterTURNServer): boolean => server.labels.zone === (user.startsWith('tokyo') ? 'east' : 'west'))
            }
        })
        try {
            await until((): boolean => signaling.cluster!.nodes().filter((node: ClusterNode): boolean => !!node.services.turn).length === 2, 5000, 'the TURN servers')
            assert.deepStrictEqual(turnUrlsOf((await signaling.signaling.iceServersOf('tokyo-1')).iceServers), [`turn:127.0.0.1:${east.turn!.location.port}?transport=udp`])
            assert.deepStrictEqual(turnUrlsOf((await signaling.signaling.iceServersOf('paris-1')).iceServers), [`turn:127.0.0.1:${west.turn!.location.port}?transport=udp`])
        } finally {
            for (const server of [east, west, signaling]) await server.stop()
        }
        //A TURN server of a cluster needs the shared secret
        const container: Container = new Container()
        try {
            await container.setNamed<Cluster>('cluster', Cluster, nodeOptions(`test-${randomUUID()}`, 'lonely'))
            await assert.rejects(container.setNamed<TURNServer>('turn', TURNServer, {host: '127.0.0.1', port: 0, cluster: 'cluster'}), InvalidValueException)
        } finally {
            await container.destroy()
        }
    })

    it('ends a WHIP session through any node of the cluster', {timeout: 60000}, async (): Promise<void> => {
        const prefix: string = `test-${randomUUID()}`
        const a = await startWHIP('express', {}, nodeOptions(prefix, 'a'))
        const b = await startWHIP('fastify', {}, nodeOptions(prefix, 'b'))
        const clients: Container = new Container()
        try {
            const clusterOf = async (container: Container): Promise<Cluster> => await container.get<Cluster>('cluster')
            const [clusterA, clusterB] = [await clusterOf(a.container), await clusterOf(b.container)]
            await until((): boolean => clusterA.nodes().length === 2 && clusterB.nodes().length === 2, 5000, 'the nodes')
            //Two sessions published through the node a
            const publish = async (stream: string): Promise<string> => {
                const connection: PeerConnection = await clients.get(PeerConnection, {iceAdditionalHostAddresses: ['127.0.0.1']})
                connection.addTransceiver(new MediaTrack('audio', {codec: 'audio/opus'}), {direction: 'sendonly'})
                await connection.setLocalDescription()
                await until((): boolean => connection.iceGatheringState === 'complete', 10000, 'the candidates')
                const response: Response = await fetch(`${a.url}/whip/${stream}`, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: connection.localDescription!.sdp})
                assert.strictEqual(response.status, 201)
                return response.headers.get('location')!
            }
            const studio: string = await publish('studio')
            const backstage: string = await publish('backstage')
            assert.strictEqual(a.whip.sessions.length, 2)
            //Its DELETE reaching the node b: ended on the node a
            const unpublished: Promise<WHIPSession> = next<WHIPSession>((resolve: (session: WHIPSession) => void): unknown => a.whip.once('unpublish', resolve), 5000, 'unpublish')
            assert.strictEqual((await fetch(`${b.url}${studio}`, {method: 'DELETE'})).status, 200)
            assert.strictEqual((await unpublished).stream, 'studio')
            assert.deepStrictEqual(a.whip.sessions.map((session: WHIPSession): string => session.stream), ['backstage'])
            //Ended already, of another stream, unknown: not found
            assert.strictEqual((await fetch(`${b.url}${studio}`, {method: 'DELETE'})).status, 404)
            assert.strictEqual((await fetch(`${b.url}${backstage.replace('backstage', 'studio')}`, {method: 'DELETE'})).status, 404)
            assert.strictEqual((await fetch(`${b.url}/whip/studio/unknown`, {method: 'DELETE'})).status, 404)
            assert.strictEqual(a.whip.sessions.length, 1)
            assert.strictEqual((await fetch(`${a.url}${backstage}`, {method: 'DELETE'})).status, 200)
            assert.deepStrictEqual(a.whip.sessions, [])
        } finally {
            await clients.destroy()
            await a.container.destroy()
            await b.container.destroy()
        }
    })
})
