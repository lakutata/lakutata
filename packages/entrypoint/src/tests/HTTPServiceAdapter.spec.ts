import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {durationOf, takeOverUpgrades, upgrade} from './support/Upgrade.js'
import {keepAliveAgent, postThrough} from './support/KeepAlive.js'
import type {Agent} from 'node:http'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint, httpRequestOfContext, httpServiceEntrypoint, type HTTPServiceEntrypointOptions, Result, ServiceContext, type FileResult, type StatusResult} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'

const abortedActions: string[] = []

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

class EchoController extends Controller {

    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<unknown> {
        return {value: input.value, method: httpRequestOfContext(this.context as ServiceContext)?.method}
    }

    @ServiceAction({cmd: 'whoami'})
    public async whoami(): Promise<string | undefined> {
        return (this.context as ServiceContext).clientId
    }

    @ServiceAction({cmd: 'created'})
    public async created(): Promise<StatusResult> {
        return Result.status(201, {id: 7}, {Location: '/orders/7'})
    }

    @ServiceAction({cmd: 'file'})
    public async file(): Promise<FileResult> {
        return Result.file(Buffer.from('a,b'))
    }

    @ServiceAction({cmd: 'wait'})
    public async wait(): Promise<string> {
        //Its signal aborted once its client is gone
        await new Promise<void>((resolve: () => void): void => this.signal?.addEventListener('abort', (): void => {
            abortedActions.push('wait')
            resolve()
        }))
        return 'aborted'
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }
}

/**
 * Start an entrypoint with an HTTP service adapter on a random port
 * @param options
 */
async function start(options: HTTPServiceEntrypointOptions = {}): Promise<{ url: string, container: Container, entrypoint: Entrypoint }> {
    let port: number = 0
    const container: Container = new Container()
    const entrypoint: Entrypoint = await container.set(Entrypoint, buildEntrypoints({
        controllers: [EchoController],
        service: httpServiceEntrypoint({
            port: 0,
            host: '127.0.0.1',
            ...options,
            listening: async (server): Promise<void> => {
                port = (server.address() as AddressInfo).port
                await options.listening?.(server)
            }
        })
    }))
    return {url: `http://127.0.0.1:${port}`, container: container, entrypoint: entrypoint}
}

/**
 * Invoke an action
 * @param url
 * @param data
 * @param clientId
 */
async function invoke(url: string, data: unknown, clientId?: string): Promise<any> {
    const response: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...clientId ? {id: clientId} : {}}, body: typeof data === 'string' ? data : JSON.stringify(data)})
    return {status: response.status, ...await response.json() as Record<string, unknown>}
}

/**
 * The events of a stream (Server-Sent Events), as they are received
 * @param url
 */
async function streamEvents(url: string): Promise<{ next: () => Promise<{ event: string, data: unknown }>, close: () => void }> {
    const aborted: AbortController = new AbortController()
    const response: Response = await fetch(url, {signal: aborted.signal})
    assert.match(response.headers.get('content-type')!, /^text\/event-stream/)
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer: string = ''
    return {
        next: async (): Promise<{ event: string, data: unknown }> => {
            for (; ;) {
                const end: number = buffer.indexOf('\n\n')
                if (end >= 0) {
                    const block: string = buffer.slice(0, end)
                    buffer = buffer.slice(end + 2)
                    if (block.startsWith(':')) continue
                    const event: string = /^event: (.*)$/m.exec(block)![1]
                    return {event: event, data: JSON.parse(/^data: (.*)$/m.exec(block)![1])}
                }
                const {value, done} = await reader.read()
                if (done) throw new Error('The stream ended')
                buffer += decoder.decode(value, {stream: true})
            }
        },
        close: (): void => aborted.abort()
    }
}

