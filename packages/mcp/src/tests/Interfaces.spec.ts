import {describe, it} from 'node:test'
import assert from 'node:assert'
import {request as httpRequest, type IncomingMessage, type Server} from 'node:http'
import {Container, type IInterfaceListener} from '@lakutata/core'
import {buildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import {type InterfaceAddress, listInterfaces, type NetworkInterfaceInfo} from '@lakutata/netif'
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {httpMCPEntrypoint, type HTTPMCPEntrypointOptions} from '../exports/MCP.js'
import {DeviceController, ToolController} from './support/Tools.js'

/**
 * The loopback interface, found by its address
 */
const LOOPBACK: string = listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!.name

/**
 * An interface up with an IPv4 address, not the loopback one: its name and that address
 */
const OTHER: { name: string, address: string } | undefined = listInterfaces()
    .filter((entry: NetworkInterfaceInfo): boolean => !entry.loopback && entry.up)
    .map((entry: NetworkInterfaceInfo): { name: string, address: string } | undefined => {
        const address: InterfaceAddress | undefined = entry.addresses.find((candidate: InterfaceAddress): boolean => candidate.family === 'IPv4')
        return address ? {name: entry.name, address: address.address} : undefined
    })
    .find((entry: { name: string, address: string } | undefined): boolean => !!entry)

/**
 * Start an entrypoint with an HTTP MCP adapter listening on an interface: the port of its listener
 * @param options
 */
async function start(options: HTTPMCPEntrypointOptions): Promise<{ port: number, container: Container }> {
    let port: number = 0
    const container: Container = new Container()
    await container.set(Entrypoint, buildEntrypoints({
        controllers: [DeviceController, ToolController],
        mcp: httpMCPEntrypoint({
            port: 0,
            family: 'IPv4',
            ...options,
            listening: (server: Server, listeners?: IInterfaceListener[]): void => {
                port = listeners![0].port!
            }
        })
    }))
    return {port: port, container: container}
}

/**
 * The status of a POST sent with the given headers (fetch does not send its own Host header)
 * @param url
 * @param headers
 */
function postStatus(url: string, headers: Record<string, string>): Promise<number> {
    return new Promise((resolve: (status: number) => void, reject: (error: Error) => void): void => {
        httpRequest(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}}, (response: IncomingMessage): void => {
            response.resume()
            resolve(response.statusCode!)
        }).once('error', reject).end('{}')
    })
}

describe('HTTP MCP adapter listening on an interface', (): void => {

    it('serves the clients through the loopback interface, checking the hosts as on a loopback address', async (): Promise<void> => {
        const {port, container} = await start({interface: LOOPBACK})
        const url: string = `http://127.0.0.1:${port}/mcp`
        const client: Client = new Client({name: 'test', version: '1.0.0'})
        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(url)))
            assert.ok((await client.listTools()).tools.length > 0)
            assert.strictEqual(await postStatus(url, {'Host': 'evil.example.com'}), 403)
            assert.strictEqual(await postStatus(url, {'Origin': 'http://evil.example.com'}), 403)
        } finally {
            await client.close()
            await container.destroy()
        }
        await assert.rejects(fetch(url, {method: 'POST'}))
    })

    it('checks no host by default on another interface', {skip: OTHER ? false : 'no interface but the loopback one has an IPv4 address'}, async (): Promise<void> => {
        const {port, container} = await start({interface: OTHER?.name})
        try {
            assert.notStrictEqual(await postStatus(`http://${OTHER!.address}:${port}/mcp`, {'Host': 'device.example.com'}), 403)
        } finally {
            await container.destroy()
        }
    })

    it('refuses the options that contradict', (): void => {
        assert.throws((): unknown => httpMCPEntrypoint({listen: false, interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => httpMCPEntrypoint({host: '127.0.0.1', interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => httpMCPEntrypoint({strict: true}), TypeError)
    })
})
