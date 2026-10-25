import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {
    buildNativeLibraryOptions,
    Library,
    Native,
    NativeDeclarationException,
    NativeLibrary,
    NativeLibraryClosedException,
    NativeLibraryNotFoundException,
    NativeVariable,
    type Out,
    type Pointer
} from '../exports/FFI.js'
import {compileFixture, FIXTURE_DECLARATIONS, removeFixture} from './support/Fixture.js'

const POSIX: boolean = process.platform !== 'win32'

@Library({
    names: 'c',
    declarations: `
        int abs(int value);
        typedef void *(*thread_main_t)(void *argument);
        #define LIMIT (1 << 4)
    `
})
class LibC extends NativeLibrary {
    @Native()
    public readonly abs: (value: number) => number

    @Native('size_t strlen(const char *text)')
    public readonly strlen: (text: string) => bigint

    @Native('int usleep(uint32_t microseconds)', {async: true})
    public readonly usleep: (microseconds: number) => Promise<number>

    @Native('int pthread_create(_Out_ void **thread, void *attributes, thread_main_t main, void *argument)')
    public readonly pthreadCreate: (thread: Out<Pointer>, attributes: null, main: Pointer, argument: null) => number

    @Native('int pthread_detach(void *thread)')
    public readonly pthreadDetach: (thread: Pointer) => number
}

/**
 * A library declared by a parent class, with a function of its own
 */
class LibCWithDiv extends LibC {
    @Native('int atoi(const char *text)')
    public readonly atoi: (text: string) => number
}

class Undeclared extends NativeLibrary {
}

@Library({names: 'c'})
class BadPrototype extends NativeLibrary {
    @Native('vendor_t make(void)')
    public readonly make: () => unknown
}

describe('A library component', {skip: !POSIX && 'the Windows libraries are tested in the virtual machine'}, (): void => {

    it('binds its functions to its properties when created, and gives its constants', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('libc', LibC, {})
            const libc: LibC = await container.get<LibC>('libc')
            assert.strictEqual(libc.abs(-3), 3)
            assert.strictEqual(libc.strlen('héllo'), 6n)
            assert.strictEqual(await libc.usleep(1000), 0)
            assert.strictEqual(libc.constants.LIMIT, 16n)
            assert.strictEqual(libc.func<(text: string) => number>('int atoi(const char *text)')('42'), 42)
            assert.ok(libc.file.length > 0)
        } finally {
            await container.destroy()
        }
    })

    it('throws from its properties once destroyed, after waiting for its asynchronous calls', async (): Promise<void> => {
        const container: Container = new Container()
        await container.setNamed('libc', LibC, {})
        const libc: LibC = await container.get<LibC>('libc')
        const running: Promise<number> = libc.usleep(80000)
        const started: number = Date.now()
        await container.destroy()
        assert.ok(Date.now() - started >= 50, 'the destruction waited for the call')
        assert.strictEqual(await running, 0)
        assert.throws((): number => libc.abs(-1), NativeLibraryClosedException)
        await assert.rejects(libc.usleep(1), NativeLibraryClosedException)
    })

    it('gives the exceptions of its persistent callbacks as error events', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('libc', LibC, {})
            const libc: LibC = await container.get<LibC>('libc')
            const errors: unknown[] = []
            libc.on('error', (error: unknown): unknown => errors.push(error))
            let called: number = 0
            const callback = libc.callback('thread_main_t', (): null => {
                called++
                throw new Error('thrown in a thread')
            })
            const thread: Out<Pointer> = [null]
            assert.strictEqual(libc.pthreadCreate(thread, null, callback.pointer, null), 0)
            libc.pthreadDetach(thread[0]!)
            for (let i: number = 0; i < 100 && !errors.length; i++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
            assert.strictEqual(called, 1)
            assert.match(String(errors[0]), /thrown in a thread/)
        } finally {
            await container.destroy()
        }
    })

    it('inherits the library of its parent class, with functions of its own', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('libc', LibCWithDiv, {})
            const libc: LibCWithDiv = await container.get<LibCWithDiv>('libc')
            assert.strictEqual(libc.atoi('17'), 17)
            assert.strictEqual(libc.abs(-17), 17)
        } finally {
            await container.destroy()
        }
    })

    it('is created again in another container, its types made once', async (): Promise<void> => {
        for (let i: number = 0; i < 3; i++) {
            const container: Container = new Container()
            await container.setNamed('libc', LibC, {})
            assert.strictEqual((await container.get<LibC>('libc')).abs(-i), i)
            await container.destroy()
        }
    })

    it('refuses a class without @Library, a prototype it cannot read, a library it cannot find', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await assert.rejects(container.setNamed('undeclared', Undeclared, {}), (error: unknown): boolean => error instanceof NativeDeclarationException && /Undeclared has no @Library/.test(error.message))
            await assert.rejects(container.setNamed('bad', BadPrototype, {}), (error: unknown): boolean => error instanceof NativeDeclarationException && /Unknown type vendor_t/.test(error.message))
            await assert.rejects(container.setNamed('missing', LibC, {path: '/lakutata/surely/missing.so'}), NativeLibraryNotFoundException)
        } finally {
            await container.destroy()
        }
    })

    it('is declared in the components by buildNativeLibraryOptions', (): void => {
        assert.deepStrictEqual(buildNativeLibraryOptions(LibC, {search: ['@data/native'], drainTimeout: 100}), {class: LibC, search: ['@data/native'], drainTimeout: 100})
    })
})

describe('A library component of the C library of the tests', (): void => {

    const file: string | undefined = compileFixture()

    @Library({names: 'fixture', declarations: FIXTURE_DECLARATIONS})
    class Fixture extends NativeLibrary {
        @NativeVariable()
        public fixture_counter: number

        @NativeVariable('fixture_version')
        public readonly version: string

        @Native('struct flags flags_make(unsigned ready, unsigned mode, int level, unsigned char tag, uint64_t big)')
        public readonly makeFlags: (ready: number, mode: number, level: number, tag: number, big: bigint) => {ready: number, mode: number, level: number, tag: number, big: bigint}
    }

    after((): void => {
        if (file) removeFixture(file)
    })

    it('reads and writes its variables through its properties, found by its configured directories', {skip: !file && 'no C compiler'}, async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('fixture', Fixture, {search: [path.dirname(file!)]})
            const fixture: Fixture = await container.get<Fixture>('fixture')
            assert.strictEqual(fixture.version, '1.0')
            const before: number = fixture.fixture_counter
            fixture.fixture_counter = before + 3
            assert.strictEqual(fixture.fixture_counter, before + 3)
            assert.throws((): void => {
                (fixture as unknown as {version: string}).version = '2.0'
            }, /const/)
            assert.deepStrictEqual(fixture.makeFlags(1, 2, -3, 4, 5n), {ready: 1, mode: 2, level: -3, tag: 4, big: 5n})
        } finally {
            await container.destroy()
        }
    })

    it('is loaded from the file of its configuration', {skip: !file && 'no C compiler'}, async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('fixture', Fixture, {path: file})
            const fixture: Fixture = await container.get<Fixture>('fixture')
            assert.strictEqual(fixture.file, file)
            assert.strictEqual(fixture.version, '1.0')
        } finally {
            await container.destroy()
        }
    })
})
