import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {Library, loadNativeLibrary, Native, NativeLibrary, NativeLibraryClosedException, type NativeLibraryHandle, type Out, type Pointer} from '../exports/FFI.js'
import {DeclarationParser} from '../lib/declarations/Parser.js'
import {CURRENT_PLATFORM} from '../lib/declarations/Platform.js'
import {NativeThreads, type ThreadFunction} from '../lib/thread/NativeThreads.js'
import {compileFixture, FIXTURE_DECLARATIONS, removeFixture} from './support/Fixture.js'

const POSIX: boolean = process.platform !== 'win32'

/**
 * The declarations of the C library the tests use
 */
const DECLARATIONS: string = `
    typedef int (*compare_t)(const void *a, const void *b);
    struct timeval { time_t tv_sec; suseconds_t tv_usec; };
`

/**
 * The order the promises settle in
 * @param promises
 */
async function settleOrder(promises: Promise<unknown>[]): Promise<number[]> {
    const order: number[] = []
    await Promise.all(promises.map((promise: Promise<unknown>, index: number): Promise<void> => promise.then((): void => {
        order.push(index)
    })))
    return order
}

@Library({names: 'c', declarations: DECLARATIONS, threads: 2})
class ThreadedLibC extends NativeLibrary {
    @Native('void *pthread_self(void)')
    public readonly self: () => Pointer

    @Native('void *pthread_self(void)', {async: true})
    public readonly selfInThread: () => Promise<Pointer>
}

