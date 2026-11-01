import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {connect, createServer, type Server, type Socket} from 'node:net'
import {Application} from 'lakutata'
import type {ReactNativeServiceMessage} from 'lakutata/adapter/react-native'
import {config} from '../config/Config.js'

/**
 * The native module of the mobile application in the tests: its end of the socket to the application, the messages
 * it received (a line of JSON each)
 */
const received: ReactNativeServiceMessage[] = []
let host: Socket

let next: number = 0

/**
 * Write a message as the native module does, a line of JSON
 * @param message
 */
function send(message: Record<string, unknown>): void {
    host.write(`${JSON.stringify(message)}\n`)
}

/**
 * Invoke an action as the user interface does (ipc.invoke)
 * @param data
 */
async function invoke(data: Record<string, unknown>): Promise<any> {
    const id: number = ++next
    send({type: 'invoke', id: id, clientId: 'ui', data: data})
    for (let attempt: number = 0; attempt < 500; attempt++) {
        const response = received.find((message: ReactNativeServiceMessage): boolean => message.type === 'response' && message.id === id)
        if (response) return response.response
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
    }
    throw new Error(`No response to ${JSON.stringify(data)}`)
}

/**
 * Two sockets connected to each other: the end of the native module, the end of the application
 */
async function connectedPair(): Promise<[Socket, Socket]> {
    const server: Server = createServer()
    await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
    const accepted: Promise<Socket> = new Promise((resolve: (socket: Socket) => void): unknown => server.once('connection', resolve))
    const native: Socket = connect((server.address() as { port: number }).port, '127.0.0.1')
    const application: Socket = await accepted
    server.close()
    return [native, application]
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
    let socket: Socket

    before(async (): Promise<void> => {
        //@if i18n
        //The actions answer in the language of the environment: English for the tests
        process.env.LANG = 'en_US.UTF-8'
        //@end
        devPort = await freePort()
        ;[host, socket] = await connectedPair()
        let buffer: string = ''
        host.setEncoding('utf8')
        host.on('data', (chunk: string): void => {
            buffer += chunk
            for (let end: number = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
                received.push(JSON.parse(buffer.slice(0, end)) as ReactNativeServiceMessage)
                buffer = buffer.slice(end + 1)
            }
        })
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config({host: socket, devPort: devPort})).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        host?.destroy()
        socket?.destroy()
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
        //The user interface subscribed to the events, the subscription answered
        send({type: 'subscribe', clientId: 'ui'})
        await invoke({cmd: 'greet', name: 'you'})
        assert.deepStrictEqual(received.filter((message: ReactNativeServiceMessage): boolean => message.type === 'subscribed'), [{type: 'subscribed', clientId: 'ui'}])
        assert.deepStrictEqual(received.filter((message: ReactNativeServiceMessage): boolean => message.type === 'event'), [{type: 'event', clientId: 'ui', event: 'greeted', args: ['you']}])
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
