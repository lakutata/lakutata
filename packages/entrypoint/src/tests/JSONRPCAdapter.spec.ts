import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {PassThrough} from 'node:stream'
import {durationOf, takeOverUpgrades, upgrade} from './support/Upgrade.js'
import {keepAliveAgent, postThrough} from './support/KeepAlive.js'
import type {Agent} from 'node:http'
import {Container, DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint, httpRequestOfContext, ServiceContext} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'
import {JSONRPCErrorCode, jsonRPCRequestOfContext, jsonRPCServiceEntrypoint, type JSONRPCServiceEntrypointOptions} from '../exports/JSONRPCAdapter.js'

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

class OrderException extends Exception {
    public errno: string | number = 'E_ORDER'
}

class RPCController extends Controller {

    @ServiceAction({method: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<unknown> {
        const request = jsonRPCRequestOfContext(this.context as ServiceContext)
        return {value: input.value, method: request?.method, transport: request?.transport, http: httpRequestOfContext(this.context as ServiceContext)?.method}
    }

    @ServiceAction({method: 'whoami'})
    public async whoami(): Promise<string | undefined> {
        return (this.context as ServiceContext).clientId
    }

    @ServiceAction({method: 'nothing'})
    public async nothing(): Promise<void> {
        return
    }

    @ServiceAction({method: 'fail'})
    public async fail(): Promise<void> {
        throw new OrderException('The order is closed')
    }

    @ServiceAction({method: 'sum'})
    public async sum(input: { args: number[] }): Promise<number> {
        return input.args.reduce((total: number, value: number): number => total + value, 0)
    }

    @ServiceAction({service: 'user', cmd: 'get'})
    public async userGet(input: { id: number }): Promise<string> {
        return `user ${input.id}`
    }
}

/**
 * Start an entrypoint with a JSON-RPC adapter
 * @param options
 */
async function start(options: JSONRPCServiceEntrypointOptions): Promise<{ port: number, container: Container, entrypoint: Entrypoint }> {
    let port: number = 0
    const container: Container = new Container()
    const entrypoint: Entrypoint = await container.set(Entrypoint, buildEntrypoints({
        controllers: [RPCController],
        service: jsonRPCServiceEntrypoint({
            port: 0,
            host: '127.0.0.1',
            ...options,
            listening: async (server): Promise<void> => {
                port = (server.address() as AddressInfo).port
                await options.listening?.(server)
            }
        })
    }))
    return {port: port, container: container, entrypoint: entrypoint}
}

/**
 * Post a message
 * @param port
 * @param body
 * @param headers
 */
async function post(port: number, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number, body: any }> {
    const response: Response = await fetch(`http://127.0.0.1:${port}/rpc`, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)})
    const text: string = await response.text()
    return {status: response.status, body: text ? JSON.parse(text) : undefined}
}