describe('The worker threads of a library', {skip: !POSIX && 'tested on Windows by the suite of Windows'}, (): void => {

    let libc: NativeLibraryHandle

    before(async (): Promise<void> => {
        libc = loadNativeLibrary('c', DECLARATIONS, {threads: 1})
        await libc.ready
    })

    after(async (): Promise<void> => {
        await libc.close()
    })

    it('run the asynchronous functions, the synchronous ones staying in the thread calling them', async (): Promise<void> => {
        const self = libc.func<() => Pointer>('void *pthread_self(void)')
        const selfInThread = libc.func<() => Promise<Pointer>>('void *pthread_self(void)', {async: true})
        assert.strictEqual(libc.threads, 1)
        const thread: Pointer = await selfInThread()
        assert.notStrictEqual(thread, self())
        assert.strictEqual(await selfInThread(), thread)
    })

    it('run the calls one after the other with one thread, side by side with several', async (): Promise<void> => {
        const usleep = libc.func<(microseconds: number) => Promise<number>>('int usleep(uint32_t microseconds)', {async: true})
        assert.deepStrictEqual(await settleOrder([usleep(40000), usleep(20000), usleep(1000)]), [0, 1, 2])
        const several: NativeLibraryHandle = loadNativeLibrary('c', '', {threads: 3})
        try {
            await several.ready
            const parallel = several.func<(microseconds: number) => Promise<number>>('int usleep(uint32_t microseconds)', {async: true})
            const started: number = Date.now()
            assert.deepStrictEqual(await settleOrder([parallel(60000), parallel(30000), parallel(1000)]), [2, 1, 0])
            assert.ok(Date.now() - started < 150, `${Date.now() - started} ms`)
        } finally {
            await several.close()
        }
    })

    it('call the JS functions given as callbacks in the thread calling, and reject with what they throw', async (): Promise<void> => {
        const qsort = libc.func<(base: Int32Array, count: number, size: number, compare: (a: Pointer, b: Pointer) => number) => Promise<void>>('void qsort(void *base, size_t count, size_t size, compare_t compare)', {async: true})
        const values: Int32Array = Int32Array.from({length: 300}, (): number => (Math.random() * 1e6) | 0)
        await qsort(values, values.length, 4, (a: Pointer, b: Pointer): number => (libc.read(a, 'int') as number) - (libc.read(b, 'int') as number))
        for (let i: number = 1; i < values.length; i++) assert.ok(values[i - 1] <= values[i])
        await assert.rejects(qsort(new Int32Array([3, 1, 2]), 3, 4, (): number => {
            throw new Error('thrown in a callback')
        }), /thrown in a callback/)
    })

    it('give back the output parameters and the buffers the function writes, only their own bytes', async (): Promise<void> => {
        const gettimeofday = libc.func<(tv: Record<string, unknown>, tz: null) => Promise<number>>('int gettimeofday(_Out_ struct timeval *tv, void *tz)', {async: true})
        const tv: Record<string, unknown> = {}
        assert.strictEqual(await gettimeofday(tv, null), 0)
        assert.strictEqual(typeof tv.tv_sec, 'bigint')
        //A variadic function, asynchronous in the threads; a string to free given through an output parameter
        const asprintf = libc.func<(out: Out<string>, format: string, ...args: unknown[]) => Promise<number>>('int asprintf(_Out_ char **out, const char *format, ...)', {async: true, free: true})
        const out: Out<string> = [null]
        assert.strictEqual(await asprintf(out, '%s=%d', 'const char *', 'count', 'int', 42), 8)
        assert.strictEqual(out[0], 'count=42')
        //Two Buffers of the pool of Node.js: the function writes into one, the other one is left as it is
        const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => Promise<number>>('int snprintf(char *buffer, size_t size, const char *format, ...)', {async: true})
        const first: Buffer = Buffer.allocUnsafe(32).fill(1)
        const second: Buffer = Buffer.allocUnsafe(32).fill(2)
        await snprintf(first, first.length, 'x=%d', 'int', 7)
        assert.strictEqual(first.subarray(0, first.indexOf(0)).toString(), 'x=7')
        assert.ok(second.every((byte: number): boolean => byte === 2))
        //A const buffer is not written back
        const strlen = libc.func<(text: Buffer) => Promise<bigint>>('size_t strlen(const char *text)', {async: true})
        assert.strictEqual(await strlen(Buffer.from('four\0')), 4n)
    })

    it('give the errno of the thread after the call', async (): Promise<void> => {
        const open = libc.func<(path: string, flags: number) => Promise<number>>('int open(const char *path, int flags, ...)', {async: true})
        assert.strictEqual(await open('/lakutata/surely/missing', 0), -1)
        assert.strictEqual(libc.errno(), 2)
    })

    it('are closed after the calls running, which the closing waits for', async (): Promise<void> => {
        const closing: NativeLibraryHandle = loadNativeLibrary('c', '', {threads: 1})
        const usleep = closing.func<(microseconds: number) => Promise<number>>('int usleep(uint32_t microseconds)', {async: true})
        const running: Promise<number> = usleep(60000)
        const closed: Promise<void> = closing.close()
        await assert.rejects(usleep(1), NativeLibraryClosedException)
        assert.strictEqual(await running, 0)
        await closed
        //A call still running after the time given: rejected, its thread ending once it returns
        const late: NativeLibraryHandle = loadNativeLibrary('c', '', {threads: 1})
        const lateSleep = late.func<(microseconds: number) => Promise<number>>('int usleep(uint32_t microseconds)', {async: true})
        const longCall: Promise<number> = lateSleep(300000)
        const rejected: Promise<void> = assert.rejects(longCall, NativeLibraryClosedException)
        const started: number = Date.now()
        await late.close(50)
        assert.ok(Date.now() - started < 250, `${Date.now() - started} ms`)
        await rejected
    })

    it('fail the calls of a thread that ends, and start a thread again for the next ones', async (): Promise<void> => {
        const threads: NativeThreads = new NativeThreads(libc.file, '', 1)
        try {
            await threads.ready
            const declaration: string = 'int usleep(uint32_t microseconds)'
            const usleep: ThreadFunction = {declaration: declaration, named: false, options: {}, type: new DeclarationParser(CURRENT_PLATFORM).prototype(declaration)}
            const running: Promise<unknown> = threads.call(usleep, [200000])
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
            await threads.stopThread(0)
            await assert.rejects(running, /ended/)
            assert.strictEqual((await threads.call(usleep, [1000])).value, 0)
        } finally {
            await threads.close()
        }
    })

    it('are given to a component by @Library, or by its configuration', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('libc', ThreadedLibC, {})
            await container.setNamed('single', ThreadedLibC, {threads: 1})
            const libc2: ThreadedLibC = await container.get<ThreadedLibC>('libc')
            const single: ThreadedLibC = await container.get<ThreadedLibC>('single')
            assert.deepStrictEqual([libc2.threadCount, single.threadCount], [2, 1])
            assert.notStrictEqual(await libc2.selfInThread(), libc2.self())
        } finally {
            await container.destroy()
        }
    })

    it('cost tens of microseconds a call', async (): Promise<void> => {
        const abs = libc.func<(value: number) => Promise<number>>('int abs(int value)', {async: true})
        const pooled: NativeLibraryHandle = loadNativeLibrary('c')
        const absPool = pooled.func<(value: number) => Promise<number>>('int abs(int value)', {async: true})
        const measure = async (fn: (value: number) => Promise<number>): Promise<number> => {
            for (let i: number = 0; i < 200; i++) await fn(-i)
            const started: bigint = process.hrtime.bigint()
            for (let i: number = 0; i < 2000; i++) await fn(-i)
            return Number(process.hrtime.bigint() - started) / 2000 / 1000
        }
        const thread: number = await measure(abs)
        const pool: number = await measure(absPool)
        await pooled.close()
        console.log(`An asynchronous call one after the other: ${thread.toFixed(1)} µs in the thread of the library, ${pool.toFixed(1)} µs in the thread pool`)
        assert.ok(thread < 1000)
    })
})

