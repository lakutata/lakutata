import {link, mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises'
import {hostname} from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {lockToken, nameDigest} from '../lib/Names.js'

//A rename over a lock file another process has open fails on Windows: tried again every RENAME_DELAY milliseconds
const RENAME_BUSY: string[] = ['EPERM', 'EACCES', 'EBUSY']
const RENAME_DELAY: number = 5

/**
 * The content of a lock file: its holder (its token, its process and its host), its expiration
 */
type LockFile = {
    name: string
    token: string
    pid: number
    host: string
    expires: number
}

/**
 * Whether a process of this host runs
 * @param pid
 */
function processRuns(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error: unknown) {
        //Running, but not ours to signal
        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}

/**
 * The file driver (`{type: 'file'}`): each lock is a file of a directory, created exclusively, shared by the processes of
 * one host using the same directory and prefix (several workers or applications of a machine). It needs no package.
 * The processes must share the directory: the default one (`lakutata-mutex` in the operating system's temporary
 * directory) can differ between users. A directory shared by several hosts (a network file system) works only as far
 * as its exclusive creation and renames are atomic, and only the expiration then frees the lock of a crashed host.
 *
 * The locks expire after their `ttl` unless renewed; a lock whose process is gone on this host is taken over at once,
 * without waiting for its expiration. The driver gives no fencing token (`fence` is `undefined`).
 * @example
 * ```typescript
 * import {FileMutexDriver, type DriverLock} from 'lakutata/com/mutex'
 *
 * //The workers of this machine run the migration one at a time
 * const driver: FileMutexDriver = new FileMutexDriver('/var/lock/my-app', 'my-app:')
 * const lock: DriverLock | undefined = await driver.acquire('migrate', 60000)
 * if (lock) {
 *     try {
 *         console.log('migrating')
 *     } finally {
 *         await driver.release('migrate', lock)
 *     }
 * }
 * ```
 */
export class FileMutexDriver extends MutexDriver {

    /**
     * `true`: the locks expire after their `ttl` unless renewed.
     */
    public readonly expiring: boolean = true

    readonly #host: string = hostname()

    /**
     * Create a driver on a directory, created at the first acquisition when it does not exist.
     * @param directory The directory of the lock files.
     * @param prefix The prefix added to the lock names; `''` by default.
     */
    constructor(protected readonly directory: string, protected readonly prefix: string = '') {
        super()
    }

    /**
     * The path of a lock's file: the SHA-256 digest of the prefixed name, with the extension `.lock`.
     * @param name The lock name.
     * @returns The file path.
     */
    protected file(name: string): string {
        return path.join(this.directory, `${nameDigest(this.prefix + name)}.lock`)
    }

    /**
     * Read a lock file.
     * @param file The file path.
     * @returns Its content, or `undefined` when it does not exist or cannot be parsed (being written).
     */
    protected async read(file: string): Promise<LockFile | undefined> {
        try {
            return JSON.parse(await readFile(file, 'utf8')) as LockFile
        } catch {
            //Not there, or being written
            return undefined
        }
    }

    /**
     * Whether a lock file is no longer held: expired, or written by another process of this host which no longer runs.
     * @param lock The content of the lock file.
     * @returns Whether it may be taken over.
     */
    protected stale(lock: LockFile): boolean {
        return lock.expires <= Date.now() || (lock.host === this.#host && lock.pid !== process.pid && !processRuns(lock.pid))
    }

    /**
     * Whether a lock file which cannot be read was abandoned (its process ended while writing it) rather than being
     * written: unchanged for more than 5 seconds.
     * @param file The file path.
     * @returns Whether it may be taken over.
     */
    protected async abandoned(file: string): Promise<boolean> {
        try {
            return Date.now() - (await stat(file)).mtimeMs > 5000
        } catch {
            return false
        }
    }

    /**
     * Remove a lock file when it is still the one read, by renaming it first so that only one process takes it. A file
     * of another holder taken by mistake is put back when its place is still free.
     * @param file The file path.
     * @param same Whether the content of the file taken (`undefined` when it cannot be read) is the one read.
     * @returns Whether the file was removed.
     */
    protected async take(file: string, same: (content: LockFile | undefined) => boolean): Promise<boolean> {
        const taken: string = `${file}.${lockToken()}`
        try {
            await rename(file, taken)
        } catch {
            return false
        }
        const content: LockFile | undefined = await this.read(taken)
        if (same(content)) {
            await unlink(taken).catch((): undefined => undefined)
            return true
        }
        //Another lock was taken: given back when its place is free
        await link(taken, file).catch((): undefined => undefined)
        await unlink(taken).catch((): undefined => undefined)
        return false
    }

    /**
     * Try to acquire a lock once: create its file exclusively, or take over a file expired, abandoned, or whose process
     * of this host is gone.
     * @param name The lock name.
     * @param ttl How long the lock stays held without a renewal, in milliseconds.
     * @returns The lock (without fencing token), or `undefined` when another holder has it.
     * @throws {Error} When the directory cannot be created or the file written (permissions, disk full).
     */
    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        await mkdir(this.directory, {recursive: true})
        const file: string = this.file(name)
        const lock: DriverLock = {token: lockToken()}
        const content: string = JSON.stringify({name: name, token: lock.token, pid: process.pid, host: this.#host, expires: Date.now() + ttl} satisfies LockFile)
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await writeFile(file, content, {flag: 'wx'})
                return lock
            } catch (error: unknown) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            }
            const current: LockFile | undefined = await this.read(file)
            if (current ? !this.stale(current) : !(await this.abandoned(file))) return undefined
            //The file read as stale, not one renewed meanwhile (the same token, a later expiration)
            if (!(await this.take(file, (content: LockFile | undefined): boolean => content?.token === current?.token && content?.expires === current?.expires))) return undefined
        }
        return undefined
    }

    /**
     * Release a lock by removing its file, when the file still holds this holder's token.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @returns Whether it was released.
     */
    public async release(name: string, lock: DriverLock): Promise<boolean> {
        const file: string = this.file(name)
        if ((await this.read(file))?.token !== lock.token) return false
        //Its own file, even when a renewal still running changed its expiration
        return await this.take(file, (content: LockFile | undefined): boolean => content?.token === lock.token)
    }

    /**
     * Renew a lock whose file still holds this holder's token, for `ttl` milliseconds from now: the new content is
     * written to a file of its own, then renamed over the lock file, which is replaced at once and never missing (another
     * process cannot create it meanwhile). A lock expired is not renewed (lost), even when no other process took it over
     * yet. On Windows, a rename over a file another process is reading is tried again, for a third of `ttl` at most (the
     * pace of the component's renewals).
     * @param name The lock name.
     * @param lock The lock acquired.
     * @param ttl How long the lock stays held without another renewal, in milliseconds.
     * @returns Whether it was renewed.
     * @throws {Error} When the new content cannot be written or renamed over the lock file (the component tries again
     * until the lock expires).
     */
    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const file: string = this.file(name)
        const current: LockFile | undefined = await this.read(file)
        //Expired: lost, even when nobody took it yet
        if (current?.token !== lock.token || current.expires <= Date.now()) return false
        const renewed: string = `${file}.${lockToken()}`
        await writeFile(renewed, JSON.stringify({...current, expires: Date.now() + ttl} satisfies LockFile))
        const deadline: number = Date.now() + ttl / 3
        try {
            for (; ;) {
                //Still its own and not expired just before it is replaced: a lock taken over is not overwritten
                const content: LockFile | undefined = await this.read(file)
                if (content?.token !== lock.token || content.expires <= Date.now()) return false
                try {
                    await rename(renewed, file)
                    return true
                } catch (error: unknown) {
                    if (Date.now() >= deadline || !RENAME_BUSY.includes((error as NodeJS.ErrnoException).code!)) throw error
                }
                await sleep(RENAME_DELAY)
            }
        } finally {
            await unlink(renewed).catch((): undefined => undefined)
        }
    }

    /**
     * Do nothing: the driver keeps no file open; the lock files stay until they are released or taken over.
     */
    public async close(): Promise<void> {
        //Nothing kept open
    }
}
