import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {
    allocMemory,
    freeMemory,
    lastErrno,
    loadNativeLibrary,
    type NativeCallback,
    NativeDeclarationException,
    type NativeLibraryHandle,
    NativeLibraryClosedException,
    NativeLibraryNotFoundException,
    NativeMemoryException,
    type Out,
    type Pointer,
    readArray,
    readBuffer,
    readCString,
    readValue,
    sizeOf,
    viewBuffer,
    writeValue
} from '../exports/FFI.js'
import {TYPES} from '../lib/Runtime.js'
import {DeclarationParser} from '../lib/declarations/Parser.js'
import {CURRENT_PLATFORM} from '../lib/declarations/Platform.js'
import type {RecordType} from '../lib/declarations/Types.js'
import {compileFixture, FIXTURE_DECLARATIONS, removeFixture} from './support/Fixture.js'

const POSIX: boolean = process.platform !== 'win32'

/**
 * The declarations of the C library the tests use
 */
const LIBC_DECLARATIONS: string = `
    typedef struct { int quot; int rem; } div_t;
    struct tm { int tm_sec; int tm_min; int tm_hour; int tm_mday; int tm_mon; int tm_year; int tm_wday; int tm_yday; int tm_isdst; long tm_gmtoff; const char *tm_zone; };
    typedef int (*compare_t)(const void *a, const void *b);
    typedef void *(*thread_main_t)(void *argument);
`

