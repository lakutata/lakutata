import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, spawnSync, type ChildProcess} from 'node:child_process'
import {createHash} from 'node:crypto'
import {access, mkdtemp, readdir, rm, unlink, utimes, writeFile} from 'node:fs/promises'
import {hostname, tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {Container} from '@lakutata/core'
import {FileMutexDriver, MemoryMutexDriver, Mutex, MutexLock, MutexLostException, MutexTimeoutException, type MutexDriverOptions} from '../exports/Mutex.js'

/**
 * A component of the locks, in a container of its own (an instance of an application)
 * @param driver
 * @param options
 */
async function instance(driver: MutexDriverOptions, options: Record<string, unknown> = {}): Promise<{ mutex: Mutex, container: Container }> {
    const container: Container = new Container()
    const mutex: Mutex = await container.set(Mutex, {driver: driver, ...options})
    return {mutex: mutex, container: container}
}

/**
 * Why a test resolving the modules of the scripts it writes (import.meta.resolve) is skipped: before Node.js 18.19 and
 * 20.6 it is behind a flag
 */
const NO_RESOLVE: string | false = typeof import.meta.resolve === 'function' ? false : 'import.meta.resolve needs Node.js 18.19, 20.6 or later'

describe('The locks', (): void => {

    let directory: string

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-mutex-'))
    })

    after(async (): Promise<void> => {
        await rm(directory, {recursive: true, force: true})
    })

    for (const type of ['memory', 'file'] as const) {
        const driver = (): MutexDriverOptions => type === 'file' ? {type: 'file', directory: directory} : {type: 'memory'}

        it(`excludes, waits for and releases the locks (${type})`, async (): Promise<void> => {
            const {mutex, container} = await instance(driver())
            try {
                const lock: MutexLock = (await mutex.tryAcquire('order:1'))!
                assert.ok(lock.held)
                assert.strictEqual(await mutex.tryAcquire('order:1'), undefined)
                assert.ok(await mutex.tryAcquire('order:2'))
                await assert.rejects(mutex.acquire('order:1', {timeout: 100}), MutexTimeoutException)
                await assert.rejects(mutex.acquire('order:1', {timeout: 0}), MutexTimeoutException)
                //Waited for: acquired once released
                const started: number = Date.now()
                setTimeout((): unknown => lock.release(), 150)
                const next: MutexLock = await mutex.acquire('order:1', {timeout: 2000})
                assert.ok(Date.now() - started >= 140)
                assert.strictEqual(lock.held, false)
                assert.strictEqual(await lock.release(), false)
                await next.release()
                //Its wait aborted
                const holding: MutexLock = (await mutex.tryAcquire('order:3'))!
                const abort: AbortController = new AbortController()
                setTimeout((): void => abort.abort(new Error('gone')), 50)
                await assert.rejects(mutex.acquire('order:3', {timeout: 5000, signal: abort.signal}), /gone/)
                await holding.release()
            } finally {
                await container.destroy()
            }
        })

        it(`runs the functions one at a time (${type})`, async (): Promise<void> => {
            const {mutex, container} = await instance(driver(), {retryDelay: 5})
            try {
                let running: number = 0
                let most: number = 0
                let counter: number = 0
                await Promise.all(Array.from({length: 10}, (): Promise<void> => mutex.synchronized('counter', async (): Promise<void> => {
                    most = Math.max(most, ++running)
                    const read: number = counter
                    await sleep(5)
                    counter = read + 1
                    running--
                }, {timeout: 10000})))
                assert.strictEqual(counter, 10)
                assert.strictEqual(most, 1)
                //Released after an error
                await assert.rejects(mutex.synchronized('counter', (): never => {
                    throw new Error('failed')
                }), /failed/)
                assert.strictEqual(await mutex.synchronized('counter', (lock: MutexLock): string => lock.name, {timeout: 0}), 'counter')
                //await using
                {
                    await using lock = await mutex.acquire('scoped')
                    assert.ok(lock.held)
                    assert.strictEqual(await mutex.tryAcquire('scoped'), undefined)
                }
                assert.ok(await mutex.tryAcquire('scoped'))
            } finally {
                await container.destroy()
            }
        })

        it(`renews the locks held, loses the ones which expired (${type})`, async (): Promise<void> => {
            const first = await instance(driver(), {ttl: 150})
            const second = await instance(driver(), {ttl: 150})
            try {
                const lock: MutexLock = (await first.mutex.tryAcquire('renewed'))!
                //Held longer than its time: renewed
                await sleep(500)
                assert.ok(lock.held)
                assert.strictEqual(await second.mutex.tryAcquire('renewed'), undefined)
                await lock.release()
                if (type === 'file') {
                    //Its file removed: lost at its renewal, its signal aborted
                    const lost: MutexLock = (await first.mutex.tryAcquire('lost'))!
                    for (const file of await readdir(directory)) await unlink(path.join(directory, file)).catch((): undefined => undefined)
                    await sleep(200)
                    assert.strictEqual(lost.held, false)
                    assert.ok(lost.signal.aborted)
                    assert.ok(lost.signal.reason instanceof MutexLostException)
                }
            } finally {
                await first.container.destroy()
                await second.container.destroy()
            }
        })

        it(`releases the locks of a component destroyed (${type})`, async (): Promise<void> => {
            const first = await instance(driver())
            const second = await instance(driver())
            try {
                assert.ok(await first.mutex.tryAcquire('destroyed'))
                assert.strictEqual(await second.mutex.tryAcquire('destroyed'), undefined)
                await first.container.destroy()
                assert.ok(await second.mutex.tryAcquire('destroyed'))
            } finally {
                await second.container.destroy()
            }
        })
    }

    it('gives increasing fencing tokens', async (): Promise<void> => {
        const {mutex, container} = await instance({type: 'memory'})
        try {
            const first: MutexLock = (await mutex.tryAcquire('fenced'))!
            await first.release()
            const second: MutexLock = (await mutex.tryAcquire('fenced'))!
            assert.ok(second.fence! > first.fence!)
        } finally {
            await container.destroy()
        }
    })

    it('excludes the processes of a host, takes over the locks of a process gone', {skip: NO_RESOLVE}, async (): Promise<void> => {
        const script: string = path.join(directory, 'holder.mjs')
        const exports: string = new URL('../exports/Mutex.js', import.meta.url).href
        const core: string = import.meta.resolve('@lakutata/core')
        await writeFile(script, `
            import {Container} from '${core}'
            import {Mutex} from '${exports}'
            const mutex = await new Container().set(Mutex, {driver: {type: 'file', directory: ${JSON.stringify(directory)}}, ttl: 60000})
            await mutex.tryAcquire('device:serial')
            console.log('held')
            setInterval(() => undefined, 1000)
        `)
        const child: ChildProcess = spawn(process.execPath, [script], {stdio: ['ignore', 'pipe', 'inherit']})
        const {mutex, container} = await instance({type: 'file', directory: directory})
        try {
            await new Promise<void>((resolve: () => void): unknown => child.stdout!.once('data', (): void => resolve()))
            assert.strictEqual(await mutex.tryAcquire('device:serial'), undefined)
            //Killed without releasing it: its process gone, its lock taken over before it expires
            child.kill('SIGKILL')
            await new Promise((resolve): unknown => child.once('exit', resolve))
            assert.ok(await mutex.tryAcquire('device:serial'))
            //A lock file abandoned while being written (empty): taken over once it is old enough
            const abandoned: string = path.join(directory, `${(await import('node:crypto')).createHash('sha256').update('lakutata:mutex:abandoned').digest('hex')}.lock`)
            await writeFile(abandoned, '')
            assert.strictEqual(await mutex.tryAcquire('abandoned'), undefined)
            await utimes(abandoned, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
            assert.ok(await mutex.tryAcquire('abandoned'))
        } finally {
            child.kill('SIGKILL')
            await container.destroy()
        }
    })

    it('renews a lock at the pace of its last time to live', async (): Promise<void> => {
        const {mutex, container} = await instance({type: 'memory'})
        const other = await instance({type: 'memory'})
        try {
            const lock: MutexLock = (await mutex.tryAcquire('shortened', {ttl: 3000}))!
            //Shortened: renewed every 50 ms from now on, not every second
            assert.ok(await lock.extend(150))
            await sleep(600)
            assert.ok(lock.held)
            assert.strictEqual(await other.mutex.tryAcquire('shortened'), undefined)
        } finally {
            await container.destroy()
            await other.container.destroy()
        }
    })

    it('does not renew the expired locks, nor replace the lock of a new holder', async (): Promise<void> => {
        const memory: MemoryMutexDriver = new MemoryMutexDriver('test:expired:')
        const first = (await memory.acquire('a', 50))!
        await sleep(80)
        assert.strictEqual(await memory.extend('a', first, 1000), false)
        const files: FileMutexDriver = new FileMutexDriver(directory, 'test:expired:')
        const held = (await files.acquire('b', 50))!
        await sleep(80)
        //Taken over once expired
        const taker = (await files.acquire('b', 10000))!
        assert.ok(taker)
        assert.strictEqual(await files.extend('b', held, 1000), false)
        assert.ok(await files.extend('b', taker, 10000))
        assert.ok(await files.release('b', taker))
    })

    it('never lets another holder in while a lock file is renewed', async (): Promise<void> => {
        //A lock of a minute renewed without pause, another holder trying to acquire it without pause: the file is
        //replaced at each renewal, never missing, so the other holder never gets it
        const holder: FileMutexDriver = new FileMutexDriver(directory, 'test:renewing:')
        const other: FileMutexDriver = new FileMutexDriver(directory, 'test:renewing:')
        const held = (await holder.acquire('c', 60000))!
        const end: number = Date.now() + 1000
        let renewals: number = 0
        let taken: number = 0
        await Promise.all([
            (async (): Promise<void> => {
                while (Date.now() < end) if (await holder.extend('c', held, 60000)) renewals++
            })(),
            (async (): Promise<void> => {
                while (Date.now() < end) if (await other.acquire('c', 60000)) taken++
            })()
        ])
        assert.strictEqual(taken, 0)
        assert.ok(renewals > 0)
        assert.ok(await holder.release('c', held))
    })

    it('never lets another holder in while a lock file is taken over', async (): Promise<void> => {
        //The taker paused at its second read, once it found the lock expired and started to take it over: the file is
        //still there (a takeover replaces it), and its guard keeps a third holder from taking it over too
        let reads: number = 0
        let reached: () => void = (): void => undefined
        let resume: () => void = (): void => undefined
        const pausing: Promise<void> = new Promise((resolve: () => void): void => {
            reached = resolve
        })
        const paused: Promise<void> = new Promise((resolve: () => void): void => {
            resume = resolve
        })

        class PausedDriver extends FileMutexDriver {
            protected async read<Content>(file: string): Promise<Content | undefined> {
                if (++reads === 2) {
                    reached()
                    await paused
                }
                return await super.read(file) as Content | undefined
            }
        }

        const file: string = path.join(directory, `${createHash('sha256').update('test:takeover:d').digest('hex')}.lock`)
        const holder: FileMutexDriver = new FileMutexDriver(directory, 'test:takeover:')
        const taker: PausedDriver = new PausedDriver(directory, 'test:takeover:')
        const third: FileMutexDriver = new FileMutexDriver(directory, 'test:takeover:')
        assert.ok(await holder.acquire('d', 50))
        await sleep(80)
        const taking = taker.acquire('d', 10000)
        await pausing
        await access(file)
        assert.strictEqual(await third.acquire('d', 10000), undefined)
        resume()
        const taken = (await taking)!
        assert.ok(taken)
        assert.strictEqual(await third.acquire('d', 10000), undefined)
        assert.ok(await taker.release('d', taken))
    })

    it('does not write again a lock released while it is renewed', async (): Promise<void> => {
        //The renewal paused once it checked the lock, just before it replaces the file: the release waits for it, then
        //removes the file, which the renewal does not create again
        let reached: () => void = (): void => undefined
        let resume: () => void = (): void => undefined
        const pausing: Promise<void> = new Promise((resolve: () => void): void => {
            reached = resolve
        })
        const paused: Promise<void> = new Promise((resolve: () => void): void => {
            resume = resolve
        })

        class PausedDriver extends FileMutexDriver {
            protected async replace(from: string, to: string, check: () => Promise<boolean>, deadline: number): Promise<boolean> {
                return await super.replace(from, to, async (): Promise<boolean> => {
                    const allowed: boolean = await check()
                    reached()
                    await paused
                    return allowed
                }, deadline)
            }
        }

        const file: string = path.join(directory, `${createHash('sha256').update('test:released:g').digest('hex')}.lock`)
        const renewer: PausedDriver = new PausedDriver(directory, 'test:released:')
        const releaser: FileMutexDriver = new FileMutexDriver(directory, 'test:released:')
        const held = (await renewer.acquire('g', 10000))!
        const renewing: Promise<boolean> = renewer.extend('g', held, 10000)
        await pausing
        const releasing: Promise<boolean> = releaser.release('g', held)
        await sleep(50)
        resume()
        assert.ok(await renewing)
        assert.ok(await releasing)
        await assert.rejects(access(file))
    })

    it('lets only one of the holders racing for an expired lock take it over', async (): Promise<void> => {
        const drivers: FileMutexDriver[] = Array.from({length: 4}, (): FileMutexDriver => new FileMutexDriver(directory, 'test:race:'))
        for (let round: number = 0; round < 30; round++) {
            assert.ok(await drivers[0].acquire(`r${round}`, 20))
            await sleep(30)
            const taken = (await Promise.all(drivers.map((driver: FileMutexDriver) => driver.acquire(`r${round}`, 10000)))).filter(Boolean)
            assert.strictEqual(taken.length, 1, `round ${round}`)
        }
    })

    it('breaks the guard of a process gone or held too long, and waits for one held', async (): Promise<void> => {
        const driver: FileMutexDriver = new FileMutexDriver(directory, 'test:guard:')
        const guard: string = path.join(directory, `${createHash('sha256').update('test:guard:e').digest('hex')}.lock.guard`)
        const gone: number = spawnSync(process.execPath, ['-e', '']).pid!
        //An expired lock whose guard was left by a process gone, then by one which held it longer than 5 seconds: taken
        //over all the same
        for (const left of [{pid: gone, since: Date.now()}, {pid: process.pid, since: Date.now() - 6000}]) {
            assert.ok(await driver.acquire('e', 20))
            await sleep(30)
            await writeFile(guard, JSON.stringify({token: 'left', host: hostname(), ...left}))
            const taken = (await driver.acquire('e', 10000))!
            assert.ok(taken)
            assert.ok(await driver.release('e', taken))
        }
        //A guard held by a running process: a takeover gives up, a release waits for it
        assert.ok(await driver.acquire('e', 20))
        await sleep(30)
        await writeFile(guard, JSON.stringify({token: 'held', pid: process.pid, host: hostname(), since: Date.now()}))
        assert.strictEqual(await driver.acquire('e', 10000), undefined)
        await unlink(guard)
        const taken = (await driver.acquire('e', 10000))!
        assert.ok(taken)
        await writeFile(guard, JSON.stringify({token: 'held', pid: process.pid, host: hostname(), since: Date.now()}))
        const started: number = Date.now()
        setTimeout((): unknown => unlink(guard), 150)
        assert.ok(await driver.release('e', taken))
        assert.ok(Date.now() - started >= 140)
    })

    it('tries once with a timeout of 0, the round trip of a slow store included', async (): Promise<void> => {
        //A store answering in 20 ms: the attempt is not cut short by the timeout
        const acquire: MemoryMutexDriver['acquire'] = MemoryMutexDriver.prototype.acquire
        MemoryMutexDriver.prototype.acquire = async function (this: MemoryMutexDriver, name: string, ttl: number): ReturnType<MemoryMutexDriver['acquire']> {
            await sleep(20)
            return acquire.call(this, name, ttl)
        }
        const {mutex, container} = await instance({type: 'memory'})
        try {
            for (let round: number = 0; round < 20; round++) {
                //Free: acquired, every time
                const lock: MutexLock = await mutex.acquire('slow', {timeout: 0})
                //Held: refused after the one attempt, without waiting
                const started: number = Date.now()
                await assert.rejects(mutex.acquire('slow', {timeout: 0}), MutexTimeoutException)
                assert.ok(Date.now() - started < 500, `${Date.now() - started} ms`)
                await lock.release()
            }
        } finally {
            MemoryMutexDriver.prototype.acquire = acquire
            await container.destroy()
        }
    })

    it('gives up waiting when the store does not answer, its attempt given a second', async (): Promise<void> => {
        const {mutex, container} = await instance({type: 'redis', host: '127.0.0.1', port: 1})
        try {
            const started: number = Date.now()
            await assert.rejects(mutex.acquire('unreachable', {timeout: 300}), MutexTimeoutException)
            assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`)
        } finally {
            await container.destroy()
        }
    })

    it('refuses the invalid table names in the options', async (): Promise<void> => {
        await assert.rejects(instance({type: 'postgres', host: 'localhost', database: 'db', username: 'u', password: 'p', mode: 'table', table: 'locks; DROP TABLE users'} as MutexDriverOptions), {name: 'InvalidValueException'})
    })
})
