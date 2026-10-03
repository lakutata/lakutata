/**
 * The response of an action of the main process
 */
type ServiceResponse<T> = {
    success: boolean
    error: { message?: string, errno?: string } | null
    payload: T
}

/**
 * A listener of an event of the main process, given its arguments
 */
type Listener = (...args: any[]) => void

declare global {
    interface Window {
        /**
         * The transport of the IPC, given by the preload script of the window of the application
         */
        ipcBridge?: {
            invoke<T>(data: Record<string, unknown>, clientId: string): Promise<ServiceResponse<T>>
            subscribe(clientId: string, listener: (event: string, args: unknown[]) => void): void
        }
        /**
         * The IPC of the main process
         */
        ipc: IPC
    }
}

/**
 * The IPC of the main process (window.ipc): its actions invoked, their results given and their errors thrown (with their
 * errno), its events listened to. Defined in the page: the errors and the listeners given across the preload script lose
 * their properties and their identity
 */
export class IPC {

    /**
     * The id of the page, a client of the main process (the clientId of the contexts of its requests, which the events
     * are pushed to): a new one each time the page is loaded
     */
    public readonly id: string = crypto.randomUUID()

    readonly #listeners: Map<string, Listener[]> = new Map()

    constructor() {
        window.ipcBridge?.subscribe(this.id, (event: string, args: unknown[]): void => {
            for (const listener of [...this.#listeners.get(event) ?? []]) listener(...args)
        })
    }

    /**
     * Invoke an action of the main process (a @ServiceAction of its controllers): window.ipc.invoke({cmd: 'greet', name: 'you'})
     * @param data its pattern and its input
     */
    public async invoke<T = any>(data: Record<string, unknown>): Promise<T> {
        if (!window.ipcBridge) throw new Error('The actions are invoked in the window of the application (npm run dev)')
        const response: ServiceResponse<T> = await window.ipcBridge.invoke<T>(data, this.id)
        if (!response.success) throw Object.assign(new Error(response.error?.message ?? 'The action failed'), response.error)
        return response.payload
    }

    /**
     * Listen to an event of the main process
     * @param event
     * @param listener
     */
    public on(event: string, listener: Listener): this {
        this.#listeners.set(event, [...this.#listeners.get(event) ?? [], listener])
        return this
    }

    /**
     * Listen to the next event of the main process
     * @param event
     * @param listener
     */
    public once(event: string, listener: Listener): this {
        const once: Listener & { listener?: Listener } = (...args: any[]): void => {
            this.off(event, once)
            listener(...args)
        }
        once.listener = listener
        return this.on(event, once)
    }

    /**
     * Stop listening to an event of the main process
     * @param event
     * @param listener
     */
    public off(event: string, listener: Listener): this {
        this.#listeners.set(event, (this.#listeners.get(event) ?? []).filter((existing: Listener & { listener?: Listener }): boolean => existing !== listener && existing.listener !== listener))
        return this
    }

    /**
     * Stop listening to an event of the main process (off)
     * @param event
     * @param listener
     */
    public removeListener(event: string, listener: Listener): this {
        return this.off(event, listener)
    }

    /**
     * Stop listening to an event of the main process, or to every event
     * @param event
     */
    public removeAllListeners(event?: string): this {
        if (event === undefined) this.#listeners.clear()
        else this.#listeners.delete(event)
        return this
    }

    /**
     * Kept for the renderers of the version 2 (the listeners of an event are not limited)
     * @param _count
     */
    public setMaxListeners(_count: number): this {
        return this
    }
}

window.ipc = new IPC()
