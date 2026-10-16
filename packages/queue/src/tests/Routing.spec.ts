import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {
    Queue,
    QueueAction,
    QueueAmbiguousGroupException,
    QueueCapabilityException,
    queueEntrypoint,
    QueueInvalidMessageException,
    type QueueJobContext,
    type QueueMessage
} from '../exports/Queue.js'
import {RecordingDriver, sleep, until} from './support/RecordingDriver.js'

/**
 * A queue on a driver, in a container
 * @param driver The driver.
 * @param options The other options of the queue.
 */
async function queueOn(driver: RecordingDriver, options: Record<string, any> = {}): Promise<{container: Container, queue: Queue}> {
    const container: Container = new Container()
    const queue: Queue = await container.setNamed('queue', Queue, {driver: {type: 'custom', driver: driver}, ...options})
    return {container: container, queue: queue}
}

class OrderedController extends Controller {
    @QueueAction('orders.ordered', {ordered: true})
    public async ordered(): Promise<void> {
    }
}

describe('The groups', (): void => {

    it('delivers each message to every group, once to the consumers of a group', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        const received: Record<string, number[]> = {billing: [], mail: []}
        const consumer = (name: string) => async (input: Record<string, any>): Promise<void> => void received[name].push(input.n)
        await queue.consume('order.placed', consumer('billing'), {group: 'billing'})
        //Two instances of the group mail
        await queue.consume('order.placed', consumer('mail'), {group: 'mail'})
        await queue.consume('order.placed', consumer('mail'), {group: 'mail'})
        for (let n: number = 1; n <= 4; n++) await queue.add('order.placed', {n: n})
        await until((): boolean => received.billing.length === 4 && received.mail.length === 4)
        await sleep(20)
        assert.deepStrictEqual(received.billing.sort(), [1, 2, 3, 4])
        assert.deepStrictEqual(received.mail.sort(), [1, 2, 3, 4])
        await container.destroy()
    })

    it('needs the group of a request or a result when several groups consume the queue', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        await queue.consume('price.quote', async (): Promise<string> => 'from a', {group: 'a'})
        await queue.consume('price.quote', async (): Promise<string> => {
            await sleep(20)
            return 'from b'
        }, {group: 'b'})
        await assert.rejects(queue.request('price.quote', {}), QueueAmbiguousGroupException)
        //The reply of the group named, though the other replies first
        assert.strictEqual(await queue.request('price.quote', {}, {group: 'b'}), 'from b')
        const job = await queue.add('price.quote', {})
        await assert.rejects(job.result(), QueueAmbiguousGroupException)
        assert.strictEqual(await job.result({group: 'a'}), 'from a')
        assert.strictEqual(await job.result({group: 'b'}), 'from b')
        await container.destroy()
    })

    it('takes the group of the defaults, else the application id', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver(), {defaults: {group: 'workers'}})
        const groups: string[] = []
        await queue.consume('jobs', async (input: Record<string, any>, context: QueueJobContext): Promise<void> => void groups.push(context.group))
        await queue.add('jobs', {})
        await until((): boolean => groups.length === 1)
        assert.deepStrictEqual(groups, ['workers'])
        await container.destroy()
    })
})

