import 'reflect-metadata'
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import EventEmitter2Package from 'eventemitter2'
import {EventEmitter, DefaultEventEmitterOptions, type ListenerFn} from '../../lib/base/EventEmitter.js'

const {EventEmitter2: UpstreamEventEmitter2} = EventEmitter2Package as any

/**
 * The emitter of 2.x: eventemitter2 with the options and the listener options of 2.x
 */
class UpstreamEmitter {

    protected readonly emitter: any = new UpstreamEventEmitter2({...DefaultEventEmitterOptions})

    protected readonly onOptions: Record<string, boolean> = {async: true, nextTick: false, promisify: true, objectify: false}

    public emit(event: any, ...values: any[]): boolean {
        return this.emitter.emit(event, ...values)
    }

    public async emitRequest(event: any, ...values: any[]): Promise<any[]> {
        return this.emitter.emitAsync(event, ...values)
    }

    public addListener(event: any, listener: ListenerFn): this {
        this.emitter.addListener(event, listener)
        return this
    }

    public on(event: any, listener: ListenerFn): this {
        this.emitter.on(event, listener, this.onOptions)
        return this
    }

    public prependListener(event: any, listener: ListenerFn): this {
        this.emitter.prependListener(event, listener, this.onOptions)
        return this
    }

    public once(event: any, listener: ListenerFn): this {
        this.emitter.once(event, listener, this.onOptions)
        return this
    }

    public prependOnceListener(event: any, listener: ListenerFn): this {
        this.emitter.prependOnceListener(event, listener, this.onOptions)
        return this
    }

    public many(event: any, times: number, listener: ListenerFn): this {
        this.emitter.many(event, times, listener, this.onOptions)
        return this
    }

    public prependMany(event: any, times: number, listener: ListenerFn): this {
        this.emitter.prependMany(event, times, listener, this.onOptions)
        return this
    }

    public onAny(listener: any): this {
        this.emitter.onAny(listener)
        return this
    }

    public prependAny(listener: any): this {
        this.emitter.prependAny(listener)
        return this
    }

    public offAny(listener: any): this {
        this.emitter.offAny(listener)
        return this
    }

    public removeListener(event: any, listener: ListenerFn): this {
        this.emitter.removeListener(event, listener)
        return this
    }

    public off(event: any, listener: ListenerFn): this {
        this.emitter.off(event, listener)
        return this
    }

    public removeAllListeners(event?: any): this {
        this.emitter.removeAllListeners(event)
        return this
    }

    public setMaxListeners(n: number): void {
        return this.emitter.setMaxListeners(n)
    }

    public getMaxListeners(): number {
        return this.emitter.getMaxListeners()
    }

    public eventNames(nsAsArray?: boolean): any[] {
        return this.emitter.eventNames(nsAsArray)
    }

    public listenerCount(event?: any): number {
        return this.emitter.listenerCount(event)
    }

    public listeners(event?: any): ListenerFn[] {
        return this.emitter.listeners(event)
    }

    public listenersAny(): ListenerFn[] {
        return this.emitter.listenersAny()
    }

    public hasListeners(event?: any): boolean {
        return this.emitter.hasListeners(event).valueOf()
    }
}

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const SYMBOL: symbol = Symbol.for('event')

/**
 * The events listened to and emitted: names, namespaces, wildcards, arrays, a symbol and error
 */
const EVENTS: any[] = [
    'a', 'b', 'a.b', 'a.c', 'b.c', 'a.b.c', 'a.b.d', 'x.y.z', 'a.*', '*.b', '*', '*.*', '**', 'a.**', '**.c', 'a.**.c', '**.**', 'a.*.c',
    '*.*.*', '', 'a.', '.b', ['a', 'b'], ['a', '*'], ['**'], ['a', 'b', 'c'], SYMBOL, [SYMBOL, 'a'], 'error', 'newListener'
]

const flush = async (): Promise<void> => {
    for (let index: number = 0; index < 3; index++) await new Promise((resolve: (value?: unknown) => void): unknown => setImmediate(resolve))
}

/**
 * Describe an event (symbols as text)
 * @param value
 */
