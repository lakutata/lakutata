import {createHash, randomBytes} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {extract as tarExtract, pack as tarPack, type Header, type Pack} from 'tar-stream'
import {ContainerdClient, IsGRPCError, type ContentDescriptor} from './ContainerdClient.js'
import {GRPCStatus, type Message} from '@lakutata/grpc'
import {FormatPlatform, HostPlatform, MatchPlatform, NormalizePlatform, PlatformRank, type Platform} from './Platforms.js'
import {ImageName, ParseReference, type ImageReference} from './Reference.js'
import {Digest, IsIndex, IsManifest, MediaTypes, RegistryClient, type RegistryOptions} from './Registry.js'

/**
 * A manifest of an image (OCI, Docker)
 */
export type ImageManifest = {
    schemaVersion: number
    mediaType?: string
    config: ContentDescriptor
    layers: ContentDescriptor[]
    annotations?: Record<string, string>
}

/**
 * An index of the manifests of the platforms of an image
 */
export type ImageIndex = {
    schemaVersion: number
    mediaType?: string
    manifests: ContentDescriptor[]
    annotations?: Record<string, string>
}

/**
 * The configuration of an image (OCI): its platform, the configuration of its containers, its layers
 */
export type ImageConfigFile = {
    architecture: string
    os: string
    variant?: string
    created?: string
    config?: {
        Env?: string[]
        Cmd?: string[]
        Entrypoint?: string[]
        WorkingDir?: string
        User?: string
        ExposedPorts?: Record<string, object>
        Volumes?: Record<string, object>
        Labels?: Record<string, string>
        StopSignal?: string
    }
    rootfs: { type: string, diff_ids: string[] }
}

/**
 * The changes of the configuration of an image committed
 */
export type ImageConfigChanges = {
    cmd?: string[]
    entrypoint?: string[]
    /**
     * Its environment variables added or replaced (KEY=value)
     */
    env?: string[]
    workingDir?: string
    user?: string
    labels?: Record<string, string>
    /**
     * Its ports exposed (80, 53/udp)
     */
    exposedPorts?: string[]
}

/**
 * An image of a platform, resolved: its manifest and its configuration
 */
export type ResolvedImage = {
    image: Message
    name: string
    target: ContentDescriptor
    manifestDescriptor: ContentDescriptor
    manifest: ImageManifest
    config: ImageConfigFile
    platform: Platform
}

/**
 * The progress of the transfer of a blob
 */
export type TransferProgress = {
    digest: string
    mediaType: string
    current: number
    total: number
}

/**
 * The options of a pull
 */
export type PullOptions = {
    /**
     * The platforms pulled: the one of the machine by default, all with "all"
     */
    platforms?: Platform[] | 'all'
    registry?: RegistryOptions
    /**
     * Unpack the layers of the platforms the machine runs (the ones of the store) into its snapshots, true by default
     */
    unpack?: boolean
    progress?: (progress: TransferProgress) => void
}

/**
 * The labels of containerd binding its content (its garbage collection keeps what an image references)
 */
const Labels = {
    contentRef: (kind: string, index?: number): string => `containerd.io/gc.ref.content.${kind}${index === undefined ? '' : `.${index}`}`,
    snapshotRef: (snapshotter: string): string => `containerd.io/gc.ref.snapshot.${snapshotter}`,
    uncompressed: 'containerd.io/uncompressed',
    source: (registry: string): string => `containerd.io/distribution.source.${registry}`
}

/**
 * The bytes of a stream, whole
 * @param chunks
 */
async function Collect(chunks: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const all: Buffer[] = []
    for await (const chunk of chunks) all.push(Buffer.from(chunk))
    return Buffer.concat(all)
}

/**
 * The identifiers of the chain of layers (OCI): the ones of the snapshots of their unpacking
 * @param diffIds
 */
export function ChainIds(diffIds: string[]): string[] {
    const chain: string[] = []
    for (const diffId of diffIds) {
        chain.push(chain.length ? `sha256:${createHash('sha256').update(`${chain[chain.length - 1]} ${diffId}`).digest('hex')}` : diffId)
    }
    return chain
}

/**
 * The platform of the configuration of an image
 * @param config
 */
function ConfigPlatform(config: ImageConfigFile): Platform {
    return NormalizePlatform({os: config.os, architecture: config.architecture, variant: config.variant})
}

/**
 * The images of containerd: pulled from the registries, unpacked into the snapshots, pushed, imported and exported
 * (OCI image layouts, the archives of docker save), as ctr and nerdctl do: their content bound by the labels of the
 * garbage collection of containerd, under a lease until the image references it
 */
