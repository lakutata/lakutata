import { TypeORMError } from "../../error/TypeORMError"

/**
 * lakutata: the size of a page.
 */
const PAGE = 4096

/**
 * lakutata: the pages of a chunk of the memory of a tree (2 MiB).
 */
const PAGES_PER_CHUNK = 512 // the pages are located by shifts of 9 bits

/**
 * lakutata: the size of the header of a page: its type (1 byte, then 1 unused), its number of entries (2), the start
 * of its entries (2), the bytes of its entries removed (2), its next leaf (4), its previous leaf or its first child (4).
 */
const HEADER = 16

/**
 * lakutata: no page.
 */
const NONE = 0xffffffff

const LEAF = 1

const INTERNAL = 2

/**
 * lakutata: the bytes of a page for its entries and their directory.
 */
const CAPACITY = PAGE - HEADER

/**
 * lakutata: the largest entry (in an internal page): with its offset in the directory, a quarter of a page at most. A
 * page split by the bytes of its entries (middleOf) then leaves two halves each fitting a page, whatever the sizes of
 * its entries.
 */
const MAXIMUM_ENTRY = Math.floor(CAPACITY / 4) - 2

/**
 * lakutata: an id greater than any (the ids have up to 255 bytes). With the empty id, it turns a bound of keys into a
 * bound of entries (a key, then an id): before or after all the entries of its key.
 */
const GREATEST_ID = Buffer.alloc(256, 0xff)

/**
 * lakutata: a bound of a range of keys.
 */
export interface EmbeddedBound {
    key: Uint8Array
    inclusive: boolean
}

/**
 * lakutata: an entry read from a page.
 */
interface Entry {
    key: Buffer
    id: Buffer
    child?: number
}

/**
 * lakutata: an ordered index of entries (a key, then the id of a document), in a B+tree whose pages are slices of
 * buffers outside the heap of V8. A page holds a directory of the offsets of its entries (in their order) after its
 * header, and its entries from its end: their key length (2 bytes), id length (1 byte), key, id, and in an internal
 * page the child (4 bytes) holding the entries from it. The leaves are linked both ways. A removal leaves its page as
 * it is (its pages are not merged).
 */
export class EmbeddedBTree {
    protected chunks: Buffer[] = []

    protected pages = 0

    protected free: number[] = []

    protected root: number

    protected count = 0

    constructor() {
        this.root = this.allocate(LEAF)
    }

    /**
     * The number of entries.
     */
    get size(): number {
        return this.count
    }

    /**
     * Whether an entry fits a tree: its key and id of MAXIMUM_ENTRY bytes at most, with their sizes and a child (in an
     * internal page, where a split of its leaf may copy it).
     *
     * @param key
     * @param id
     */
    static fits(key: Uint8Array, id: Uint8Array): boolean {
        return 3 + key.length + id.length + 4 <= MAXIMUM_ENTRY && id.length <= 255
    }

    /**
     * Adds an entry; false when it exists. An entry not fitting the tree (fits) throws, the tree unchanged.
     *
     * @param key
     * @param id
     */
    insert(key: Uint8Array, id: Uint8Array): boolean {
        if (!EmbeddedBTree.fits(key, id))
            throw new TypeORMError(
                `The key of an index of mongo-embedded is too large: ${key.length} bytes`,
            )
        const path: number[] = []
        let page = this.root
        while (this.typeOf(page) === INTERNAL) {
            path.push(page)
            page = this.childFor(page, key, id)
        }
        const position = this.lowerBound(page, key, id)
        if (
            position < this.countOf(page) &&
            this.compareAt(page, position, key, id) === 0
        )
            return false
        let split = this.insertAt(page, position, {
            key: Buffer.from(key),
            id: Buffer.from(id),
        })
        while (split) {
            const parent = path.pop()
            if (parent === undefined) {
                const root = this.allocate(INTERNAL)
                this.setFirst(root, this.root)
                this.insertAt(root, 0, split)
                this.root = root
                break
            }
            split = this.insertAt(
                parent,
                this.upperBound(parent, split.key, split.id),
                split,
            )
        }
        this.count++
        return true
    }

