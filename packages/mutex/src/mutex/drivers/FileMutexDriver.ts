import {link, mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises'
import {hostname} from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {lockToken, nameDigest} from '../lib/Names.js'

//A rename of a file another process has open fails on Windows: tried again every RENAME_DELAY milliseconds
const RENAME_BUSY: string[] = ['EPERM', 'EACCES', 'EBUSY']
const RENAME_DELAY: number = 5
//How long a removal is tried again on Windows, in milliseconds
const REMOVE_WAIT: number = 1000
//A file left unchanged this long (its process ended or stalled while it held it), in milliseconds: a lock file which
//cannot be read is abandoned, a guard is broken
const ABANDONED: number = 5000

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
 * The content of the guard of a lock file: its holder (its token, its process and its host), when it was entered
 */
type GuardFile = {
    token: string
    pid: number
    host: string
    since: number
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
 *
 * The file of a lock is created only where none exists, and it is missing only once its holder released it: a renewal
 * and a takeover replace it at once (a new file renamed over it). The renewals, the takeovers and the releases of a lock
 * run one at a time, each in the guard of the lock: a file created exclusively next to it for the few operations they
 * take.
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
     * Read a lock file, or a guard file.
     * @param file The file path.
     * @returns Its content, or `undefined` when it does not exist or cannot be parsed (being written).
     */
    protected async read<Content = LockFile>(file: string): Promise<Content | undefined> {
        try {
            return JSON.parse(await readFile(file, 'utf8')) as Content
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
     * Whether a file which cannot be read was abandoned (its process ended while writing it) rather than being written:
     * unchanged for more than 5 seconds.
     * @param file The file path.
     * @returns Whether it may be taken over.
     */
    protected async abandoned(file: string): Promise<boolean> {
        try {
            return Date.now() - (await stat(file)).mtimeMs > ABANDONED
        } catch {
            return false
        }
    }

    /**
     * Replace a file at once, never missing: the file of the new content is renamed over it, when `check` still allows
     * it just before. On Windows, a rename over a file another process is reading fails: it is tried again until
     * `deadline`.
     * @param from The file of the new content, removed in any case.
     * @param to The file replaced.
     * @param check Whether the file may still be replaced, called before each attempt.
     * @param deadline When the attempts end, in milliseconds since the epoch.
     * @returns Whether the file was replaced.
     * @throws {Error} When the rename fails otherwise, or still fails at the deadline.
     */
    protected async replace(from: string, to: string, check: () => Promise<boolean>, deadline: number): Promise<boolean> {
        try {
            for (; ;) {
                if (!(await check())) return false
                try {
                    await rename(from, to)
                    return true
                } catch (error: unknown) {
                    if (Date.now() >= deadline || !RENAME_BUSY.includes((error as NodeJS.ErrnoException).code!)) throw error
                }
                await sleep(RENAME_DELAY)
            }
        } finally {
            await unlink(from).catch((): undefined => undefined)
        }
    }

    /**
     * Remove a file, its name free at once: renamed first, then deleted (on Windows, a file deleted while another process
     * reads it keeps its name until it is closed). The rename is tried again for a second when the file is busy.
     * @param file The file path.
     * @returns Whether the file was removed (`false` when it no longer exists).
     * @throws {Error} When the rename fails otherwise, or is still busy after a second.
     */
    protected async remove(file: string): Promise<boolean> {
        const removed: string = `${file}.${lockToken()}`
        const deadline: number = Date.now() + REMOVE_WAIT
        for (; ;) {
            try {
                await rename(file, removed)
                break
            } catch (error: unknown) {
                const code: string = (error as NodeJS.ErrnoException).code!
                if (code === 'ENOENT') return false
                if (Date.now() >= deadline || !RENAME_BUSY.includes(code)) throw error
            }
            await sleep(RENAME_DELAY)
        }
        await unlink(removed).catch((): undefined => undefined)
        return true
    }

    /**
     * Enter the guard of a lock file, in which a lock is renewed, taken over or released: a file created exclusively
     * next to it, so that no other process replaces or removes the lock file meanwhile. A guard whose process of this host is gone,
     * or held for more than 5 seconds, is broken. Breaking it renames it away and puts it back when it was entered again
     * meanwhile: a guard broken by two processes at once, while a third one enters it, can still be held twice.
     * @param file The lock file path.
     * @param wait Whether to wait for a guard held by another process (until it is left or broken), else give up at once.
     * @returns The token of the guard entered, or `undefined` when another process holds it and `wait` is `false`.
     * @throws {Error} When the guard file cannot be written (permissions, disk full).
     */
    protected async enter(file: string, wait: boolean): Promise<string | undefined> {
        const guard: string = `${file}.guard`
        const token: string = lockToken()
        for (; ;) {
            try {
                await writeFile(guard, JSON.stringify({token: token, pid: process.pid, host: this.#host, since: Date.now()} satisfies GuardFile), {flag: 'wx'})
                return token
            } catch (error: unknown) {
                const code: string = (error as NodeJS.ErrnoException).code!
                if (code !== 'EEXIST' && !RENAME_BUSY.includes(code)) throw error
            }
            const held: GuardFile | undefined = await this.read<GuardFile>(guard)
            const broken: boolean = held
                ? Date.now() - held.since > ABANDONED || (held.host === this.#host && held.pid !== process.pid && !processRuns(held.pid))
                : await this.abandoned(guard)
            //Broken: entered again at once, unless it could not be renamed away yet (busy on Windows)
            if (broken && await this.unguard(guard, held?.token)) continue
            if (!broken && !wait) return undefined
            await sleep(RENAME_DELAY)
        }
    }

    /**
     * Remove a guard broken, when it is still the one read: renamed away first, so that only one process removes it,
     * and put back when it is not (entered again meanwhile) and its place is still free.
     * @param guard The guard file path.
     * @param token The token read in the guard, `undefined` when it could not be read.
     * @returns Whether the guard could be renamed away (`false` when it no longer exists, or is busy on Windows).
     */
    protected async unguard(guard: string, token: string | undefined): Promise<boolean> {
        const taken: string = `${guard}.${lockToken()}`
        try {
            await rename(guard, taken)
        } catch {
            return false
        }
        if ((await this.read<GuardFile>(taken))?.token !== token) await link(taken, guard).catch((): undefined => undefined)
        await unlink(taken).catch((): undefined => undefined)
        return true
    }

    /**
     * Leave the guard of a lock file, when it is still the one entered. It does not throw: a guard that cannot be
     * removed (busy on Windows) is broken after 5 seconds.
     * @param file The lock file path.
     * @param token The token of the guard entered.
     */
    protected async leave(file: string, token: string): Promise<void> {
        const guard: string = `${file}.guard`
        try {
            if ((await this.read<GuardFile>(guard))?.token === token) await this.remove(guard)
        } catch {
            //Left behind: broken later
        }
    }

    /**
     * Try to acquire a lock once: create its file exclusively, or take over a file expired, abandoned, or whose process
     * of this host is gone. A takeover happens in the guard of the lock (another process taking it over at the same time
     * gives up), and replaces the file at once while it is still the one read: another process never finds it missing.
     * @param name The lock name.
     * @param ttl How long the lock stays held without a renewal, in milliseconds.
     * @returns The lock (without fencing token), or `undefined` when another holder has it.
     * @throws {Error} When the directory cannot be created or the file written (permissions, disk full), or when a file
     * taken over cannot be replaced (busy on Windows for a third of `ttl`).
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
            const guard: string | undefined = await this.enter(file, false)
            if (!guard) return undefined
            try {
                const replacement: string = `${file}.${lockToken()}`
                await writeFile(replacement, content)
                //Still the file read as stale (not renewed, released or taken over meanwhile), or still abandoned
                const unchanged = async (): Promise<boolean> => {
                    const now: LockFile | undefined = await this.read(file)
                    return current ? now?.token === current.token && now.expires === current.expires : !now && await this.abandoned(file)
                }
                if (await this.replace(replacement, file, unchanged, Date.now() + ttl / 3)) return lock
            } finally {
                await this.leave(file, guard)
            }
            //Changed meanwhile: created again when it was released, else held
        }
        return undefined
    }

    /**
     * Release a lock by removing its file, when the file still holds this holder's token. The release waits for the
     * guard of the lock, so that the file it removes is not replaced meanwhile.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @returns Whether it was released.
     */
    public async release(name: string, lock: DriverLock): Promise<boolean> {
        const file: string = this.file(name)
        const guard: string = (await this.enter(file, true))!
        try {
            //Its own file, even when a renewal still running changed its expiration
            if ((await this.read(file))?.token !== lock.token) return false
            return await this.remove(file)
        } finally {
            await this.leave(file, guard)
        }
    }

    /**
     * Renew a lock whose file still holds this holder's token, for `ttl` milliseconds from now: the new content is
     * written to a file of its own, then renamed over the lock file, which is replaced at once and never missing (another
     * process cannot create it meanwhile). The renewal waits for the guard of the lock: a lock released meanwhile is not
     * written again, and a lock is not taken over between its check and its replacement. A lock expired is not renewed
     * (lost), even when no other process took it over yet. On Windows, a rename over a file another process is reading
     * is tried again, for a third of `ttl` at most (the pace of the component's renewals).
     * @param name The lock name.
     * @param lock The lock acquired.
     * @param ttl How long the lock stays held without another renewal, in milliseconds.
     * @returns Whether it was renewed.
     * @throws {Error} When the new content cannot be written or renamed over the lock file (the component tries again
     * until the lock expires).
     */
    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const file: string = this.file(name)
        //Expired: lost, even when nobody took it yet
        const valid = async (): Promise<LockFile | undefined> => {
            const content: LockFile | undefined = await this.read(file)
            return content?.token === lock.token && content.expires > Date.now() ? content : undefined
        }
        if (!(await valid())) return false
        const guard: string = (await this.enter(file, true))!
        try {
            const current: LockFile | undefined = await valid()
            if (!current) return false
            const renewed: string = `${file}.${lockToken()}`
            await writeFile(renewed, JSON.stringify({...current, expires: Date.now() + ttl} satisfies LockFile))
            return await this.replace(renewed, file, async (): Promise<boolean> => !!(await valid()), Date.now() + ttl / 3)
        } finally {
            await this.leave(file, guard)
        }
    }

    /**
     * Do nothing: the driver keeps no file open; the lock files stay until they are released or taken over.
     */
    public async close(): Promise<void> {
        //Nothing kept open
    }
}
