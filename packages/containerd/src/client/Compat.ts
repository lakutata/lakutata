import os from 'node:os'

/**
 * A signal aborted with the first of the signals given: AbortSignal.any (Node.js 18.17, 20.3), else a controller
 * listening to them. `dispose` removes its listeners once the signal is not needed any more (the signals given may live
 * longer); with AbortSignal.any it has nothing to remove.
 * @param signals The signals.
 * @internal
 */
export function anySignal(signals: AbortSignal[]): { signal: AbortSignal, dispose: () => void } {
    //node-compat: AbortSignal.any
    if (typeof AbortSignal.any === 'function') return {signal: AbortSignal.any(signals), dispose: (): void => undefined}
    const controller: AbortController = new AbortController()
    const listeners: [AbortSignal, () => void][] = []
    const dispose = (): void => {
        for (const [signal, listener] of listeners.splice(0)) signal.removeEventListener('abort', listener)
    }
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason)
            dispose()
            break
        }
        const listener = (): void => {
            controller.abort(signal.reason)
            dispose()
        }
        signal.addEventListener('abort', listener, {once: true})
        listeners.push([signal, listener])
    }
    return {signal: controller.signal, dispose: dispose}
}

/**
 * A stream of the chunks of an iterable: ReadableStream.from (Node.js 20.6), else a stream that pulls them.
 * @param source The chunks.
 * @internal
 */
export function readableStreamFrom(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
    //node-compat: ReadableStream.from
    if (typeof ReadableStream.from === 'function') return ReadableStream.from(source)
    const iterator: AsyncIterator<Uint8Array> = source[Symbol.asyncIterator]()
    return new ReadableStream<Uint8Array>({
        async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
            const next: IteratorResult<Uint8Array> = await iterator.next()
            if (next.done) {
                controller.close()
            } else {
                controller.enqueue(next.value)
            }
        },
        async cancel(reason?: unknown): Promise<void> {
            await iterator.return?.(reason)
        }
    })
}

/**
 * The parallelism the system advises: os.availableParallelism (Node.js 18.14, 19.4), else the cores.
 * @internal
 */
export function parallelism(): number {
    //node-compat: os.availableParallelism
    return typeof os.availableParallelism === 'function' ? os.availableParallelism() : Math.max(1, os.cpus().length)
}
