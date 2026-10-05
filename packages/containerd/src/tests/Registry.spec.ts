import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {parseReference} from '../client/Reference.js'
import {digestOf, MediaTypes, RegistryClient, RegistryError} from '../client/Registry.js'

/**
 * The body of a request
 * @param request
 */
async function body(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
}

describe('The registry client', (): void => {

    let server: Server
    let host: string
    const blobs: Map<string, Buffer> = new Map()
    const manifests: Map<string, { mediaType: string, data: Buffer }> = new Map()
    const tokenRequests: { authorization?: string, scope: string }[] = []

    const layer: Buffer = Buffer.from('layer')
    const config: Buffer = Buffer.from('{"architecture":"arm64","os":"linux","rootfs":{"type":"layers","diff_ids":[]}}')
    const manifest: Buffer = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: MediaTypes.OCI_MANIFEST, config: {mediaType: MediaTypes.OCI_CONFIG, digest: digestOf(config), size: config.length}, layers: [{mediaType: MediaTypes.OCI_LAYER_GZIP, digest: digestOf(layer), size: layer.length}]}))
    const index: Buffer = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: MediaTypes.OCI_INDEX, manifests: [{mediaType: MediaTypes.OCI_MANIFEST, digest: digestOf(manifest), size: manifest.length, platform: {os: 'linux', architecture: 'arm64', variant: 'v8'}}]}))

    before(async (): Promise<void> => {
        blobs.set(digestOf(layer), layer)
        blobs.set(digestOf(config), config)
        manifests.set(digestOf(manifest), {mediaType: MediaTypes.OCI_MANIFEST, data: manifest})
        manifests.set(digestOf(index), {mediaType: MediaTypes.OCI_INDEX, data: index})
        manifests.set('1.0', {mediaType: MediaTypes.OCI_INDEX, data: index})
        //A registry whose token service gives the tokens to the user test (password secret) only
        const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
            const url: URL = new URL(request.url!, `http://${host}`)
            if (url.pathname === '/token') {
                tokenRequests.push({authorization: request.headers.authorization, scope: url.searchParams.get('scope')!})
                if (request.headers.authorization !== `Basic ${Buffer.from('test:secret').toString('base64')}`) return void response.writeHead(401).end()
                return void response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({token: `token:${url.searchParams.get('scope')}`}))
            }
            const scope: string = request.method === 'GET' || request.method === 'HEAD' ? 'repository:team/app:pull' : 'repository:team/app:push,pull'
            const authorized: boolean = [`Bearer token:${scope}`, 'Bearer token:repository:team/app:push,pull'].includes(request.headers.authorization ?? '')
            if (!authorized) {
                return void response.writeHead(401, {'www-authenticate': `Bearer realm="http://${host}/token",service="test",scope="${scope}"`}).end()
            }
            const match: RegExpMatchArray | null = url.pathname.match(/^\/v2\/team\/app\/(manifests|blobs)\/(.+)$/)
            if (url.pathname === '/v2/team/app/blobs/uploads/' && request.method === 'POST') {
                return void response.writeHead(202, {location: '/v2/team/app/blobs/uploads/1'}).end()
            }
            if (url.pathname === '/v2/team/app/blobs/uploads/1' && request.method === 'PUT') {
                const data: Buffer = await body(request)
                if (digestOf(data) !== url.searchParams.get('digest')) return void response.writeHead(400).end(JSON.stringify({errors: [{code: 'DIGEST_INVALID', message: 'digest mismatch'}]}))
                blobs.set(digestOf(data), data)
                return void response.writeHead(201).end()
            }
            if (match?.[1] === 'manifests' && request.method === 'PUT') {
                manifests.set(match[2], {mediaType: request.headers['content-type']!, data: await body(request)})
                return void response.writeHead(201).end()
            }
            if (match?.[1] === 'manifests') {
                const found = manifests.get(match[2])
                if (!found) return void response.writeHead(404, {'content-type': 'application/json'}).end(JSON.stringify({errors: [{code: 'MANIFEST_UNKNOWN', message: 'manifest unknown'}]}))
                return void response.writeHead(200, {'content-type': found.mediaType}).end(request.method === 'HEAD' ? undefined : found.data)
            }
            if (match?.[1] === 'blobs') {
                const found: Buffer | undefined = blobs.get(match[2])
                if (!found) return void response.writeHead(404).end()
                return void response.writeHead(200).end(request.method === 'HEAD' ? undefined : found)
            }
            response.writeHead(404).end()
        }
        server = http.createServer((request: IncomingMessage, response: ServerResponse): void => void handle(request, response))
        await new Promise<void>((resolve: () => void): void => void server.listen(0, '127.0.0.1', resolve))
        host = `localhost:${(server.address() as AddressInfo).port}`
    })

    after(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void): void => void server.close((): void => resolve()))
    })

    it('resolves the tags and fetches the manifests and the blobs, with the tokens of the registry', async (): Promise<void> => {
        const registry: RegistryClient = new RegistryClient(parseReference(`${host}/team/app:1.0`), {insecure: [host], credentials: {[host]: {username: 'test', password: 'secret'}}})
        const root = await registry.resolve('1.0')
        assert.strictEqual(root.descriptor.mediaType, MediaTypes.OCI_INDEX)
        assert.strictEqual(root.descriptor.digest, digestOf(index))
        assert.deepStrictEqual(await registry.fetchManifest({mediaType: MediaTypes.OCI_MANIFEST, digest: digestOf(manifest), size: manifest.length}), manifest)
        const chunks: Buffer[] = []
        for await (const chunk of await registry.fetchBlob({mediaType: MediaTypes.OCI_LAYER_GZIP, digest: digestOf(layer), size: layer.length})) chunks.push(Buffer.from(chunk))
        assert.strictEqual(Buffer.concat(chunks).toString(), 'layer')
        //The token of the scope asked once
        assert.strictEqual(tokenRequests.filter((request): boolean => request.scope === 'repository:team/app:pull').length, 1)
        await assert.rejects(registry.resolve('2.0'), (error: unknown): boolean => error instanceof RegistryError && error.status === 404 && error.message.includes('MANIFEST_UNKNOWN'))
    })

    it('refuses without the credentials the registry asks', async (): Promise<void> => {
        const registry: RegistryClient = new RegistryClient(parseReference(`${host}/team/app:1.0`), {insecure: [host]})
        await assert.rejects(registry.resolve('1.0'), (error: unknown): boolean => error instanceof RegistryError && error.status === 401)
    })

    it('pushes the blobs (streamed) and the manifests', async (): Promise<void> => {
        const registry: RegistryClient = new RegistryClient(parseReference(`${host}/team/app:2.0`), {insecure: [host], credentials: {[host]: {username: 'test', password: 'secret'}}})
        const data: Buffer = Buffer.from('a new layer')
        await registry.pushBlob({mediaType: MediaTypes.OCI_LAYER, digest: digestOf(data), size: data.length}, async function* (): AsyncGenerator<Uint8Array> {
            yield data.subarray(0, 3)
            yield data.subarray(3)
        })
        assert.strictEqual(blobs.get(digestOf(data))?.toString(), 'a new layer')
        //A blob the registry has is not uploaded again
        await registry.pushBlob({mediaType: MediaTypes.OCI_LAYER, digest: digestOf(layer), size: layer.length}, (): AsyncIterable<Uint8Array> => {
            throw new Error('uploaded again')
        })
        await registry.pushManifest('2.0', MediaTypes.OCI_MANIFEST, manifest)
        assert.deepStrictEqual(manifests.get('2.0'), {mediaType: MediaTypes.OCI_MANIFEST, data: manifest})
    })
})
