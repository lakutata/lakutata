import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {createServer, type Server} from 'node:net'
import {Application} from 'lakutata'
import {NWJS_SERVICE_BRIDGE, type NwjsServiceBridge} from 'lakutata/adapter/nwjs'
import {config} from '../config/Config.js'

/**
 * The global object of the tests: the actions are invoked through the bridge put on it, as the host page of the window
 * invokes them, without NW.js
 */
const shared: Record<symbol, unknown> = {}

/**
 * The bridge of the actions
 */
function bridge(): NwjsServiceBridge {
    return shared[Symbol.for(NWJS_SERVICE_BRIDGE)] as NwjsServiceBridge
}

/**
 * Invoke an action as the user interface does (window.ipc.invoke)
 * @param data
 */
function invoke(data: Record<string, unknown>): Promise<any> {
    return bridge().invoke(data, 'page')
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
        process.env.LC_ALL = 'en_US.UTF-8'
        //@end
        devPort = await freePort()
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config({window: false, global: shared, devPort: devPort})).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('serves the actions to the user interface', async (): Promise<void> => {
        assert.deepStrictEqual(await invoke({cmd: 'greet', name: 'you'}), {success: true, error: null, payload: {message: 'Hello, you!'}})
    })

    //@if i18n
    it('serves the actions in the language of the environment', async (): Promise<void> => {
        process.env.LC_ALL = 'zh_CN.UTF-8'
        try {
            assert.deepStrictEqual(await invoke({cmd: 'greet', name: 'you'}), {success: true, error: null, payload: {message: '你好，you！'}})
        } finally {
            process.env.LC_ALL = 'en_US.UTF-8'
        }
    })

    //@end
    it('pushes its events to the user interface', async (): Promise<void> => {
        //The page subscribed to the events
        const received: unknown[][] = []
        bridge().subscribe('page', (event: string, args: unknown[]): unknown => received.push([event, args]))
        await invoke({cmd: 'greet', name: 'you'})
        assert.deepStrictEqual(received, [['greeted', ['you']]])
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
