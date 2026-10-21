import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {Container} from '@lakutata/core'
import {Cluster, type ClusterNode, type ClusterOptions, type ClusterReply} from '../cluster/Cluster.js'
import {FrameAssembler, framesOf} from '../cluster/ClusterFrames.js'
import {MemoryClusterTransport} from '../cluster/transports/MemoryClusterTransport.js'
import {ClusterRequestException} from '../exceptions/ClusterRequestException.js'
import {ClusterTimeoutException} from '../exceptions/ClusterTimeoutException.js'
import {ClusterTransportNotFoundException} from '../exceptions/ClusterTransportNotFoundException.js'
import {next, until} from './support/Server.js'

/**
 * A node of a cluster in the memory of the process, in its own container
 * @param prefix
 * @param options
 */
async function startNode(prefix: string, options: Partial<ClusterOptions> = {}): Promise<{cluster: Cluster, container: Container}> {
    const container: Container = new Container()
    const cluster: Cluster = await container.setNamed<Cluster>('cluster', Cluster, {transport: {type: 'memory'}, prefix: prefix, heartbeatInterval: 100, ...options})
    return {cluster: cluster, container: container}
}

/**
 * Nodes started one after the other: the options of a registration are kept on its class under its name, shared by the
 * containers of the process, so an object must be created before the next container registers its class
 * @param prefix
 * @param ids
 */
async function startNodes(prefix: string, ids: string[]): Promise<{cluster: Cluster, container: Container}[]> {
    const nodes: {cluster: Cluster, container: Container}[] = []
    for (const id of ids) nodes.push(await startNode(prefix, {nodeId: id}))
    return nodes
}

/**
 * The ids of the nodes a cluster knows
 * @param cluster
 */
function idsOf(cluster: Cluster): string[] {
    return cluster.nodes().map((node: ClusterNode): string => node.id)
}