export class ImageStore {

    /**
     * @param client
     * @param snapshotter
     * @param temporary the directory of the archives extracted (a disk of the machine, not a small tmpfs)
     * @param runnablePlatforms the platforms the machine runs, unpacked by the pulls and the imports (the one of the
     * machine by default)
     */
    constructor(protected readonly client: ContainerdClient, public readonly snapshotter: string, public readonly temporary: string = os.tmpdir(), public readonly runnablePlatforms: () => Platform[] = (): Platform[] => [HostPlatform()]) {
    }

    /**
     * The JSON of a content
     * @param digest
     */
    protected async readJson<T>(digest: string): Promise<T> {
        return JSON.parse((await this.client.readAll(digest)).toString('utf8')) as T
    }

    /**
     * The best manifest of an index for a platform, among the ones the content store has (or all)
     * @param index
     * @param platform
     * @param local
     */
    protected async chooseManifest(index: ImageIndex, platform: Platform, local: boolean): Promise<ContentDescriptor | undefined> {
        let best: { descriptor: ContentDescriptor, rank: number } | undefined
        for (const descriptor of index.manifests) {
            if (!IsManifest(descriptor.mediaType) || !descriptor.platform) continue
            const rank: number | undefined = PlatformRank(descriptor.platform, platform)
            if (rank === undefined || (best && best.rank <= rank)) continue
            if (local && !(await this.client.contentInfo(descriptor.digest))) continue
            best = {descriptor: descriptor, rank: rank}
        }
        return best?.descriptor
    }

    /**
     * The image of a name (the reference given or its normalized name), undefined when it does not exist
     * @param name
     */
    public async get(name: string): Promise<Message | undefined> {
        return await this.client.getImage(ImageName(name)) ?? (ImageName(name) === name ? undefined : await this.client.getImage(name))
    }

    /**
     * Resolve an image for a platform: its manifest and its configuration (the manifest of the platform of its index)
     * @param name
     * @param platform the one of the machine by default
     */
    public async resolve(name: string, platform: Platform = HostPlatform()): Promise<ResolvedImage> {
        const image: Message | undefined = await this.get(name)
        if (!image) throw Object.assign(new Error(`The image ${name} does not exist`), {code: 'NOT_FOUND'})
        const target: ContentDescriptor = image.target
        let manifestDescriptor: ContentDescriptor = target
        if (IsIndex(target.mediaType)) {
            const chosen: ContentDescriptor | undefined = await this.chooseManifest(await this.readJson<ImageIndex>(target.digest), platform, true)
            if (!chosen) throw Object.assign(new Error(`The image ${name} has no manifest of the platform ${FormatPlatform(platform)}`), {code: 'PLATFORM'})
            manifestDescriptor = chosen
        }
        const manifest: ImageManifest = await this.readJson<ImageManifest>(manifestDescriptor.digest)
        const config: ImageConfigFile = await this.readJson<ImageConfigFile>(manifest.config.digest)
        return {image: image, name: image.name, target: target, manifestDescriptor: manifestDescriptor, manifest: manifest, config: config, platform: ConfigPlatform(config)}
    }

    /**
     * The platforms of an image the content store has (the ones pulled)
     * @param name
     */
    public async platforms(name: string): Promise<Platform[]> {
        const image: Message | undefined = await this.get(name)
        if (!image) return []
        if (!IsIndex(image.target.mediaType)) return [ConfigPlatform(await this.readJson<ImageConfigFile>((await this.readJson<ImageManifest>(image.target.digest)).config.digest))]
        const platforms: Platform[] = []
        for (const descriptor of (await this.readJson<ImageIndex>(image.target.digest)).manifests) {
            if (descriptor.platform && IsManifest(descriptor.mediaType) && await this.client.contentInfo(descriptor.digest)) platforms.push(NormalizePlatform(descriptor.platform))
        }
        return platforms
    }

