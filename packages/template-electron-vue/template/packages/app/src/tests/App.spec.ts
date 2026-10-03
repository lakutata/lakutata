import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import type {IPCMain} from 'lakutata/adapter/electron'
import {Config} from '../config/Config.js'

/**
 * The ipcMain of the tests: the actions are invoked as the renderer invokes them, without Electron
 */
const handlers: Map<string, (event: unknown, data: unknown) => Promise<unknown>> = new Map()
const ipcMain: IPCMain = {
    handle: (channel: string, listener: (event: unknown, data: unknown) => Promise<unknown>): unknown => handlers.set(channel, listener),
    removeHandler: (channel: string): unknown => handlers.delete(channel)
}
//The web contents of the renderer: the events pushed to it
const received: unknown[][] = []
const sender = {once: (): void => undefined, off: (): void => undefined, send: (...args: unknown[]): unknown => received.push(args)}

/**
 * Invoke an action as the renderer does (window.ipc.invoke)
 * @param data
 */
function Invoke(data: Record<string, unknown>): Promise<any> {
    return handlers.get('lakutata:service')!({sender: sender}, data)
}

describe('{$APP_NAME}', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        //@if i18n
        //The actions answer in the language of the environment: English for the tests
        process.env.LC_ALL = 'en_US.UTF-8'
        //@end
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(Config({window: false, ipcMain: ipcMain})).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('serves the actions to the renderer', async (): Promise<void> => {
        assert.deepStrictEqual(await Invoke({cmd: 'greet', name: 'you'}), {success: true, error: null, payload: {message: 'Hello, you!'}})
    })

    //@if i18n
    it('serves the actions in the language of the environment', async (): Promise<void> => {
        process.env.LC_ALL = 'zh_CN.UTF-8'
        try {
            assert.deepStrictEqual(await Invoke({cmd: 'greet', name: 'you'}), {success: true, error: null, payload: {message: '你好，you！'}})
        } finally {
            process.env.LC_ALL = 'en_US.UTF-8'
        }
    })

    //@end
    it('pushes its events to the renderer', async (): Promise<void> => {
        received.length = 0
        await Invoke({cmd: 'greet', name: 'you'})
        assert.deepStrictEqual(received, [['lakutata:service:event', 'greeted', ['you']]])
    })

    it('refuses an invalid input', async (): Promise<void> => {
        const response = await Invoke({cmd: 'greet'})
        assert.strictEqual(response.success, false)
        assert.match(response.error.message, /name/)
    })

    it('refuses an unknown action', async (): Promise<void> => {
        assert.strictEqual((await Invoke({cmd: 'unknown'})).success, false)
    })
})
