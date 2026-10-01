export interface Cache {
    /**
     * Add an item to the cache.
     *
     * Note that key and value can be anything including objects, array, etc.
     */
    set(key: any, value: any): void

    /**
     * Retrieve an item from the cache.
     *
     * Note that key and value can be anything including objects, array, etc.
     */
    get(key: any): any
}
