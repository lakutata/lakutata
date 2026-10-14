import { TypeORMError } from "../../error/TypeORMError"

/**
 * lakutata: the size of the chunks of the arena of the keys.
 */
const CHUNK_SIZE = 16 * 1024 * 1024

/**
 * lakutata: the largest number of slots of a keydir: its arrays of 8 bytes stay below 4 GiB, the largest buffer of
 * Bun.
 */
const MAXIMUM_CAPACITY = 2 ** 28

/**
 * lakutata: the share of the slots used (live or deleted) above which a keydir grows.
 */
const LOAD = 0.7

/**
 * lakutata: the hash of a key (FNV-1a, then the finalizer of MurmurHash3), 2 or more: 0 marks an empty slot, 1 a
 * deleted one.
 *
 * @param key
 */
function hashOf(key: Uint8Array): number {
    let hash = 0x811c9dc5
    for (let index = 0; index < key.length; index++) {
        hash ^= key[index]
        hash = Math.imul(hash, 0x01000193)
    }
    hash ^= hash >>> 16
    hash = Math.imul(hash, 0x85ebca6b)
    hash ^= hash >>> 13
    hash = Math.imul(hash, 0xc2b2ae35)
    hash ^= hash >>> 16
    hash >>>= 0
    return hash < 2 ? hash + 2 : hash
}

/**
 * lakutata: the keys of a keydir, appended to chunks of buffers: each one its length (4 bytes) then its bytes, at an
 * address (its chunk times the size of the chunks, plus its place in it).
 */
class KeyArena {
    chunks: Buffer[] = []

    position = CHUNK_SIZE

    /**
     * Adds a key; its address.
     *
     * @param key
     */
    add(key: Uint8Array): number {
        const size = 4 + key.length
        if (this.position + size > CHUNK_SIZE) {
            this.chunks.push(Buffer.allocUnsafe(Math.max(CHUNK_SIZE, size)))
            this.position = 0
        }
        const chunk = this.chunks[this.chunks.length - 1]
        chunk.writeUInt32LE(key.length, this.position)
        chunk.set(key, this.position + 4)
        const address = (this.chunks.length - 1) * CHUNK_SIZE + this.position
        this.position += size
        return address
    }

    /**
     * Whether the key at an address is a key.
     *
     * @param address
     * @param key
     */
    equals(address: number, key: Uint8Array): boolean {
        const chunk = this.chunks[Math.floor(address / CHUNK_SIZE)]
        const start = address % CHUNK_SIZE
        const length = chunk.readUInt32LE(start)
        return (
            length === key.length &&
            chunk.compare(key, 0, length, start + 4, start + 4 + length) === 0
        )
    }

    /**
     * The key at an address.
     *
     * @param address
     */
    read(address: number): Buffer {
        const chunk = this.chunks[Math.floor(address / CHUNK_SIZE)]
        const start = address % CHUNK_SIZE
        return chunk.subarray(
            start + 4,
            start + 4 + chunk.readUInt32LE(start),
        )
    }
}

/**
 * lakutata: the records of the documents of a collection by the keys of their _id, outside the heap of V8, whose
 * maps hold up to 2^23 entries: an open addressing hash table (linear probing) of typed arrays, its keys in an arena.
 * A slot holds the hash of its key (0 empty, 1 deleted), the address of its key, and the offset and length of the
 * record of the document. It holds up to 0.7 × 2^28 keys.
 */
export class EmbeddedKeydir {
    protected hashes: Uint32Array

    protected keys: Float64Array

    protected offsets: Float64Array

    protected lengths: Uint32Array

    protected arena: KeyArena

    protected mask: number

    protected live = 0

    protected deleted = 0

    constructor(capacity = 1024) {
        this.allocate(capacity)
    }

    /**
     * The number of keys.
     */
    get size(): number {
        return this.live
    }

    /**
     * The slot of a key, or -1.
     *
     * @param key
     */
    find(key: Uint8Array): number {
        const hash = hashOf(key)
        let slot = hash & this.mask
        for (;;) {
            const stored = this.hashes[slot]
            if (stored === 0) return -1
            if (stored === hash && this.arena.equals(this.keys[slot], key))
                return slot
            slot = (slot + 1) & this.mask
        }
    }

    /**
     * Whether a key is held.
     *
     * @param key
     */
    has(key: Uint8Array): boolean {
        return this.find(key) >= 0
    }

    /**
     * The offset of the record of a slot.
     *
     * @param slot
     */
    offsetAt(slot: number): number {
        return this.offsets[slot]
    }

    /**
     * The length of the record of a slot.
     *
     * @param slot
     */
    lengthAt(slot: number): number {
        return this.lengths[slot]
    }