    /**
     * Removes an entry; whether it existed.
     *
     * @param key
     * @param id
     */
    delete(key: Uint8Array, id: Uint8Array): boolean {
        const page = this.leafFor(key, id)
        const position = this.lowerBound(page, key, id)
        if (
            position >= this.countOf(page) ||
            this.compareAt(page, position, key, id) !== 0
        )
            return false
        const [buffer, base] = this.locate(page)
        const count = buffer.readUInt16LE(base + 2)
        const offset = buffer.readUInt16LE(base + HEADER + position * 2)
        buffer.copyWithin(
            base + HEADER + position * 2,
            base + HEADER + (position + 1) * 2,
            base + HEADER + count * 2,
        )
        buffer.writeUInt16LE(count - 1, base + 2)
        buffer.writeUInt16LE(
            buffer.readUInt16LE(base + 6) + this.sizeAt(buffer, base + offset, false),
            base + 6,
        )
        this.count--
        return true
    }

    /**
     * Whether an entry exists.
     *
     * @param key
     * @param id
     */
    has(key: Uint8Array, id: Uint8Array): boolean {
        const page = this.leafFor(key, id)
        const position = this.lowerBound(page, key, id)
        return (
            position < this.countOf(page) &&
            this.compareAt(page, position, key, id) === 0
        )
    }

    /**
     * The entries of a range of keys, in their order or reversed.
     *
     * @param lower
     * @param upper
     * @param reverse
     */
    *range(
        lower?: EmbeddedBound,
        upper?: EmbeddedBound,
        reverse = false,
    ): Generator<[Buffer, Buffer]> {
        if (!reverse) {
            let page = lower
                ? this.leafFor(lower.key, lower.inclusive ? Buffer.alloc(0) : GREATEST_ID)
                : this.firstLeaf()
            let position = lower
                ? this.lowerBound(
                      page,
                      lower.key,
                      lower.inclusive ? Buffer.alloc(0) : GREATEST_ID,
                  )
                : 0
            while (page !== NONE) {
                const count = this.countOf(page)
                for (; position < count; position++) {
                    const entry = this.entryAt(page, position)
                    if (upper) {
                        const order = Buffer.compare(entry.key, upper.key)
                        if (order > 0 || (order === 0 && !upper.inclusive)) return
                    }
                    yield [entry.key, entry.id]
                }
                page = this.nextOf(page)
                position = 0
            }
            return
        }
        let page = upper
            ? this.leafFor(upper.key, upper.inclusive ? GREATEST_ID : Buffer.alloc(0))
            : this.lastLeaf()
        let position =
            (upper
                ? this.lowerBound(
                      page,
                      upper.key,
                      upper.inclusive ? GREATEST_ID : Buffer.alloc(0),
                  )
                : this.countOf(page)) - 1
        while (page !== NONE) {
            for (; position >= 0; position--) {
                const entry = this.entryAt(page, position)
                if (lower) {
                    const order = Buffer.compare(entry.key, lower.key)
                    if (order < 0 || (order === 0 && !lower.inclusive)) return
                }
                yield [entry.key, entry.id]
            }
            page = this.previousOf(page)
            if (page !== NONE) position = this.countOf(page) - 1
        }
    }

    /**
     * The entries whose key starts with a prefix, in their order.
     *
     * @param prefix
     */
    *prefixed(prefix: Uint8Array): Generator<[Buffer, Buffer]> {
        for (const entry of this.range({ key: prefix, inclusive: true })) {
            if (
                entry[0].length < prefix.length ||
                entry[0].compare(prefix, 0, prefix.length, 0, prefix.length) !== 0
            )
                return
            yield entry
        }
    }

    /**
     * The state of the tree as buffers (the chunks of its pages, shared, not copied), and the numbers telling them
     * apart.
     */
    export(): { state: number[]; buffers: Uint8Array[] } {
        // The last chunk up to its last page
        const used = this.pages - (this.chunks.length - 1) * PAGES_PER_CHUNK
        return {
            state: [this.root, this.pages, this.count, this.chunks.length],
            buffers: this.chunks.map((chunk, index) =>
                index === this.chunks.length - 1
                    ? chunk.subarray(0, used * PAGE)
                    : chunk,
            ),
        }
    }