describe('HTTP service adapter', (): void => {

    it('answers the requests with the responses of the actions, their client given by their header id', async (): Promise<void> => {
        const {url, container} = await start()
        assert.deepStrictEqual(await invoke(url, {cmd: 'echo', value: 3}), {status: 200, success: true, error: null, payload: {value: 3, method: 'POST'}})
        assert.deepStrictEqual(await invoke(url, {cmd: 'whoami'}, 'postman'), {status: 200, success: true, error: null, payload: 'postman'})
        const invalid = await invoke(url, {cmd: 'echo', value: 'x'})
        assert.deepStrictEqual([invalid.error.errno, invalid.error.statusCode], ['E_INVALID_VALUE', 400])
        assert.strictEqual((await invoke(url, {cmd: 'unknown'})).success, false)
        //Not JSON
        const malformed = await invoke(url, '{cmd')
        assert.deepStrictEqual([malformed.status, malformed.success, malformed.error.message], [400, false, 'The body of the request is not JSON'])
        //The other paths
        const other: Response = await fetch(`${url}/other`)
        assert.strictEqual(other.status, 404)
        assert.match((await other.json() as { error: { message: string } }).error.message, /POST \/ invokes the actions, GET \/events streams their events/)
        //The preflights of the browsers: the headers they ask for are allowed (an Authorization header…)
        assert.strictEqual((await fetch(url, {method: 'OPTIONS'})).headers.get('access-control-allow-headers'), 'Content-Type, id')
        const preflight: Response = await fetch(url, {method: 'OPTIONS', headers: {'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'}})
        assert.deepStrictEqual([preflight.headers.get('access-control-allow-headers'), preflight.headers.get('vary')], ['authorization,content-type', 'Access-Control-Request-Headers'])
        await container.destroy()
    })

    it('refuses the bodies larger than its limit, serves the requests under its path', async (): Promise<void> => {
        const {url, container} = await start({path: '/api/', limit: 64})
        assert.strictEqual((await invoke(`${url}/api`, {cmd: 'echo', value: 1})).payload.value, 1)
        const large = await invoke(`${url}/api`, {cmd: 'echo', value: 1, padding: 'x'.repeat(100)})
        assert.deepStrictEqual([large.status, large.error.message], [413, 'The body of the request is larger than 64 bytes'])
        await container.destroy()
    })

    //A body still arriving when its limit is passed: its rest is read and dropped
    it('keeps the connection of a body larger than its limit usable', async (): Promise<void> => {
        const {url, container} = await start({limit: 64})
        const agent: Agent = keepAliveAgent()
        try {
            const large = await postThrough(url, JSON.stringify({cmd: 'echo', value: 1, padding: 'x'.repeat(1024 * 1024)}), agent)
            //The next request of the client goes through the same connection
            const next = await postThrough(url, JSON.stringify({cmd: 'echo', value: 2}), agent)
            assert.strictEqual(large.status, 413)
            assert.strictEqual(JSON.parse(next.body).payload.value, 2)
        } finally {
            agent.destroy()
            await container.destroy()
        }
    })

    it('streams the events pushed to the clients (Server-Sent Events), to every client', async (): Promise<void> => {
        const {url, container, entrypoint} = await start()
        const tool = await streamEvents(`${url}/events?id=postman`)
        //Its id given first, an id given by the adapter without it
        assert.deepStrictEqual(await tool.next(), {event: 'client', data: ['postman']})
        const anonymous = await streamEvents(`${url}/events`)
        const {data: [id]} = await anonymous.next() as { data: string[] }
        assert.match(id, /^[0-9a-f-]{36}$/)
        assert.strictEqual(entrypoint.notify('postman', 'progress', 1, {step: 'a'}), true)
        assert.deepStrictEqual(await tool.next(), {event: 'progress', data: [1, {step: 'a'}]})
        assert.strictEqual(entrypoint.notify('nobody', 'progress'), false)
        assert.strictEqual(entrypoint.broadcast('all', 2), 2)
        assert.deepStrictEqual([await tool.next(), await anonymous.next()], [{event: 'all', data: [2]}, {event: 'all', data: [2]}])
        //A client whose stream is closed has none
        tool.close()
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
        assert.strictEqual(entrypoint.notify('postman', 'progress'), false)
        anonymous.close()
        await container.destroy()
    })

    it('sends the data of the status results, refuses the files', async (): Promise<void> => {
        const {url, container} = await start()
        try {
            assert.deepStrictEqual(await invoke(url, {cmd: 'created'}), {status: 200, success: true, error: null, payload: {id: 7}})
            const file = await invoke(url, {cmd: 'file'})
            assert.strictEqual(file.success, false)
            assert.match(file.error.message, /cannot send a FileResult/)
        } finally {
            await container.destroy()
        }
    })

    it('aborts the signal of the controllers once their clients are gone', async (): Promise<void> => {
        const {url, container} = await start()
        try {
            const abort: AbortController = new AbortController()
            const request: Promise<unknown> = fetch(url, {method: 'POST', body: JSON.stringify({cmd: 'wait'}), signal: abort.signal}).catch((): undefined => undefined)
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
            abort.abort()
            await request
            for (let attempt = 0; attempt < 50 && !abortedActions.length; attempt++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
            assert.deepStrictEqual(abortedActions, ['wait'])
        } finally {
            await container.destroy()
        }
    })

    it('stops gracefully, its streams closed', async (): Promise<void> => {
        const {url, container} = await start()
        const stream = await streamEvents(`${url}/events?id=desk`)
        await stream.next()
        const inProgress: Promise<any> = invoke(url, {cmd: 'slow'})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        const destroyed: Promise<void> = container.destroy()
        assert.strictEqual((await invoke(url, {cmd: 'echo', value: 1})).error.errno, 'E_ENTRYPOINT_STOPPED')
        assert.deepStrictEqual(await inProgress, {status: 200, success: true, error: null, payload: 'slow'})
        await destroyed
        await assert.rejects(stream.next(), /The stream ended|terminated|aborted/)
    })

    it('stops with the connections taken over by an upgrade (a WebSocket of the application)', {timeout: 10000}, async (): Promise<void> => {
        const {url, container} = await start({listening: (server): void => takeOverUpgrades(server)})
        const {socket, status} = await upgrade(url)
        assert.strictEqual(status, 'HTTP/1.1 101 Switching Protocols')
        assert.ok(await durationOf((): Promise<void> => container.destroy()) < 3000)
        await new Promise((resolve: (value: unknown) => void): unknown => socket.destroyed ? resolve(true) : socket.once('close', resolve))
    })
})
