import type { EmbeddedDocument } from "./EmbeddedValues"

/**
 * lakutata: the memory of a document in the heap of V8, estimated from the size of its record (about 3.7 times its
 * BSON).
 *
 * @param recordLength
 */
export function cachedSizeOf(recordLength: number): number {
    return recordLength * 4
}

/**
 * lakutata: a document cached: read by the store and its callers (it is never changed), its size, whether it was read
 * since the eviction last passed it.
 */
interface CacheEntry {
    document: EmbeddedDocument
    size: number
    hit: boolean
}

/**
 * lakutata: the memory the document caches of a database share: when they hold more, the cache adding a document evicts
 * its own first, then the largest one.
 */
export class EmbeddedCacheBudget {
    used = 0

    readonly caches = new Set<EmbeddedCollectionCache>()

    /**
     * @param capacity the memory of the cached documents, in bytes (estimated)
     */
    constructor(readonly capacity: number) {}

    /**
     * Evicts documents until the caches hold their capacity.
     *
     * @param adding the cache adding a document
     */
    trim(adding: EmbeddedCollectionCache): void {
        while (this.used > this.capacity && adding.evictOne()) {}
        while (this.used > this.capacity) {
            let largest: EmbeddedCollectionCache | undefined
            for (const cache of this.caches)
                if (!largest || cache.size > largest.size) largest = cache
            if (!largest || !largest.evictOne()) return
        }
    }
}

/**
 * lakutata: the documents of a collection cached, by the keys of their _id: their oldest evicted first, unless they
 * were read since (their second chance).
 */
export class EmbeddedCollectionCache {
    protected readonly entries = new Map<string, CacheEntry>()

    constructor(protected readonly budget: EmbeddedCacheBudget) {
        budget.caches.add(this)
    }

    /**
     * The number of the documents cached.
     */
    get size(): number {
        return this.entries.size
    }

    /**
     * A document cached, if any.
     *
     * @param key the key of its _id, as a latin1 string
     */
    get(key: string): EmbeddedDocument | undefined {
        const entry = this.entries.get(key)
        if (!entry) return undefined
        entry.hit = true
        return entry.document
    }

    /**
     * Caches a document (it is not changed any more), unless it is larger than the capacity.
     *
     * @param key
     * @param document
     * @param size
     */
    set(key: string, document: EmbeddedDocument, size: number): void {
        this.delete(key)
        if (size > this.budget.capacity) return
        this.entries.set(key, { document: document, size: size, hit: false })
        this.budget.used += size
        if (this.budget.used > this.budget.capacity) this.budget.trim(this)
    }

    /**
     * Caches a document when the budget has room for it, evicting none: the scans of a collection larger than the
     * cache do not replace it with its documents read once.
     *
     * @param key
     * @param document
     * @param size
     */
    offer(key: string, document: EmbeddedDocument, size: number): void {
        if (this.budget.used + size > this.budget.capacity) return
        this.entries.set(key, { document: document, size: size, hit: false })
        this.budget.used += size
    }

    delete(key: string): void {
        const entry = this.entries.get(key)
        if (!entry) return
        this.entries.delete(key)
        this.budget.used -= entry.size
    }

    /**
     * The documents cached, at once (the writes made while they are read change the cache).
     */
    documents(): EmbeddedDocument[] {
        const documents: EmbeddedDocument[] = []
        for (const entry of this.entries.values()) {
            entry.hit = true
            documents.push(entry.document)
        }
        return documents
    }

    /**
     * Evicts a document: the oldest not read since the eviction last passed it; whether one was evicted.
     */
    evictOne(): boolean {
        let passes = this.entries.size
        for (const [key, entry] of this.entries) {
            if (entry.hit && passes-- > 0) {
                // Its second chance: moved to the end
                entry.hit = false
                this.entries.delete(key)
                this.entries.set(key, entry)
                continue
            }
            this.entries.delete(key)
            this.budget.used -= entry.size
            return true
        }
        return false
    }

    /**
     * Removes all the documents, and the cache from its budget.
     */
    close(): void {
        for (const entry of this.entries.values()) this.budget.used -= entry.size
        this.entries.clear()
        this.budget.caches.delete(this)
    }
}
