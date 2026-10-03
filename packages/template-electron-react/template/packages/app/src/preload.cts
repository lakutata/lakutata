import {contextBridge, ipcRenderer} from 'electron'

/**
 * The preload script of the window: the transport of window.ipc (packages/ui/src/ipc.ts), the renderer invokes the actions
 * of the main process and receives the events it pushes, nothing else of Electron or of Node.js
 */
contextBridge.exposeInMainWorld('ipcBridge', {
    invoke: (data: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke('lakutata:service', data),
    //The events of the main process (NotifyRenderer, BroadcastToRenderers), once the renderer is subscribed to them
    subscribe: (listener: (event: string, args: unknown[]) => void): void => {
        ipcRenderer.on('lakutata:service:event', (_event: unknown, name: string, args: unknown[]): void => listener(name, args))
        ipcRenderer.send('lakutata:service:subscribe')
    }
})
