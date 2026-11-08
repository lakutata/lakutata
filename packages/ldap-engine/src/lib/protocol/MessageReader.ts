import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {decodeMessage} from './Codec.js'
import type {LDAPMessage} from './Messages.js'

/**
 * The options of a message reader
 */
export interface MessageReaderOptions {
    /**
     * The largest message, in bytes; a larger one is a fatal error, raised as soon as its length is read (16 MiB by
     * default). A server lowers it for the sessions not bound yet.
     */
    maxMessageSize?: number
}

/**
 * A message read from a stream: the message, or the error of a message that could not be decoded but whose message
 * ID is known (the stream goes on)
 */
export interface ReadMessage {
    /**
     * The message
     */
    message?: LDAPMessage
    /**
     * The error, when the message could not be decoded
     */
    error?: LDAPDecodeException
}

/**
 * The reader of the messages of a stream: the chunks of a socket are pushed in, the whole messages come out. One
 * chunk may hold several messages and one message may span several chunks; a message within one chunk is read in
 * place, and only a message spanning chunks is copied, once.
 * @example
 * ```typescript
 * import {encodeMessage, MessageReader, type ReadMessage} from '@lakutata/ldap-engine'
 *
 * const reader: MessageReader = new MessageReader({maxMessageSize: 1024 * 1024})
 * const bytes: Buffer = encodeMessage({messageId: 1, protocolOp: {type: 'unbindRequest'}})
 * reader.push(bytes.subarray(0, 3))
 * const read: ReadMessage[] = reader.push(bytes.subarray(3))
 * console.log(read[0].message?.protocolOp.type) //unbindRequest
 * ```
 */
export class MessageReader {
    /**
     * The largest message, in bytes; it can be changed between chunks
     */
    public maxMessageSize: number

    /**
     * The chunks not read to their end
     */
    protected readonly chunks: Buffer[] = []

    /**
     * The offset of the first unread byte in the first chunk
     */
    protected offset: number = 0

    /**
     * The unread bytes in all the chunks
     */
    protected buffered: number = 0

    /**
     * The length of the message being read once its header is known, -1 before
     */
    protected pending: number = -1

    /**
     * @param options The largest message.
     */
    constructor(options: MessageReaderOptions = {}) {
        this.maxMessageSize = options.maxMessageSize ?? 16 * 1024 * 1024
    }

    /**
     * The bytes buffered and not read yet
     */
    public get bufferedBytes(): number {
        return this.buffered
    }

    /**
     * Push a chunk, and read the messages it completes. A message that cannot be framed (a wrong tag, an indefinite or
     * too large length) or whose message ID cannot be read throws a fatal `LDAPDecodeException`: the stream cannot go
     * on.
     * @param chunk The chunk.
     */
    public push(chunk: Buffer): ReadMessage[] {
        if (chunk.length) {
            this.chunks.push(chunk)
            this.buffered += chunk.length
        }
        const messages: ReadMessage[] = []
        for (; ;) {
            if (this.pending < 0) {
                this.pending = this.header()
                if (this.pending < 0) break
            }
            if (this.buffered < this.pending) break
            const bytes: Buffer = this.take(this.pending)
            this.pending = -1
            try {
                messages.push({message: decodeMessage(bytes)})
            } catch (error) {
                if (!(error instanceof LDAPDecodeException) || error.fatal) throw error
                messages.push({error: error})
            }
        }
        return messages
    }

    /**
     * The byte at a position of the unread bytes
     * @param position The position.
     */
    protected byteAt(position: number): number {
        let index: number = position + this.offset
        for (const chunk of this.chunks) {
            if (index < chunk.length) return chunk[index]
            index -= chunk.length
        }
        return -1
    }

    /**
     * The whole length of the next message, from its tag and length, or -1 while they are not all buffered
     */
    protected header(): number {
        if (this.buffered < 2) return -1
        const tag: number = this.byteAt(0)
        if (tag !== 0x30) throw new LDAPDecodeException(`A message starting with 0x${tag.toString(16)}, not a SEQUENCE`, {fatal: true})
        const first: number = this.byteAt(1)
        let length: number
        let header: number
        if (first < 0x80) {
            length = first
            header = 2
        } else {
            if (first === 0x80) throw new LDAPDecodeException('A message of an indefinite length', {fatal: true})
            const count: number = first & 0x7f
            if (count > 4) throw new LDAPDecodeException('A message length of more than 4 bytes', {fatal: true})
            if (this.buffered < 2 + count) return -1
            length = 0
            for (let index: number = 0; index < count; index++) length = length * 256 + this.byteAt(2 + index)
            header = 2 + count
        }
        if (header + length > this.maxMessageSize) throw new LDAPDecodeException(`A message of ${header + length} bytes, more than ${this.maxMessageSize}`, {fatal: true})
        return header + length
    }

    /**
     * Take bytes from the front: a slice of the first chunk when it holds them, a copy otherwise
     * @param count How many.
     */
    protected take(count: number): Buffer {
        const first: Buffer = this.chunks[0]
        let bytes: Buffer
        if (first.length - this.offset >= count) {
            bytes = first.subarray(this.offset, this.offset + count)
            this.offset += count
        } else {
            bytes = Buffer.allocUnsafe(count)
            let copied: number = 0
            while (copied < count) {
                const chunk: Buffer = this.chunks[0]
                const available: number = chunk.length - this.offset
                const part: number = Math.min(available, count - copied)
                chunk.copy(bytes, copied, this.offset, this.offset + part)
                copied += part
                this.offset += part
                if (this.offset === chunk.length) {
                    this.chunks.shift()
                    this.offset = 0
                }
            }
        }
        if (this.chunks.length && this.offset === this.chunks[0].length) {
            this.chunks.shift()
            this.offset = 0
        }
        this.buffered -= count
        return bytes
    }
}