function Describe(value: unknown): unknown {
    if (typeof value === 'symbol') return value.toString()
    if (Array.isArray(value)) return value.map(Describe)
    if (value instanceof Error) return `Error: ${value.message}`
    if (value && typeof value === 'object' && value.constructor?.name === 'Immediate') return 'Immediate'
    return value
}

/**
 * Run a random script on an emitter: the calls of the listeners, the results of the methods, the unhandled rejections
 * and the warnings
 * @param create
 * @param seed
 */
async function Script(create: () => any, seed: number): Promise<unknown[]> {
    const random: () => number = Random(seed)
    const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]
    const log: unknown[] = []
    const emitter: any = create()
    //Whether the listeners are called by the emitting (synchronously), or by emitRequest(): the last listener throws then
    //(an error of an asynchronous listener of emit() is an unhandled rejection, compared in a process of its own)
    let throwing: boolean = false
    //The listeners: they log their calls, return or throw
    const listeners: ListenerFn[] = Array.from({length: 6}, (_: unknown, id: number): ListenerFn => {
        const listener = function (this: any, ...args: any[]): unknown {
            log.push(['call', id, Describe(this?.event), Describe(args)])
            if (id === 5 && throwing) throw new Error(`listener ${id}`)
            return `result ${id}`
        }
        Object.defineProperty(listener, 'name', {value: `listener${id}`})
        return listener
    })
    const idOf = (fn: any): unknown => {
        const origin: unknown = fn?._origin ?? fn
        const id: number = listeners.indexOf(origin as ListenerFn)
        return id >= 0 ? id : typeof fn
    }
    const record = (name: string, fn: () => unknown): void => {
        try {
            log.push([name, Describe(fn())])
        } catch (error) {
            log.push([name, 'throws', (error as Error).message])
        }
    }
    for (let step: number = 0; step < 40; step++) {
        const event: any = pick(EVENTS)
        const listener: ListenerFn = pick(listeners)
        const values: unknown[] = Array.from({length: pick([0, 1, 2, 3, 4])}, (_: unknown, index: number): unknown => index === 0 && random() < 0.3 ? new Error('value') : `v${index}`)
        switch (pick(['on', 'on', 'once', 'many', 'prependListener', 'prependOnceListener', 'prependMany', 'addListener', 'onAny', 'prependAny', 'offAny', 'off', 'removeListener', 'removeAllListeners', 'emit', 'emit', 'emit', 'emitRequest', 'query', 'setMaxListeners'])) {
            case 'on':
            case 'once':
            case 'prependListener':
            case 'prependOnceListener':
            case 'addListener': {
                const method: string = pick(['on', 'once', 'prependListener', 'prependOnceListener', 'addListener'])
                record(method, (): unknown => (emitter[method](event, listener), 'ok'))
                break
            }
            case 'many':
            case 'prependMany': {
                const method: string = pick(['many', 'prependMany'])
                record(method, (): unknown => (emitter[method](event, pick([1, 2, 3]), listener), 'ok'))
                break
            }
            case 'onAny':
            case 'prependAny': {
                const method: string = pick(['onAny', 'prependAny'])
                record(method, (): unknown => (emitter[method](listener), 'ok'))
                break
            }
            case 'offAny':
                record('offAny', (): unknown => (emitter.offAny(random() < 0.3 ? undefined : listener), 'ok'))
                break
            case 'off':
            case 'removeListener':
                record('off', (): unknown => (emitter.off(event, listener), 'ok'))
                break
            case 'removeAllListeners':
                record('removeAllListeners', (): unknown => (emitter.removeAllListeners(random() < 0.3 ? undefined : event), 'ok'))
                break
            case 'emitRequest': {
                let result: unknown
                throwing = true
                try {
                    result = await emitter.emitRequest(event, ...values)
                } catch (error) {
                    result = ['rejects', Describe(error)]
                }
                throwing = false
                log.push(['emitRequest', Describe(event), Describe(result)])
                await flush()
                break
            }
            case 'query':
                record('listenerCount', (): unknown => emitter.listenerCount(event))
                record('listeners', (): unknown => emitter.listeners(event).map(idOf))
                record('eventNames', (): unknown => emitter.eventNames())
                record('eventNamesAsArray', (): unknown => emitter.eventNames(true))
                record('hasListeners', (): unknown => emitter.hasListeners(event))
                record('listenersAny', (): unknown => emitter.listenersAny().map(idOf))
                record('getMaxListeners', (): unknown => emitter.getMaxListeners())
                break
            case 'setMaxListeners':
                record('setMaxListeners', (): unknown => emitter.setMaxListeners(pick([1, 2, 0])))
                break
            default:
                throwing = true
                record('emit ' + JSON.stringify(Describe(event)), (): unknown => emitter.emit(event, ...values))
                throwing = false
                log.push(['sync point'])
                await flush()
        }
    }
    await flush()
    return log
}