    /**
     * Sets the record of a key; the length of the record it replaces, or 0.
     *
     * @param key
     * @param offset
     * @param length
     */
    set(key: Uint8Array, offset: number, length: number): number {
        const hash = hashOf(key)
        let slot = hash & this.mask
        let free = -1
        for (;;) {
            const stored = this.hashes[slot]
            if (stored === 0) break
            if (stored === 1) {
                if (free < 0) free = slot
            } else if (
                stored === hash &&
                this.arena.equals(this.keys[slot], key)
            ) {
                const previous = this.lengths[slot]
                this.offsets[slot] = offset
                this.lengths[slot] = length
                return previous
            }
            slot = (slot + 1) & this.mask
        }
        if (free >= 0) {
            slot = free
            this.deleted--
        }
        this.hashes[slot] = hash
        this.keys[slot] = this.arena.add(key)
        this.offsets[slot] = offset
        this.lengths[slot] = length
        this.live++
        if (this.live + this.deleted > (this.mask + 1) * LOAD) this.grow()
        return 0
    }

    /**
     * Removes a key; the length of the record of its document, or 0 when it was not held.
     *
     * @param key
     */
    delete(key: Uint8Array): number {
        const slot = this.find(key)
        if (slot < 0) return 0
        this.hashes[slot] = 1
        this.live--
        this.deleted++
        return this.lengths[slot]
    }

    /**
     * Removes all the keys.
     */
    clear(): void {
        this.allocate(1024)
    }

    /**
     * The keys held, with the offsets and lengths of their records.
     */
    *entries(): Generator<[Buffer, number, number]> {
        for (let slot = 0; slot <= this.mask; slot++)
            if (this.hashes[slot] > 1)
                yield [
                    this.arena.read(this.keys[slot]),
                    this.offsets[slot],
                    this.lengths[slot],
                ]
    }

    /**
     * The state of the keydir as buffers (its arrays and the chunks of its arena, shared, not copied), and the numbers
     * telling them apart.
     */
    export(): { state: number[]; buffers: Uint8Array[] } {
        const view = (array: ArrayBufferView) =>
            new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
        return {
            state: [
                this.mask + 1,
                this.live,
                this.deleted,
                this.arena.chunks.length,
                this.arena.position,
            ],
            // The last chunk of the arena up to its end
            buffers: [
                view(this.hashes),
                view(this.keys),
                view(this.offsets),
                view(this.lengths),
                ...this.arena.chunks.map((chunk, index) =>
                    index === this.arena.chunks.length - 1
                        ? view(chunk.subarray(0, this.arena.position))
                        : view(chunk),
                ),
            ],
        }
    }

    /**
     * A keydir from its state exported (its buffers used as they are, aligned on 8 bytes).
     *
     * @param state
     * @param buffers
     */
    static import(state: number[], buffers: Uint8Array[]): EmbeddedKeydir {
        const [capacity, live, deleted, chunks, position] = state
        const keydir = new EmbeddedKeydir(1)
        const array = <T>(Type: new (buffer: ArrayBufferLike, offset: number, length: number) => T, bytes: Uint8Array, size: number): T =>
            new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / size)
        keydir.hashes = array(Uint32Array, buffers[0], 4)
        keydir.keys = array(Float64Array, buffers[1], 8)
        keydir.offsets = array(Float64Array, buffers[2], 8)
        keydir.lengths = array(Uint32Array, buffers[3], 4)
        keydir.mask = capacity - 1
        keydir.live = live
        keydir.deleted = deleted
        keydir.arena = new KeyArena()
        keydir.arena.chunks = buffers
            .slice(4, 4 + chunks)
            .map((bytes) =>
                Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            )
        // The last chunk whole again, to be written on
        const last = keydir.arena.chunks.length - 1
        if (last >= 0 && keydir.arena.chunks[last].length < CHUNK_SIZE) {
            const chunk = Buffer.allocUnsafe(CHUNK_SIZE)
            keydir.arena.chunks[last].copy(chunk)
            keydir.arena.chunks[last] = chunk
        }
        keydir.arena.position = position
        return keydir
    }

    /**
     * Grows the table (or rebuilds it without its deleted slots), with a new arena of its live keys: read from the
     * arrays of the old table, their hashes kept.
     */
    protected grow(): void {
        let capacity = this.mask + 1
        while (this.live + 1 > capacity * LOAD * 0.5) capacity *= 2
        if (capacity > MAXIMUM_CAPACITY)
            throw new TypeORMError(
                `A collection of mongo-embedded holds up to ${Math.floor(MAXIMUM_CAPACITY * LOAD)} documents`,
            )
        const { hashes, keys, offsets, lengths, arena, mask, live } = this
        this.allocate(capacity)
        for (let old = 0; old <= mask; old++) {
            const hash = hashes[old]
            if (hash < 2) continue
            let slot = hash & this.mask
            while (this.hashes[slot] !== 0) slot = (slot + 1) & this.mask
            this.hashes[slot] = hash
            this.keys[slot] = this.arena.add(arena.read(keys[old]))
            this.offsets[slot] = offsets[old]
            this.lengths[slot] = lengths[old]
        }
        this.live = live
    }

    protected allocate(capacity: number): void {
        this.hashes = new Uint32Array(capacity)
        this.keys = new Float64Array(capacity)
        this.offsets = new Float64Array(capacity)
        this.lengths = new Uint32Array(capacity)
        this.arena = new KeyArena()
        this.mask = capacity - 1
        this.live = 0
        this.deleted = 0
    }
}
