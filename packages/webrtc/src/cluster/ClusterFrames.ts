import {randomBytes} from 'node:crypto'

/**
 * A frame holding a whole message
 */
const WHOLE: number = 0

/**
 * A frame holding a part of a message larger than the transport carries
 */
const PART: number = 1

/**
 * The header of a part: its kind, the id of its message, its index, the number of parts
 */
const PART_HEADER: number = 1 + 16 + 4 + 4

/**
 * The parts of a message at most (a frame claiming more is dropped)
 */
const MAX_PARTS: number = 65536

/**
 * The frames carrying a message: the message itself, or its parts when it is larger than the transport carries
 * @param message
 * @param maxPayload
 */
export function framesOf(message: Uint8Array, maxPayload: number): Buffer[] {
    if (message.length + 1 <= maxPayload) return [Buffer.concat([Buffer.of(WHOLE), message])]
    const size: number = Math.max(1, maxPayload - PART_HEADER)
    const id: Buffer = randomBytes(16)
    const count: number = Math.ceil(message.length / size)
    const frames: Buffer[] = []
    for (let index: number = 0; index < count; index++) {
        const header: Buffer = Buffer.alloc(PART_HEADER)
        header[0] = PART
        id.copy(header, 1)
        header.writeUInt32BE(index, 17)
        header.writeUInt32BE(count, 21)
        frames.push(Buffer.concat([header, message.subarray(index * size, (index + 1) * size)]))
    }
    return frames
}

/**
 * A message being received in parts
 */
interface PartialMessage {
    readonly parts: (Buffer | undefined)[]
    received: number
    readonly expiresAt: number
}

/**
 * Puts the messages back together from their frames: the parts of a message arrive in order from its publisher, those
 * of other messages may come between them
 */
export class FrameAssembler {

    readonly #partials: Map<string, PartialMessage> = new Map()

    /**
     * @param timeout How long the parts of a message are kept, waiting for the rest, in milliseconds.
     */
    constructor(protected readonly timeout: number = 30000) {
    }

    /**
     * Add a frame
     * @param frame
     * @returns The message, once it is whole.
     */
    public add(frame: Uint8Array): Buffer | undefined {
        const buffer: Buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
        if (buffer[0] === WHOLE) return buffer.subarray(1)
        if (buffer[0] !== PART || buffer.length < PART_HEADER) return undefined
        const now: number = Date.now()
        for (const [id, partial] of this.#partials) if (partial.expiresAt < now) this.#partials.delete(id)
        const id: string = buffer.toString('hex', 1, 17)
        const index: number = buffer.readUInt32BE(17)
        const count: number = buffer.readUInt32BE(21)
        if (count < 1 || count > MAX_PARTS || index >= count) return undefined
        let partial: PartialMessage | undefined = this.#partials.get(id)
        if (!partial) {
            partial = {parts: new Array(count), received: 0, expiresAt: now + this.timeout}
            this.#partials.set(id, partial)
        }
        if (partial.parts.length !== count || partial.parts[index]) return undefined
        partial.parts[index] = Buffer.from(buffer.subarray(PART_HEADER))
        if (++partial.received < count) return undefined
        this.#partials.delete(id)
        return Buffer.concat(partial.parts as Buffer[])
    }
}
