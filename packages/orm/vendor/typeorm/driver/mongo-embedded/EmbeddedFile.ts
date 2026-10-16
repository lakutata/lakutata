import * as fs from "fs"
import { TypeORMError } from "../../error/TypeORMError"

/**
 * lakutata: the file of the records of a collection, written at its end only.
 */
export interface EmbeddedFile {
    /**
     * Its size.
     */
    readonly size: number

    /**
     * Writes data at its end, in one write; the offset of the data.
     */
    append(data: Uint8Array): number

    /**
     * Reads bytes of it into a buffer; the number of bytes read.
     */
    readInto(
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
    ): number

    /**
     * Writes it to the disk (fsync).
     */
    sync(): void

    /**
     * Cuts it at a size.
     */
    truncate(size: number): void

    /**
     * Closes it: its uses after throw (a file of a collection dropped while a cursor reads it, a write runs on it).
     */
    close(): void
}

/**
 * lakutata: the bytes read or written by a call of the system (a call reads or writes up to 2^31 - 1 bytes).
 */
const IO_CHUNK = 1024 * 1024 * 1024

/**
 * lakutata: a file of the disk, opened for reading and writing, written at the offset of its end (not in the append
 * mode of the system, whose offsets are not the ones the file is read at on every system).
 */
export class EmbeddedDiskFile implements EmbeddedFile {
    /**
     * Its descriptor, -1 once it is closed: the system may give its number to another file opened since.
     */
    protected descriptor: number

    size: number

    constructor(public path: string) {
        this.descriptor = fs.openSync(
            path,
            fs.constants.O_RDWR | fs.constants.O_CREAT,
            0o644,
        )
        this.size = fs.fstatSync(this.descriptor).size
    }

    append(data: Uint8Array): number {
        const descriptor = this.opened()
        const offset = this.size
        let written = 0
        while (written < data.length)
            written += fs.writeSync(
                descriptor,
                data,
                written,
                Math.min(data.length - written, IO_CHUNK),
                offset + written,
            )
        this.size += data.length
        return offset
    }

    readInto(
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
    ): number {
        const descriptor = this.opened()
        let read = 0
        while (read < length) {
            const count = fs.readSync(
                descriptor,
                buffer,
                offset + read,
                Math.min(length - read, IO_CHUNK),
                position + read,
            )
            if (count === 0) break
            read += count
        }
        return read
    }

    sync(): void {
        fs.fsyncSync(this.opened())
    }

    truncate(size: number): void {
        fs.ftruncateSync(this.opened(), size)
        this.size = size
    }

    close(): void {
        if (this.descriptor < 0) return
        fs.closeSync(this.descriptor)
        this.descriptor = -1
    }

    /**
     * Its descriptor; it throws once it is closed.
     */
    protected opened(): number {
        if (this.descriptor < 0)
            throw new TypeORMError(
                `The file ${this.path} of mongo-embedded is closed`,
            )
        return this.descriptor
    }
}

/**
 * lakutata: the size of the chunks of a file in memory.
 */
const MEMORY_CHUNK_SIZE = 8 * 1024 * 1024

/**
 * lakutata: a file in memory (of a database ":memory:"), in chunks of buffers, the data written across them.
 */
export class EmbeddedMemoryFile implements EmbeddedFile {
    protected readonly chunks: Buffer[] = []

    protected closed = false

    size = 0

    append(data: Uint8Array): number {
        this.assertOpened()
        const offset = this.size
        let written = 0
        while (written < data.length) {
            const chunk = Math.floor(this.size / MEMORY_CHUNK_SIZE)
            if (chunk === this.chunks.length)
                this.chunks.push(Buffer.allocUnsafe(MEMORY_CHUNK_SIZE))
            const start = this.size % MEMORY_CHUNK_SIZE
            const count = Math.min(
                data.length - written,
                MEMORY_CHUNK_SIZE - start,
            )
            this.chunks[chunk].set(
                data.subarray(written, written + count),
                start,
            )
            written += count
            this.size += count
        }
        return offset
    }

    readInto(
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
    ): number {
        this.assertOpened()
        const end = Math.min(position + length, this.size)
        let read = 0
        while (position + read < end) {
            const at = position + read
            const chunk = this.chunks[Math.floor(at / MEMORY_CHUNK_SIZE)]
            const start = at % MEMORY_CHUNK_SIZE
            const count = Math.min(end - at, MEMORY_CHUNK_SIZE - start)
            chunk.copy(buffer, offset + read, start, start + count)
            read += count
        }
        return read
    }

    sync(): void {}

    truncate(size: number): void {
        this.size = Math.min(this.size, size)
        this.chunks.length = Math.ceil(this.size / MEMORY_CHUNK_SIZE)
    }

    close(): void {
        this.chunks.length = 0
        this.size = 0
        this.closed = true
    }

    /**
     * Throws once it is closed.
     */
    protected assertOpened(): void {
        if (this.closed)
            throw new TypeORMError("A file of mongo-embedded in memory is closed")
    }
}
