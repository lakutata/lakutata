/**
 * A double-ended queue on a ring buffer: adding and removing at both ends take constant time, however long it is (a
 * JavaScript array takes time in proportion to its length to remove its first item)
 */
export class Deque<T> implements Iterable<T> {
    #items: (T | undefined)[] = new Array(16)
    #head: number = 0
    #size: number = 0

    /**
     * The number of items
     */
    get length(): number {
        return this.#size
    }

    /**
     * Adds an item at the end
     */
    push(item: T): void {
        if (this.#size === this.#items.length) this.#grow()
        this.#items[(this.#head + this.#size) & (this.#items.length - 1)] = item
        this.#size++
    }

    /**
     * Adds an item at the start
     */
    unshift(item: T): void {
        if (this.#size === this.#items.length) this.#grow()
        this.#head = (this.#head - 1) & (this.#items.length - 1)
        this.#items[this.#head] = item
        this.#size++
    }

    /**
     * Removes the first item and returns it; undefined when empty
     */
    shift(): T | undefined {
        if (!this.#size) return undefined
        const item: T | undefined = this.#items[this.#head]
        this.#items[this.#head] = undefined
        this.#head = (this.#head + 1) & (this.#items.length - 1)
        this.#size--
        return item
    }

    /**
     * The item at a position from the start (a negative position counts from the end); undefined out of range
     */
    at(index: number): T | undefined {
        const position: number = index < 0 ? this.#size + index : index
        if (position < 0 || position >= this.#size) return undefined
        return this.#items[(this.#head + position) & (this.#items.length - 1)]
    }

    /**
     * The position of the first item the predicate accepts; -1 when none does
     */
    findIndex(predicate: (item: T) => boolean): number {
        for (let i: number = 0; i < this.#size; i++) {
            if (predicate(this.#items[(this.#head + i) & (this.#items.length - 1)] as T)) return i
        }
        return -1
    }

    /**
     * Removes every item
     */
    clear(): void {
        this.#items = new Array(16)
        this.#head = 0
        this.#size = 0
    }

    * [Symbol.iterator](): Iterator<T> {
        for (let i: number = 0; i < this.#size; i++) yield this.#items[(this.#head + i) & (this.#items.length - 1)] as T
    }

    //Doubles the capacity (always a power of two), the items from position 0
    #grow(): void {
        const items: (T | undefined)[] = new Array(this.#items.length * 2)
        for (let i: number = 0; i < this.#size; i++) items[i] = this.#items[(this.#head + i) & (this.#items.length - 1)]
        this.#items = items
        this.#head = 0
    }
}