    /**
     * A tree from its state exported (its buffers used as they are).
     *
     * @param state
     * @param buffers
     */
    static import(state: number[], buffers: Uint8Array[]): EmbeddedBTree {
        const [root, pages, count, chunks] = state
        const tree = new EmbeddedBTree()
        tree.chunks = buffers
            .slice(0, chunks)
            .map((bytes) =>
                Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            )
        // The last chunk whole again, to be written on
        const last = tree.chunks.length - 1
        if (last >= 0 && tree.chunks[last].length < PAGE * PAGES_PER_CHUNK) {
            const chunk = Buffer.allocUnsafe(PAGE * PAGES_PER_CHUNK)
            tree.chunks[last].copy(chunk)
            tree.chunks[last] = chunk
        }
        tree.root = root
        tree.pages = pages
        tree.count = count
        tree.free = []
        return tree
    }

    /**
     * Removes all the entries.
     */
    clear(): void {
        this.chunks = []
        this.pages = 0
        this.free = []
        this.count = 0
        this.root = this.allocate(LEAF)
    }

    /**
     * Inserts an entry at a position of a page; the entry and page to insert in its parent when the page is split.
     *
     * @param page
     * @param position
     * @param entry
     */
    protected insertAt(
        page: number,
        position: number,
        entry: Entry,
    ): Entry | undefined {
        const internal = this.typeOf(page) === INTERNAL
        const size = 3 + entry.key.length + entry.id.length + (internal ? 4 : 0)
        let [buffer, base] = this.locate(page)
        const count = buffer.readUInt16LE(base + 2)
        const free = buffer.readUInt16LE(base + 4) - (HEADER + count * 2)
        if (free < size + 2 && free + buffer.readUInt16LE(base + 6) >= size + 2) {
            this.rewrite(page, this.entriesOf(page))
            ;[buffer, base] = this.locate(page)
        }
        if (
            buffer.readUInt16LE(base + 4) - (HEADER + count * 2) >=
            size + 2
        ) {
            const offset = buffer.readUInt16LE(base + 4) - size
            this.writeEntry(buffer, base + offset, entry, internal)
            buffer.copyWithin(
                base + HEADER + (position + 1) * 2,
                base + HEADER + position * 2,
                base + HEADER + count * 2,
            )
            buffer.writeUInt16LE(offset, base + HEADER + position * 2)
            buffer.writeUInt16LE(count + 1, base + 2)
            buffer.writeUInt16LE(offset, base + 4)
            return undefined
        }
        // The page split in two: its entries and the new one shared by their bytes. A leaf keeps the entries before
        // the middle, its new sibling the others, the first of which is copied up to the parent; an internal page
        // moves its middle entry up, its child becoming the first child of the sibling. The parent leads the keys
        // equal to an entry to its child (childFor)
        const entries = this.entriesOf(page)
        entries.splice(position, 0, entry)
        const middle = this.middleOf(entries, internal)
        const sibling = this.allocate(internal ? INTERNAL : LEAF)
        if (internal) {
            const up = entries[middle]
            this.rewrite(page, entries.slice(0, middle))
            this.setFirst(sibling, up.child!)
            this.rewrite(sibling, entries.slice(middle + 1))
            return { key: up.key, id: up.id, child: sibling }
        }
        this.rewrite(page, entries.slice(0, middle))
        this.rewrite(sibling, entries.slice(middle))
        const next = this.nextOf(page)
        this.setLinks(sibling, next, page)
        this.setLinks(page, sibling, this.previousOf(page))
        if (next !== NONE) this.setLinks(next, this.nextOf(next), sibling)
        return { key: entries[middle].key, id: entries[middle].id, child: sibling }
    }

    /**
     * Where the entries of a page split in two are divided (the entry at the position starting the second half of a
     * leaf, or moved up from an internal page): the halves as near in bytes as possible, each fitting a page, each with
     * an entry at least. As an entry takes a quarter of a page at most and the entries split overflow a page, the
     * position exists.
     *
     * @param entries
     * @param internal
     */
    protected middleOf(entries: Entry[], internal: boolean): number {
        const sizes = entries.map(
            (entry) =>
                2 + 3 + entry.key.length + entry.id.length + (internal ? 4 : 0),
        )
        const total = sizes.reduce((sum, size) => sum + size, 0)
        let middle = -1
        let difference = Infinity
        let before = 0
        // An internal page moves its middle entry up: its last entry cannot be it
        const end = entries.length - (internal ? 1 : 0)
        for (let position = 1; position < end; position++) {
            before += sizes[position - 1]
            const after = total - before - (internal ? sizes[position] : 0)
            if (before > CAPACITY || after > CAPACITY) continue
            if (Math.abs(before - after) < difference) {
                middle = position
                difference = Math.abs(before - after)
            }
        }
        if (middle < 0)
            throw new TypeORMError(
                "lakutata: the entries of a page of an index of mongo-embedded cannot be split",
            )
        return middle
    }