describe('A native library', {skip: !POSIX && 'the Windows libraries are tested in the virtual machine'}, (): void => {

    let libc: NativeLibraryHandle

    before((): void => {
        libc = loadNativeLibrary('c', LIBC_DECLARATIONS)
    })

    after(async (): Promise<void> => {
        await libc.close()
    })

    it('calls functions with numbers, strings and null pointers', (): void => {
        const abs = libc.func<(value: number) => number>('int abs(int value)')
        const strlen = libc.func<(text: string) => bigint>('size_t strlen(const char *text)')
        const strlenNumber = libc.func<(text: string) => number>('size_t strlen(const char *text)', {int64: 'number'})
        const getenv = libc.func<(name: string) => string | null>('const char *getenv(const char *name)')
        const llabs = libc.func<(value: bigint) => bigint>('long long llabs(long long value)')
        assert.strictEqual(abs(-42), 42)
        assert.strictEqual(strlen('héllo'), 6n)
        assert.strictEqual(strlenNumber('héllo'), 6)
        assert.strictEqual(getenv('HOME'), process.env.HOME)
        assert.strictEqual(getenv('LAKUTATA_SURELY_UNSET'), null)
        assert.strictEqual(llabs(-9007199254740993n), 9007199254740993n)
        //A prototype bound twice: the same function
        assert.strictEqual(libc.func('int abs(int value)'), abs)
    })

    it('calls variadic functions, the types of the extra arguments given by their C names', (): void => {
        const snprintf = libc.func<(buffer: Buffer, size: number, format: string, ...args: unknown[]) => number>('int snprintf(char *buffer, size_t size, const char *format, ...)')
        const buffer: Buffer = Buffer.alloc(64)
        snprintf(buffer, buffer.length, 'x=%d s=%s f=%.2f n=%lld', 'int', 42, 'const char *', 'hi', 'double', 3.14159, 'long long', 9007199254740993n)
        assert.strictEqual(buffer.subarray(0, buffer.indexOf(0)).toString(), 'x=42 s=hi f=3.14 n=9007199254740993')
    })

    it('passes and returns structs, by value and as output parameters', (): void => {
        const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
        assert.deepStrictEqual(div(17, 5), {quot: 3, rem: 2})
        libc.declare('struct timeval { time_t tv_sec; suseconds_t tv_usec; };')
        const gettimeofday = libc.func<(tv: {tv_sec?: bigint, tv_usec?: number | bigint}, tz: null) => number>('int gettimeofday(_Out_ struct timeval *tv, void *tz)')
        const tv: {tv_sec?: bigint, tv_usec?: number | bigint} = {}
        assert.strictEqual(gettimeofday(tv, null), 0)
        assert.strictEqual(typeof tv.tv_sec, 'bigint')
        assert.ok(Math.abs(Number(tv.tv_sec) - Date.now() / 1000) < 2)
        const mktime = libc.func<(time: Record<string, unknown>) => bigint>('time_t mktime(_Inout_ struct tm *time)')
        const time: Record<string, unknown> = {tm_sec: 0, tm_min: 0, tm_hour: 12, tm_mday: 32, tm_mon: 0, tm_year: 124, tm_wday: 0, tm_yday: 0, tm_isdst: -1, tm_gmtoff: 0n, tm_zone: null}
        const seconds: bigint = mktime(time)
        assert.deepStrictEqual([time.tm_mon, time.tm_mday, time.tm_yday], [1, 1, 31])
        //The time zone of the C library may not be the one of JS (bun test runs JS in UTC)
        assert.ok(Math.abs(Number(seconds) - new Date(2024, 1, 1, 12).getTime() / 1000) <= 14 * 3600, String(seconds))
        assert.strictEqual(typeof time.tm_gmtoff, 'bigint')
    })

    it('calls transient callbacks, rethrowing what they throw once the call returns', (): void => {
        const qsort = libc.func<(base: Int32Array, count: number, size: number, compare: (a: Pointer, b: Pointer) => number) => void>('void qsort(void *base, size_t count, size_t size, compare_t compare)')
        const values: Int32Array = Int32Array.from({length: 1000}, (): number => (Math.random() * 1e6) | 0)
        qsort(values, values.length, 4, (a: Pointer, b: Pointer): number => (libc.read(a, 'int') as number) - (libc.read(b, 'int') as number))
        for (let i: number = 1; i < values.length; i++) assert.ok(values[i - 1] <= values[i])
        assert.throws((): void => qsort(new Int32Array([3, 1, 2]), 3, 4, (): number => {
            throw new Error('in a callback')
        }), /in a callback/)
    })

    it('calls persistent callbacks from threads of their own, and hands their exceptions to its handler', async (): Promise<void> => {
        const errors: unknown[] = []
        const threads: NativeLibraryHandle = loadNativeLibrary('c', LIBC_DECLARATIONS, {onCallbackError: (error: unknown): unknown => errors.push(error)})
        const create = threads.func<(thread: Out<Pointer>, attributes: null, main: Pointer, argument: null) => number>('int pthread_create(_Out_ void **thread, void *attributes, thread_main_t main, void *argument)')
        const detach = threads.func<(thread: Pointer) => number>('int pthread_detach(void *thread)')
        let called: number = 0
        let done: () => void = (): void => undefined
        const finished: Promise<void> = new Promise((resolve: () => void): void => {
            done = resolve
        })
        const callback: NativeCallback = threads.callback('thread_main_t', (): null => {
            if (++called === 8) done()
            if (called === 1) throw new Error('thrown in a thread')
            return null
        })
        for (let i: number = 0; i < 8; i++) {
            const thread: Out<Pointer> = [null]
            assert.strictEqual(create(thread, null, callback.pointer, null), 0)
            detach(thread[0]!)
        }
        await finished
        assert.strictEqual(called, 8)
        assert.match(String(errors[0]), /thrown in a thread/)
        await threads.close()
        assert.strictEqual(callback.released, true)
    })

    it('runs asynchronous calls in the thread pool, the event loop going on', async (): Promise<void> => {
        const usleep = libc.func<(microseconds: number) => Promise<number>>('int usleep(uint32_t microseconds)', {async: true})
        let ticks: number = 0
        const interval: NodeJS.Timeout = setInterval((): number => ticks++, 2)
        await Promise.all(Array.from({length: 8}, (): Promise<number> => usleep(30000)))
        clearInterval(interval)
        assert.ok(ticks >= 3, `${ticks} ticks`)
        assert.strictEqual(libc.pending, 0)
        libc.declare('struct timeval2 { time_t tv_sec; suseconds_t tv_usec; };')
        const gettimeofday = libc.func<(tv: Record<string, unknown>, tz: null) => Promise<number>>('int gettimeofday(_Out_ struct timeval2 *tv, void *tz)', {async: true})
        const tv: Record<string, unknown> = {}
        await gettimeofday(tv, null)
        assert.strictEqual(typeof tv.tv_sec, 'bigint')
        assert.throws((): unknown => libc.func('int printf(const char *format, ...)', {async: true}), /variadic function printf cannot be called asynchronously/)
    })

    it('frees the strings a function gives with the function given', (): void => {
        const strdup = libc.func<(text: string) => string>('char *strdup(const char *text)', {free: true})
        for (let i: number = 0; i < 1000; i++) assert.strictEqual(strdup('disposable'), 'disposable')
    })

    it('reads and writes native memory', (): void => {
        const pointer: Pointer = allocMemory('int32_t', 4)
        for (let i: number = 0; i < 4; i++) writeValue(pointer + BigInt(i * 4), 'int32_t', i + 1)
        assert.deepStrictEqual(readArray(pointer, 'int32_t', 4), [1, 2, 3, 4])
        assert.deepStrictEqual([...readBuffer(pointer, 8)], [1, 0, 0, 0, 2, 0, 0, 0])
        if (process.versions.electron) {
            //Electron forbids views of native memory: refused before koffi is asked (it would end the process)
            assert.throws((): ArrayBuffer => viewBuffer(pointer, 16), NativeMemoryException)
        } else {
            new Int32Array(viewBuffer(pointer, 16))[0] = 7
            assert.strictEqual(readValue(pointer, 'int32_t'), 7)
        }
        freeMemory(pointer)
        const big: Pointer = allocMemory('int64_t')
        writeValue(big, 'int64_t', -5n)
        assert.strictEqual(readValue(big, 'int64_t'), -5n)
        freeMemory(big)
        const strdup = libc.func<(text: string) => Pointer>('void *strdup(const char *text)')
        const copy: Pointer = strdup('pointer')
        assert.strictEqual(readCString(copy), 'pointer')
        libc.func('void free(void *pointer)')(copy)
        assert.deepStrictEqual([sizeOf('int'), sizeOf('void *'), sizeOf('long')], [4, CURRENT_PLATFORM.pointerSize, CURRENT_PLATFORM.longSize])
        assert.strictEqual(libc.sizeOf('struct tm'), 56)
        assert.strictEqual(libc.offsetOf('struct tm', 'tm_gmtoff'), 40)
        assert.throws((): unknown => readValue(null as unknown as Pointer, 'int'), NativeMemoryException)
        assert.throws((): unknown => readBuffer(1n, -1), NativeMemoryException)
    })

    it('gives the errno of the last call', (): void => {
        const open = libc.func<(path: string, flags: number) => number>('int open(const char *path, int flags, ...)')
        assert.strictEqual(open('/lakutata/surely/missing', 0), -1)
        assert.strictEqual(lastErrno(), 2)
        assert.strictEqual(libc.errno(), 2)
    })

    it('refuses what it cannot do, clearly', async (): Promise<void> => {
        assert.throws((): unknown => libc.func('int abs(int value)')('nope'), TypeError)
        assert.throws((): unknown => libc.func('vendor_t make(void)'), (error: unknown): boolean => error instanceof NativeDeclarationException && /Unknown type vendor_t/.test(error.message))
        assert.throws((): unknown => libc.func('int lakutata_missing_function(void)'), /lakutata_missing_function cannot be bound/)
        assert.throws((): unknown => libc.func('int vprintf(const char *format, va_list args)'), /A va_list cannot be passed/)
        assert.throws((): unknown => libc.func('int f(_Out_ int value)'), /_Out_ but not a pointer/)
        assert.throws((): NativeLibraryHandle => loadNativeLibrary('lakutata_surely_missing', '', {search: ['/lakutata/nowhere']}), (error: unknown): boolean => {
            return error instanceof NativeLibraryNotFoundException && error.message.includes(path.join('/lakutata/nowhere', process.platform === 'darwin' ? 'liblakutata_surely_missing.dylib' : 'liblakutata_surely_missing.so'))
        })
        const closing: NativeLibraryHandle = loadNativeLibrary('c')
        const usleep = closing.func<(microseconds: number) => Promise<number>>('int usleep(uint32_t microseconds)', {async: true})
        const running: Promise<number> = usleep(50000)
        const closed: Promise<void> = closing.close()
        await assert.rejects(usleep(1), NativeLibraryClosedException)
        await running
        await closed
        assert.throws((): unknown => closing.func('int abs(int value)'), NativeLibraryClosedException)
    })

    it('lays out with koffi every struct as the platform does, packed ones and bitfields included', (): void => {
        const declarations = new DeclarationParser(CURRENT_PLATFORM).parse(`
            struct S1 { char a; int b; short c; };
            struct S5 { short a[3]; char b; struct S1 inner; void *p; };
            union U1 { char a; double b; int c[3]; };
            #pragma pack(push, 2)
            struct P1 { char a; int b; double c; };
            #pragma pack(pop)
            struct P3 { char a; int b; } __attribute__((packed));
            struct A1 { char a; int b __attribute__((aligned(8))); };
            struct B1 { char c; unsigned a : 3; unsigned b : 30; short s : 4; long long x; };
            struct B3 { char a; int : 0; char b; };
            struct B7 { char a; int b : 30; };
            struct Z7 { char a; long long : 1; };
            struct F { int count; double values[]; };
        `)
        for (const record of declarations.tags.values()) TYPES.type(record as RecordType)
    })
})

