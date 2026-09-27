import {writeSync} from 'node:fs'

//The buffered text written at once
const HIGH_WATER_MARK: number = 16384

const SLEEPER: Int32Array = new Int32Array(new SharedArrayBuffer(4))

/**
 * A destination of the log lines, buffered unless synchronous
 * The buffered lines are written in the next event loop iteration, and synchronously when the process exits
 * The streams with a file descriptor (stdout, stderr, files) are written through it, so the lines stay in order
 */
export class Destination {

    #buffer: string = ''

    #scheduled: boolean = false

    constructor(protected readonly stream: NodeJS.WritableStream, protected readonly sync: boolean) {
    }

    /**
     * The file descriptor of the stream, if it has one
     * @protected
     */
    protected get fd(): number | undefined {
        const fd: unknown = (this.stream as { fd?: unknown }).fd
        return typeof fd === 'number' ? fd : undefined
    }

    /**
     * Write a text to the file descriptor, retrying when the descriptor is busy
     * @param fd
     * @param text
     * @protected
     */
    protected writeFd(fd: number, text: string): void {
        let data: Buffer = Buffer.from(text)
        while (data.length) {
            try {
                data = data.subarray(writeSync(fd, data))
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e
                //A pipe is full, wait for its reader
                Atomics.wait(SLEEPER, 0, 0, 10)
            }
        }
    }

    /**
     * Write a text
     * @param text
     */
    public write(text: string): void {
        if (this.sync) return this.output(text)
        this.#buffer += text
        if (this.#buffer.length >= HIGH_WATER_MARK) return this.flush()
        if (this.#scheduled) return
        this.#scheduled = true
        setImmediate((): void => this.flush())
    }

    /**
     * Write a text to the stream, through its file descriptor if it has one
     * @param text
     * @protected
     */
    protected output(text: string): void {
        const fd: number | undefined = this.fd
        fd === undefined ? this.stream.write(text) : this.writeFd(fd, text)
    }

    /**
     * Write the buffered text
     */
    public flush(): void {
        this.#scheduled = false
        if (!this.#buffer) return
        const text: string = this.#buffer
        this.#buffer = ''
        this.output(text)
    }
}
