import {nativeUnwatch, nativeWatch} from './Native.js'
import {readInterfaces} from './Snapshot.js'
import {type NetworkInterfaceInfo} from './Types.js'

/**
 * A subscriber of the changes: called with the interfaces read after each change
 */
export type Subscriber = (interfaces: NetworkInterfaceInfo[]) => void

//The notifications of the system come in bursts (an interface plugged: its link, then each address): read once after
const SETTLE: number = 50
//An IPv6 address in its duplicate address detection: read again until it is usable (no notification of it on macOS)
const TENTATIVE_INTERVAL: number = 300
const TENTATIVE_LIMIT: number = 15000

/**
 * The interfaces of the machine as the package follows them: the notifications of the system shared by every
 * subscriber of the thread, started with the first one and stopped with the last one. The timers do not keep the event
 * loop alive.
 */
class Registry {

    readonly #subscribers: Set<Subscriber> = new Set()

    #interfaces: NetworkInterfaceInfo[] = []

    #settle: NodeJS.Timeout | undefined

    #tentative: NodeJS.Timeout | undefined

    #tentativeSince: number = 0

    /**
     * The interfaces read last while followed, read now otherwise
     */
    public current(): NetworkInterfaceInfo[] {
        return this.#subscribers.size ? this.#interfaces : readInterfaces().interfaces
    }

    /**
     * Follows the interfaces: the subscriber is called after each change; the function returned unsubscribes it
     */
    public subscribe(subscriber: Subscriber): () => void {
        if (!this.#subscribers.size) {
            this.#tentativeSince = Date.now()
            this.#interfaces = this.#read()
            nativeWatch((): void => this.#changed())
        }
        this.#subscribers.add(subscriber)
        return (): void => this.#unsubscribe(subscriber)
    }

    #unsubscribe(subscriber: Subscriber): void {
        if (!this.#subscribers.delete(subscriber) || this.#subscribers.size) return
        nativeUnwatch()
        clearTimeout(this.#settle)
        clearTimeout(this.#tentative)
        this.#settle = undefined
        this.#tentative = undefined
    }

    /**
     * A notification of the system: the interfaces read once the burst has settled
     */
    #changed(): void {
        if (this.#settle || !this.#subscribers.size) return
        this.#settle = setTimeout((): void => {
            this.#settle = undefined
            this.#tentativeSince = Date.now()
            this.#refresh()
        }, SETTLE)
        this.#settle.unref()
    }

    #refresh(): void {
        if (!this.#subscribers.size) return
        try {
            this.#interfaces = this.#read()
        } catch {
            //The system cannot be read now: the next notification reads it again
            return
        }
        for (const subscriber of [...this.#subscribers]) {
            try {
                subscriber(this.#interfaces)
            } catch (error) {
                queueMicrotask((): never => {
                    throw error
                })
            }
        }
    }

    /**
     * The interfaces now; while an address is tentative, read again a little later
     */
    #read(): NetworkInterfaceInfo[] {
        const {interfaces, tentative} = readInterfaces()
        clearTimeout(this.#tentative)
        this.#tentative = undefined
        if (tentative && Date.now() - this.#tentativeSince < TENTATIVE_LIMIT) {
            this.#tentative = setTimeout((): void => {
                this.#tentative = undefined
                this.#refresh()
            }, TENTATIVE_INTERVAL)
            this.#tentative.unref()
        }
        return interfaces
    }
}

/**
 * The registry of the thread
 */
export const registry: Registry = new Registry()