describe('The JSON-RPC 2.0 service adapter', (): void => {

    //A body still arriving when its limit is passed: its rest is read and dropped
    it('keeps the connection of a body of HTTP larger than its limit usable', async (): Promise<void> => {
        const {port, container} = await start({path: '/rpc', limit: 64})
        const agent: Agent = keepAliveAgent()
        try {
            const large = await postThrough(`http://127.0.0.1:${port}/rpc`, JSON.stringify({jsonrpc: '2.0', method: 'echo', params: {value: 1, padding: 'x'.repeat(1024 * 1024)}, id: 1}), agent)
            //The next request of the client goes through the same connection
            const next = await postThrough(`http://127.0.0.1:${port}/rpc`, JSON.stringify({jsonrpc: '2.0', method: 'echo', params: {value: 2}, id: 2}), agent)
            assert.strictEqual(large.status, 413)
            assert.strictEqual(JSON.parse(next.body).result.value, 2)
        } finally {
            agent.destroy()
            await container.destroy()
        }
    })

    it('dispatches the requests of HTTP to the service actions', async (): Promise<void> => {
        const {port, container} = await start({path: '/rpc'})
        try {
            assert.deepStrictEqual((await post(port, {jsonrpc: '2.0', method: 'echo', params: {value: 3}, id: 1})).body, {jsonrpc: '2.0', id: 1, result: {value: 3, method: 'echo', transport: 'http', http: 'POST'}})
            assert.deepStrictEqual((await post(port, {jsonrpc: '2.0', method: 'whoami', id: 'a'}, {id: 'client-1'})).body, {jsonrpc: '2.0', id: 'a', result: 'client-1'})
            assert.deepStrictEqual((await post(port, {jsonrpc: '2.0', method: 'nothing', id: 2})).body, {jsonrpc: '2.0', id: 2, result: null})
            //A notification: no response
            assert.deepStrictEqual(await post(port, {jsonrpc: '2.0', method: 'echo', params: {value: 1}}), {status: 204, body: undefined})
        } finally {
            await container.destroy()
        }
    })

    it('answers the errors as JSON-RPC defines them', async (): Promise<void> => {
        const {port, container} = await start({path: '/rpc'})
        try {
            const error = async (body: unknown): Promise<any> => (await post(port, body)).body.error
            assert.strictEqual((await error('{not json')).code, JSONRPCErrorCode.PARSE_ERROR)
            assert.strictEqual((await error({method: 'echo', id: 1})).code, JSONRPCErrorCode.INVALID_REQUEST)
            assert.strictEqual((await error({jsonrpc: '2.0', method: 'echo', params: 'x', id: 1})).code, JSONRPCErrorCode.INVALID_REQUEST)
            assert.strictEqual((await error([])).code, JSONRPCErrorCode.INVALID_REQUEST)
            assert.strictEqual((await error({jsonrpc: '2.0', method: 'missing', id: 1})).code, JSONRPCErrorCode.METHOD_NOT_FOUND)
            assert.strictEqual((await error({jsonrpc: '2.0', method: 'echo', params: {value: 'x'}, id: 1})).code, JSONRPCErrorCode.INVALID_PARAMS)
            assert.strictEqual((await error({jsonrpc: '2.0', method: 'echo', params: [1], id: 1})).code, JSONRPCErrorCode.INVALID_PARAMS)
            //The error of an action: its message, the whole error as its data
            const failed = await error({jsonrpc: '2.0', method: 'fail', id: 1})
            assert.strictEqual(failed.code, JSONRPCErrorCode.SERVER_ERROR)
            assert.strictEqual(failed.message, 'The order is closed')
            assert.strictEqual(failed.data.errno, 'E_ORDER')
        } finally {
            await container.destroy()
        }
    })

    it('answers the batches, without their notifications', async (): Promise<void> => {
        const {port, container} = await start({path: '/rpc'})
        try {
            const {body} = await post(port, [
                {jsonrpc: '2.0', method: 'echo', params: {value: 1}, id: 1},
                {jsonrpc: '2.0', method: 'echo', params: {value: 2}},
                {jsonrpc: '2.0', method: 'missing', id: 2},
                {foo: 'bar'},
                {jsonrpc: '2.0', method: 'whoami', id: 3}
            ])
            assert.deepStrictEqual(body.map((response: any): unknown => [response.id, 'error' in response ? response.error.code : response.result?.value ?? response.result]), [[1, 1], [2, JSONRPCErrorCode.METHOD_NOT_FOUND], [null, JSONRPCErrorCode.INVALID_REQUEST], [3, null]])
            //A batch of notifications: no response
            assert.strictEqual((await post(port, [{jsonrpc: '2.0', method: 'echo', params: {value: 1}}])).status, 204)
        } finally {
            await container.destroy()
        }
    })

    it('maps the methods to the patterns as the options say', async (): Promise<void> => {
        const positional = await start({path: '/rpc', positionalParams: 'args'})
        try {
            assert.strictEqual((await post(positional.port, {jsonrpc: '2.0', method: 'sum', params: [1, 2, 3], id: 1})).body.result, 6)
        } finally {
            await positional.container.destroy()
        }
        const mapped = await start({
            path: '/rpc',
            toPattern: (method: string, params): Record<string, unknown> => {
                const [service, cmd] = method.split('.')
                return {...params as Record<string, unknown>, service: service, cmd: cmd}
            }
        })
        try {
            assert.strictEqual((await post(mapped.port, {jsonrpc: '2.0', method: 'user.get', params: {id: 7}, id: 1})).body.result, 'user 7')
        } finally {
            await mapped.container.destroy()
        }
    })

    it('dispatches the messages of WebSocket, pushes the events as notifications', async (): Promise<void> => {
        const {port, container, entrypoint} = await start({transport: 'websocket', path: '/ws'})
        const {WebSocket} = await import('ws')
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {headers: {id: 'socket-1'}})
        const messages: any[] = []
        socket.on('message', (data: Buffer): unknown => messages.push(JSON.parse(data.toString())))
        const until = async (count: number): Promise<void> => {
            for (let attempt = 0; attempt < 100 && messages.length < count; attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
            assert.ok(messages.length >= count, JSON.stringify(messages))
        }
        try {
            await new Promise((resolve, reject): unknown => socket.once('open', resolve).once('error', reject))
            socket.send(JSON.stringify({jsonrpc: '2.0', method: 'echo', params: {value: 5}, id: 1}))
            await until(1)
            //The request of its connection (the upgrade of HTTP) given to the actions
            assert.deepStrictEqual(messages[0], {jsonrpc: '2.0', id: 1, result: {value: 5, method: 'echo', transport: 'websocket', http: 'GET'}})
            socket.send(JSON.stringify([{jsonrpc: '2.0', method: 'whoami', id: 2}, {jsonrpc: '2.0', method: 'nothing'}]))
            await until(2)
            assert.deepStrictEqual(messages[1], [{jsonrpc: '2.0', id: 2, result: 'socket-1'}])
            assert.strictEqual(entrypoint.notify('socket-1', 'orderChanged', {id: 1}, 'paid'), true)
            assert.strictEqual(entrypoint.notify('nobody', 'orderChanged'), false)
            entrypoint.broadcast('tick', 1)
            await until(4)
            assert.deepStrictEqual(messages.slice(2), [{jsonrpc: '2.0', method: 'orderChanged', params: [{id: 1}, 'paid']}, {jsonrpc: '2.0', method: 'tick', params: [1]}])
        } finally {
            socket.close()
            await container.destroy()
        }
    })

    it('closes the WebSocket connections which do not answer the pings', async (): Promise<void> => {
        const {port, container, entrypoint} = await start({transport: 'websocket', heartbeat: 100})
        const {WebSocket} = await import('ws')
        const answering = new WebSocket(`ws://127.0.0.1:${port}/`, {headers: {id: 'answering'}})
        const silent = new WebSocket(`ws://127.0.0.1:${port}/`, {headers: {id: 'silent'}})
        try {
            await Promise.all([answering, silent].map((socket): Promise<unknown> => new Promise((resolve, reject): unknown => socket.once('open', resolve).once('error', reject))))
            //Its pings not read: not answered
            ;(silent as unknown as { _socket: { pause(): void } })._socket.pause()
            for (let attempt = 0; attempt < 50 && entrypoint.notify('silent', 'tick'); attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
            assert.strictEqual(entrypoint.notify('silent', 'tick'), false)
            assert.strictEqual(entrypoint.notify('answering', 'tick'), true)
        } finally {
            answering.terminate()
            silent.terminate()
            await container.destroy()
        }
    })

    it('stops with the WebSockets not answering their close and the connections taken over by an upgrade', {timeout: 15000}, async (): Promise<void> => {
        //A WebSocket of the transport not reading the close of the server
        const {WebSocket} = await import('ws')
        const ws = await start({transport: 'websocket'})
        const silent = new WebSocket(`ws://127.0.0.1:${ws.port}/`, {headers: {id: 'silent'}})
        await new Promise((resolve, reject): unknown => silent.once('open', resolve).once('error', reject))
        ;(silent as unknown as { _socket: { pause(): void } })._socket.pause()
        assert.ok(await durationOf((): Promise<void> => ws.container.destroy()) < 3000)
        silent.terminate()
        //A connection of the HTTP transport taken over by an upgrade of the application
        const http = await start({transport: 'http', listening: (server): void => takeOverUpgrades(server)})
        const {socket, status} = await upgrade(`http://127.0.0.1:${http.port}`)
        assert.strictEqual(status, 'HTTP/1.1 101 Switching Protocols')
        assert.ok(await durationOf((): Promise<void> => http.container.destroy()) < 3000)
        socket.destroy()
    })

    it('ends once the input of stdio ends, its requests in progress answered', async (): Promise<void> => {
        const input: PassThrough = new PassThrough()
        const output: PassThrough = new PassThrough()
        let written: string = ''
        output.on('data', (chunk: Buffer): unknown => written += chunk.toString())
        let ended: boolean = false
        const {container} = await start({transport: 'stdio', input: input, output: output, end: (): void => void (ended = true)})
        try {
            input.end(`${JSON.stringify({jsonrpc: '2.0', method: 'echo', params: {value: 4}, id: 1})}\n`)
            for (let attempt = 0; attempt < 50 && !ended; attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
            assert.ok(ended)
            assert.deepStrictEqual(JSON.parse(written).result.value, 4)
        } finally {
            await container.destroy()
        }
    })

    it('dispatches the messages of stdio, framed by lines or by their Content-Length headers', async (): Promise<void> => {
        for (const framing of ['newline', 'content-length'] as const) {
            const input: PassThrough = new PassThrough()
            const output: PassThrough = new PassThrough()
            let written: string = ''
            output.on('data', (chunk: Buffer): unknown => written += chunk.toString())
            const {container, entrypoint} = await start({transport: 'stdio', framing: framing, input: input, output: output})
            try {
                const frame = (message: unknown): string => {
                    const text: string = JSON.stringify(message)
                    return framing === 'newline' ? `${text}\n` : `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`
                }
                //A message split over two chunks
                const message: string = frame({jsonrpc: '2.0', method: 'echo', params: {value: 9}, id: 1})
                input.write(message.slice(0, 10))
                input.write(message.slice(10))
                input.write(frame({jsonrpc: '2.0', method: 'whoami', id: 2}))
                for (let attempt = 0; attempt < 100 && (written.match(/"id":/g) ?? []).length < 2; attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
                entrypoint.notify('stdio', 'progress', 50)
                await new Promise((resolve): unknown => setTimeout(resolve, 50))
                const messages: any[] = framing === 'newline'
                    ? written.trim().split('\n').map((line: string): unknown => JSON.parse(line))
                    : written.split(/Content-Length: \d+\r\n\r\n/).filter(Boolean).map((part: string): unknown => JSON.parse(part))
                assert.deepStrictEqual(messages.find((item: any): boolean => item.id === 1).result, {value: 9, method: 'echo', transport: 'stdio'})
                assert.strictEqual(messages.find((item: any): boolean => item.id === 2).result, 'stdio')
                assert.deepStrictEqual(messages.at(-1), {jsonrpc: '2.0', method: 'progress', params: [50]})
            } finally {
                await container.destroy()
            }
        }
    })

    it('skips the messages of stdio larger than its limit, keeping the framing', async (): Promise<void> => {
        for (const framing of ['newline', 'content-length'] as const) {
            const input: PassThrough = new PassThrough()
            const output: PassThrough = new PassThrough()
            let written: string = ''
            output.on('data', (chunk: Buffer): unknown => written += chunk.toString())
            const {container} = await start({transport: 'stdio', framing: framing, input: input, output: output, limit: 100})
            try {
                const frame = (message: unknown): string => {
                    const text: string = JSON.stringify(message)
                    return framing === 'newline' ? `${text}\n` : `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`
                }
                //An oversized message in several chunks, then a message
                const large: string = frame({jsonrpc: '2.0', method: 'echo', params: {value: 1, padding: 'x'.repeat(300)}, id: 1})
                for (let index = 0; index < large.length; index += 64) input.write(large.slice(index, index + 64))
                input.write(frame({jsonrpc: '2.0', method: 'whoami', id: 2}))
                for (let attempt = 0; attempt < 100 && !written.includes('"id":2'); attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
                const messages: any[] = framing === 'newline'
                    ? written.trim().split('\n').map((line: string): unknown => JSON.parse(line))
                    : written.split(/Content-Length: \d+\r\n\r\n/).filter(Boolean).map((part: string): unknown => JSON.parse(part))
                assert.deepStrictEqual(messages, [
                    {jsonrpc: '2.0', id: null, error: {code: -32600, message: 'The message is larger than 100 bytes'}},
                    {jsonrpc: '2.0', id: 2, result: 'stdio'}
                ], framing)
            } finally {
                await container.destroy()
            }
        }
    })
})