    /**
     * Unpack the layers of an image into the snapshots of the snapshotter (named by the chain of their identifiers), the
     * configuration bound to the last one
     * @param manifest
     * @param lease
     */
    public async unpack(manifest: ImageManifest, lease: string): Promise<string> {
        const config: ImageConfigFile = await this.readJson<ImageConfigFile>(manifest.config.digest)
        const diffIds: string[] = config.rootfs?.diff_ids ?? []
        if (diffIds.length !== manifest.layers.length) throw new Error(`The image ${manifest.config.digest} has ${manifest.layers.length} layers and ${diffIds.length} identifiers of them`)
        const chain: string[] = ChainIds(diffIds)
        for (let index = 0; index < chain.length; index++) {
            if (await this.client.statSnapshot(this.snapshotter, chain[index])) continue
            const key: string = `extract-${randomBytes(6).toString('hex')}-${chain[index]}`
            const mounts = await this.client.prepareSnapshot(this.snapshotter, key, index ? chain[index - 1] : '', {}, lease)
            try {
                const applied: ContentDescriptor = await this.client.applyLayer(manifest.layers[index], mounts, lease)
                if (applied.digest !== diffIds[index]) throw new Error(`The layer ${manifest.layers[index].digest} unpacked is ${applied.digest}, not ${diffIds[index]}`)
                await this.client.commitSnapshot(this.snapshotter, chain[index], key, {}, lease)
            } catch (error: unknown) {
                await this.client.removeSnapshot(this.snapshotter, key)
                //Unpacked meanwhile
                if (IsGRPCError(error, GRPCStatus.ALREADY_EXISTS)) continue
                throw error
            }
        }
        if (chain.length) await this.client.labelContent(manifest.config.digest, {[Labels.snapshotRef(this.snapshotter)]: chain[chain.length - 1]})
        return chain[chain.length - 1] ?? ''
    }

    /**
     * Write a manifest, its configuration and its layers (the blobs given by a source), bound by the labels of the
     * garbage collection
     * @param manifest
     * @param blob the bytes of a blob (its stream)
     * @param lease
     * @param labels the labels of all the content (its source)
     * @param progress
     */
    protected async writeImage(manifest: ImageManifest, blob: (descriptor: ContentDescriptor) => Promise<Uint8Array | AsyncIterable<Uint8Array>>, lease: string, labels: Record<string, string>, progress?: (progress: TransferProgress) => void): Promise<void> {
        const configData: Uint8Array | AsyncIterable<Uint8Array> = await blob(manifest.config)
        const configBytes: Buffer = configData instanceof Uint8Array ? Buffer.from(configData) : await Collect(configData)
        await this.client.writeContent(manifest.config, configBytes, lease, labels)
        const config: ImageConfigFile = JSON.parse(configBytes.toString('utf8')) as ImageConfigFile
        for (let index = 0; index < manifest.layers.length; index++) {
            const layer: ContentDescriptor = manifest.layers[index]
            const uncompressed: Record<string, string> = config.rootfs?.diff_ids?.[index] ? {[Labels.uncompressed]: config.rootfs.diff_ids[index]} : {}
            if (await this.client.contentInfo(layer.digest)) {
                await this.client.labelContent(layer.digest, {...labels, ...uncompressed})
                progress?.({digest: layer.digest, mediaType: layer.mediaType, current: layer.size, total: layer.size})
                continue
            }
            const data: Uint8Array | AsyncIterable<Uint8Array> = await blob(layer)
            let current: number = 0
            const counted = async function* (): AsyncGenerator<Uint8Array> {
                for await (const chunk of data as AsyncIterable<Uint8Array>) {
                    current += chunk.length
                    progress?.({digest: layer.digest, mediaType: layer.mediaType, current: current, total: layer.size})
                    yield chunk
                }
            }
            await this.client.writeContent(layer, data instanceof Uint8Array ? data : counted(), lease, {...labels, ...uncompressed})
        }
    }

    /**
     * The labels of a manifest binding its configuration and its layers
     * @param manifest
     */
    protected manifestLabels(manifest: ImageManifest): Record<string, string> {
        const labels: Record<string, string> = {[Labels.contentRef('config')]: manifest.config.digest}
        manifest.layers.forEach((layer: ContentDescriptor, index: number): unknown => labels[Labels.contentRef('l', index)] = layer.digest)
        return labels
    }

