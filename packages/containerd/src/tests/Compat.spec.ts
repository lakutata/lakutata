import {describe, it} from 'node:test'
import assert from 'node:assert'
import os from 'node:os'
import {anySignal, parallelism, readableStreamFrom} from '../client/Compat.js'

/**
 * Run a function with a property of an object removed, as on a version of Node.js without it
 */
async function without<T>(target: object, property: string, run: () => T | Promise<T>): Promise<T> {
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(target, property)
    Reflect.deleteProperty(target, property)
    try {
        return await run()
    } finally {
        if (descriptor) Object.defineProperty(target, property, descriptor)
    }
}

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = []
    const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value)
    return Buffer.concat(chunks).toString()
}

describe('What Node.js 18.10 lacks, made from what it has', (): void => {

    for (const native of [true, false]) it(`aborts a signal with the first of the signals given${native ? '' : ', without AbortSignal.any'}`, async (): Promise<void> => {
        const run = (): void => {
            const first: AbortController = new AbortController()
            const second: AbortController = new AbortController()
            const combined: { signal: AbortSignal, dispose: () => void } = anySignal([first.signal, second.signal])
            assert.strictEqual(combined.signal.aborted, false)
            second.abort('second')
            assert.strictEqual(combined.signal.aborted, true)
            assert.strictEqual(combined.signal.reason, 'second')
            first.abort('first')
            assert.strictEqual(combined.signal.reason, 'second')
            //A signal aborted already
            const aborted: { signal: AbortSignal, dispose: () => void } = anySignal([new AbortController().signal, AbortSignal.abort('done')])
            assert.strictEqual(aborted.signal.reason, 'done')
        }
        await (native ? run() : without(AbortSignal, 'any', run))
    })

    it('leaves no listener on the signals given once disposed, without AbortSignal.any', async (): Promise<void> => {
        await without(AbortSignal, 'any', (): void => {
            const lasting: AbortController = new AbortController()
            let listening: number = 0
            const add: typeof lasting.signal.addEventListener = lasting.signal.addEventListener.bind(lasting.signal)
            const remove: typeof lasting.signal.removeEventListener = lasting.signal.removeEventListener.bind(lasting.signal)
            lasting.signal.addEventListener = ((...args: Parameters<typeof add>): void => {
                listening++
                add(...args)
            }) as typeof add
            lasting.signal.removeEventListener = ((...args: Parameters<typeof remove>): void => {
                listening--
                remove(...args)
            }) as typeof remove
            for (let i: number = 0; i < 3; i++) anySignal([lasting.signal, new AbortController().signal]).dispose()
            assert.strictEqual(listening, 0)
            const kept: { signal: AbortSignal, dispose: () => void } = anySignal([lasting.signal])
            assert.strictEqual(listening, 1)
            lasting.abort()
            assert.strictEqual(kept.signal.aborted, true)
            assert.strictEqual(listening, 0)
        })
    })

    for (const native of [true, false]) it(`streams the chunks of an iterable${native ? '' : ', without ReadableStream.from'}`, async (): Promise<void> => {
        const run = async (): Promise<void> => {
            async function* chunks(): AsyncGenerator<Uint8Array> {
                yield Buffer.from('a')
                yield Buffer.from('bc')
            }
            assert.strictEqual(await read(readableStreamFrom(chunks())), 'abc')
            //Cancelled: the iterable is returned
            let returned: boolean = false
            async function* endless(): AsyncGenerator<Uint8Array> {
                try {
                    for (;;) yield Buffer.from('x')
                } finally {
                    returned = true
                }
            }
            const reader: ReadableStreamDefaultReader<Uint8Array> = readableStreamFrom(endless()).getReader()
            await reader.read()
            await reader.cancel()
            assert.strictEqual(returned, true)
        }
        await (native ? run() : without(ReadableStream, 'from', run))
    })

    it('counts the cores without os.availableParallelism', async (): Promise<void> => {
        const native: number = parallelism()
        assert.ok(native >= 1)
        assert.strictEqual(await without(os, 'availableParallelism', (): number => parallelism()), Math.max(1, os.cpus().length))
    })
})