describe('The worker threads of the C library of the tests', (): void => {

    const file: string | undefined = compileFixture()
    let fixture: NativeLibraryHandle

    before(async (): Promise<void> => {
        if (!file) return
        fixture = loadNativeLibrary('fixture', FIXTURE_DECLARATIONS, {search: [path.dirname(file)], threads: 1})
        await fixture.ready
    })

    after(async (): Promise<void> => {
        await fixture?.close()
        if (file) removeFixture(file)
    })

    it('convert bitfields, 64-bit integers and strings to free as the thread of the library does', {skip: !file && 'no C compiler'}, async (): Promise<void> => {
        const make = fixture.func<(...args: (number | bigint)[]) => Promise<Record<string, number | bigint>>>('struct flags flags_make(unsigned ready, unsigned mode, int level, unsigned char tag, uint64_t big)', {async: true})
        assert.deepStrictEqual(await make(1, 6, -7, 200, 0xABCDEF1234n), {ready: 1, mode: 6, level: -7, tag: 200, big: 0xABCDEF1234n})
        const bump = fixture.func<(flags: Record<string, unknown>) => Promise<void>>('void flags_bump(_Inout_ struct flags *flags)', {async: true})
        const flags: Record<string, unknown> = {ready: 1, mode: 7, level: -16, tag: 5, big: 1n}
        await bump(flags)
        assert.deepStrictEqual(flags, {ready: 1, mode: 0, level: 15, tag: 5, big: 1n})
        const out: Out<bigint> = [null]
        await fixture.func<(out: Out<bigint>) => Promise<void>>('void big_out(_Out_ int64_t *out)', {async: true})(out)
        assert.strictEqual(out[0], 9007199254740993n)
        const frees = fixture.func<() => number>('int fixture_frees(void)')
        const before: number = frees()
        assert.strictEqual(await fixture.func<(text: string) => Promise<string>>('char *fixture_dup(const char *text)', {async: true, free: 'fixture_free'})('in a thread'), 'in a thread')
        assert.strictEqual(frees() - before, 1)
        //A callback the library keeps, called from the thread
        const messages: string[] = []
        const logger = fixture.callback('logger_t', (level: number, message: string): void => {
            messages.push(`${level} ${message}`)
        })
        fixture.func('void set_logger(logger_t logger)')(logger.pointer)
        assert.strictEqual(await fixture.func<(level: number, message: string) => Promise<number>>('int log_now(int level, const char *message)', {async: true})(4, 'from the thread'), 1)
        assert.deepStrictEqual(messages, ['4 from the thread'])
        fixture.func('void set_logger(logger_t logger)')(null)
        logger.release()
    })
})
