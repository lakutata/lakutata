import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

/**
 * The event of an invocation: its sender is the web contents of the renderer
 */
export type IPCInvokeEvent = {
    readonly sender: {
        once(event: 'destroyed', listener: () => void): unknown
        off?(event: 'destroyed', listener: () => void): unknown
        removeListener?(event: 'destroyed', listener: () => void): unknown
    }
}

/**
 * The part of the ipcMain of Electron used by the adapter
 */
export type IPCMain = {
    handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
    removeHandler(channel: string): void
}

export type ElectronIPCServiceEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The IPC channel of the requests, "lakutata:service" by default
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
 * ipcRenderer.invoke('lakutata:service', {cmd: 'echo', …}), and receive its response encoded as {success, error, payload} (ServiceResponseCodec)
 * @param options
 */
export function ElectronIPCServiceEntrypoint(options: ElectronIPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const channel: string = options.channel ?? 'lakutata:service'
    let ipcMain: IPCMain | undefined
    let stopping: boolean = false

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            ipcMain = options.ipcMain ?? await LoadIPCMain()
            ipcMain.handle(channel, async (event: IPCInvokeEvent, data: unknown): Promise<ServiceResponse> => {
                if (stopping) return ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping'))
                //The request is aborted when its renderer is destroyed
                const request: AbortController = new AbortController()
                const abort = (): void => request.abort()
                event.sender.once('destroyed', abort)
                try {
                    const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, event: event})
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
        }
    }
}