    /**
     * Pull an image from its registry: the manifests of the platforms asked (of its index), their configurations and
     * their layers; the image named by its reference (docker.io/library/busybox:latest), unpacked for the machine
     * @param reference
     * @param options
     */
    public async pull(reference: string, options: PullOptions = {}): Promise<string> {
        const parsed: ImageReference = ParseReference(reference)
        const registry: RegistryClient = new RegistryClient(parsed, options.registry)
        const platforms: Platform[] | 'all' = options.platforms ?? [HostPlatform()]
        const source: Record<string, string> = {[Labels.source(parsed.registry)]: parsed.repository}
        const lease: string = await this.client.createLease()
        try {
            const root = await registry.resolve(parsed.digest ?? parsed.tag!)
            const manifests: { descriptor: ContentDescriptor, data: Buffer, index?: number }[] = []
            if (IsIndex(root.descriptor.mediaType)) {
                const index: ImageIndex = JSON.parse(root.data.toString('utf8')) as ImageIndex
                const chosen: Set<ContentDescriptor> = new Set()
                if (platforms === 'all') {
                    index.manifests.filter((descriptor: ContentDescriptor): boolean => IsManifest(descriptor.mediaType) && descriptor.platform?.os !== 'unknown').forEach((descriptor: ContentDescriptor): unknown => chosen.add(descriptor))
                } else {
                    for (const platform of platforms) {
                        const descriptor: ContentDescriptor | undefined = await this.chooseManifest(index, platform, false)
                        if (!descriptor) {
                            const available: string = index.manifests.filter((item: ContentDescriptor): boolean => !!item.platform && item.platform.os !== 'unknown').map((item: ContentDescriptor): string => FormatPlatform(NormalizePlatform(item.platform!))).join(', ')
                            throw Object.assign(new Error(`The image ${parsed.name} has no manifest of the platform ${FormatPlatform(platform)} (it has ${available})`), {code: 'PLATFORM'})
                        }
                        chosen.add(descriptor)
                    }
                }
                for (const descriptor of chosen) manifests.push({descriptor: descriptor, data: await registry.fetchManifest(descriptor), index: index.manifests.indexOf(descriptor)})
            } else {
                manifests.push(root)
            }
            for (const {descriptor, data} of manifests) {
                const manifest: ImageManifest = JSON.parse(data.toString('utf8')) as ImageManifest
                await this.writeImage(manifest, (blob: ContentDescriptor): Promise<AsyncIterable<Uint8Array>> => registry.fetchBlob(blob), lease, source, options.progress)
                await this.client.writeContent(descriptor, data, lease, {...source, ...this.manifestLabels(manifest)})
            }
            if (IsIndex(root.descriptor.mediaType)) {
                const labels: Record<string, string> = {...source}
                manifests.forEach(({descriptor, index}): unknown => labels[Labels.contentRef('m', index)] = descriptor.digest)
                await this.client.writeContent(root.descriptor, root.data, lease, labels)
            }
            await this.client.putImage({name: parsed.name, target: root.descriptor}, lease)
            if (options.unpack ?? true) await this.unpackFor(parsed.name, lease)
            return parsed.name
        } finally {
            await this.client.deleteLease(lease)
        }
    }

    /**
     * Unpack an image for the platforms the machine runs, among the ones the content store has (its manifests pulled):
     * not the other platforms, nor the attestations (unknown/unknown)
     * @param name
     * @param lease
     */
    protected async unpackFor(name: string, lease: string): Promise<void> {
        const image: Message | undefined = await this.get(name)
        if (!image) return
        const manifests: ContentDescriptor[] = IsIndex(image.target.mediaType)
            ? (await this.readJson<ImageIndex>(image.target.digest)).manifests.filter((descriptor: ContentDescriptor): boolean => IsManifest(descriptor.mediaType))
            : [image.target]
        const runnable: Platform[] = this.runnablePlatforms()
        for (const descriptor of manifests) {
            if (!(await this.client.contentInfo(descriptor.digest))) continue
            const manifest: ImageManifest = await this.readJson<ImageManifest>(descriptor.digest)
            const platform: Platform = descriptor.platform ? NormalizePlatform(descriptor.platform) : ConfigPlatform(await this.readJson<ImageConfigFile>(manifest.config.digest))
            if (!runnable.some((item: Platform): boolean => MatchPlatform(platform, item))) continue
            await this.unpack(manifest, lease)
        }
    }

