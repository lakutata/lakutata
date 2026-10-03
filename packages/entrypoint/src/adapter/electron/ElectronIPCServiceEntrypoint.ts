import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The web contents of a renderer: the sender of its invocations, the receiver of the events pushed to it
 */
export type IPCSender = {
    once(event: 'destroyed', listener: () => void): unknown
    off?(event: 'destroyed', listener: () => void): unknown
    removeListener?(event: 'destroyed', listener: () => void): unknown
    send?(channel: string, ...args: unknown[]): void
    sendToFrame?(frame: [number, number], channel: string, ...args: unknown[]): void
    isDestroyed?(): boolean
}

/**
 * The event of an invocation: its sender is the web contents of the renderer, its frame the one of the page invoking
 */
export type IPCInvokeEvent = {
    readonly sender: IPCSender
    readonly processId?: number
    readonly frameId?: number
    readonly senderFrame?: { readonly parent?: unknown } | null
}

/**
 * The part of the ipcMain of Electron used by the adapter
 */
export type IPCMain = {
    handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
    removeHandler(channel: string): void
    on?(channel: string, listener: (event: any, ...args: any[]) => void): unknown
    removeAllListeners?(channel: string): unknown
}

/**
 * A client of the adapter: a page of a renderer, which gives its id when it subscribes to the events and when it invokes
 */
type IPCClient = {
    sender: IPCSender
    //Its frame: the process of its renderer, its id in it (the ids of the frames are the ones of their process)
    frame?: [number, number]
    main: boolean
}

export type ElectronIPCServiceEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The IPC channel of the requests, "lakutata:service" by default (ipcRenderer.invoke(channel, data, clientId)); the
     * events pushed to the renderers (Entrypoint.notify, broadcast) are sent on "<channel>:event", the renderers
     * subscribe to them by sending their id on "<channel>:subscribe"
     */
    channel?: string
    /**
     * The ipcMain of Electron, the one of the main process by default
     */
    ipcMain?: IPCMain
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * The IPC event of the request of a context, in the service actions served by Electron
 * @param context
 */
export function IPCEventOfContext<Event extends IPCInvokeEvent = IPCInvokeEvent>(context: ServiceContext): Event | undefined {
    return (context as ServiceContext & { event?: Event }).event
}

/**
 * The ipcMain of the main process of Electron
 */
async function LoadIPCMain(): Promise<IPCMain> {
    let ipcMain: IPCMain | undefined
    try {
        //Electron is not a dependency: it is loaded where it runs
        const electronModule: string = 'electron'
        const electron: any = await import(electronModule)
        ipcMain = electron.ipcMain ?? electron.default?.ipcMain
    } catch {
        ipcMain = undefined
    }
    if (!ipcMain) throw new Error('ElectronIPCServiceEntrypoint runs in the main process of Electron (or is given its ipcMain)')
    return ipcMain
}

/**
 * The service entrypoint served over the IPC of Electron: the renderers invoke the channel with the pattern and the input of an action,
 * ipcRenderer.invoke('lakutata:service', {cmd: 'echo', …}, clientId), and receive its response encoded as {success, error, payload}
 * (ServiceResponseCodec). Each page is a client (the id it gives, the clientId of the contexts of its requests): the
 * main process pushes events to it (Entrypoint.notify, broadcast) on 'lakutata:service:event', which it subscribes to by
 * sending its id on 'lakutata:service:subscribe'
 * @param options
 */
export function ElectronIPCServiceEntrypoint(options: ElectronIPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const channel: string = options.channel ?? 'lakutata:service'
    const eventChannel: string = `${channel}:event`
    const subscribeChannel: string = `${channel}:subscribe`
    let ipcMain: IPCMain | undefined
    let stopping: boolean = false
    //The clients by their ids, the renderers whose destruction removes their clients
    const clients: Map<string, IPCClient> = new Map()
    const watched: WeakSet<IPCSender> = new WeakSet()

    /**
     * Register the client of a page, by the id it gives (the one of the page loaded: a page loaded again in the main
     * frame of its window replaces its client); undefined without id
     * @param event
     * @param clientId
     */
    const register = (event: IPCInvokeEvent, clientId: unknown): string | undefined => {
        if (typeof clientId !== 'string' || !clientId || clientId.length > 200) return undefined
        if (clients.get(clientId)?.sender === event.sender) return clientId
        const frame: [number, number] | undefined = event.processId !== undefined && event.frameId !== undefined ? [event.processId, event.frameId] : undefined
        const main: boolean = !event.senderFrame?.parent
        for (const [id, client] of clients) {
            const sameFrame: boolean = !!frame && !!client.frame && client.frame[0] === frame[0] && client.frame[1] === frame[1]
            if (client.sender === event.sender && (sameFrame || (main && client.main))) clients.delete(id)
        }
        clients.set(clientId, {sender: event.sender, frame: frame, main: main})
        if (!watched.has(event.sender)) {
            watched.add(event.sender)
            event.sender.once('destroyed', (): void => {
                for (const [id, client] of clients) if (client.sender === event.sender) clients.delete(id)
            })
        }
        return clientId
    }

    /**
     * Send an event to a client, in its frame
     * @param clientId
     * @param client
     * @param event
     * @param args
     */
    const send = (clientId: string, client: IPCClient, event: string, args: unknown[]): boolean => {
        if (client.sender.isDestroyed?.()) {
            clients.delete(clientId)
            return false
        }
        if (client.frame && client.sender.sendToFrame) client.sender.sendToFrame(client.frame, eventChannel, event, args)
        else if (client.sender.send) client.sender.send(eventChannel, event, args)
        else return false
        return true
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            ipcMain = options.ipcMain ?? await LoadIPCMain()
            ipcMain.on?.(subscribeChannel, (event: IPCInvokeEvent, clientId: unknown): unknown => register(event, clientId))
            ipcMain.handle(channel, async (event: IPCInvokeEvent, data: unknown, clientId: unknown): Promise<ServiceResponse> => {
                if (stopping) return ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping'))
                //The request is aborted when its renderer is destroyed
                const request: AbortController = new AbortController()
                const abort = (): void => request.abort()
                event.sender.once('destroyed', abort)
                try {
                    const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, event: event, clientId: register(event, clientId)})
                    return ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: request.signal}), false)
                } catch (error: unknown) {
                    return ServiceResponseCodec.encodeError(error)
                } finally {
                    (event.sender.off ?? event.sender.removeListener)?.call(event.sender, 'destroyed', abort)
                }
            })
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: (): void => {
            ipcMain?.removeHandler(channel)
            ipcMain?.removeAllListeners?.(subscribeChannel)
            clients.clear()
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const client: IPCClient | undefined = clients.get(clientId)
            return !!client && send(clientId, client, event, args)
        },
        broadcast: (event: string, args: unknown[]): number => {
            let sent: number = 0
            for (const [clientId, client] of [...clients]) if (send(clientId, client, event, args)) sent++
            return sent
        }
    }
}
