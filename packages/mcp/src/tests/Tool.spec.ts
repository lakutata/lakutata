import {describe, it} from 'node:test'
import assert from 'node:assert'
import {PassThrough} from 'node:stream'
import type {Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint, Result} from '@lakutata/entrypoint'
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {httpMCPEntrypoint, MCPPrompt, MCPTool, stdioMCPEntrypoint, toToolResult} from '../exports/MCP.js'
import {StatusDTO} from './support/Tools.js'

describe('MCPTool', (): void => {

    it('rejects the names MCP does not allow', (): void => {
        assert.throws((): void => {
            class InvalidController extends Controller {
                @MCPTool('get device')
                public async get(): Promise<void> {
                }
            }
            void InvalidController
        }, /Invalid MCP tool name "get device"/)
    })
})

describe('The MCP addresses', (): void => {

    class PingController extends Controller {
        @MCPTool('ping', {description: 'A'})
        public async ping(): Promise<string> {
            return 'A'
        }
    }

    class OtherPingController extends Controller {
        @MCPTool('ping', {description: 'B'})
        public async ping(): Promise<string> {
            return 'B'
        }
    }

    //With a title: the two declarations differ, both reach the adapter
    class TitledController extends Controller {
        @MCPTool('pong', {title: 'Pong'})
        public async pong(): Promise<string> {
            return 'A'
        }

        @MCPPrompt('greet', {title: 'Greet'})
        public async greet(): Promise<string> {
            return 'Hello'
        }
    }

    class OtherTitledController extends Controller {
        @MCPTool('pong', {title: 'Another pong'})
        public async pong(): Promise<string> {
            return 'B'
        }

        @MCPPrompt('greet', {title: 'Greet again'})
        public async greet(): Promise<string> {
            return 'Hi'
        }
    }

    it('are served by the controller registered last when two controllers declare them', async (): Promise<void> => {
        const controllers = [PingController, OtherPingController, TitledController, OtherTitledController]
        const stdio: Container = new Container()
        await stdio.set(Entrypoint, buildEntrypoints({controllers: controllers, mcp: stdioMCPEntrypoint({stdin: new PassThrough(), stdout: new PassThrough(), exitOnClose: false})}))
        await stdio.destroy()
        let server: Server | undefined
        const container: Container = new Container()
        await container.set(Entrypoint, buildEntrypoints({
            controllers: controllers,
            mcp: httpMCPEntrypoint({port: 0, listening: (listening: Server): void => void (server = listening)})
        }))
        const client: Client = new Client({name: 'test', version: '1.0.0'})
        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`)))
            assert.deepStrictEqual((await client.listTools()).tools.map((tool): string => tool.name).sort(), ['ping', 'pong'])
            for (const name of ['ping', 'pong']) assert.deepStrictEqual((await client.callTool({name: name})).content, [{type: 'text', text: 'B'}])
            assert.deepStrictEqual((await client.getPrompt({name: 'greet'})).messages[0].content, {type: 'text', text: 'Hi'})
        } finally {
            await client.close()
            await container.destroy()
        }
    })
})

describe('toToolResult', (): void => {

    it('gives the structured content of the class instances of a tool declaring an output', async (): Promise<void> => {
        const status: StatusDTO = new StatusDTO({sn: 'A1', online: true})
        assert.deepStrictEqual((await toToolResult(status, true)).structuredContent, {sn: 'A1', online: true})
        assert.deepStrictEqual((await toToolResult(Result.status(200, status), true)).structuredContent, {sn: 'A1', online: true})
        //Without output, a class instance is its JSON only
        assert.strictEqual((await toToolResult(status)).structuredContent, undefined)
        assert.deepStrictEqual(JSON.parse(((await toToolResult(status)).content[0] as { text: string }).text), {sn: 'A1', online: true})
        //A plain object is always structured; the values whose JSON is not an object never are
        assert.deepStrictEqual((await toToolResult({sn: 'B2'})).structuredContent, {sn: 'B2'})
        assert.strictEqual((await toToolResult(new Date(0), true)).structuredContent, undefined)
        assert.strictEqual((await toToolResult([status], true)).structuredContent, undefined)
        assert.strictEqual((await toToolResult('online', true)).structuredContent, undefined)
    })
})