    /**
     * Push an image to a registry (as another reference): the manifest of the platform asked; without it, the manifests
     * of all the platforms and the index when the content store has all of them, the manifest of the machine's platform
     * otherwise
     * @param name
     * @param options
     */
    public async push(name: string, options: { reference?: string, platform?: Platform, registry?: RegistryOptions, progress?: (progress: TransferProgress) => void } = {}): Promise<void> {
        const image: Message | undefined = await this.get(name)
        if (!image) throw Object.assign(new Error(`The image ${name} does not exist`), {code: 'NOT_FOUND'})
        const parsed: ImageReference = ParseReference(options.reference ?? image.name)
        const registry: RegistryClient = new RegistryClient(parsed, options.registry)
        const tag: string = parsed.tag ?? parsed.digest!
        const pushManifest = async (descriptor: ContentDescriptor, reference: string): Promise<void> => {
            const data: Buffer = await this.client.readAll(descriptor.digest)
            const manifest: ImageManifest = JSON.parse(data.toString('utf8')) as ImageManifest
            for (const blob of [manifest.config, ...manifest.layers]) {
                await registry.pushBlob(blob, (): AsyncIterable<Uint8Array> => this.client.readContent(blob.digest))
                options.progress?.({digest: blob.digest, mediaType: blob.mediaType, current: blob.size, total: blob.size})
            }
            await registry.pushManifest(reference, descriptor.mediaType, data)
        }
        const target: ContentDescriptor = image.target
        if (!IsIndex(target.mediaType)) {
            if (options.platform) {
                const platform: Platform = ConfigPlatform(await this.readJson<ImageConfigFile>((await this.readJson<ImageManifest>(target.digest)).config.digest))
                if (!MatchPlatform(platform, options.platform)) throw Object.assign(new Error(`The image ${name} has no manifest of the platform ${FormatPlatform(options.platform)} to push (it is ${FormatPlatform(platform)})`), {code: 'PLATFORM'})
            }
            return await pushManifest(target, tag)
        }
        const index: ImageIndex = await this.readJson<ImageIndex>(target.digest)
        const local: ContentDescriptor[] = []
        for (const descriptor of index.manifests) if (await this.client.contentInfo(descriptor.digest)) local.push(descriptor)
        if (!options.platform && local.length === index.manifests.length) {
            for (const descriptor of local) await pushManifest(descriptor, descriptor.digest)
            return await registry.pushManifest(tag, target.mediaType, await this.client.readAll(target.digest))
        }
        const chosen: ContentDescriptor | undefined = await this.chooseManifest(index, options.platform ?? HostPlatform(), true)
        if (!chosen) throw Object.assign(new Error(`The image ${name} has no manifest of the platform ${FormatPlatform(options.platform ?? HostPlatform())} to push`), {code: 'PLATFORM'})
        await pushManifest(chosen, tag)
    }

    /**
     * Commit the changes of a snapshot (the one of a container) on its image: a layer of their diff, the configuration
     * of the image with its changes, a manifest of the platform, the image named (and unpacked)
     * @param options
     */
    public async commit(options: { image: string, platform: Platform, snapshotKey: string, name: string, changes?: ImageConfigChanges, comment?: string, author?: string }): Promise<string> {
        const base: ResolvedImage = await this.resolve(options.image, options.platform)
        const name: string = ImageName(options.name)
        const lease: string = await this.client.createLease()
        const view: string = `commit-${randomBytes(6).toString('hex')}`
        try {
            const chain: string[] = ChainIds(base.config.rootfs?.diff_ids ?? [])
            const left = chain.length ? await this.client.viewSnapshot(this.snapshotter, view, chain[chain.length - 1], lease) : []
            const right = await this.client.snapshotMounts(this.snapshotter, options.snapshotKey)
            const layer: ContentDescriptor = await this.client.diff(left, right, lease)
            const diffId: string | undefined = (await this.client.contentInfo(layer.digest))?.labels?.[Labels.uncompressed]
            if (!diffId) throw new Error(`The layer ${layer.digest} of the commit has no uncompressed digest`)
            const created: string = new Date().toISOString()
            const changes: ImageConfigChanges = options.changes ?? {}
            const config: ImageConfigFile & { history?: object[], author?: string } = {
                ...structuredClone(base.config),
                created: created,
                rootfs: {type: 'layers', diff_ids: [...base.config.rootfs?.diff_ids ?? [], diffId]}
            }
            const containerConfig = config.config ??= {}
            if (changes.cmd) containerConfig.Cmd = changes.cmd
            if (changes.entrypoint) containerConfig.Entrypoint = changes.entrypoint
            if (changes.env) {
                const env: Map<string, string> = new Map((containerConfig.Env ?? []).map((entry: string): [string, string] => [entry.split('=')[0], entry]))
                for (const entry of changes.env) env.set(entry.split('=')[0], entry)
                containerConfig.Env = [...env.values()]
            }
            if (changes.workingDir !== undefined) containerConfig.WorkingDir = changes.workingDir
            if (changes.user !== undefined) containerConfig.User = changes.user
            if (changes.labels) containerConfig.Labels = {...containerConfig.Labels ?? {}, ...changes.labels}
            if (changes.exposedPorts) containerConfig.ExposedPorts = {...containerConfig.ExposedPorts ?? {}, ...Object.fromEntries(changes.exposedPorts.map((port: string): [string, object] => [port.includes('/') ? port : `${port}/tcp`, {}]))}
            if (options.author) config.author = options.author
            config.history = [...config.history ?? [], {created: created, created_by: 'lakutata commit', ...options.comment ? {comment: options.comment} : {}, ...options.author ? {author: options.author} : {}}]
            const configData: Buffer = Buffer.from(JSON.stringify(config))
            const configDescriptor: ContentDescriptor = {mediaType: MediaTypes.OCI_CONFIG, digest: Digest(configData), size: configData.length}
            await this.client.writeContent(configDescriptor, configData, lease)
            const manifest: ImageManifest = {
                schemaVersion: 2,
                mediaType: MediaTypes.OCI_MANIFEST,
                config: configDescriptor,
                layers: [...base.manifest.layers.map((item: ContentDescriptor): ContentDescriptor => ({mediaType: item.mediaType, digest: item.digest, size: item.size})), {mediaType: layer.mediaType, digest: layer.digest, size: Number(layer.size)}]
            }
            const manifestData: Buffer = Buffer.from(JSON.stringify(manifest))
            const manifestDescriptor: ContentDescriptor = {mediaType: MediaTypes.OCI_MANIFEST, digest: Digest(manifestData), size: manifestData.length}
            await this.client.writeContent(manifestDescriptor, manifestData, lease, this.manifestLabels(manifest))
            await this.client.putImage({name: name, target: manifestDescriptor}, lease)
            await this.unpack(manifest, lease)
            return name
        } finally {
            await this.client.removeSnapshot(this.snapshotter, view)
            await this.client.deleteLease(lease)
        }
    }

