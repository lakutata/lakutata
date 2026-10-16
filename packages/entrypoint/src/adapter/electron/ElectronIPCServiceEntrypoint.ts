import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The part of Electron's `WebContents` (a renderer) that {@link electronIPCServiceEntrypoint} uses: the sender of the
 * invocations and the receiver of the events pushed to its pages.
 */
export type IPCSender = {
    /**
     * Listen once to the renderer's destruction, which aborts its requests in progress and removes its clients.
     * @param event The `'destroyed'` event.
     * @param listener Called when the renderer is destroyed.
     */
    once(event: 'destroyed', listener: () => void): unknown
    /**
     * Remove a `'destroyed'` listener (`removeListener` is used without it).
     * @param event The `'destroyed'` event.
     * @param listener The listener to remove.
     */
    off?(event: 'destroyed', listener: () => void): unknown
    /**
     * Remove a `'destroyed'` listener, when `off` is missing.
     * @param event The `'destroyed'` event.
     * @param listener The listener to remove.
     */
    removeListener?(event: 'destroyed', listener: () => void): unknown
    /**
     * Send a message to the renderer's main frame, used to push an event to a client without a known frame.
     * @param channel The IPC channel.
     * @param args The message's arguments.
     */
    send?(channel: string, ...args: unknown[]): void
    /**
     * Send a message to a frame of the renderer, used to push an event to the page of a client.
     * @param frame The frame's process id and frame id.
     * @param channel The IPC channel.
     * @param args The message's arguments.
     */
    sendToFrame?(frame: [number, number], channel: string, ...args: unknown[]): void
    /**
     * Tell whether the renderer is destroyed; its clients are then dropped instead of receiving the events.
     * @returns Whether the renderer is destroyed.
     */
    isDestroyed?(): boolean
}

/**
 * The part of Electron's `IpcMainInvokeEvent` that {@link electronIPCServiceEntrypoint} uses, given to the service
 * actions through {@link ipcEventOfContext}.
 */
export type IPCInvokeEvent = {
    /**
     * The renderer that invoked.
     */
    readonly sender: IPCSender
    /**
     * The id of the renderer process of the invoking frame.
     */
    readonly processId?: number
    /**
     * The id of the invoking frame within its process.
     */
    readonly frameId?: number
    /**
     * The invoking frame; a frame without `parent` is the main frame of its window.
     */
    readonly senderFrame?: { readonly parent?: unknown } | null
}

/**
 * The part of Electron's `ipcMain` that {@link electronIPCServiceEntrypoint} uses (give a stand-in in the tests).
 */
