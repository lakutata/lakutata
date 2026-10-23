type EventExecute<T extends any[]> = (...args: T) => void
type PromiseEventExecute<T extends any[]> = (...args: T) => Promise<void>
type EventComplete = () => void
type EventError = (e: any) => void
interface Subscriber<E> {
    execute: E
    complete?: EventComplete
    error?: EventError
    //Unsubscribed: skipped, and left out of the list once it is compacted
    removed?: boolean
}

/**
 * The subscribers of an event in their order. Unsubscribing marks a subscriber removed, in constant time; the list
 * drops the removed ones once they outnumber the others, a copy left to the iterations going on
 */
class Subscribers<E> {
    list: Subscriber<E>[] = []
    size: number = 0
    #removed: number = 0

    add(subscriber: Subscriber<E>): void {
        this.list.push(subscriber)
        this.size++
    }

    /**
     * Remove a subscriber
     * @param subscriber
     * @returns Whether it was there
     */
    remove(subscriber: Subscriber<E>): boolean {
        if (subscriber.removed) return false
        subscriber.removed = true
        this.size--
        if (++this.#removed > 16 && this.#removed > this.size) {
            this.list = this.list.filter((each: Subscriber<E>): boolean => !each.removed)
            this.#removed = 0
        }
        return true
    }

    /**
     * Remove them all: the iterations going on skip the ones they have not reached
     */
    clear(): void {
        for (const subscriber of this.list) subscriber.removed = true
        this.list = []
        this.size = 0
        this.#removed = 0
    }
}

export class Event<T extends any[]> {
    private readonly subscribers: Subscribers<EventExecute<T>> = new Subscribers()
    private readonly queued: Subscribers<PromiseEventExecute<T>> = new Subscribers()
    ended = false
    onended?: () => void
    onerror = (_error: any) => {}
    //Called when a subscriber is added or removed (length is their number)
    onsubscriberschange?: () => void

    execute = (...args: T) => {
        if (this.ended) {
            return
        }

        for (const item of this.subscribers.list) {
            if (!item.removed) item.execute(...args)
        }

        //The queued subscribers run one after the other; without them, no promise is made
        if (this.queued.size === 0) return
        (async () => {
            for (const item of this.queued.list) {
                if (!item.removed) await item.execute(...args)
            }
        })().catch((e) => {
            this.onerror(e)
        })
    }

    complete = () => {
        if (this.ended) {
            return
        }

        for (const item of this.subscribers.list) {
            if (item.complete && !item.removed) {
                item.complete()
            }
        }
        this.allUnsubscribe()
        this.ended = true
        if (this.onended) {
            this.onended()
            this.onended = undefined
        }
    }

    error = (e: any) => {
        if (this.ended) {
            return
        }

        for (const item of this.subscribers.list) {
            if (item.error && !item.removed) {
                item.error(e)
            }
        }
        this.allUnsubscribe()
    }

    allUnsubscribe = () => {
    // complete() 後の再呼び出しを許容し、close 経路での二重クリーンアップを安全にする
        if (this.ended) {
            return
        }

        this.subscribers.clear()
        this.queued.clear()
        this.onsubscriberschange?.()
    }

    subscribe = (
        execute: EventExecute<T>,
        complete?: EventComplete,
        error?: EventError
    ) => {
        const subscriber: Subscriber<EventExecute<T>> = {execute, complete, error}
        const subscribers = this.subscribers
        subscribers.add(subscriber)
        this.onsubscriberschange?.()

        const unSubscribe = () => {
            if (subscribers.remove(subscriber)) this.onsubscriberschange?.()
        }

        const disposer = (disposer: EventDisposer) => {
            disposer.push(unSubscribe)
        }

        return {unSubscribe, disposer}
    }

    pipe(e: Event<T>) {
        this.subscribe((...args) => {
            e.execute(...args)
        })
    }

    queuingSubscribe = (
        execute: PromiseEventExecute<T>,
        complete?: EventComplete,
        error?: EventError
    ) => {
        if (this.ended) throw new Error('event completed')

        const subscriber: Subscriber<PromiseEventExecute<T>> = {execute, complete, error}
        const queued = this.queued
        queued.add(subscriber)

        const unSubscribe = () => {
            queued.remove(subscriber)
        }

        const disposer = (disposer: EventDisposer) => {
            disposer.push(unSubscribe)
        }

        return {unSubscribe, disposer}
    }

    once = (
        execute: EventExecute<T>,
        complete?: EventComplete,
        error?: EventError
    ) => {
        const off = this.subscribe(
            (...args) => {
                off.unSubscribe()
                execute(...args)
            },
            complete,
            error
        )
    }

    watch = (cb: (...args: T) => boolean, timeLimit?: number) =>
        new Promise<T>((resolve, reject) => {
            const timeout =
                timeLimit &&
        setTimeout(() => {
            reject('Event watch timeout')
        }, timeLimit)

            const {unSubscribe} = this.subscribe((...args) => {
                const done = cb(...args)
                if (done) {
                    if (timeout) clearTimeout(timeout)
                    unSubscribe()
                    resolve(args)
                }
            })
        })

    asPromise = (timeLimit?: number) =>
        new Promise<T>((resolve, reject) => {
            const timeout =
                timeLimit &&
        setTimeout(() => {
            reject('Event asPromise timeout')
        }, timeLimit)

            this.once(
                (...args) => {
                    if (timeout) clearTimeout(timeout)
                    resolve(args)
                },
                () => {
                    if (timeout) clearTimeout(timeout)
                    resolve([] as any)
                },
                (err) => {
                    if (timeout) clearTimeout(timeout)
                    reject(err)
                }
            )
        })

    get returnTrigger() {
        const {execute, error, complete} = this
        return {execute, error, complete}
    }

    get returnListener() {
        const {subscribe, once, asPromise} = this
        return {subscribe, once, asPromise}
    }

    get length() {
        return this.subscribers.size
    }
}

export class EventDisposer {
    private _disposer: (() => void)[] = []

    push(disposer: () => void) {
        this._disposer.push(disposer)
    }

    dispose() {
        this._disposer.forEach((d) => d())
        this._disposer = []
    }
}