describe('Cluster', (): void => {

    it('finds the other nodes, sees their labels and services, and sees them leave', async (): Promise<void> => {
        const prefix: string = `test-${randomUUID()}`
        const a = await startNode(prefix, {nodeId: 'node-a', labels: {zone: 'east'}})
        const b = await startNode(prefix, {nodeId: 'node-b'})
        try {
            await until((): boolean => idsOf(a.cluster).length === 2 && idsOf(b.cluster).length === 2, 5000, 'the nodes')
            assert.deepStrictEqual(idsOf(a.cluster), ['node-a', 'node-b'])
            assert.deepStrictEqual(a.cluster.nodes()[0], {id: 'node-a', labels: {zone: 'east'}, services: {}, local: true})
            assert.deepStrictEqual(b.cluster.nodes().find((node: ClusterNode): boolean => node.id === 'node-a'), {id: 'node-a', labels: {zone: 'east'}, services: {}, local: false})
            //A new service at once, a change with the next heartbeat
            const added: Promise<ClusterNode> = next<ClusterNode>((resolve: (node: ClusterNode) => void): unknown => b.cluster.once('node-update', resolve), 5000, 'the service')
            a.cluster.announce('turn', {allocations: 0})
            assert.deepStrictEqual((await added).services, {turn: {allocations: 0}})
            const changed: Promise<ClusterNode> = next<ClusterNode>((resolve: (node: ClusterNode) => void): unknown => b.cluster.once('node-update', resolve), 5000, 'the change')
            a.cluster.announce('turn', {allocations: 3})
            assert.deepStrictEqual((await changed).services, {turn: {allocations: 3}})
            //A node stopping is gone at once
            const down: Promise<ClusterNode> = next<ClusterNode>((resolve: (node: ClusterNode) => void): unknown => b.cluster.once('node-down', resolve), 1000, 'node-down')
            const stoppedAt: number = Date.now()
            await a.container.destroy()
            assert.strictEqual((await down).id, 'node-a')
            assert.ok(Date.now() - stoppedAt < 250)
            assert.deepStrictEqual(idsOf(b.cluster), ['node-b'])
        } finally {
            await a.container.destroy()
            await b.container.destroy()
        }
    })

    it('takes a node as gone after three intervals without its heartbeats, and a restarted node as new', async (): Promise<void> => {
        const prefix: string = `test-${randomUUID()}`
        const observer = await startNode(prefix, {nodeId: 'observer'})
        //A node whose process stops without a word: its heartbeats sent by hand
        const bus: MemoryClusterTransport = new MemoryClusterTransport()
        await bus.connect()
        const heartbeat = (incarnation: string): void => {
            for (const frame of framesOf(Buffer.from(JSON.stringify({k: 'hb', n: 'silent', i: incarnation, iv: 100, l: {}, s: {}})), bus.maxPayload)) bus.publish(`${prefix}.all`, frame)
        }
        try {
            const up: Promise<ClusterNode> = next<ClusterNode>((resolve: (node: ClusterNode) => void): unknown => observer.cluster.once('node-up', resolve), 1000, 'node-up')
            heartbeat('first')
            assert.strictEqual((await up).id, 'silent')
            const downAt: Promise<number> = next<number>((resolve: (at: number) => void): unknown => observer.cluster.once('node-down', (): void => resolve(Date.now())), 2000, 'node-down')
            const silentFrom: number = Date.now()
            const elapsed: number = await downAt - silentFrom
            assert.ok(elapsed >= 300 && elapsed < 1000, `gone after ${elapsed} ms`)
            //The same id with another incarnation: the node it was is gone, the new one is up
            heartbeat('second')
            await until((): boolean => idsOf(observer.cluster).includes('silent'), 1000, 'the node back')
            const events: string[] = []
            observer.cluster.on('node-down', (): number => events.push('down'))
            observer.cluster.on('node-up', (): number => events.push('up'))
            heartbeat('third')
            await until((): boolean => events.length === 2, 1000, 'the restart')
            assert.deepStrictEqual(events, ['down', 'up'])
        } finally {
            await bus.close()
            await observer.container.destroy()
        }
    })

    it('sends the messages of a topic to the other nodes', async (): Promise<void> => {
        const prefix: string = `test-${randomUUID()}`
        const nodes = await startNodes(prefix, ['a', 'b', 'c'])
        try {
            await until((): boolean => nodes.every(({cluster}): boolean => idsOf(cluster).length === 3), 5000, 'the nodes')
            const received: string[] = []
            for (const {cluster} of nodes) cluster.subscribe<{text: string}>('news', (message: {text: string}, from: string): number => received.push(`${cluster.nodeId}<${from}:${message.text}`))
            const unsubscribe: () => void = nodes[2].cluster.subscribe('news', (): void => {
                throw new Error('A listener failing')
            })
            nodes[0].cluster.publish('news', {text: 'hello'})
            await until((): boolean => received.length === 2, 2000, 'the messages')
            assert.deepStrictEqual(received.sort(), ['b<a:hello', 'c<a:hello'])
            unsubscribe()
            //Another prefix is another cluster
            const other = await startNode(`test-${randomUUID()}`, {nodeId: 'other'})
            other.cluster.subscribe('news', (): number => received.push('other'))
            nodes[1].cluster.publish('news', {text: 'again'})
            await until((): boolean => received.length === 4, 2000, 'the messages')
            assert.ok(!received.includes('other'))
            assert.deepStrictEqual(idsOf(other.cluster), ['other'])
            await other.container.destroy()
        } finally {
            await Promise.all(nodes.map(({container}): Promise<void> => container.destroy()))
        }
    })

    it('answers the requests to one node and to all of them', async (): Promise<void> => {
        const prefix: string = `test-${randomUUID()}`
        const nodes = await startNodes(prefix, ['a', 'b', 'c'])
        const [a, b, c] = nodes.map(({cluster}): Cluster => cluster)
        try {
            await until((): boolean => nodes.every(({cluster}): boolean => idsOf(cluster).length === 3), 5000, 'the nodes')
            b.handle<{n: number}, number>('double', ({n}: {n: number}, from: string): number => {
                assert.strictEqual(from, 'a')
                return n * 2
            })
            c.handle<{n: number}, number>('double', async ({n}: {n: number}): Promise<number> => n * 3)
            b.handle('fail', (): never => {
                throw new Error('No luck')
            })
            a.handle<{n: number}, number>('double', ({n}: {n: number}): number => n)
            assert.strictEqual(await a.request<number>('b', 'double', {n: 21}), 42)
            //This node itself
            assert.strictEqual(await a.request<number>('a', 'double', {n: 5}), 5)
            await assert.rejects(a.request('b', 'fail', {}), (error: Error): boolean => error instanceof ClusterRequestException && /No luck/.test(error.message))
            await assert.rejects(a.request('b', 'unknown', {}), (error: Error): boolean => error instanceof ClusterRequestException && /no handler/.test(error.message))
            await assert.rejects(a.request('nobody', 'double', {}), (error: Error): boolean => error instanceof ClusterRequestException && /not in the cluster/.test(error.message))
            b.handle('slow', (): Promise<void> => new Promise((resolve: () => void): unknown => setTimeout(resolve, 1000)))
            await assert.rejects(a.request('b', 'slow', {}, {timeout: 100}), ClusterTimeoutException)
            //All the other nodes: the answers of their handlers
            const replies: ClusterReply<number>[] = await a.requestAll<number>('double', {n: 10})
            assert.deepStrictEqual(replies.sort((x: ClusterReply<number>, y: ClusterReply<number>): number => x.node.localeCompare(y.node)), [{node: 'b', result: 20}, {node: 'c', result: 30}])
            //No handler, a failure: no answer; the time up: the answers so far
            assert.deepStrictEqual(await a.requestAll('fail', {}), [])
            c.handle('slow', (): string => 'quick')
            const startedAt: number = Date.now()
            assert.deepStrictEqual(await a.requestAll('slow', {}, {timeout: 300}), [{node: 'c', result: 'quick'}])
            assert.ok(Date.now() - startedAt >= 280)
            //A node leaving while it is awaited
            b.handle('stall', (): Promise<void> => new Promise((): void => undefined))
            c.handle('stall', (): string => 'here')
            const pending: Promise<ClusterReply[]> = a.requestAll('stall', {}, {timeout: 5000})
            const single: Promise<unknown> = a.request('b', 'stall', {}, {timeout: 5000})
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
            await nodes[1].container.destroy()
            assert.deepStrictEqual(await pending, [{node: 'c', result: 'here'}])
            await assert.rejects(single, (error: Error): boolean => error instanceof ClusterRequestException && /left the cluster/.test(error.message))
        } finally {
            await Promise.all(nodes.map(({container}): Promise<void> => container.destroy()))
        }
    })

    it('sends the messages larger than the transport carries in parts', (): void => {
        const assembler: FrameAssembler = new FrameAssembler()
        const large: Buffer = Buffer.alloc(10000, 7)
        large.write('the end', 9993)
        //1000 bytes of the message in each part, after its header of 25
        const frames: Buffer[] = framesOf(large, 1025)
        assert.strictEqual(frames.length, 10)
        assert.ok(frames.every((frame: Buffer): boolean => frame.length <= 1025))
        //A whole message between the parts of another
        const small: Buffer[] = framesOf(Buffer.from('small'), 1024)
        assert.strictEqual(small.length, 1)
        const results: (Buffer | undefined)[] = [...frames.slice(0, 5), small[0], ...frames.slice(5)].map((frame: Buffer): Buffer | undefined => assembler.add(frame))
        assert.deepStrictEqual(results.filter((result: Buffer | undefined): boolean => !!result).map((result: Buffer | undefined): string => result!.length === 5 ? result!.toString() : 'large'), ['small', 'large'])
        assert.ok(results[10]!.equals(large))
        //A part repeated, a part of a message whose start is lost, a frame of another kind: dropped
        assert.strictEqual(assembler.add(frames[3]), undefined)
        assert.strictEqual(assembler.add(Buffer.from([9, 1, 2])), undefined)
        const expired: FrameAssembler = new FrameAssembler(0)
        expired.add(frames[0])
        assert.strictEqual(expired.add(frames[1]), undefined)
    })

    it('fails to start without the client package of its transport, or without a transport', async (): Promise<void> => {
        //The packages are installed in the repository: the error of a missing one is checked through its message
        const container: Container = new Container()
        try {
            await assert.rejects(container.setNamed('cluster', Cluster, {}), /transport/)
            await assert.rejects(container.setNamed('cluster', Cluster, {transport: {type: 'kafka'}}), /transport/)
        } finally {
            await container.destroy()
        }
        const exception: ClusterTransportNotFoundException = new ClusterTransportNotFoundException('Package "{packageName}" is required', {packageName: 'nats'})
        assert.strictEqual(exception.errno, 'E_CLUSTER_TRANSPORT_NOT_FOUND')
    })
})