    /**
     * Name an image again (a tag), its target the same
     * @param name
     * @param reference
     */
    public async tag(name: string, reference: string): Promise<string> {
        const image: Message | undefined = await this.get(name)
        if (!image) throw Object.assign(new Error(`The image ${name} does not exist`), {code: 'NOT_FOUND'})
        const target: string = ImageName(reference)
        await this.client.putImage({name: target, target: image.target, labels: image.labels})
        return target
    }

    /**
     * Remove an image (its content and its snapshots are collected by containerd once nothing references them)
     * @param name
     */
    public async remove(name: string): Promise<void> {
        const image: Message | undefined = await this.get(name)
        if (!image) throw Object.assign(new Error(`The image ${name} does not exist`), {code: 'NOT_FOUND'})
        await this.client.deleteImage(image.name, true)
    }

    /**
     * Import an archive of images: an OCI image layout (nerdctl save, docker save of Docker 25+), or an archive of
     * docker save; the images named by the archive (or by a name given, to an archive of one image), unpacked for the
     * platforms the machine runs
     * @param source a file, or its stream
     * @param options
     */
    public async import(source: string | NodeJS.ReadableStream, options: { name?: string, unpack?: boolean } = {}): Promise<string[]> {
        await mkdir(this.temporary, {recursive: true})
        const directory: string = await mkdtemp(path.join(this.temporary, 'lakutata-containerd-import-'))
        const lease: string = await this.client.createLease()
        try {
            await this.extract(typeof source === 'string' ? createReadStream(source) : source, directory)
            const file = (name: string): string => path.join(directory, ...name.split('/'))
            const blobFile = (digest: string): string => file(`blobs/${digest.replace(':', '/')}`)
            const exists = async (name: string): Promise<boolean> => !!(await stat(name).catch((): undefined => undefined))
            const names: string[] = []
            const named = (name: string | undefined): string | undefined => options.name ? ImageName(options.name) : name ? ImageName(name) : undefined
            const index: ImageIndex | undefined = await exists(file('index.json')) ? JSON.parse(await readFile(file('index.json'), 'utf8')) as ImageIndex : undefined
            const entries = await exists(file('manifest.json')) ? JSON.parse(await readFile(file('manifest.json'), 'utf8')) as { Config: string, RepoTags?: string[] | null, Layers: string[] }[] : []
            if (options.name) {
                //One name for one image (its tags: its entries of the same digest), checked before any import
                const images: number = new Set((index?.manifests ?? []).map((entry: ContentDescriptor): string => entry.digest)).size || new Set(entries.map((entry): string => entry.Config)).size
                if (images > 1) throw new Error(`The archive has ${images} images: the name ${options.name} can only be given to an archive of one image`)
            }
            if (index) {
                const blob = async (descriptor: ContentDescriptor): Promise<AsyncIterable<Uint8Array>> => createReadStream(blobFile(descriptor.digest))
                for (const entry of index.manifests) {
                    const name: string | undefined = named(entry.annotations?.['io.containerd.image.name'] ?? entry.annotations?.['org.opencontainers.image.ref.name'])
                    await this.writeTree(entry, blob, lease)
                    if (!name) continue
                    await this.client.putImage({name: name, target: {mediaType: entry.mediaType, digest: entry.digest, size: entry.size}}, lease)
                    if (!names.includes(name)) names.push(name)
                }
            }
            if (!names.length && entries.length) {
                //docker save: uncompressed layers (or compressed ones), the configuration, the tags
                for (const entry of entries) {
                    const configData: Buffer = await readFile(file(entry.Config))
                    const layers: ContentDescriptor[] = []
                    const layerFiles: Map<string, string> = new Map()
                    for (const layer of entry.Layers) {
                        const data: Buffer = await readFile(file(layer))
                        const digest: string = Digest(data)
                        const magic: string = data.subarray(0, 4).toString('hex')
                        const mediaType: string = magic.startsWith('1f8b') ? MediaTypes.DOCKER_LAYER_GZIP : magic === '28b52ffd' ? 'application/vnd.oci.image.layer.v1.tar+zstd' : MediaTypes.DOCKER_LAYER
                        layers.push({mediaType: mediaType, digest: digest, size: data.length})
                        layerFiles.set(digest, file(layer))
                    }
                    const manifest: ImageManifest = {schemaVersion: 2, mediaType: MediaTypes.DOCKER_MANIFEST, config: {mediaType: MediaTypes.DOCKER_CONFIG, digest: Digest(configData), size: configData.length}, layers: layers}
                    const manifestData: Buffer = Buffer.from(JSON.stringify(manifest))
                    const descriptor: ContentDescriptor = {mediaType: MediaTypes.DOCKER_MANIFEST, digest: Digest(manifestData), size: manifestData.length}
                    await this.writeImage(manifest, async (blob: ContentDescriptor): Promise<Uint8Array | AsyncIterable<Uint8Array>> => blob.digest === manifest.config.digest ? configData : createReadStream(layerFiles.get(blob.digest)!), lease, {})
                    await this.client.writeContent(descriptor, manifestData, lease, this.manifestLabels(manifest))
                    const tags: string[] = options.name ? [options.name] : entry.RepoTags?.length ? entry.RepoTags : [`import-${Date.now()}@${descriptor.digest}`]
                    for (const tag of tags) {
                        const name: string = ImageName(tag)
                        await this.client.putImage({name: name, target: descriptor}, lease)
                        names.push(name)
                    }
                }
            }
            if (!names.length) throw new Error('The archive has no image: an OCI image layout (index.json) or an archive of docker save (manifest.json)')
            if (options.unpack ?? true) for (const name of names) await this.unpackFor(name, lease)
            return names
        } finally {
            await this.client.deleteLease(lease)
            await rm(directory, {recursive: true, force: true})
        }
    }

