import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import type {Server} from 'node:http'
import express from 'express'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {GET} from '@lakutata/entrypoint/decorator/ctrl'
import {expressHTTPEntrypoint} from '@lakutata/entrypoint/adapter/express'
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {httpMCPEntrypoint, HTTPMCPEntrypointAdapter} from '../exports/MCP.js'
import {DeviceController, ToolController} from './support/Tools.js'

class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<unknown> {
        return {status: 'ok'}
    }
}

/**
 * Start an express adapter mounting the MCP handler
 * @param parseBody the express application parses the JSON bodies before the MCP handler
 */
async function start(parseBody: boolean): Promise<{ url: string, container: Container }> {
    let server: Server | undefined
    const mcp: HTTPMCPEntrypointAdapter = httpMCPEntrypoint({listen: false})
    const container: Container = new Container()
    await container.set(Entrypoint, buildEntrypoints({
        controllers: [DeviceController, ToolController, HealthController],
        http: expressHTTPEntrypoint({
            port: 0,
            host: '127.0.0.1',
            before: (app, context): void => {
                server = context.server
                if (parseBody) app.use(express.json())
                app.all('/mcp', mcp.handler)
            }
        }),
        mcp: mcp
    }))
    return {url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, container: container}
}

describe('HTTP MCP adapter mounted on another server', (): void => {

    for (const parseBody of [false, true]) {
        it(`shares the port of the express adapter${parseBody ? ', the body parsed by express' : ''}`, async (): Promise<void> => {
            const {url, container} = await start(parseBody)
            const client: Client = new Client({name: 'test', version: '1.0.0'})
            await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)))
            assert.deepStrictEqual((await client.callTool({name: 'device_status', arguments: {sn: 'A1'}})).structuredContent, {sn: 'A1', online: true})
            assert.deepStrictEqual((await client.readResource({uri: 'device://catalog'})).contents, [{uri: 'device://catalog', mimeType: 'text/plain', text: 'A1, B2'}])
            //The HTTP actions are served on the same port
            assert.deepStrictEqual(await (await fetch(`${url}/health`)).json(), {status: 'ok'})
            await client.close()
            await container.destroy()
        })
    }
})