    /**
     * Writes the entries of a page again, packed. Entries not fitting it throw before any of them is written (the
     * page is left as it was).
     *
     * @param page
     * @param entries
     */
    protected rewrite(page: number, entries: Entry[]): void {
        const [buffer, base] = this.locate(page)
        const internal = buffer[base] === INTERNAL
        let bytes = 0
        for (const entry of entries)
            bytes += 2 + 3 + entry.key.length + entry.id.length + (internal ? 4 : 0)
        if (bytes > CAPACITY)
            throw new TypeORMError(
                "lakutata: the entries of a page of an index of mongo-embedded do not fit it",
            )
        let end = PAGE
        entries.forEach((entry, index) => {
            end -= 3 + entry.key.length + entry.id.length + (internal ? 4 : 0)
            this.writeEntry(buffer, base + end, entry, internal)
            buffer.writeUInt16LE(end, base + HEADER + index * 2)
        })
        buffer.writeUInt16LE(entries.length, base + 2)
        buffer.writeUInt16LE(end, base + 4)
        buffer.writeUInt16LE(0, base + 6)
    }

    protected writeEntry(
        buffer: Buffer,
        at: number,
        entry: Entry,
        internal: boolean,
    ): void {
        buffer.writeUInt16LE(entry.key.length, at)
        buffer[at + 2] = entry.id.length
        buffer.set(entry.key, at + 3)
        buffer.set(entry.id, at + 3 + entry.key.length)
        if (internal)
            buffer.writeUInt32LE(
                entry.child!,
                at + 3 + entry.key.length + entry.id.length,
            )
    }

    protected entriesOf(page: number): Entry[] {
        const entries: Entry[] = []
        for (let position = 0; position < this.countOf(page); position++)
            entries.push(this.entryAt(page, position))
        return entries
    }

    /**
     * The entry at a position of a page: its key and id copied.
     *
     * @param page
     * @param position
     */
    protected entryAt(page: number, position: number): Entry {
        const [buffer, base] = this.locate(page)
        const at = base + buffer.readUInt16LE(base + HEADER + position * 2)
        const keyLength = buffer.readUInt16LE(at)
        const idLength = buffer[at + 2]
        const key = Buffer.from(buffer.subarray(at + 3, at + 3 + keyLength))
        const id = Buffer.from(
            buffer.subarray(at + 3 + keyLength, at + 3 + keyLength + idLength),
        )
        return buffer[base] === INTERNAL
            ? {
                  key: key,
                  id: id,
                  child: buffer.readUInt32LE(at + 3 + keyLength + idLength),
              }
            : { key: key, id: id }
    }

    protected sizeAt(buffer: Buffer, at: number, internal: boolean): number {
        return (
            3 + buffer.readUInt16LE(at) + buffer[at + 2] + (internal ? 4 : 0)
        )
    }

    /**
     * Compares the entry at a position of a page with a key and an id.
     *
     * @param page
     * @param position
     * @param key
     * @param id
     */
    protected compareAt(
        page: number,
        position: number,
        key: Uint8Array,
        id: Uint8Array,
    ): number {
        // Compared byte by byte (the keys are short: a call of Buffer.compare costs more)
        const buffer = this.chunks[page >>> 9]
        const base = (page & 511) * PAGE
        const slot = base + HEADER + position * 2
        const at = base + (buffer[slot] | (buffer[slot + 1] << 8))
        const keyLength = buffer[at] | (buffer[at + 1] << 8)
        const keyStart = at + 3
        const shorter = keyLength < key.length ? keyLength : key.length
        for (let index = 0; index < shorter; index++) {
            const difference = buffer[keyStart + index] - key[index]
            if (difference !== 0) return difference
        }
        if (keyLength !== key.length) return keyLength - key.length
        const idStart = keyStart + keyLength
        const idLength = buffer[at + 2]
        const shorterId = idLength < id.length ? idLength : id.length
        for (let index = 0; index < shorterId; index++) {
            const difference = buffer[idStart + index] - id[index]
            if (difference !== 0) return difference
        }
        return idLength - id.length
    }