    /**
     * Write a manifest or an index of an archive, and what it references (the manifests the archive has)
     * @param descriptor
     * @param blob
     * @param lease
     */
    protected async writeTree(descriptor: ContentDescriptor, blob: (descriptor: ContentDescriptor) => Promise<AsyncIterable<Uint8Array>>, lease: string): Promise<void> {
        const data: Buffer = await Collect(await blob(descriptor))
        if (IsIndex(descriptor.mediaType)) {
            const index: ImageIndex = JSON.parse(data.toString('utf8')) as ImageIndex
            const labels: Record<string, string> = {}
            for (let position = 0; position < index.manifests.length; position++) {
                const child: ContentDescriptor = index.manifests[position]
                try {
                    await this.writeTree(child, blob, lease)
                    labels[Labels.contentRef('m', position)] = child.digest
                } catch (error: unknown) {
                    //The archives of a platform have the index of all of them
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
                }
            }
            return await this.client.writeContent(descriptor, data, lease, labels)
        }
        const manifest: ImageManifest = JSON.parse(data.toString('utf8')) as ImageManifest
        await this.writeImage(manifest, blob, lease, {})
        await this.client.writeContent(descriptor, data, lease, this.manifestLabels(manifest))
    }

    /**
     * Extract an archive into a directory
     * @param source
     * @param directory
     */
    protected async extract(source: NodeJS.ReadableStream, directory: string): Promise<void> {
        const extractor = tarExtract()
        extractor.on('entry', (header: Header, entry: unknown, next: (error?: Error | null) => void): void => {
            const stream: Readable = entry as Readable
            const target: string = path.resolve(directory, header.name)
            if (header.type !== 'file' || !target.startsWith(directory + path.sep)) {
                stream.on('end', (): void => next()).resume()
                return
            }
            mkdir(path.dirname(target), {recursive: true})
                .then((): Promise<void> => pipeline(stream, createWriteStream(target)))
                .then((): void => next(), (error: Error): void => next(error))
        })
        await pipeline(source, extractor)
    }

