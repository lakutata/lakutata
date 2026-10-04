import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {createWriteStream} from 'node:fs'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'
import {pack as tarPack, type Pack} from 'tar-stream'
import type {Message} from '@lakutata/grpc'
import type {ContainerdClient, ContentDescriptor} from '../client/ContainerdClient.js'
import {ImageStore} from '../client/ImageStore.js'
import {ParsePlatform, type Platform} from '../client/Platforms.js'
import {Digest, MediaTypes} from '../client/Registry.js'

/**
 * A containerd of the tests: its content, its images and its snapshots in memory, the layers it applies
 */
class FakeClient {

    public readonly content: Map<string, Buffer> = new Map()

    public readonly images: Map<string, Message> = new Map()

    public readonly snapshots: Set<string> = new Set()

    public readonly applied: string[] = []

    public failApply: boolean = false

    public async createLease(): Promise<string> {
        return 'lease'
    }

    public async deleteLease(): Promise<void> {
    }

    public async getImage(name: string): Promise<Message | undefined> {
        return this.images.get(name)
    }

    public async putImage(image: Message): Promise<Message> {
        this.images.set(image.name, image)
        return image
    }

    public async contentInfo(digest: string): Promise<Message | undefined> {
        const data: Buffer | undefined = this.content.get(digest)
        return data ? {digest: digest, size: data.length, labels: {}} : undefined
    }

    public async labelContent(): Promise<void> {
    }

    public async* readContent(digest: string): AsyncGenerator<Uint8Array> {
        yield await this.readAll(digest)
    }

    public async readAll(digest: string): Promise<Buffer> {
        const data: Buffer | undefined = this.content.get(digest)
        if (!data) throw new Error(`The content ${digest} does not exist`)
        return data
    }

    public async writeContent(descriptor: { digest: string }, data: Uint8Array | AsyncIterable<Uint8Array>): Promise<void> {
        const chunks: Buffer[] = []
        if (data instanceof Uint8Array) chunks.push(Buffer.from(data))
        else for await (const chunk of data) chunks.push(Buffer.from(chunk))
        this.content.set(descriptor.digest, Buffer.concat(chunks))
    }

    public async statSnapshot(snapshotter: string, key: string): Promise<Message | undefined> {
        return this.snapshots.has(key) ? {name: key} : undefined
    }

    public async prepareSnapshot(): Promise<[]> {
        return []
    }

    //The layers of the tests are not compressed: their digests are their identifiers
    public async applyLayer(layer: ContentDescriptor): Promise<ContentDescriptor> {
        if (this.failApply) throw new Error('The layer cannot be applied')
        this.applied.push(layer.digest)
        return {mediaType: MediaTypes.OCI_LAYER, digest: layer.digest, size: layer.size}
    }

    public async commitSnapshot(snapshotter: string, name: string): Promise<void> {
        this.snapshots.add(name)
    }

    public async removeSnapshot(): Promise<void> {
    }
}

/**
 * An image of the tests in an OCI layout: its index of the manifests of its platforms (and of an attestation), their
 * configurations and their layers
 */
class LayoutImage {

    public readonly blobs: Map<string, Buffer> = new Map()

    public readonly layers: Map<string, string> = new Map()

    public readonly index: ContentDescriptor

