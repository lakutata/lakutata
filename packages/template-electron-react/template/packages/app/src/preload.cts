import {contextBridge, ipcRenderer} from 'electron'

/**
 * The preload script of the window: the renderer invokes the actions of the main process, and nothing else of Electron
 * or of Node.js (window.lakutata.invoke({cmd: 'greet', name: 'you'}) → {success, error, payload})
 */
contextBridge.exposeInMainWorld('lakutata', {
    invoke: (data: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke('lakutata:service', data)
})
