/**
 * The response of an action of the application
 */
type ServiceResponse<T> = {
    success: boolean
    error: { message?: string, errno?: string } | null
    payload: T
}

/**
 * A listener of an event of the application, given its arguments
 */
type Listener = (...args: any[]) => void

/**
 * The transport of the IPC: the actions invoked, the events of the application received
 */
type Bridge = {
    invoke<T>(data: Record<string, unknown>, clientId: string): Promise<ServiceResponse<T>>
    subscribe(clientId: string, listener: (event: string, args: unknown[]) => void): void
}

declare global {
    interface Window {
        /**
         * The transport of the IPC: the messages of the host page of the window of the application
         */
        ipcBridge?: Bridge
        /**
         * The IPC of the application
         */
        ipc: IPC
    }
}

/**
 * The channel of the messages between the page and the host page of the window (packages/app/host/host.js)
 */
const CHANNEL: string = 'lakutata:service'

/**
 * How long an action waits for the host page: a page that hears nothing from the host page in that time is not in the
 * window of the application
 */
const HOST_TIMEOUT: number = 10000

/**
 * The transport of the IPC in the webview of the window: the host page gives the page the source of its messages once
 * the page is loaded, forwards its invocations to the application and pushes it the events of the application
 */
function hostBridge(): Bridge {
    let host: { source: Window, origin: string } | undefined
    let connected: () => void = (): void => undefined
    const connection: Promise<void> = new Promise((resolve: () => void): void => {
        connected = resolve
    })
    const responses: Map<number, (response: ServiceResponse<any>) => void> = new Map()
    const listeners: ((event: string, args: unknown[]) => void)[] = []
    let next: number = 0
    window.addEventListener('message', (event: MessageEvent): void => {
        const message = event.data
        if (message?.channel !== CHANNEL) return
        if (message.type === 'hello') {
            host = {source: event.source as Window, origin: event.origin}
            return connected()
        }
        //The messages of the host page only
        if (!host || event.source !== host.source) return
        if (message.type === 'response') {
            responses.get(message.id)?.(message.response)
            responses.delete(message.id)
        } else if (message.type === 'event') {
            for (const listener of listeners) listener(message.name, message.args)
        }
    })
    const post = async (message: Record<string, unknown>): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([connection, new Promise((_resolve: unknown, reject: (error: Error) => void): void => {
                timer = setTimeout((): void => reject(new Error('The actions are invoked in the window of the application (npm run dev)')), HOST_TIMEOUT)
            })])
        } finally {
            clearTimeout(timer)
        }
        host!.source.postMessage({channel: CHANNEL, ...message}, host!.origin)
    }
    return {
        invoke: async <T>(data: Record<string, unknown>, clientId: string): Promise<ServiceResponse<T>> => {
            const id: number = ++next
            const response: Promise<ServiceResponse<T>> = new Promise((resolve: (response: ServiceResponse<T>) => void): unknown => responses.set(id, resolve))
            try {
                await post({type: 'invoke', id: id, data: data, clientId: clientId})
            } catch (error) {
                responses.delete(id)
                throw error
            }
            return response
        },
        subscribe: (clientId: string, listener: (event: string, args: unknown[]) => void): void => {
            listeners.push(listener)
            //Outside the window of the application, the page receives no event
            post({type: 'subscribe', clientId: clientId}).catch((): void => undefined)
        }
    }
}

window.ipcBridge ??= hostBridge()

/**
 * The IPC of the application (window.ipc): its actions invoked, their results given and their errors thrown (with their
 * errno), its events listened to. Defined in the page: the errors and the listeners given across the messages lose
 * their properties and their identity
 */
export class IPC {

    /**
     * The id of the page, a client of the application (the clientId of the contexts of its requests, which the events
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
     * Invoke an action of the application (a @ServiceAction of its controllers): window.ipc.invoke({cmd: 'greet', name: 'you'})
     * @param data its pattern and its input
     */
    public async invoke<T = any>(data: Record<string, unknown>): Promise<T> {
        if (!window.ipcBridge) throw new Error('The actions are invoked in the window of the application (npm run dev)')
        const response: ServiceResponse<T> = await window.ipcBridge.invoke<T>(data, this.id)
        if (!response.success) throw Object.assign(new Error(response.error?.message ?? 'The action failed'), response.error)
        return response.payload
    }

    /**
     * Listen to an event of the application
     * @param event
     * @param listener
     */
    public on(event: string, listener: Listener): this {
        this.#listeners.set(event, [...this.#listeners.get(event) ?? [], listener])
        return this
    }

    /**
     * Listen to the next event of the application
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
     * Stop listening to an event of the application
     * @param event
     * @param listener
     */
    public off(event: string, listener: Listener): this {
        this.#listeners.set(event, (this.#listeners.get(event) ?? []).filter((existing: Listener & { listener?: Listener }): boolean => existing !== listener && existing.listener !== listener))
        return this
    }

    /**
     * Stop listening to an event of the application (off)
     * @param event
     * @param listener
     */
    public removeListener(event: string, listener: Listener): this {
        return this.off(event, listener)
    }

    /**
     * Stop listening to an event of the application, or to every event
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
