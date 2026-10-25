import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    lastErrno,
    lastWindowsError,
    Library,
    loadNativeLibrary,
    Native,
    type NativeCallback,
    NativeLibrary,
    type NativeLibraryHandle,
    type Out,
    type Pointer,
    readArray
} from '../exports/FFI.js'

const WINDOWS: boolean = process.platform === 'win32'

/**
 * The declarations of the libraries of Windows the tests use
 */
const DECLARATIONS: string = `
    typedef struct { int quot; int rem; } div_t;
    struct tm { int tm_sec; int tm_min; int tm_hour; int tm_mday; int tm_mon; int tm_year; int tm_wday; int tm_yday; int tm_isdst; };
    typedef struct _FILETIME { DWORD dwLowDateTime; DWORD dwHighDateTime; } FILETIME;
    typedef int (*compare_t)(const void *a, const void *b);
    typedef DWORD (WINAPI *LPTHREAD_START_ROUTINE)(LPVOID parameter);
`

@Library({names: 'kernel32', declarations: DECLARATIONS})
class Kernel32 extends NativeLibrary {
    @Native('DWORD WINAPI GetCurrentProcessId(void)')
    public readonly GetCurrentProcessId: () => number

    @Native('void WINAPI Sleep(DWORD milliseconds)', {async: true})
    public readonly Sleep: (milliseconds: number) => Promise<void>

    @Native('void WINAPI GetSystemTimeAsFileTime(_Out_ FILETIME *time)')
    public readonly GetSystemTimeAsFileTime: (time: Record<string, number>) => void
}

