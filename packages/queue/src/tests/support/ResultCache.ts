import {Component} from '@lakutata/core'

/**
 * A store of the results, as a Cacher
 */
export class ResultCache extends Component {
    public readonly entries: Map<string, {value: unknown, expiresAt: number}> = new Map()

    public async get(key: string): Promise<unknown> {
        const entry: {value: unknown, expiresAt: number} | undefined = this.entries.get(key)
        return entry && entry.expiresAt > Date.now() ? entry.value : undefined
    }

    //A time to live of 0 never expires, as the Cacher of @lakutata/cache
    public async set(key: string, value: unknown, ttl: number): Promise<void> {
        this.entries.set(key, {value: value, expiresAt: ttl > 0 ? Date.now() + ttl : Infinity})
    }
}
