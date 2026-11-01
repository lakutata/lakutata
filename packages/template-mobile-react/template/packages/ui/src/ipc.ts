import {Capacitor} from '@capacitor/core'
import {Nodejs} from '@capawesome/capacitor-nodejs'

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
         * The transport of the IPC: the bridge of the plugin in the mobile application, HTTP on the computer
         */
        ipcBridge?: Bridge
        /**
         * The IPC of the application
         */
        ipc: IPC
    }
}

/**
 * The name of the messages of the bridge of @capawesome/capacitor-nodejs (capacitorServiceEntrypoint)
 */
const EVENT: string = 'lakutata:service'

/**
 * The address of the application on the computer of the development (npm run dev: its HTTP entrypoint)
 */
const DEV_URL: string = 'http://localhost:9000'

/**
 * The transport of the IPC in the mobile application: the messages of the bridge of @capawesome/capacitor-nodejs, sent
 * once the Node.js of the application is ready. The plugin tells the page so once the bridge is loaded in Node.js,
 * which may come before the application listens (the messages sent until then are lost): the subscription of the page
 * is sent again until the application answers it, and the actions are invoked after
 */
function pluginBridge(): Bridge {
    const ready: Promise<void> = Nodejs.isReady().then(({ready}): unknown => ready || new Promise<void>((resolve: () => void): unknown => Nodejs.addListener('ready', (): void => resolve()))).then((): void => undefined)
    const responses: Map<number, (response: ServiceResponse<any>) => void> = new Map()
    const listeners: Map<string, (event: string, args: unknown[]) => void> = new Map()
    const subscriptions: Map<string, () => void> = new Map()
    let subscribed: Promise<void> = Promise.resolve()
    let next: number = 0
    void Nodejs.addListener('message', ({eventName, args}): void => {
        if (eventName !== EVENT) return
        const message = args[0] as { type: string, id?: number, response?: ServiceResponse<any>, clientId?: string, event?: string, args?: unknown[] }
        if (message?.type === 'response') {
            responses.get(message.id!)?.(message.response!)
            responses.delete(message.id!)
        } else if (message?.type === 'event') {
            listeners.get(message.clientId!)?.(message.event!, message.args ?? [])
        } else if (message?.type === 'subscribed') {
            subscriptions.get(message.clientId!)?.()
        }
    })
    const send = async (message: Record<string, unknown>): Promise<void> => {
        await ready
        await Nodejs.send({eventName: EVENT, args: [message as any]})
    }
    return {
        invoke: async <T>(data: Record<string, unknown>, clientId: string): Promise<ServiceResponse<T>> => {
            await subscribed
            const id: number = ++next
            const response: Promise<ServiceResponse<T>> = new Promise((resolve: (response: ServiceResponse<T>) => void): unknown => responses.set(id, resolve))
            try {
                await send({type: 'invoke', id: id, clientId: clientId, data: data})
            } catch (error) {
                responses.delete(id)
                throw error
            }
            return response
        },
        subscribe: (clientId: string, listener: (event: string, args: unknown[]) => void): void => {
            listeners.set(clientId, listener)
            subscribed = new Promise((resolve: () => void): void => {
                let timer: ReturnType<typeof setTimeout> | undefined
                subscriptions.set(clientId, (): void => {
                    clearTimeout(timer)
                    subscriptions.delete(clientId)
                    resolve()
                })
                const attempt = (): void => {
                    send({type: 'subscribe', clientId: clientId}).catch((): void => undefined)
                    timer = setTimeout(attempt, 250)
                }
                void ready.then(attempt)
            })
        }
    }
}

/**
 * The transport of the IPC on the computer of the development (npm run dev): the HTTP entrypoint of the application, its
 * events read from its stream (Server-Sent Events)
 * @param url
 */
function httpBridge(url: string): Bridge {
    return {
        invoke: async <T>(data: Record<string, unknown>, clientId: string): Promise<ServiceResponse<T>> => {
            const response: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'id': clientId}, body: JSON.stringify(data)})
            return await response.json() as ServiceResponse<T>
        },
        subscribe: (clientId: string, listener: (event: string, args: unknown[]) => void): void => {
            const listen = async (): Promise<void> => {
                const response: Response = await fetch(`${url}/events?id=${encodeURIComponent(clientId)}`)
                const reader: ReadableStreamDefaultReader<Uint8Array> = response.body!.getReader()
                const decoder = new TextDecoder()
                let buffer: string = ''
                for (; ;) {
                    const {value, done} = await reader.read()
                    if (done) return
                    buffer += decoder.decode(value, {stream: true})
                    //The events end with a blank line: event: <name>, data: <its arguments in JSON>
                    for (let end: number = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
                        const block: string = buffer.slice(0, end)
                        buffer = buffer.slice(end + 2)
                        const event: string | undefined = /^event: (.*)$/m.exec(block)?.[1]
                        const data: string | undefined = /^data: (.*)$/m.exec(block)?.[1]
                        if (event && data) listener(event, JSON.parse(data))
                    }
                }
            }
            //The application restarted: listened again
            const again = (): unknown => setTimeout((): unknown => listen().then(again, again), 1000)
            listen().then(again, again)
        }
    }
}

window.ipcBridge ??= Capacitor.isNativePlatform() ? pluginBridge() : httpBridge(DEV_URL)

/**
 * The IPC of the application (window.ipc): its actions invoked, their results given and their errors thrown (with their
 * errno), its events listened to. Defined in the page: the errors and the listeners given across the messages lose
 * their properties and their identity
 */
export class IPC {

    /**
     * The id of the page, a client of the application (the clientId of the contexts of its requests, which the events
     * are pushed to): a new one each time the page is loaded (crypto.getRandomValues: crypto.randomUUID needs a secure
     * context, which the pages of a dev server on the network are not)
     */
    public readonly id: string = [...crypto.getRandomValues(new Uint8Array(16))].map((byte: number): string => byte.toString(16).padStart(2, '0')).join('')

    readonly #listeners: Map<string, Listener[]> = new Map()

    constructor() {
        window.ipcBridge?.subscribe(this.id, (event: string, args: unknown[]): void => {
            for (const listener of [...this.#listeners.get(event) ?? []]) listener(...args)
        })
        //@if i18n
        //The languages of the device, which the messages of the application are in
        this.invoke({cmd: 'languages', languages: [...navigator.languages]}).catch((): void => undefined)
        //@end
    }

    /**
     * Invoke an action of the application (a @ServiceAction of its controllers): window.ipc.invoke({cmd: 'greet', name: 'you'})
     * @param data its pattern and its input
     */
    public async invoke<T = any>(data: Record<string, unknown>): Promise<T> {
        if (!window.ipcBridge) throw new Error('The actions are invoked in the mobile application (npm run android, npm run ios)')
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
}

window.ipc = new IPC()