    constructor(name: string, platforms: string[]) {
        const manifests: ContentDescriptor[] = []
        for (const platform of [...platforms, 'unknown/unknown']) {
            const [os, architecture, variant] = platform.split('/')
            const layer: Buffer = Buffer.from(`${name} ${platform}`)
            const config: Buffer = this.blob(JSON.stringify({architecture: architecture, os: os, ...variant ? {variant: variant} : {}, rootfs: {type: 'layers', diff_ids: [Digest(layer)]}}))
            this.blob(layer)
            this.layers.set(platform, Digest(layer))
            const manifest: Buffer = this.blob(JSON.stringify({
                schemaVersion: 2,
                mediaType: MediaTypes.OCI_MANIFEST,
                config: {mediaType: MediaTypes.OCI_CONFIG, digest: Digest(config), size: config.length},
                layers: [{mediaType: MediaTypes.OCI_LAYER, digest: Digest(layer), size: layer.length}]
            }))
            manifests.push({mediaType: MediaTypes.OCI_MANIFEST, digest: Digest(manifest), size: manifest.length, platform: {os: os, architecture: architecture, ...variant ? {variant: variant} : {}}})
        }
        const index: Buffer = this.blob(JSON.stringify({schemaVersion: 2, mediaType: MediaTypes.OCI_INDEX, manifests: manifests}))
        this.index = {mediaType: MediaTypes.OCI_INDEX, digest: Digest(index), size: index.length, annotations: {'io.containerd.image.name': name}}
    }

    protected blob(content: string | Buffer): Buffer {
        const data: Buffer = Buffer.from(content)
        this.blobs.set(Digest(data), data)
        return data
    }
}

/**
 * Write an OCI layout of images into an archive
 * @param file
 * @param images
 */
async function WriteLayout(file: string, images: LayoutImage[]): Promise<void> {
    const archive: Pack = tarPack()
    const output: Promise<void> = pipeline(archive, createWriteStream(file))
    const entry = (name: string, data: Buffer): void => void archive.entry({name: name, size: data.length}, data)
    entry('oci-layout', Buffer.from(JSON.stringify({imageLayoutVersion: '1.0.0'})))
    for (const image of images) for (const [digest, data] of image.blobs) entry(`blobs/${digest.replace(':', '/')}`, data)
    entry('index.json', Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: MediaTypes.OCI_INDEX, manifests: images.map((image: LayoutImage): ContentDescriptor => image.index)})))
    archive.finalize()
    await output
}

