import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {request as httpRequest} from 'node:http'
import type {IncomingMessage, Server} from 'node:http'
import {Container} from '@lakutata/core'
import {BuildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import type {ActionInvocation, MiddlewareHandler, Next} from '@lakutata/entrypoint'
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {HTTPMCPEntrypoint, HTTPMCPEntrypointOptions, MCPContext} from '../exports/MCP.js'
import {calls, DeviceController, ToolController} from './support/Tools.js'

/**
 * Start an entrypoint with an HTTP MCP adapter on a random port
 * @param options
 * @param entrypointOptions
 */
async function Start(options: HTTPMCPEntrypointOptions = {}, entrypointOptions: Record<string, unknown> = {}): Promise<{ url: string, container: Container }> {
    let server: Server | undefined
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({
        controllers: [DeviceController, ToolController],
        ...entrypointOptions,
        mcp: HTTPMCPEntrypoint({
            port: 0,
            serverName: 'devices',
            serverVersion: '2.0.0',
            ...options,
            listening: (listening: Server): void => {
                server = listening
            }
        })
    }))
    return {url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`, container: container}
}

/**
 * A client connected to the server
 * @param url
 * @param headers
 */
async function Connect(url: string, headers: Record<string, string> = {}): Promise<Client> {
    const client: Client = new Client({name: 'test', version: '1.0.0'})
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {requestInit: {headers: headers}}))
    return client
}

/**
 * The status of a POST sent with the given headers (fetch does not send its own Host header)
 * @param url
 * @param headers
 */
function PostStatus(url: string, headers: Record<string, string>): Promise<number> {
    return new Promise((resolve: (status: number) => void, reject: (error: Error) => void): void => {
        httpRequest(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}}, (response: IncomingMessage): void => {
            response.resume()
            resolve(response.statusCode!)
        }).once('error', reject).end('{}')
    })
}

describe('HTTP MCP adapter', (): void => {

    it('lists the actions as tools', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: Client = await Connect(url)
        const tools = (await client.listTools()).tools
        assert.deepStrictEqual(tools.map((tool): string => tool.name).sort(), ['count', 'device_reboot', 'device_status', 'echo', 'picture', 'raw', 'slow'])
        const status = tools.find((tool): boolean => tool.name === 'device_status')!
        assert.strictEqual(status.title, 'Device status')
        assert.strictEqual(status.description, 'The status of a device')
        assert.deepStrictEqual(status.annotations, {readOnlyHint: true, idempotentHint: true})
        assert.deepStrictEqual((status.inputSchema as any).required, ['sn'])
        assert.strictEqual((status.inputSchema as any).properties.sn.description, 'The serial number')
        assert.deepStrictEqual(Object.keys((status.outputSchema as any).properties).sort(), ['online', 'sn'])
        assert.deepStrictEqual(tools.find((tool): boolean => tool.name === 'device_reboot')!.annotations, {destructiveHint: true})
        await client.close()
        await container.destroy()
    })

    it('calls the tools', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: Client = await Connect(url)
        const status = await client.callTool({name: 'device_status', arguments: {sn: 'A1'}})
        assert.deepStrictEqual(status.structuredContent, {sn: 'A1', online: true})
        assert.deepStrictEqual(JSON.parse((status.content as any)[0].text), {sn: 'A1', online: true})
        assert.deepStrictEqual((await client.callTool({name: 'device_reboot', arguments: {sn: 'A1'}})).content, [{type: 'text', text: 'Rebooting A1'}])
        assert.deepStrictEqual((await client.callTool({name: 'picture', arguments: {}})).content, [{type: 'image', data: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png'}])
        assert.deepStrictEqual((await client.callTool({name: 'raw', arguments: {}})).content, [{type: 'text', text: 'first'}, {type: 'text', text: 'second'}])
        assert.deepStrictEqual((await client.callTool({name: 'echo', arguments: {a: [1, 2]}})).structuredContent, {a: [1, 2]})
        await client.close()
        await container.destroy()
    })

    it('reads the resources', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: Client = await Connect(url)
        assert.deepStrictEqual((await client.listResources()).resources, [{uri: 'device://catalog', name: 'catalog', title: 'The device catalog'}])
        const templates = (await client.listResourceTemplates()).resourceTemplates
        assert.deepStrictEqual(templates, [{uriTemplate: 'device://{sn}/status', name: 'DeviceController:statusResource', description: 'The status of a device', mimeType: 'application/json', annotations: {audience: ['assistant']}}])
        calls.length = 0
        const status = await client.readResource({uri: 'device://A1/status'})
        assert.deepStrictEqual(status.contents, [{uri: 'device://A1/status', mimeType: 'application/json', text: JSON.stringify({sn: 'A1', online: true}, null, 2)}])
        //The context has the URI template and the URI read
        assert.deepStrictEqual(calls, [{kind: 'resource', name: 'device://{sn}/status', type: 'device://A1/status'}])
        assert.deepStrictEqual((await client.readResource({uri: 'device://catalog'})).contents, [{uri: 'device://catalog', mimeType: 'text/plain', text: 'A1, B2'}])
        await assert.rejects(client.readResource({uri: 'device://missing/status'}), /E_OFFLINE: The device missing is unknown/)
        await client.close()
        await container.destroy()
    })

    it('gets the prompts', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: Client = await Connect(url)
        const prompts = (await client.listPrompts()).prompts
        const diagnose = prompts.find((prompt): boolean => prompt.name === 'device_diagnose')!
        assert.strictEqual(diagnose.title, 'Diagnose a device')
        assert.deepStrictEqual(diagnose.arguments, [{name: 'sn', description: 'The serial number', required: true}])
        assert.deepStrictEqual(await client.getPrompt({name: 'device_diagnose', arguments: {sn: 'A1'}}), {
            description: 'Diagnose the failures of a device',
            messages: [{role: 'user', content: {type: 'text', text: 'Diagnose the device A1 from its status and its logs.'}}]
        })
        assert.deepStrictEqual((await client.getPrompt({name: 'device_handover', arguments: {sn: 'B2'}})).messages, [
            {role: 'user', content: {type: 'text', text: 'Take over the device B2.'}},
            {role: 'assistant', content: {type: 'text', text: 'Ready.'}}
        ])
        await assert.rejects(client.getPrompt({name: 'device_diagnose', arguments: {}}), /sn/)
        await client.close()
        await container.destroy()
    })

    it('gives the errors to the model', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: Client = await Connect(url)
        const offline = await client.callTool({name: 'device_reboot', arguments: {sn: 'off'}})
        assert.strictEqual(offline.isError, true)
        assert.deepStrictEqual(offline.content, [{type: 'text', text: 'E_OFFLINE: The device off is offline'}])
        //The input is validated by the DTO
        const invalid = await client.callTool({name: 'device_status', arguments: {}})
        assert.strictEqual(invalid.isError, true)
        assert.match((invalid.content as any)[0].text, /sn/)
        await client.close()
        await container.destroy()
    })

    it('runs the middlewares with the MCP context and reports the progress', async (): Promise<void> => {
        const trace: string[] = []
        const traced = (name: string): MiddlewareHandler => async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            trace.push(`${name}:${(invocation.context as MCPContext).type}:${(invocation.context as MCPContext).name}`)
            return next()
        }
        const {url, container} = await Start({middlewares: [traced('adapter')]}, {middlewares: [traced('global')]})
        const client: Client = await Connect(url)
        const progress: unknown[] = []
        const counted = await client.callTool({name: 'count', arguments: {}}, {onprogress: (value: unknown): unknown => progress.push(value)})
        assert.deepStrictEqual(counted.content, [{type: 'text', text: 'counted'}])
        assert.deepStrictEqual(trace, ['global:MCP:count', 'adapter:MCP:count'])
        assert.deepStrictEqual(progress, [1, 2, 3].map((step: number): unknown => ({progress: step, total: 3, message: `step ${step}`})))
        await client.close()
        await container.destroy()
    })

    it('authenticates the requests and validates the hosts', async (): Promise<void> => {
        const {url, container} = await Start({
            authenticate: (request): { token: string, clientId: string, scopes: string[] } => {
                const token: string | undefined = request.headers.authorization?.replace(/^Bearer /, '')
                if (token !== 'secret') throw new Error('Invalid token')
                return {token: token, clientId: 'agent', scopes: ['devices']}
            }
        })
        await assert.rejects(Connect(url))
        const unauthorized: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})
        assert.strictEqual(unauthorized.status, 401)
        assert.strictEqual(unauthorized.headers.get('www-authenticate'), 'Bearer')
        const client: Client = await Connect(url, {Authorization: 'Bearer secret'})
        calls.length = 0
        await client.callTool({name: 'device_status', arguments: {sn: 'A1'}})
        assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [{kind: 'tool', name: 'device_status', type: 'MCP', authInfo: {token: 'secret', clientId: 'agent', scopes: ['devices']}}])
        //A foreign host is refused (DNS rebinding)
        assert.strictEqual(await PostStatus(url, {'Host': 'evil.example.com', 'Authorization': 'Bearer secret'}), 403)
        assert.strictEqual(await PostStatus(url, {'Origin': 'http://evil.example.com', 'Authorization': 'Bearer secret'}), 403)
        assert.strictEqual((await fetch(url.replace('/mcp', '/other'))).status, 404)
        await client.close()
        await container.destroy()
    })

    it('stops gracefully', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: Client = await Connect(url)
        const inProgress = client.callTool({name: 'slow', arguments: {}})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 30))
        await container.destroy()
        assert.deepStrictEqual((await inProgress).content, [{type: 'text', text: 'slow'}])
        await assert.rejects(fetch(url, {method: 'POST', body: '{}'}))
        await client.close()
    })
})
