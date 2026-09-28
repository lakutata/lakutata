import {describe, it} from 'node:test'
import assert from 'node:assert'
import {fileURLToPath} from 'node:url'
import type {ChildProcess} from 'node:child_process'
import {Client} from '@modelcontextprotocol/client'
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio'

describe('Stdio MCP adapter', (): void => {

    it('serves a client running the application as its subprocess', async (): Promise<void> => {
        const transport: StdioClientTransport = new StdioClientTransport({
            command: process.execPath,
            args: [fileURLToPath(new URL('./support/StdioApp.js', import.meta.url))],
            stderr: 'pipe'
        })
        let stderr: string = ''
        transport.stderr?.on('data', (chunk: Buffer): unknown => stderr += chunk.toString())
        const client: Client = new Client({name: 'test', version: '1.0.0'})
        await client.connect(transport)
        assert.strictEqual(client.getServerVersion()?.version, '3.0.0')
        assert.ok((await client.listTools()).tools.some((tool): boolean => tool.name === 'device_status'))
        assert.deepStrictEqual((await client.callTool({name: 'device_status', arguments: {sn: 'A1'}})).structuredContent, {sn: 'A1', online: true})
        const offline = await client.callTool({name: 'device_reboot', arguments: {sn: 'off'}})
        assert.strictEqual(offline.isError, true)
        //The application exits once the client closed its input
        const child: ChildProcess = (transport as any)._process
        const exited: Promise<number | null> = new Promise((resolve: (code: number | null) => void): unknown => child.once('exit', resolve))
        await client.close()
        assert.strictEqual(await exited, 0)
        assert.match(stderr, /\[done]/)
    })
})