export type IPCMain = {
    /**
     * Handle the invocations of a channel (`ipcRenderer.invoke`).
     * @param channel The IPC channel.
     * @param listener Answers an invocation with its result.
     */
    handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
    /**
     * Remove the handler of a channel, when the adapter closes.
     * @param channel The IPC channel.
     */
    removeHandler(channel: string): void
    /**
     * Listen to the messages of a channel (`ipcRenderer.send`), used for the event subscriptions; without it, the pages
     * are registered as clients only when they invoke with their id.
     * @param channel The IPC channel.
     * @param listener Called with each message.
     */
    on?(channel: string, listener: (event: any, ...args: any[]) => void): unknown
    /**
     * Remove the listeners of a channel, when the adapter closes.
     * @param channel The IPC channel.
     */
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

/**
 * The options of {@link electronIPCServiceEntrypoint}.
 */
export type ElectronIPCServiceEntrypointOptions = {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The IPC channel of the requests (`ipcRenderer.invoke(channel, data, clientId)`). The events pushed to the pages are
     * sent on `<channel>:event`, and a page subscribes to them by sending its client id on `<channel>:subscribe`.
     * @default 'lakutata:service'
     */
    channel?: string
    /**
     * The `ipcMain` to serve the requests on.
     * @default the `ipcMain` of Electron's main process
     */
    ipcMain?: IPCMain
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * Get the IPC event of a service action's request, when {@link electronIPCServiceEntrypoint} serves it (to reach the
 * invoking renderer or frame).
 * @param context The service action's context (`this.context` in a controller).
 * @returns The IPC event (Electron's `IpcMainInvokeEvent`, typed as `Event`), or `undefined` when another adapter serves
 * the request.
 * @example
 * ```typescript
 * import {Controller, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ipcEventOfContext} from 'lakutata/adapter/electron'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import type {IpcMainInvokeEvent} from 'electron'
 *
 * class WindowController extends Controller {
 *     //ipcRenderer.invoke('lakutata:service', {cmd: 'window.url'})
 *     @ServiceAction({cmd: 'window.url'})
 *     public async url(): Promise<string | undefined> {
 *         return ipcEventOfContext<IpcMainInvokeEvent>(this.context as ServiceContext)?.sender.getURL()
 *     }
 * }
 * ```
 */
export function ipcEventOfContext<Event extends IPCInvokeEvent = IPCInvokeEvent>(context: ServiceContext): Event | undefined {
    return (context as ServiceContext & { event?: Event }).event
}

/**
 * The ipcMain of the main process of Electron
 */
async function loadIPCMain(): Promise<IPCMain> {
    let ipcMain: IPCMain | undefined
    try {
        //Electron is not a dependency: it is loaded where it runs
        const electronModule: string = 'electron'
        const electron: any = await import(electronModule)
        ipcMain = electron.ipcMain ?? electron.default?.ipcMain
    } catch {
        ipcMain = undefined
    }
    if (!ipcMain) throw new Error('electronIPCServiceEntrypoint runs in the main process of Electron (or is given its ipcMain)')
    return ipcMain
}

/**
 * Create a service adapter of an entrypoint served over Electron's IPC, in the main process. It needs the optional
 * peer dependency `electron`: without the `ipcMain` option, the entrypoint fails to start outside Electron's main
 * process.
 *
 * A renderer invokes the channel with the action's pattern and input, and optionally its client id:
 * `ipcRenderer.invoke('lakutata:service', {cmd: 'echo', text: 'hi'}, clientId)`. The invocation resolves to
 * `{success, error, payload}` (see `ServiceResponseCodec`): `payload` is the result, or `error` the whole error object
 * when the action failed (no matching action, validation…).
 *
 * Each page is a client, identified by the id it gives (a non-empty string of at most 200 characters), which its
 * requests carry as `ServiceContext.clientId`. A page registers by sending its id on `<channel>:subscribe` (or with
 * any invocation giving it); a page reloaded in the same frame replaces its previous id. The events pushed by
 * `Entrypoint.notify` and `Entrypoint.broadcast` are sent to the page's frame on `<channel>:event` with the event name
 * and its arguments array. A destroyed renderer drops its clients.
 *
 * When a renderer is destroyed, its requests in progress are aborted (their abort signal fires). When the entrypoint
 * stops, the new invocations resolve to an `EntrypointStoppedException` error; once the requests in progress end, the
 * IPC handlers are removed.
 * @param options The adapter options; by default it serves the channel `'lakutata:service'` on Electron's `ipcMain`.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {electronIPCServiceEntrypoint} from 'lakutata/adapter/electron'
 * import type {IpcRenderer, IpcRendererEvent} from 'electron'
 *
 * class EchoController extends Controller {
 *     @ServiceAction({cmd: 'echo'})
 *     public async echo(input: {text: string}): Promise<string> {
 *         return input.text
 *     }
 * }
 *
 * //In the main process
 * Application.run({
 *     id: 'desktop.app',
 *     name: 'Desktop',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [EchoController],
 *             service: electronIPCServiceEntrypoint()
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //In the preload script of a window
 * declare const ipcRenderer: IpcRenderer
 * const clientId: string = crypto.randomUUID()
 * //The events pushed by entrypoint.notify(clientId, 'progress', 50)
 * ipcRenderer.on('lakutata:service:event', (event: IpcRendererEvent, name: string, args: unknown[]): void => console.log(name, ...args))
 * ipcRenderer.send('lakutata:service:subscribe', clientId)
 * //{success: true, error: null, payload: 'hi'}
 * console.log(await ipcRenderer.invoke('lakutata:service', {cmd: 'echo', text: 'hi'}, clientId))
 * ```
 */
export function electronIPCServiceEntrypoint(options: ElectronIPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
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
            ipcMain = options.ipcMain ?? await loadIPCMain()
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
