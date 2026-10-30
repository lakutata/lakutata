import { crc32 } from "./EmbeddedCrc32"
import type { EmbeddedFile } from "./EmbeddedFile"

/**
 * lakutata: the size of the header of a record: the length of its payload (4 bytes), the CRC-32 of its type and
 * payload (4 bytes), its type (1 byte).
 */
export const RECORD_HEADER = 9

/**
 * lakutata: the types of the records of the file of a collection. An operation is its records followed by a commit
 * record; the records after the last commit record (an operation cut by a crash) are dropped when the file is opened.
 */
export const RecordType = {
    /**
     * The first record of a file: the name of its collection, the format of the file (1), and its id (which its
     * snapshot tells).
     */
    Header: 0,
    /** A document (BSON, its _id first). */
    Put: 1,
    /** The deletion of a document: its _id. */
    Delete: 2,
    /** The creation of an index: its specification. */
    CreateIndex: 3,
    /** The removal of an index: its name. */
    DropIndex: 4,
    /** The end of an operation. */
    Commit: 5,
} as const

/**
 * lakutata: a record read from a file. Its payload is a view of the buffer of the reader, valid until it reads the
 * next record.
 */
export interface EmbeddedRecord {
    type: number
    offset: number
    length: number
    payload: Buffer
}

/**
 * lakutata: why a record could not be read: the end of the file, a record past its end (cut by a crash), a record
 * whose CRC-32 does not match. The CRC-32 does not cover the length of a record: a length damaged in the middle of a
 * file reads as a record cut (past its end) or as a CRC-32 not matching (another record read).
 */
export type EmbeddedRecordEnd = "end" | "torn" | "checksum"

/**
 * lakutata: the CRC-32 of the type and the payload of a record.
 *
 * @param type
 * @param payload
 */
function checksumOf(type: number, payload: Uint8Array): number {
    return crc32(payload, crc32(Buffer.of(type)))
}

/**
 * lakutata: encodes a record.
 *
 * @param type
 * @param payload
 */
export function encodeRecord(type: number, payload: Uint8Array): Buffer {
    const record = Buffer.allocUnsafe(RECORD_HEADER + payload.length)
    record.writeUInt32LE(payload.length, 0)
    record.writeUInt32LE(checksumOf(type, payload), 4)
    record[8] = type
    record.set(payload, RECORD_HEADER)
    return record
}

/**
 * lakutata: reads the records of a file in its order, by blocks.
 */
export class EmbeddedRecordReader {
    protected block: Buffer

    protected blockStart = 0

    protected filled = 0

    /**
     * @param file
     * @param position the offset of the first record to read
     * @param end the offset the reading stops at (the size of the file when it is read, by default)
     * @param blockSize
     */
    constructor(
        protected readonly file: EmbeddedFile,
        public position = 0,
        protected readonly end = file.size,
        blockSize = 4 * 1024 * 1024,
    ) {
        this.block = Buffer.allocUnsafe(blockSize)
    }

    /**
     * The next record, or why there is none.
     *
     * @param verify whether its CRC-32 is checked
     */
    next(verify: boolean): EmbeddedRecord | EmbeddedRecordEnd {
        if (this.position >= this.end) return "end"
        if (!this.ensure(RECORD_HEADER)) return "torn"
        const length =
            RECORD_HEADER +
            this.block.readUInt32LE(this.position - this.blockStart)
        if (this.position + length > this.end || !this.ensure(length))
            return "torn"
        const start = this.position - this.blockStart
        const type = this.block[start + 8]
        const payload = this.block.subarray(
            start + RECORD_HEADER,
            start + length,
        )
        if (
            verify &&
            checksumOf(type, payload) !== this.block.readUInt32LE(start + 4)
        )
            return "checksum"
        const record = {
            type: type,
            offset: this.position,
            length: length,
            payload: payload,
        }
        this.position += length
        return record
    }

    /**
     * Makes the block hold the bytes from the position; whether the file has them.
     *
     * @param bytes
     */
    protected ensure(bytes: number): boolean {
        if (this.position + bytes <= this.blockStart + this.filled) return true
        if (bytes > this.block.length) this.block = Buffer.allocUnsafe(bytes)
        this.blockStart = this.position
        this.filled = this.file.readInto(
            this.block,
            0,
            Math.min(this.block.length, this.end - this.position),
            this.position,
        )
        return this.filled >= bytes
    }
}
