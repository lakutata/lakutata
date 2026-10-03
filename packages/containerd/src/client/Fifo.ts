import {spawnSync} from 'node:child_process'
import {closeSync, constants, openSync} from 'node:fs'
import net from 'node:net'

/**
 * The FIFOs of the standard streams of a process of containerd (the ones of its cio): created by mkfifo, the shim
 * writing (or reading) them, read (or written) from the event loop
 */
export class ProcessFifo {

    #keeper: number | undefined

    #socket: net.Socket | undefined

    protected constructor(public readonly path: string, protected readonly direction: 'read' | 'write') {
    }

    /**
     * Whether the FIFOs can be created (mkfifo of the system: coreutils, busybox)
     */
    public static Supported(): boolean {
        return spawnSync('mkfifo', ['--help'], {stdio: 'ignore'}).error === undefined
    }

    /**
     * Create a FIFO, kept open (read and write) for the shim to open its end without waiting
     * @param path
     * @param direction read: the shim writes it (stdout, stderr), write: the shim reads it (stdin)
     */
    public static Create(path: string, direction: 'read' | 'write'): ProcessFifo {
        const result = spawnSync('mkfifo', ['-m', '0600', path], {stdio: ['ignore', 'ignore', 'pipe']})
        if (result.error || result.status !== 0) throw new Error(`The FIFO ${path} is not created: ${result.error?.message ?? result.stderr.toString().trim()}`)
        const fifo: ProcessFifo = new ProcessFifo(path, direction)
        fifo.#keeper = openSync(path, constants.O_RDWR | constants.O_NONBLOCK)
        return fifo
    }

    /**
     * Its end opened, once the shim has opened its own one (after the creation of the process): the one kept closed,
     * the end of the stream is the one of the shim
     */
    public open(): net.Socket {
        if (this.#socket) return this.#socket
        const flags: number = (this.direction === 'read' ? constants.O_RDONLY : constants.O_WRONLY) | constants.O_NONBLOCK
        this.#socket = new net.Socket({fd: openSync(this.path, flags), readable: this.direction === 'read', writable: this.direction === 'write'})
        this.releaseKeeper()
        return this.#socket
    }

    protected releaseKeeper(): void {
        if (this.#keeper === undefined) return
        closeSync(this.#keeper)
        this.#keeper = undefined
    }

    /**
     * Close it
     */
    public close(): void {
        this.releaseKeeper()
        this.#socket?.destroy()
    }
}