describe('SQLite, the library of the system', {skip: !POSIX && 'tested in the virtual machine'}, (): void => {

    let sqlite: NativeLibraryHandle | undefined

    before((): void => {
        try {
            sqlite = loadNativeLibrary({darwin: 'libsqlite3.dylib', default: 'libsqlite3.so.0'}, `
                typedef struct sqlite3 sqlite3;
                typedef struct sqlite3_stmt sqlite3_stmt;
                typedef int (*sqlite3_callback)(void *context, int count, char **values, char **names);
                #define SQLITE_OK 0
                #define SQLITE_ROW 100
                #define SQLITE_DONE 101
                #define SQLITE_TRANSIENT ((void *)-1)
            `)
        } catch {
            sqlite = undefined
        }
    })

    after(async (): Promise<void> => {
        await sqlite?.close()
    })

    it('opens a database, executes, prepares, binds, steps and reads the error messages', {skip: false}, async (context): Promise<void> => {
        if (!sqlite) return context.skip('SQLite is not installed')
        const open = sqlite.func<(filename: string, db: Out<Pointer>) => number>('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
        const exec = sqlite.func<(db: Pointer, sql: string, callback: ((context: Pointer | null, count: number, values: Pointer, names: Pointer) => number) | null, context: null, error: Out<string>) => number>('int sqlite3_exec(sqlite3 *db, const char *sql, sqlite3_callback callback, void *context, _Out_ char **error)', {free: 'sqlite3_free'})
        const execAsync = sqlite.func<(db: Pointer, sql: string, callback: ((context: Pointer | null, count: number, values: Pointer, names: Pointer) => number) | null, context: null, error: Out<string>) => Promise<number>>('int sqlite3_exec(sqlite3 *db, const char *sql, sqlite3_callback callback, void *context, _Out_ char **error)', {free: 'sqlite3_free', async: true})
        const prepare = sqlite.func<(db: Pointer, sql: string, length: number, statement: Out<Pointer>, tail: null) => number>('int sqlite3_prepare_v2(sqlite3 *db, const char *sql, int length, _Out_ sqlite3_stmt **statement, const char **tail)')
        const bindInt64 = sqlite.func<(statement: Pointer, index: number, value: bigint | number) => number>('int sqlite3_bind_int64(sqlite3_stmt *statement, int index, int64_t value)')
        const bindText = sqlite.func<(statement: Pointer, index: number, text: string, length: number, destructor: bigint) => number>('int sqlite3_bind_text(sqlite3_stmt *statement, int index, const char *text, int length, void *destructor)')
        const step = sqlite.func<(statement: Pointer) => number>('int sqlite3_step(sqlite3_stmt *statement)')
        const reset = sqlite.func<(statement: Pointer) => number>('int sqlite3_reset(sqlite3_stmt *statement)')
        const columnInt64 = sqlite.func<(statement: Pointer, column: number) => bigint>('int64_t sqlite3_column_int64(sqlite3_stmt *statement, int column)')
        const columnText = sqlite.func<(statement: Pointer, column: number) => string>('const char *sqlite3_column_text(sqlite3_stmt *statement, int column)')
        const finalize = sqlite.func<(statement: Pointer) => number>('int sqlite3_finalize(sqlite3_stmt *statement)')
        const close = sqlite.func<(db: Pointer) => number>('int sqlite3_close(sqlite3 *db)')
        const {SQLITE_OK, SQLITE_ROW, SQLITE_DONE, SQLITE_TRANSIENT} = sqlite.constants
        const db: Out<Pointer> = [null]
        assert.strictEqual(open(':memory:', db), Number(SQLITE_OK))
        const error: Out<string> = [null]
        assert.strictEqual(exec(db[0]!, 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)', null, null, error), 0)
        const statement: Out<Pointer> = [null]
        assert.strictEqual(prepare(db[0]!, 'INSERT INTO t (id, name) VALUES (?, ?)', -1, statement, null), 0)
        for (let i: number = 1; i <= 100; i++) {
            bindInt64(statement[0]!, 1, i)
            bindText(statement[0]!, 2, `name ${i} ü`, -1, SQLITE_TRANSIENT)
            assert.strictEqual(step(statement[0]!), Number(SQLITE_DONE))
            reset(statement[0]!)
        }
        finalize(statement[0]!)
        const rows: string[] = []
        exec(db[0]!, 'SELECT id, name FROM t WHERE id > 98 ORDER BY id', (context: Pointer | null, count: number, values: Pointer): number => {
            rows.push((readArray(values, 'char *', count) as string[]).join('|'))
            return 0
        }, null, error)
        assert.deepStrictEqual(rows, ['99|name 99 ü', '100|name 100 ü'])
        assert.strictEqual(prepare(db[0]!, 'SELECT count(*), max(name) FROM t', -1, statement, null), 0)
        assert.strictEqual(step(statement[0]!), Number(SQLITE_ROW))
        assert.strictEqual(columnInt64(statement[0]!, 0), 100n)
        assert.strictEqual(columnText(statement[0]!, 1), 'name 99 ü')
        finalize(statement[0]!)
        assert.notStrictEqual(exec(db[0]!, 'SELEC nonsense', null, null, error), 0)
        assert.match(error[0]!, /syntax error/)
        const sums: string[] = []
        await execAsync(db[0]!, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 300000) SELECT sum(x) FROM c', (context: Pointer | null, count: number, values: Pointer): number => {
            sums.push(readArray(values, 'char *', count)[0] as string)
            return 0
        }, null, error)
        assert.deepStrictEqual(sums, ['45000150000'])
        assert.strictEqual(close(db[0]!), 0)
    })
})