    /**
     * The first position of a page whose entry is not before a key and an id.
     */
    protected lowerBound(page: number, key: Uint8Array, id: Uint8Array): number {
        let low = 0
        let high = this.countOf(page)
        while (low < high) {
            const middle = (low + high) >> 1
            if (this.compareAt(page, middle, key, id) < 0) low = middle + 1
            else high = middle
        }
        return low
    }

    /**
     * The first position of a page whose entry is after a key and an id.
     */
    protected upperBound(page: number, key: Uint8Array, id: Uint8Array): number {
        let low = 0
        let high = this.countOf(page)
        while (low < high) {
            const middle = (low + high) >> 1
            if (this.compareAt(page, middle, key, id) <= 0) low = middle + 1
            else high = middle
        }
        return low
    }

    /**
     * The child of an internal page holding a key and an id.
     */
    protected childFor(page: number, key: Uint8Array, id: Uint8Array): number {
        const position = this.upperBound(page, key, id)
        return position === 0
            ? this.firstOf(page)
            : this.entryChild(page, position - 1)
    }

    protected leafFor(key: Uint8Array, id: Uint8Array): number {
        let page = this.root
        while (this.typeOf(page) === INTERNAL) page = this.childFor(page, key, id)
        return page
    }

    protected firstLeaf(): number {
        let page = this.root
        while (this.typeOf(page) === INTERNAL) page = this.firstOf(page)
        return page
    }

    protected lastLeaf(): number {
        let page = this.root
        while (this.typeOf(page) === INTERNAL)
            page = this.entryChild(page, this.countOf(page) - 1)
        return page
    }

    protected entryChild(page: number, position: number): number {
        const [buffer, base] = this.locate(page)
        const at = base + buffer.readUInt16LE(base + HEADER + position * 2)
        return buffer.readUInt32LE(
            at + 3 + buffer.readUInt16LE(at) + buffer[at + 2],
        )
    }

    protected allocate(type: number): number {
        const page = this.free.pop() ?? this.pages++
        if (Math.floor(page / PAGES_PER_CHUNK) >= this.chunks.length)
            this.chunks.push(Buffer.allocUnsafe(PAGE * PAGES_PER_CHUNK))
        const [buffer, base] = this.locate(page)
        buffer[base] = type
        buffer.writeUInt16LE(0, base + 2)
        buffer.writeUInt16LE(PAGE, base + 4)
        buffer.writeUInt16LE(0, base + 6)
        buffer.writeUInt32LE(NONE, base + 8)
        buffer.writeUInt32LE(NONE, base + 12)
        return page
    }

    protected locate(page: number): [Buffer, number] {
        return [this.chunks[page >>> 9], (page & 511) * PAGE]
    }

    protected typeOf(page: number): number {
        return this.chunks[page >>> 9][(page & 511) * PAGE]
    }

    protected countOf(page: number): number {
        const buffer = this.chunks[page >>> 9]
        const base = (page & 511) * PAGE
        return buffer[base + 2] | (buffer[base + 3] << 8)
    }

    protected nextOf(page: number): number {
        const [buffer, base] = this.locate(page)
        return buffer.readUInt32LE(base + 8)
    }

    protected previousOf(page: number): number {
        const [buffer, base] = this.locate(page)
        return buffer.readUInt32LE(base + 12)
    }

    protected firstOf(page: number): number {
        return this.previousOf(page)
    }

    protected setFirst(page: number, child: number): void {
        const [buffer, base] = this.locate(page)
        buffer.writeUInt32LE(child, base + 12)
    }

    protected setLinks(page: number, next: number, previous: number): void {
        const [buffer, base] = this.locate(page)
        buffer.writeUInt32LE(next, base + 8)
        buffer.writeUInt32LE(previous, base + 12)
    }
}