describe('The image store', (): void => {

    let directory: string
    let server: Server
    let host: string
    //The registry of the tests (without authentication): its blobs, its manifests by tag or digest
    const blobs: Map<string, Buffer> = new Map()
    const manifests: Map<string, { mediaType: string, data: Buffer }> = new Map()
    const multi: LayoutImage = new LayoutImage('docker.io/library/multi:1', ['linux/amd64', 'linux/arm64/v8', 'linux/s390x'])
    const other: LayoutImage = new LayoutImage('docker.io/library/other:1', ['linux/amd64'])

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-image-store-'))
        await WriteLayout(path.join(directory, 'multi.tar'), [multi])
        await WriteLayout(path.join(directory, 'two.tar'), [multi, other])
        const body = async (request: IncomingMessage): Promise<Buffer> => {
            const chunks: Buffer[] = []
            for await (const chunk of request) chunks.push(chunk as Buffer)
            return Buffer.concat(chunks)
        }
        const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
            const url: URL = new URL(request.url!, `http://${host}`)
            const match: RegExpMatchArray | null = url.pathname.match(/^\/v2\/team\/multi\/(manifests|blobs)\/(.+)$/)
            if (url.pathname === '/v2/team/multi/blobs/uploads/') return void response.writeHead(202, {location: '/v2/team/multi/blobs/uploads/1'}).end()
            if (url.pathname === '/v2/team/multi/blobs/uploads/1') {
                blobs.set(url.searchParams.get('digest')!, await body(request))
                return void response.writeHead(201).end()
            }
            if (match?.[1] === 'manifests' && request.method === 'PUT') {
                manifests.set(match[2], {mediaType: request.headers['content-type']!, data: await body(request)})
                return void response.writeHead(201).end()
            }
            if (match?.[1] === 'blobs' && blobs.has(match[2])) return void response.writeHead(200).end()
            response.writeHead(404).end()
        }
        server = http.createServer((request: IncomingMessage, response: ServerResponse): void => void handle(request, response))
        await new Promise<void>((resolve: () => void): void => void server.listen(0, '127.0.0.1', resolve))
        host = `localhost:${(server.address() as AddressInfo).port}`
    })

    after(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void): void => void server.close((): void => resolve()))
        await rm(directory, {recursive: true, force: true})
    })

    const store = (client: FakeClient, platforms: string[]): ImageStore => new ImageStore(client as unknown as ContainerdClient, 'overlayfs', directory, (): Platform[] => platforms.map(ParsePlatform))

    it('unpacks the imported images for the platforms the machine runs only, not their attestations', async (): Promise<void> => {
        const client: FakeClient = new FakeClient()
        assert.deepStrictEqual(await store(client, ['linux/amd64']).import(path.join(directory, 'multi.tar')), ['docker.io/library/multi:1'])
        assert.deepStrictEqual(client.applied, [multi.layers.get('linux/amd64')])
        //All the platforms are stored
        for (const digest of multi.blobs.keys()) assert.ok(client.content.has(digest), digest)
        const emulated: FakeClient = new FakeClient()
        await store(emulated, ['linux/amd64', 'linux/arm64']).import(path.join(directory, 'multi.tar'))
        assert.deepStrictEqual(emulated.applied, [multi.layers.get('linux/amd64'), multi.layers.get('linux/arm64/v8')])
        const none: FakeClient = new FakeClient()
        await store(none, ['linux/amd64']).import(path.join(directory, 'multi.tar'), {unpack: false})
        assert.deepStrictEqual(none.applied, [])
    })

    it('fails the import when its images fail to be unpacked', async (): Promise<void> => {
        const client: FakeClient = new FakeClient()
        client.failApply = true
        await assert.rejects(store(client, ['linux/amd64']).import(path.join(directory, 'multi.tar')), /cannot be applied/)
        //Stored and named
        assert.ok(client.images.has('docker.io/library/multi:1'))
    })

    it('names the image of an archive of one image only', async (): Promise<void> => {
        const client: FakeClient = new FakeClient()
        assert.deepStrictEqual(await store(client, ['linux/amd64']).import(path.join(directory, 'multi.tar'), {name: 'renamed:2'}), ['docker.io/library/renamed:2'])
        const several: FakeClient = new FakeClient()
        await assert.rejects(store(several, ['linux/amd64']).import(path.join(directory, 'two.tar'), {name: 'renamed:2'}), /2 images/)
        //Nothing imported
        assert.strictEqual(several.images.size, 0)
        assert.strictEqual(several.content.size, 0)
        assert.deepStrictEqual(await store(new FakeClient(), ['linux/amd64']).import(path.join(directory, 'two.tar')), ['docker.io/library/multi:1', 'docker.io/library/other:1'])
    })

    it('pushes the platform asked only, every platform and the index without it', async (): Promise<void> => {
        const client: FakeClient = new FakeClient()
        const images: ImageStore = store(client, ['linux/amd64'])
        await images.import(path.join(directory, 'multi.tar'), {unpack: false})
        const registry = {insecure: [host]}
        //All the platforms present: the one asked alone, under the tag
        await images.push('multi:1', {reference: `${host}/team/multi:arm64`, platform: ParsePlatform('linux/arm64'), registry: registry})
        assert.deepStrictEqual([...manifests.keys()], ['arm64'])
        assert.strictEqual(manifests.get('arm64')!.mediaType, MediaTypes.OCI_MANIFEST)
        assert.deepStrictEqual(JSON.parse(manifests.get('arm64')!.data.toString()).layers.map((layer: ContentDescriptor): string => layer.digest), [multi.layers.get('linux/arm64/v8')])
        assert.ok(!blobs.has(multi.layers.get('linux/amd64')!))
        await assert.rejects(images.push('multi:1', {reference: `${host}/team/multi:mips`, platform: ParsePlatform('linux/mips'), registry: registry}), /no manifest of the platform linux\/mips/)
        //Without a platform: every manifest, the index under the tag
        manifests.clear()
        await images.push('multi:1', {reference: `${host}/team/multi:all`, registry: registry})
        assert.strictEqual(manifests.get('all')!.mediaType, MediaTypes.OCI_INDEX)
        assert.strictEqual(manifests.size, 1 + 4)
    })
})