describe('The options of the messages', (): void => {

    it('processes the messages of a key in their order, the keys at once', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        const order: Record<string, number[]> = {a: [], b: []}
        const running: Record<string, number> = {a: 0, b: 0}
        let overlapped: boolean = false
        let concurrent: number = 0
        let most: number = 0
        await queue.consume('account.events', async (input: Record<string, any>): Promise<void> => {
            if (++running[input.key] > 1) overlapped = true
            most = Math.max(most, ++concurrent)
            await sleep(5 + (input.n % 3) * 5)
            order[input.key].push(input.n)
            running[input.key]--
            concurrent--
        }, {ordered: true, concurrency: 4})
        for (let n: number = 1; n <= 6; n++) {
            await queue.add('account.events', {key: 'a', n: n}, {key: 'a'})
            await queue.add('account.events', {key: 'b', n: n}, {key: 'b'})
        }
        await until((): boolean => order.a.length === 6 && order.b.length === 6)
        assert.deepStrictEqual(order.a, [1, 2, 3, 4, 5, 6])
        assert.deepStrictEqual(order.b, [1, 2, 3, 4, 5, 6])
        assert.strictEqual(overlapped, false)
        assert.strictEqual(most, 2)
        await container.destroy()
    })

    it('drops a duplicate while the message of its id is kept', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        const received: number[] = []
        let release: () => void = (): void => undefined
        await queue.consume('invoice.send', async (input: Record<string, any>): Promise<void> => {
            received.push(input.n)
            if (input.n === 1) await new Promise<void>((resolve: () => void): void => {
                release = resolve
            })
        })
        assert.strictEqual((await queue.add('invoice.send', {n: 1}, {jobId: 'invoice-9', dedupe: true})).id, 'invoice-9')
        await until((): boolean => received.length === 1)
        //Being processed: still kept
        assert.strictEqual((await queue.add('invoice.send', {n: 2}, {jobId: 'invoice-9', dedupe: true})).id, 'invoice-9')
        release()
        await sleep(20)
        assert.deepStrictEqual(received, [1])
        //Acknowledged: no longer kept
        await queue.add('invoice.send', {n: 3}, {jobId: 'invoice-9', dedupe: true})
        await until((): boolean => received.length === 2)
        assert.deepStrictEqual(received, [1, 3])
        await container.destroy()
    })

    it('delivers the messages of a greater priority first, and the delayed ones later', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        await queue.add('tasks', {name: 'low'})
        await queue.add('tasks', {name: 'urgent'}, {priority: 10})
        await queue.add('tasks', {name: 'high'}, {priority: 5})
        const added: number = Date.now()
        await queue.add('tasks', {name: 'later'}, {delay: '60ms', priority: 99})
        const received: {name: string, at: number}[] = []
        await queue.consume('tasks', async (input: Record<string, any>): Promise<void> => void received.push({name: input.name, at: Date.now()}))
        await until((): boolean => received.length === 4)
        assert.deepStrictEqual(received.map((item): string => item.name), ['urgent', 'high', 'low', 'later'])
        assert.ok(received[3].at - added >= 55, `delivered after ${received[3].at - added} ms`)
        await container.destroy()
    })

    it('refuses the options the driver does not support', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver({capabilities: {priority: false, dedupe: false, delay: false, ordering: false}})
        const {container, queue} = await queueOn(driver)
        await assert.rejects(queue.add('tasks', {}, {priority: 1}), QueueCapabilityException)
        await assert.rejects(queue.add('tasks', {}, {dedupe: true}), QueueCapabilityException)
        await assert.rejects(queue.add('tasks', {}, {delay: '1s'}), QueueCapabilityException)
        await assert.rejects(queue.consume('tasks', async (): Promise<void> => undefined, {ordered: true}), QueueCapabilityException)
        //A key without ordering, a job id without dedupe: accepted
        await queue.add('tasks', {}, {key: 'k', jobId: 'j'})
        //An ordered action fails the start of the entrypoint
        await assert.rejects(container.set(Entrypoint, buildEntrypoints({controllers: [OrderedController], queue: queueEntrypoint('queue')})), QueueCapabilityException)
        await container.destroy()
    })
})

describe('The codecs and the leases', (): void => {

    it('encodes the messages with MessagePack by default, JSON when asked; a date arrives as its ISO string', async (): Promise<void> => {
        for (const codec of ['messagepack', 'json']) {
            const driver: RecordingDriver = new RecordingDriver()
            const {container, queue} = await queueOn(driver, {codec: codec})
            const received: Record<string, any>[] = []
            await queue.consume('events', async (input: Record<string, any>): Promise<void> => void received.push(input))
            const at: Date = new Date('2026-10-16T08:00:00.000Z')
            await queue.add('events', {at: at, tags: ['a'], none: undefined})
            await until((): boolean => received.length === 1)
            assert.deepStrictEqual(received[0], {at: '2026-10-16T08:00:00.000Z', tags: ['a']})
            //Not encodable: the message refused, the result sent to the dead letter queue at once
            await assert.rejects(queue.add('events', {big: 2n ** 70n}), QueueInvalidMessageException)
            const dead: Record<string, any>[] = []
            await queue.consume('bigint', async (): Promise<Record<string, any>> => ({big: 1n}), {onError: (): void => undefined})
            await queue.consume('bigint.dead', async (input: Record<string, any>): Promise<void> => void dead.push(input))
            await queue.add('bigint', {})
            await until((): boolean => dead.length === 1)
            assert.strictEqual(dead[0].attempts, 1)
            assert.match(dead[0].error.name, /QueueInvalidMessage/)
            const body: Uint8Array = (driver.sentTo('events')[0] as QueueMessage).body
            if (codec === 'json') assert.strictEqual(new TextDecoder().decode(body).startsWith('{'), true)
            else assert.notStrictEqual(body[0], '{'.charCodeAt(0))
            await container.destroy()
        }
    })

    it('extends the lease of a delivery while it is processed', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver({lease: 30})
        const {container, queue} = await queueOn(driver)
        let done: boolean = false
        await queue.consume('long', async (): Promise<void> => {
            await sleep(80)
            done = true
        })
        await queue.add('long', {})
        await until((): boolean => done)
        const extended: number = driver.extended
        assert.ok(extended >= 5, `extended ${extended} times`)
        await sleep(40)
        assert.strictEqual(driver.extended, extended)
        await container.destroy()
    })
})
