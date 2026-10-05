import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {setTimeout as sleep} from 'node:timers/promises'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint, httpServiceEntrypoint, scheduleEntrypoint, type ScheduleContext, type ServiceContext} from '@lakutata/entrypoint'
import {Schedule, ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {Mutex, Synchronized} from '../exports/Mutex.js'

class OrderDTO extends DTO {
    @Expect(DTO.Number().required())
    public id: number
}

const running: Map<number, number> = new Map()
let most: Record<string, number> = {}
let total: number = 0
let mostTotal: number = 0

class OrderController extends Controller {

    @ServiceAction({cmd: 'pay'}, OrderDTO)
    @Synchronized('order:{id}')
    public async pay(input: OrderDTO): Promise<number> {
        running.set(input.id, (running.get(input.id) ?? 0) + 1)
        most[input.id] = Math.max(most[input.id] ?? 0, running.get(input.id)!)
        mostTotal = Math.max(mostTotal, ++total)
        await sleep(100)
        running.set(input.id, running.get(input.id)! - 1)
        total--
        return input.id
    }

    @ServiceAction({cmd: 'reindex'})
    @Synchronized('search:reindex', {wait: false})
    public async reindex(): Promise<string> {
        await sleep(200)
        return 'reindexed'
    }

    @ServiceAction({cmd: 'export'})
    @Synchronized((_input: unknown, context: ServiceContext): string => `export:${context.clientId}`, {timeout: 0})
    public async export(): Promise<string> {
        await sleep(150)
        return 'exported'
    }

    @ServiceAction({cmd: 'missing'})
    @Synchronized('device:{deviceId}')
    public async missing(): Promise<void> {
        return
    }

    @ServiceAction({cmd: 'fail'}, OrderDTO)
    @Synchronized('order:{id}')
    public async fail(): Promise<void> {
        throw new Error('The payment failed')
    }
}

/**
 * An instance of an application: its locks, its HTTP service entrypoint
 */
async function Start(): Promise<{ url: string, container: Container, mutex: Mutex }> {
    let port: number = 0
    const container: Container = new Container()
    const mutex: Mutex = await container.setNamed('mutex', Mutex, {retryDelay: 10})
    await container.set(Entrypoint, buildEntrypoints({
        controllers: [OrderController],
        service: httpServiceEntrypoint({port: 0, host: '127.0.0.1', listening: (server): void => void (port = (server.address() as AddressInfo).port)})
    }))
    return {url: `http://127.0.0.1:${port}`, container: container, mutex: mutex}
}

async function Invoke(url: string, data: unknown, options: { id?: string, signal?: AbortSignal } = {}): Promise<any> {
    const response: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...options.id ? {id: options.id} : {}}, body: JSON.stringify(data), signal: options.signal})
    return await response.json()
}

describe('The synchronized actions', (): void => {

    it('runs the actions of a same lock one at a time, the other ones in parallel', async (): Promise<void> => {
        const {url, container} = await Start()
        try {
            most = {}
            mostTotal = 0
            const results = await Promise.all([1, 1, 1, 2, 2, 2].map((id: number): Promise<any> => Invoke(url, {cmd: 'pay', id: id})))
            assert.deepStrictEqual(results.map((result: any): number => result.payload), [1, 1, 1, 2, 2, 2])
            assert.deepStrictEqual(most, {1: 1, 2: 1})
            assert.strictEqual(mostTotal, 2)
        } finally {
            await container.destroy()
        }
    })

    it('locks once the input is validated, fails at once when it does not wait', async (): Promise<void> => {
        const {url, container, mutex} = await Start()
        try {
            const first: Promise<any> = Invoke(url, {cmd: 'reindex'})
            await sleep(50)
            const second = await Invoke(url, {cmd: 'reindex'})
            assert.strictEqual(second.error.errno, 'E_MUTEX_TIMEOUT')
            assert.strictEqual(second.error.statusCode, 409)
            assert.strictEqual((await first).payload, 'reindexed')
            //An input refused before the lock: its validation error, the lock of the order not held
            const holding: Promise<any> = Invoke(url, {cmd: 'pay', id: 7})
            await sleep(20)
            assert.strictEqual((await Invoke(url, {cmd: 'pay', id: 'x'})).error.errno, 'E_INVALID_VALUE')
            await holding
            //A lock of the context (its client)
            const exporting: Promise<any> = Invoke(url, {cmd: 'export'}, {id: 'desk'})
            await sleep(30)
            assert.strictEqual((await Invoke(url, {cmd: 'export'}, {id: 'desk'})).error.errno, 'E_MUTEX_TIMEOUT')
            assert.strictEqual((await Invoke(url, {cmd: 'export'}, {id: 'phone'})).payload, 'exported')
            await exporting
            //A field of the template missing
            assert.match((await Invoke(url, {cmd: 'missing'})).error.message, /needs the field deviceId/)
            //Released after an error
            assert.strictEqual((await Invoke(url, {cmd: 'fail', id: 3})).error.message, 'The payment failed')
            assert.strictEqual((await Invoke(url, {cmd: 'pay', id: 3})).payload, 3)
            assert.strictEqual(mutex.heldLocks.length, 0)
        } finally {
            await container.destroy()
        }
    })

    it('stops waiting for the lock once its client is gone', async (): Promise<void> => {
        const {url, container, mutex} = await Start()
        try {
            const holding: Promise<any> = Invoke(url, {cmd: 'pay', id: 9})
            await sleep(20)
            const abort: AbortController = new AbortController()
            const waiting: Promise<unknown> = Invoke(url, {cmd: 'pay', id: 9}, {signal: abort.signal}).catch((): undefined => undefined)
            await sleep(20)
            abort.abort()
            await waiting
            await holding
            //The request gone does not take the lock once it is released
            await sleep(100)
            assert.strictEqual(mutex.heldLocks.length, 0)
        } finally {
            await container.destroy()
        }
    })
})

const exclusiveRuns: number[] = []

class ReportController extends Controller {

    @Schedule({every: 100, exclusive: true})
    public async report(): Promise<void> {
        exclusiveRuns.push((this.context as ScheduleContext).scheduledAt.getTime())
        await sleep(10)
    }
}

describe('The exclusive schedules', (): void => {

    it('runs each run of a schedule in one instance with the locks of the component', async (): Promise<void> => {
        const instances: Container[] = []
        try {
            for (let index = 0; index < 3; index++) {
                const container: Container = new Container()
                await container.setNamed('mutex', Mutex, {driver: {type: 'memory'}})
                await container.set(Entrypoint, buildEntrypoints({controllers: [ReportController], schedule: scheduleEntrypoint()}))
                instances.push(container)
            }
            await sleep(750)
        } finally {
            for (const container of instances) await container.destroy()
        }
        assert.ok(exclusiveRuns.length >= 5, `${exclusiveRuns.length} runs`)
        assert.strictEqual(new Set(exclusiveRuns).size, exclusiveRuns.length, exclusiveRuns.join())
    })
})
