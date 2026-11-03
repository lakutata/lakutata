import {AppState, type AppStateStatus, Platform, TurboModuleRegistry} from 'react-native'

/**
 * The native module of the Node.js of the application (native/NodeHostTurboModule.cpp)
 */
type NodeHost = {
    start(environment?: Record<string, string>): string
    send(line: string): void
    listen(callback: (line: string) => void): void
    pause(): void
    resume(): void
}

/**
 * The response of an action of the application
 */
type ServiceResponse<T> = {
    success: boolean
    error: { message?: string, errno?: string } | null
    payload: T
}

/**
 * A message of the application (reactNativeServiceEntrypoint), or of the native module when Node.js ends
 */
type Message = {
    type: 'response' | 'event' | 'subscribed' | 'exit' | 'error'
    id?: number
    response?: ServiceResponse<unknown>
    clientId?: string
    event?: string
    args?: unknown[]
    code?: number
    message?: string
}

/**
 * A listener of an event of the application, given its arguments
 */
type Listener = (...args: any[]) => void

const host: NodeHost = TurboModuleRegistry.getEnforcing<NodeHost & import('react-native').TurboModule>('LakutataNodeHost')

/**
 * The IPC of the application: its actions invoked, their results given and their errors thrown (with their errno), its
 * events listened to. Node.js runs in the mobile application, started with the user interface; when it ends
 * (process.exit(), an uncaught exception), the actions in progress fail, the event 'exit' gives its exit code, and
 * restart() starts it again
 */
export class IPC {

    /**
     * The id of the user interface, a client of the application (the clientId of the contexts of its requests, which
     * the events are pushed to)
     */
    public readonly id: string = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

    /**
     * Whether Node.js runs
     */
    public running: boolean = false

    readonly #listeners: Map<string, Listener[]> = new Map()
    readonly #pending: Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }> = new Map()
    #next: number = 0

    constructor() {
        host.listen((line: string): void => this.#receive(line))
        //The application goes to the background: it is told so (iOS waits for it in its scene delegate)
        if (Platform.OS !== 'ios') {
            AppState.addEventListener('change', (state: AppStateStatus): void => {
                if (state === 'background') host.pause()
                if (state === 'active') host.resume()
            })
        }
        this.restart()
    }

    /**
     * Start Node.js, when it does not run: the lines written before the application listens wait for it
     */
    public restart(): void {
        if (this.running) return
        const result: string = host.start()
        if (result !== 'started' && result !== 'already started') throw new Error(`Node.js cannot start: ${result}`)
        this.running = true
        host.send(JSON.stringify({type: 'subscribe', clientId: this.id}))
    }

    /**
     * Invoke an action of the application (a @ServiceAction of its controllers): ipc.invoke({cmd: 'greet', name: 'you'})
     * @param data its pattern and its input
     */
    public invoke<T = any>(data: Record<string, unknown>): Promise<T> {
        if (!this.running) return Promise.reject(new Error('Node.js does not run: ipc.restart() starts it again'))
        const id: number = ++this.#next
        return new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
            this.#pending.set(id, {resolve: resolve, reject: reject})
            host.send(JSON.stringify({type: 'invoke', id: id, clientId: this.id, data: data}))
        })
    }

    /**
     * Listen to an event of the application, or to 'exit' (Node.js ended, its exit code given)
     * @param event
     * @param listener
     * @returns a function removing the listener
     */
    public on(event: string, listener: Listener): () => void {
        this.#listeners.set(event, [...this.#listeners.get(event) ?? [], listener])
        return (): void => {
            this.#listeners.set(event, (this.#listeners.get(event) ?? []).filter((item: Listener): boolean => item !== listener))
        }
    }

    /**
     * Give an event to its listeners
     * @param event
     * @param args
     */
    #emit(event: string, args: unknown[]): void {
        for (const listener of [...this.#listeners.get(event) ?? []]) listener(...args)
    }

    /**
     * Handle a line of the application or of the native module
     * @param line
     */
    #receive(line: string): void {
        let message: Message
        try {
            message = JSON.parse(line) as Message
        } catch {
            return
        }
        if (message.type === 'response' && message.id !== undefined) {
            const pending = this.#pending.get(message.id)
            this.#pending.delete(message.id)
            const response: ServiceResponse<unknown> | undefined = message.response
            if (!pending || !response) return
            if (response.success) pending.resolve(response.payload)
            else pending.reject(Object.assign(new Error(response.error?.message ?? 'The action failed'), response.error))
        } else if (message.type === 'event' && message.clientId === this.id) {
            this.#emit(message.event!, message.args ?? [])
        } else if (message.type === 'exit') {
            this.running = false
            for (const pending of this.#pending.values()) pending.reject(new Error(`Node.js ended (exit code ${message.code})`))
            this.#pending.clear()
            this.#emit('exit', [message.code])
        } else if (message.type === 'error') {
            this.#emit('error', [new Error(message.message)])
        }
    }
}

/**
 * The IPC of the application, created once
 */
export const ipc: IPC = new IPC()
