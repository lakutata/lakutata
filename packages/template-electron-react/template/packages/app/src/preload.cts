import {contextBridge, ipcRenderer} from 'electron'

/**
 * The preload script of the window: the transport of window.ipc (packages/ui/src/ipc.ts), the renderer invokes the actions
 * of the main process and receives the events it pushes, nothing else of Electron or of Node.js
 */
contextBridge.exposeInMainWorld('ipcBridge', {
    //The page is a client of the main process: its id is the clientId of the contexts of its requests
    invoke: (data: Record<string, unknown>, clientId: string): Promise<unknown> => ipcRenderer.invoke('lakutata:service', data, clientId),
    //The events of the main process (Entrypoint.notify, broadcast), once the page is subscribed to them
    subscribe: (clientId: string, listener: (event: string, args: unknown[]) => void): void => {
        ipcRenderer.on('lakutata:service:event', (_event: unknown, name: string, args: unknown[]): void => listener(name, args))
        ipcRenderer.send('lakutata:service:subscribe', clientId)
    }
})
