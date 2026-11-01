import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {EventEmitter} from 'node:events'
import {createServer, type Server} from 'node:net'
import {Application} from 'lakutata'
import type {CapacitorBridge, CapacitorServiceMessage} from 'lakutata/adapter/capacitor'
import {config} from '../config/Config.js'

/**
 * The bridge of @capawesome/capacitor-nodejs in the tests: the messages of the page are emitted on its channel, the
 * ones posted to the page kept (in JSON, as the plugin sends them), without the mobile application
 */
const posted: CapacitorServiceMessage[] = []
const channel: EventEmitter = new EventEmitter()
const bridge: CapacitorBridge = {
    channel: Object.assign(channel, {
        post: (_event: string, ...args: unknown[]): unknown => posted.push(...JSON.parse(JSON.stringify(args)))
    }),
    app: new EventEmitter()
}

let next: number = 0

/**
 * Invoke an action as the user interface does (window.ipc.invoke)
 * @param data
 */
async function invoke(data: Record<string, unknown>): Promise<any> {
    const id: number = ++next
    channel.emit('lakutata:service', {type: 'invoke', id: id, clientId: 'page', data: data})
    for (let attempt: number = 0; attempt < 500; attempt++) {
        const response = posted.find((message: CapacitorServiceMessage): boolean => message.type === 'response' && message.id === id)
        if (response) return response.response
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
    }
    throw new Error(`No response to ${JSON.stringify(data)}`)
}

/**
 * A free port, the one of the HTTP entrypoint of the development
 */
async function freePort(): Promise<number> {
    const server: Server = createServer()
    await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
    const port: number = (server.address() as { port: number }).port
    await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
    return port
}

describe('{$APP_NAME}', (): void => {

    let app: Application
    let devPort: number

    before(async (): Promise<void> => {
        //@if i18n
        //The actions answer in the language of the environment: English for the tests
        process.env.LANG = 'en_US.UTF-8'
        //@end
        devPort = await freePort()
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config({bridge: bridge, devPort: devPort})).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('serves the actions to the user interface', async (): Promise<void> => {
        assert.deepStrictEqual(await invoke({cmd: 'greet', name: 'you'}), {success: true, error: null, payload: {message: 'Hello, you!'}})
    })

    //@if i18n
    it('serves the actions in the languages of the device the user interface gives', async (): Promise<void> => {
        await invoke({cmd: 'languages', languages: ['zh-CN', 'en']})
        try {
            assert.deepStrictEqual(await invoke({cmd: 'greet', name: 'you'}), {success: true, error: null, payload: {message: '你好，you！'}})
        } finally {
            await invoke({cmd: 'languages', languages: ['en-US']})
        }
    })

    //@end
    it('pushes its events to the user interface', async (): Promise<void> => {
        //The page subscribed to the events, the subscription answered
        channel.emit('lakutata:service', {type: 'subscribe', clientId: 'page'})
        assert.deepStrictEqual(posted.filter((message: CapacitorServiceMessage): boolean => message.type === 'subscribed'), [{type: 'subscribed', clientId: 'page'}])
        await invoke({cmd: 'greet', name: 'you'})
        assert.deepStrictEqual(posted.filter((message: CapacitorServiceMessage): boolean => message.type === 'event'), [{type: 'event', clientId: 'page', event: 'greeted', args: ['you']}])
    })

    it('serves the actions and their events to the tools of the development over HTTP', async (): Promise<void> => {
        //The events of the client (Server-Sent Events): its id first
        const events: Response = await fetch(`http://127.0.0.1:${devPort}/events?id=tool`)
        const reader = events.body!.getReader()
        let received: string = ''
        const until = async (pattern: RegExp): Promise<void> => {
            while (!pattern.test(received)) received += new TextDecoder().decode((await reader.read()).value)
        }
        await until(/event: client/)
        const response: Response = await fetch(`http://127.0.0.1:${devPort}/`, {method: 'POST', headers: {'Content-Type': 'application/json', 'id': 'tool'}, body: JSON.stringify({cmd: 'greet', name: 'you'})})
        assert.deepStrictEqual(await response.json(), {success: true, error: null, payload: {message: 'Hello, you!'}})
        await until(/event: greeted\ndata: \["you"\]/)
        await reader.cancel()
    })

    it('refuses an invalid input', async (): Promise<void> => {
        const response = await invoke({cmd: 'greet'})
        assert.strictEqual(response.success, false)
        assert.match(response.error.message, /name/)
    })

    it('refuses an unknown action', async (): Promise<void> => {
        assert.strictEqual((await invoke({cmd: 'unknown'})).success, false)
    })
})
