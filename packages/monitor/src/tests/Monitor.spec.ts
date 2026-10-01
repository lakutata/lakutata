import {describe, it} from 'node:test'
import assert from 'node:assert'
import http, {type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Container} from '@lakutata/core'
import {CpuMonitor, EventLoopMonitor, HttpRequestMonitor, MemoryMonitor} from '../exports/Monitor.js'
import {Samples} from '../monitor/lib/Samples.js'

/**
 * Wait
 * @param ms
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, ms))
}

/**
 * Keep the CPU busy
 * @param ms
 */
function busy(ms: number): void {
    const end: number = Date.now() + ms
    while (Date.now() < end) Math.sqrt(Math.random())
}

describe('The monitors', (): void => {

    it('compute the statistics of the samples in a constant memory', (): void => {
        const samples: Samples = new Samples(100)
        assert.deepStrictEqual([samples.count, samples.latest, samples.min, samples.max, samples.mean, samples.stdDev, samples.percentile(99)], [0, 0, 0, 0, 0, 0, 0])
        for (let value: number = 0; value <= 1000; value++) samples.record(value / 10)
        assert.strictEqual(samples.count, 1001)
        assert.strictEqual(samples.latest, 100)
        assert.strictEqual(samples.min, 0)
        assert.strictEqual(samples.max, 100)
        assert.ok(Math.abs(samples.mean - 50) < 1e-9)
        assert.ok(Math.abs(samples.stdDev - 28.89) < 0.01)
        //The percentiles have 3 significant digits
        assert.ok(Math.abs(samples.percentile(50) - 50) <= 0.1)
        assert.ok(Math.abs(samples.percentile(99) - 99) <= 0.1)
        assert.strictEqual(samples.percentile(100), 100)
        samples.record(-1)
        assert.strictEqual(samples.latest, 0)
        samples.reset()
        assert.deepStrictEqual([samples.count, samples.max, samples.percentile(50)], [0, 0, 0])
    })

    it('sample the CPU usage over the whole time', async (): Promise<void> => {
        const container: Container = new Container()
        const monitor: CpuMonitor = await container.set(CpuMonitor)
        //No sample before the first second
        assert.strictEqual(monitor.statistics.usageMax, 0)
        busy(1500)
        await sleep(600)
        const statistics = monitor.statistics
        assert.ok(statistics.usageMax > 50, `usage max ${statistics.usageMax}`)
        assert.ok(statistics.usageMin <= statistics.usageP50 && statistics.usageP50 <= statistics.usageMax)
        monitor.reset()
        assert.strictEqual(monitor.statistics.usageMax, 0)
        await container.destroy()
    })

    it('sample the memory when created', async (): Promise<void> => {
        const container: Container = new Container()
        const monitor: MemoryMonitor = await container.set(MemoryMonitor)
        const statistics = monitor.statistics
        assert.ok(statistics.physicalUsed > 0 && statistics.physicalUsedMin === statistics.physicalUsed)
        assert.ok(statistics.heapUsed > 0 && statistics.heapUsedMax === statistics.heapUsed)
        assert.ok(statistics.physicalUsage > 0 && statistics.physicalUsage < 100)
        assert.ok(statistics.heapUsedP99 >= statistics.heapUsedMin && statistics.heapUsedP99 <= statistics.heapUsedMax)
        await container.destroy()
    })

    it('count every HTTP request received, not the requests sent', async (): Promise<void> => {
        const container: Container = new Container()
        const monitor: HttpRequestMonitor = await container.set(HttpRequestMonitor)
        const server: Server = http.createServer((_request, response): unknown => setTimeout((): unknown => response.end('ok'), 5))
        await new Promise((resolve: (value: unknown) => void): unknown => server.listen(0, '127.0.0.1', (): void => resolve(undefined)))
        const url: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        try {
            //Concurrent requests, observed in batches
            await Promise.all(Array.from({length: 50}, (): Promise<string> => fetch(url).then((response: Response): Promise<string> => response.text())))
            //A request sent with node:http is a received request too (HttpRequest), and a sent one (HttpClient)
            await new Promise((resolve: (value: unknown) => void): unknown => http.get(url, (response): unknown => response.resume().on('end', resolve)))
            await sleep(50)
            const statistics = monitor.statistics
            assert.strictEqual(statistics.count, 51)
            assert.ok(statistics.min >= 4 && statistics.min <= statistics.p50 && statistics.p99 <= statistics.max, JSON.stringify(statistics))
        } finally {
            server.close()
            await container.destroy()
        }
    })

    it('measure the delays of the event loop, without meaningless values before its samples', async (): Promise<void> => {
        const container: Container = new Container()
        const monitor: EventLoopMonitor = await container.set(EventLoopMonitor)
        const empty = monitor.statistics
        assert.deepStrictEqual([empty.min, empty.max, empty.avg, empty.p99], [0, 0, 0, 0])
        await sleep(20)
        busy(80)
        await sleep(20)
        const statistics = monitor.statistics
        assert.ok(statistics.max >= 50, `max delay ${statistics.max}`)
        assert.ok(statistics.utilRate > 0 && statistics.utilRate <= 100)
        await container.destroy()
    })
})
