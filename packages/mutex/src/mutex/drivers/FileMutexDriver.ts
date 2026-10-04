import {link, mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises'
import {hostname} from 'node:os'
import path from 'node:path'
import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LockToken, NameDigest} from '../lib/Names.js'

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
function ProcessRuns(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error: unknown) {
        //Running, but not ours to signal
        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}

/**
 * The locks of the processes of a host: a file created exclusively (O_EXCL) for each lock in a directory; a lock expired,
 * or whose process of this host is gone, is taken over
 */
export class FileMutexDriver extends MutexDriver {

    public readonly expiring: boolean = true

    readonly #host: string = hostname()

    constructor(protected readonly directory: string, protected readonly prefix: string = '') {
        super()
    }

    protected file(name: string): string {
        return path.join(this.directory, `${NameDigest(this.prefix + name)}.lock`)
    }

    protected async read(file: string): Promise<LockFile | undefined> {
        try {
            return JSON.parse(await readFile(file, 'utf8')) as LockFile
        } catch {
            //Not there, or being written
            return undefined
        }
    }

    /**
     * Whether a lock file is not held any more: expired, or its process of this host gone
     * @param lock
     */
    protected stale(lock: LockFile): boolean {
        return lock.expires <= Date.now() || (lock.host === this.#host && lock.pid !== process.pid && !ProcessRuns(lock.pid))
    }

    /**
     * Whether a lock file which cannot be read was abandoned (its process ended while writing it), not being written
     * @param file
     */
    protected async abandoned(file: string): Promise<boolean> {
        try {
            return Date.now() - (await stat(file)).mtimeMs > 5000
        } catch {
            return false
        }
    }

    /**
     * Take a lock file away when it still is the one read (renamed: only one taker has it); the one of another holder
     * taken meanwhile given back
     * @param file
     * @param token
     */
    protected async take(file: string, token: string | undefined): Promise<boolean> {
        const taken: string = `${file}.${LockToken()}`
        try {
            await rename(file, taken)
        } catch {
            return false
        }
        const content: LockFile | undefined = await this.read(taken)
        if (content?.token === token) {
            await unlink(taken).catch((): undefined => undefined)
            return true
        }
        //Another lock was taken: given back when its place is free
        await link(taken, file).catch((): undefined => undefined)
        await unlink(taken).catch((): undefined => undefined)
        return false
    }

    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        await mkdir(this.directory, {recursive: true})
        const file: string = this.file(name)
        const lock: DriverLock = {token: LockToken()}
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
            if (!(await this.take(file, current?.token))) return undefined
        }
        return undefined
    }

    public async release(name: string, lock: DriverLock): Promise<boolean> {
        const file: string = this.file(name)
        if ((await this.read(file))?.token !== lock.token) return false
        return await this.take(file, lock.token)
    }

    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const file: string = this.file(name)
        const current: LockFile | undefined = await this.read(file)
        if (current?.token !== lock.token) return false
        //Written aside, then renamed over it (the readers never read a part of it)
        const next: string = `${file}.${LockToken()}`
        await writeFile(next, JSON.stringify({...current, expires: Date.now() + ttl} satisfies LockFile))
        await rename(next, file)
        return true
    }

    public async close(): Promise<void> {
        //Nothing kept open
    }
}