describe('The C library of the tests', (): void => {

    const file: string | undefined = compileFixture()
    let fixture: NativeLibraryHandle

    before((): void => {
        if (file) fixture = loadNativeLibrary('fixture', FIXTURE_DECLARATIONS, {search: [path.dirname(file)]})
    })

    after(async (): Promise<void> => {
        await fixture?.close()
        if (file) removeFixture(file)
    })

    const skip: string | false = !file && 'no C compiler'

    it('reads and writes the bitfields of structs by their names', {skip: skip}, (): void => {
        const make = fixture.func<(...args: (number | bigint)[]) => Record<string, number | bigint>>('struct flags flags_make(unsigned ready, unsigned mode, int level, unsigned char tag, uint64_t big)')
        const level = fixture.func<(flags: Record<string, unknown>) => number>('int flags_level(const struct flags *flags)')
        const big = fixture.func<(flags: Record<string, unknown>) => bigint>('uint64_t flags_big(struct flags flags)')
        const bump = fixture.func<(flags: Record<string, unknown>) => void>('void flags_bump(_Inout_ struct flags *flags)')
        const fill = fixture.func<(flags: Record<string, unknown>) => void>('void flags_fill(_Out_ struct flags *flags)')
        const made: Record<string, number | bigint> = make(1, 6, -7, 200, 0xABCDEF1234n)
        assert.deepStrictEqual(made, {ready: 1, mode: 6, level: -7, tag: 200, big: 0xABCDEF1234n})
        assert.strictEqual(level({ready: 0, mode: 0, level: -12, tag: 0, big: 0n}), -12)
        assert.strictEqual(big({ready: 1, mode: 2, level: 3, tag: 4, big: 0xFFFFFFFFFFn}), 0xFFFFFFFFFFn)
        const flags: Record<string, unknown> = {ready: 1, mode: 7, level: -16, tag: 5, big: 1n}
        bump(flags)
        assert.deepStrictEqual(flags, {ready: 1, mode: 0, level: 15, tag: 5, big: 1n})
        const filled: Record<string, unknown> = {}
        fill(filled)
        assert.deepStrictEqual(filled, {ready: 1, mode: 5, level: -3, tag: 9, big: 0n})
    })

    it('passes packed structs, structs of each size by value and unions', {skip: skip}, (): void => {
        assert.strictEqual(fixture.func('int32_t packed_sum(struct packed p)')({a: 1, b: 1000, c: -10}), 991)
        const packed: Record<string, unknown> = {}
        fixture.func('void packed_fill(_Out_ struct packed *p)')(packed)
        assert.deepStrictEqual(packed, {a: 1, b: 2, c: 3})
        assert.deepStrictEqual(fixture.func('struct s3 s3_make(uint8_t v)')(7), {a: Uint8Array.from([7, 8, 9])})
        assert.deepStrictEqual(fixture.func('struct s12 s12_make(float v)')(1.5), {x: 1.5, y: 3, z: 4.5})
        assert.deepStrictEqual(fixture.func('struct s16 s16_make(double v)')(2.25), {x: 2.25, y: -2.25})
        assert.deepStrictEqual(fixture.func('struct s24 s24_make(uint64_t v)')(9007199254740993n), {a: 9007199254740993n, b: 9007199254740994n, c: 9007199254740995n})
        assert.strictEqual(fixture.func('double s16_sum(struct s16 s)')({x: 1.5, y: 2}), 3.5)
        assert.strictEqual(fixture.func('int32_t number_int(union number n)')({i: 1234}), 1234)
    })

    it('gives the arrays of structs as typed arrays, the arrays of 64-bit integers as arrays of bigints', {skip: skip}, (): void => {
        const samples = fixture.func<(start: number) => {values: Int32Array, scale: number, totals: bigint[]}>('struct samples samples_make(int32_t start)')(5)
        assert.ok(samples.values instanceof Int32Array, String(samples.values?.constructor?.name))
        assert.deepStrictEqual([...samples.values], [5, 6, 7, 8])
        assert.strictEqual(samples.scale, 0.5)
        assert.deepStrictEqual(samples.totals, [50n, 9007199254740993n])
        //Given as typed arrays or as arrays of numbers
        const sum = fixture.func<(samples: Record<string, unknown>) => number>('int32_t samples_sum(const struct samples *s)')
        assert.strictEqual(sum({values: Int32Array.from([1, 2, 3, 4]), scale: 1, totals: [0n, 0n]}), 10)
        assert.strictEqual(sum({values: [4, 4, 4, 4], scale: 1, totals: [0, 0]}), 16)
    })

    it('calls callbacks kept by the library, and converts the 64-bit integers of callbacks', {skip: skip}, (): void => {
        const messages: string[] = []
        const logger: NativeCallback = fixture.callback('logger_t', (level: number, message: string): void => {
            messages.push(`${level} ${message}`)
        })
        fixture.func('void set_logger(logger_t logger)')(logger.pointer)
        const logNow = fixture.func<(level: number, message: string) => number>('int log_now(int level, const char *message)')
        assert.strictEqual(logNow(2, 'later'), 1)
        assert.strictEqual(logNow(3, 'again'), 1)
        assert.deepStrictEqual(messages, ['2 later', '3 again'])
        fixture.func('void set_logger(logger_t logger)')(null)
        logger.release()
        const apply = fixture.func<(mapper: (value: bigint) => bigint, value: bigint) => bigint>('int64_t apply_mapper(mapper_t mapper, int64_t value)')
        assert.strictEqual(apply((value: bigint): bigint => {
            assert.strictEqual(typeof value, 'bigint')
            return value * 2n
        }, 4503599627370497n), 9007199254740994n)
    })

    it('gives 64-bit integers as bigints, or as numbers when asked', {skip: skip}, (): void => {
        assert.strictEqual(fixture.func('int64_t big_negate(int64_t v)')(5), -5n)
        assert.strictEqual(fixture.func('size_t big_size(void)')(), 42n)
        assert.strictEqual(fixture.func('size_t big_size(void)', {int64: 'number'})(), 42)
        const out: Out<bigint> = [null]
        fixture.func('void big_out(_Out_ int64_t *out)')(out)
        assert.strictEqual(out[0], 9007199254740993n)
        assert.throws((): unknown => fixture.func('void big_out(_Out_ int64_t *out)', {int64: 'number'})([null]), RangeError)
    })

    it('reads and writes the variables it exports', {skip: skip}, (): void => {
        assert.strictEqual(fixture.variable('fixture_version').get(), '1.0')
        const counter = fixture.variable<number>('fixture_counter')
        assert.strictEqual(counter.get(), 5)
        counter.set(8)
        assert.strictEqual(counter.get(), 8)
        assert.throws((): void => fixture.variable('fixture_version').set('2.0'), /const/)
        assert.strictEqual(fixture.variable<number>('extern int fixture_counter').get(), 8)
    })

    it('frees the strings it gives, results and output strings, with the function given', {skip: skip}, (): void => {
        const frees = fixture.func<() => number>('int fixture_frees(void)')
        const dup = fixture.func<(text: string) => string>('char *fixture_dup(const char *text)', {free: 'fixture_free'})
        const dupOut = fixture.func<(text: string, out: Out<string>) => void>('void fixture_dup_out(const char *text, _Out_ char **out)', {free: 'fixture_free'})
        const before: number = frees()
        assert.strictEqual(dup('one'), 'one')
        const out: Out<string> = [null]
        dupOut('two', out)
        assert.strictEqual(out[0], 'two')
        assert.strictEqual(frees() - before, 2)
    })

    it('reads structs referring to themselves through pointers', {skip: skip}, (): void => {
        const make = fixture.func<(count: number) => Pointer>('struct node *list_make(int count)')
        const head: Pointer = make(3)
        const values: number[] = []
        for (let node: Pointer | null = head; node;) {
            const read = fixture.read<{value: number, next: Pointer | null}>(node, 'struct node')
            values.push(read.value)
            node = read.next
        }
        assert.deepStrictEqual(values, [1, 2, 3])
        fixture.func('void list_free(struct node *head)')(head)
    })
})