    /**
     * Export images into an archive: an OCI image layout (named by io.containerd.image.name), with the manifest.json of
     * docker load (the manifest of the platform of the machine, or the first one)
     * @param names
     * @param destination a file, or its stream
     */
    public async export(names: string[], destination: string | NodeJS.WritableStream): Promise<void> {
        const blobs: Map<string, ContentDescriptor> = new Map()
        const entries: ContentDescriptor[] = []
        const dockerManifests: { Config: string, RepoTags: string[], Layers: string[] }[] = []
        const blobPath = (digest: string): string => `blobs/${digest.replace(':', '/')}`
        for (const name of names) {
            const image: Message | undefined = await this.get(name)
            if (!image) throw Object.assign(new Error(`The image ${name} does not exist`), {code: 'NOT_FOUND'})
            const target: ContentDescriptor = {mediaType: image.target.mediaType, digest: image.target.digest, size: Number(image.target.size)}
            const reference: ImageReference | undefined = (() => {
                try {
                    return ParseReference(image.name)
                } catch {
                    return undefined
                }
            })()
            entries.push({...target, annotations: {'io.containerd.image.name': image.name, ...reference?.tag ? {'org.opencontainers.image.ref.name': reference.tag} : {}}})
            blobs.set(target.digest, target)
            const manifests: ContentDescriptor[] = IsIndex(target.mediaType) ? (await this.readJson<ImageIndex>(target.digest)).manifests : [target]
            let first: ImageManifest | undefined
            for (const descriptor of manifests) {
                if (!IsManifest(descriptor.mediaType) || !(await this.client.contentInfo(descriptor.digest))) continue
                const manifest: ImageManifest = await this.readJson<ImageManifest>(descriptor.digest)
                blobs.set(descriptor.digest, descriptor)
                for (const blob of [manifest.config, ...manifest.layers]) blobs.set(blob.digest, blob)
                const config: ImageConfigFile = await this.readJson<ImageConfigFile>(manifest.config.digest)
                if (!first || PlatformRank(ConfigPlatform(config), HostPlatform()) !== undefined) first = manifest
            }
            if (first && reference) {
                const short: string = reference.registry === 'docker.io' ? reference.repository.replace(/^library\//, '') : `${reference.registry}/${reference.repository}`
                dockerManifests.push({Config: blobPath(first.config.digest), RepoTags: reference.tag ? [`${short}:${reference.tag}`] : [], Layers: first.layers.map((layer: ContentDescriptor): string => blobPath(layer.digest))})
            }
        }
        const archive: Pack = tarPack()
        const output: Promise<void> = pipeline(archive, typeof destination === 'string' ? createWriteStream(destination) : destination)
        const entry = (name: string, data: Buffer): Promise<void> => new Promise((resolve: () => void, reject: (error: Error) => void): void => void archive.entry({name: name, size: data.length, mode: 0o644}, data, (error?: Error | null): void => error ? reject(error) : resolve()))
        try {
            await entry('oci-layout', Buffer.from(JSON.stringify({imageLayoutVersion: '1.0.0'})))
            for (const blob of blobs.values()) {
                const size: number = Number((await this.client.contentInfo(blob.digest))?.size ?? blob.size)
                await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                    const writer = archive.entry({name: blobPath(blob.digest), size: size, mode: 0o644}, (error?: Error | null): void => error ? reject(error) : resolve())
                    pipeline(this.client.readContent(blob.digest), writer).catch(reject)
                })
            }
            await entry('index.json', Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: MediaTypes.OCI_INDEX, manifests: entries})))
            await entry('manifest.json', Buffer.from(JSON.stringify(dockerManifests)))
            archive.finalize()
        } catch (error: unknown) {
            archive.destroy(error as Error)
        }
        await output
    }
}