describe('The libraries of Windows', {skip: !WINDOWS && 'Windows only'}, (): void => {

    let ucrt: NativeLibraryHandle
    let kernel32: NativeLibraryHandle

    before((): void => {
        ucrt = loadNativeLibrary('c', DECLARATIONS)
        kernel32 = loadNativeLibrary('kernel32', DECLARATIONS)
    })

    after(async (): Promise<void> => {
        await ucrt.close()
        await kernel32.close()
    })

    it('calls the C library of Microsoft: numbers, strings, structs, callbacks, strings to free', (): void => {
        assert.match(ucrt.file, /ucrtbase\.dll$/i)
        assert.strictEqual(ucrt.func<(value: number) => number>('int abs(int value)')(-42), 42)
        assert.strictEqual(ucrt.func<(text: string) => bigint>('size_t strlen(const char *text)')('héllo'), 6n)
        assert.strictEqual(ucrt.func<() => number>('int _getpid(void)')(), process.pid)
        assert.deepStrictEqual(ucrt.func('div_t div(int numerator, int denominator)')(17, 5), {quot: 3, rem: 2})
        const time: Record<string, number> = {tm_sec: 0, tm_min: 0, tm_hour: 12, tm_mday: 32, tm_mon: 0, tm_year: 124, tm_wday: 0, tm_yday: 0, tm_isdst: -1}
        ucrt.func('__int64 _mktime64(_Inout_ struct tm *time)')(time)
        assert.deepStrictEqual([time.tm_mon, time.tm_mday, time.tm_yday], [1, 1, 31])
        const qsort = ucrt.func<(base: Int32Array, count: number, size: number, compare: (a: Pointer, b: Pointer) => number) => void>('void qsort(void *base, size_t count, size_t size, compare_t compare)')
        const values: Int32Array = Int32Array.from({length: 500}, (): number => (Math.random() * 1e6) | 0)
        qsort(values, values.length, 4, (a: Pointer, b: Pointer): number => (ucrt.read(a, 'int') as number) - (ucrt.read(b, 'int') as number))
        for (let i: number = 1; i < values.length; i++) assert.ok(values[i - 1] <= values[i])
        //Allocated by ucrtbase, freed by the free() of koffi
        const strdup = ucrt.func<(text: string) => string>('char *_strdup(const char *text)', {free: true})
        for (let i: number = 0; i < 1000; i++) assert.strictEqual(strdup('disposable'), 'disposable')
    })

    it('calls the variadic functions of msvcrt', async (): Promise<void> => {
        const msvcrt: NativeLibraryHandle = loadNativeLibrary('msvcrt')
        const snprintf = msvcrt.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int _snprintf(char *buffer, size_t size, const char *format, ...)')
        const buffer: Buffer = Buffer.alloc(64)
        snprintf(buffer, buffer.length, 'x=%d s=%s f=%.2f', 'int', 42, 'const char *', 'hi', 'double', 3.14159)
        assert.strictEqual(buffer.subarray(0, buffer.indexOf(0)).toString(), 'x=42 s=hi f=3.14')
        await msvcrt.close()
    })

    it('passes wide strings, and gives GetLastError and the errno of ucrtbase', (): void => {
        assert.strictEqual(kernel32.func<(text: string) => number>('int WINAPI lstrlenW(LPCWSTR text)')('héllo中文'), 7)
        const buffer: Uint16Array = new Uint16Array(260)
        const length: number = kernel32.func<(name: string, buffer: Uint16Array, size: number) => number>('DWORD WINAPI GetEnvironmentVariableW(LPCWSTR name, WORD *buffer, DWORD size)')('USERPROFILE', buffer, buffer.length)
        assert.strictEqual(Buffer.from(buffer.buffer, 0, length * 2).toString('utf16le'), process.env.USERPROFILE)
        assert.strictEqual(kernel32.func<(path: string) => number>('DWORD WINAPI GetFileAttributesW(LPCWSTR path)')('C:\\lakutata\\surely\\missing'), 0xFFFFFFFF)
        assert.ok([2, 3].includes(lastWindowsError()!), String(lastWindowsError()))
        ucrt.func('long strtol(const char *text, char **end, int base)')('99999999999999999999', null, 10)
        assert.strictEqual(lastErrno(), 34)
        assert.strictEqual(ucrt.errno(), 34)
    })

    it('calls persistent callbacks from the threads of CreateThread, and asynchronous calls', async (): Promise<void> => {
        const create = kernel32.func<(attributes: null, stack: number, start: Pointer, parameter: null, flags: number, id: Out<number>) => Pointer>('HANDLE WINAPI CreateThread(void *attributes, SIZE_T stack, LPTHREAD_START_ROUTINE start, LPVOID parameter, DWORD flags, _Out_ DWORD *id)')
        const close = kernel32.func<(handle: Pointer) => number>('BOOL WINAPI CloseHandle(HANDLE handle)')
        let called: number = 0
        let done: () => void = (): void => undefined
        const finished: Promise<void> = new Promise((resolve: () => void): void => {
            done = resolve
        })
        const callback: NativeCallback = kernel32.callback('LPTHREAD_START_ROUTINE', (): number => {
            if (++called === 8) done()
            return 0
        })
        for (let i: number = 0; i < 8; i++) close(create(null, 0, callback.pointer, null, 0, [null]))
        await finished
        callback.release()
        const sleep = kernel32.func<(milliseconds: number) => Promise<void>>('void WINAPI Sleep(DWORD milliseconds)', {async: true})
        let ticks: number = 0
        const interval: NodeJS.Timeout = setInterval((): number => ticks++, 1)
        await Promise.all(Array.from({length: 8}, (): Promise<void> => sleep(60)))
        clearInterval(interval)
        assert.ok(ticks >= 2, `${ticks} ticks`)
    })

    it('runs the asynchronous functions in the threads of a library', async (): Promise<void> => {
        const threaded: NativeLibraryHandle = loadNativeLibrary('kernel32', DECLARATIONS, {threads: 1})
        const crt: NativeLibraryHandle = loadNativeLibrary('c', DECLARATIONS, {threads: 1})
        const msvcrt: NativeLibraryHandle = loadNativeLibrary('msvcrt', '', {threads: 1})
        try {
            await Promise.all([threaded.ready, crt.ready, msvcrt.ready])
            const id = threaded.func<() => number>('DWORD WINAPI GetCurrentThreadId(void)')
            const idInThread = threaded.func<() => Promise<number>>('DWORD WINAPI GetCurrentThreadId(void)', {async: true})
            const thread: number = await idInThread()
            assert.notStrictEqual(thread, id())
            assert.strictEqual(await idInThread(), thread)
            //One thread: the calls one after the other, in their order
            const sleep = threaded.func<(milliseconds: number) => Promise<void>>('void WINAPI Sleep(DWORD milliseconds)', {async: true})
            const order: number[] = []
            await Promise.all([40, 20, 1].map((milliseconds: number, index: number): Promise<void> => sleep(milliseconds).then((): void => {
                order.push(index)
            })))
            assert.deepStrictEqual(order, [0, 1, 2])
            //An _Out_ struct, a wide string, a buffer written by the function
            const time: Record<string, number> = {}
            await threaded.func<(time: Record<string, number>) => Promise<void>>('void WINAPI GetSystemTimeAsFileTime(_Out_ FILETIME *time)', {async: true})(time)
            assert.strictEqual(typeof time.dwHighDateTime, 'number')
            const buffer: Uint16Array = new Uint16Array(260)
            const length: number = await threaded.func<(name: string, buffer: Uint16Array, size: number) => Promise<number>>('DWORD WINAPI GetEnvironmentVariableW(LPCWSTR name, WORD *buffer, DWORD size)', {async: true})('USERPROFILE', buffer, buffer.length)
            assert.strictEqual(Buffer.from(buffer.buffer, 0, length * 2).toString('utf16le'), process.env.USERPROFILE)
            //GetLastError and the errno of ucrtbase, as the thread had them after the call
            assert.strictEqual(await threaded.func<(path: string) => Promise<number>>('DWORD WINAPI GetFileAttributesW(LPCWSTR path)', {async: true})('C:\\lakutata\\surely\\missing'), 0xFFFFFFFF)
            assert.ok([2, 3].includes(threaded.windowsError()!), String(threaded.windowsError()))
            await crt.func<(text: string, end: null, base: number) => Promise<number>>('long strtol(const char *text, char **end, int base)', {async: true})('99999999999999999999', null, 10)
            assert.strictEqual(crt.errno(), 34)
            //A callback called from the thread, a variadic function
            const qsort = crt.func<(base: Int32Array, count: number, size: number, compare: (a: Pointer, b: Pointer) => number) => Promise<void>>('void qsort(void *base, size_t count, size_t size, compare_t compare)', {async: true})
            const values: Int32Array = new Int32Array([5, 3, 9, 1])
            await qsort(values, values.length, 4, (a: Pointer, b: Pointer): number => (crt.read(a, 'int') as number) - (crt.read(b, 'int') as number))
            assert.deepStrictEqual([...values], [1, 3, 5, 9])
            const snprintf = msvcrt.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => Promise<number>>('int _snprintf(char *buffer, size_t size, const char *format, ...)', {async: true})
            const text: Buffer = Buffer.alloc(32)
            await snprintf(text, text.length, 'x=%d', 'int', 42)
            assert.strictEqual(text.subarray(0, text.indexOf(0)).toString(), 'x=42')
            //A call still running when the library is closed: rejected
            const long: Promise<void> = sleep(300)
            const rejected: Promise<void> = assert.rejects(long, /closed while a call runs/)
            await threaded.close(20)
            await rejected
        } finally {
            await threaded.close()
            await crt.close()
            await msvcrt.close()
        }
    })

    it('calls SQLite of Windows (winsqlite3.dll) and reads its version', (): void => {
        const sqlite: NativeLibraryHandle = loadNativeLibrary('winsqlite3', `
            typedef struct sqlite3 sqlite3;
            typedef int (*sqlite3_callback)(void *context, int count, char **values, char **names);
        `)
        const open = sqlite.func<(filename: string, db: Out<Pointer>) => number>('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
        const exec = sqlite.func<(db: Pointer, sql: string, callback: ((context: Pointer | null, count: number, values: Pointer) => number) | null, context: null, error: Out<string>) => number>('int sqlite3_exec(sqlite3 *db, const char *sql, sqlite3_callback callback, void *context, _Out_ char **error)', {free: 'sqlite3_free'})
        const close = sqlite.func<(db: Pointer) => number>('int sqlite3_close(sqlite3 *db)')
        const version: string = sqlite.func<() => string>('const char *sqlite3_libversion(void)')()
        assert.strictEqual(sqlite.variable<string>('extern const char sqlite3_version[]').get(), version)
        const db: Out<Pointer> = [null]
        assert.strictEqual(open(':memory:', db), 0)
        const rows: string[] = []
        const error: Out<string> = [null]
        exec(db[0]!, 'CREATE TABLE t (a TEXT); INSERT INTO t VALUES (\'ü\'), (\'中\'); SELECT a FROM t', (context: Pointer | null, count: number, values: Pointer): number => {
            rows.push(...readArray(values, 'char *', count) as string[])
            return 0
        }, null, error)
        assert.deepStrictEqual(rows, ['ü', '中'])
        assert.notStrictEqual(exec(db[0]!, 'SELEC nonsense', null, null, error), 0)
        assert.match(error[0]!, /syntax error/)
        assert.strictEqual(close(db[0]!), 0)
    })

    it('is a component', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('kernel32', Kernel32, {})
            const library: Kernel32 = await container.get<Kernel32>('kernel32')
            assert.strictEqual(library.GetCurrentProcessId(), process.pid)
            await library.Sleep(10)
            const time: Record<string, number> = {}
            library.GetSystemTimeAsFileTime(time)
            const milliseconds: number = Number(((BigInt(time.dwHighDateTime) << 32n) | BigInt(time.dwLowDateTime)) / 10000n) - 11644473600000
            assert.ok(Math.abs(milliseconds - Date.now()) < 5000)
        } finally {
            await container.destroy()
        }
    })
})