describe('EventEmitter', (): void => {

    const rejections: string[] = []
    const warnings: string[] = []
    const onRejection = (reason: unknown): number => rejections.push(String(Describe(reason)))
    const onWarning = (warning: Error): number => warnings.push(warning.message)
    const printers: NodeJS.WarningListener[] = []

    before((): void => {
        printers.push(...process.listeners('warning'))
        process.removeAllListeners('warning')
        process.on('unhandledRejection', onRejection)
        process.on('warning', onWarning)
    })

    after((): void => {
        process.off('unhandledRejection', onRejection)
        process.off('warning', onWarning)
        printers.forEach((printer: NodeJS.WarningListener): unknown => process.on('warning', printer))
    })

    it('emits as the eventemitter2 of 2.x: the wildcards, the asynchronous listeners, the queries', async (): Promise<void> => {
        for (let run: number = 0; run < 300; run++) {
            rejections.length = 0
            warnings.length = 0
            const expected: unknown[] = await Script((): UpstreamEmitter => new UpstreamEmitter(), run)
            const expectedRejections: string[] = rejections.splice(0)
            const expectedWarnings: string[] = warnings.splice(0)
            const actual: unknown[] = await Script((): EventEmitter => new EventEmitter(), run)
            assert.deepStrictEqual(actual, expected, `run ${run}`)
            assert.deepStrictEqual(rejections, expectedRejections, `the unhandled rejections of run ${run}`)
            assert.deepStrictEqual(warnings, expectedWarnings, `the warnings of run ${run}`)
        }
    })

    it('calls the listeners of the wildcards after the emitting, as 2.x', async (): Promise<void> => {
        const calls = async (emitter: EventEmitter | UpstreamEmitter): Promise<string[]> => {
            const called: string[] = []
            emitter.on('user.*', function (this: any, value: string): void {
                called.push(`${this.event} ${value}`)
            })
            emitter.on('**', (): number => called.push('any'))
            emitter.emit('user.created', 'x')
            called.push('emitted')
            await flush()
            return called
        }
        const expected: string[] = await calls(new UpstreamEmitter())
        assert.strictEqual(expected[0], 'emitted')
        assert.deepStrictEqual(await calls(new EventEmitter()), expected)
    })

    it('makes the errors of the asynchronous listeners of emit() unhandled rejections, as 2.x', (): void => {
        //A process of its own: the test runner fails on an unhandled rejection
        const script: string = `
            import 'reflect-metadata'
            import EventEmitter2Package from 'eventemitter2'
            const {EventEmitter} = await import(${JSON.stringify(new URL('../../lib/base/EventEmitter.js', import.meta.url).href)})
            const upstream = new EventEmitter2Package.EventEmitter2({wildcard: true})
            const emitter = new EventEmitter()
            const results = []
            process.on('unhandledRejection', (reason) => results.push(reason.message))
            upstream.on('x', () => { throw new Error('upstream') }, {async: true, promisify: true})
            emitter.on('x', () => { throw new Error('ported') })
            results.push(String(upstream.emit('x')), String(emitter.emit('x')))
            setTimeout(() => console.log(JSON.stringify(results)), 50)
        `
        const output: string = execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: new URL('.', import.meta.url), encoding: 'utf8'})
        assert.deepStrictEqual(JSON.parse(output), ['true', 'true', 'upstream', 'ported'])
    })
})
