import {createHash} from 'node:crypto'
import type {ContentDescriptor} from './ContainerdClient.js'
import type {ImageReference} from './Reference.js'

/**
 * The credentials of a registry: a user and its password (or its token), or an identity token
 */
export type RegistryCredentials = {
    username?: string
    password?: string
    identityToken?: string
}

/**
 * The options of the registries: their credentials by their hosts (docker.io, registry.example.com:5000), the ones
 * served over HTTP
 */
export type RegistryOptions = {
    credentials?: Record<string, RegistryCredentials>
    insecure?: string[]
    signal?: AbortSignal
}

/**
 * The media types of the manifests and of the indexes (OCI, Docker)
 */
export const MediaTypes = {
    OCI_INDEX: 'application/vnd.oci.image.index.v1+json',
    OCI_MANIFEST: 'application/vnd.oci.image.manifest.v1+json',
    OCI_CONFIG: 'application/vnd.oci.image.config.v1+json',
    OCI_LAYER: 'application/vnd.oci.image.layer.v1.tar',
    OCI_LAYER_GZIP: 'application/vnd.oci.image.layer.v1.tar+gzip',
    DOCKER_LIST: 'application/vnd.docker.distribution.manifest.list.v2+json',
    DOCKER_MANIFEST: 'application/vnd.docker.distribution.manifest.v2+json',
    DOCKER_CONFIG: 'application/vnd.docker.container.image.v1+json',
    DOCKER_LAYER: 'application/vnd.docker.image.rootfs.diff.tar',
    DOCKER_LAYER_GZIP: 'application/vnd.docker.image.rootfs.diff.tar.gzip'
} as const

/**
 * Whether a media type is the one of an index (of the manifests of the platforms)
 * @param mediaType
 */
export function IsIndex(mediaType: string): boolean {
    return mediaType === MediaTypes.OCI_INDEX || mediaType === MediaTypes.DOCKER_LIST
}

/**
 * Whether a media type is the one of a manifest (of an image of a platform)
 * @param mediaType
 */
export function IsManifest(mediaType: string): boolean {
    return mediaType === MediaTypes.OCI_MANIFEST || mediaType === MediaTypes.DOCKER_MANIFEST
}

/**
 * The digest of bytes
 * @param data
 */
export function Digest(data: Uint8Array): string {
    return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

/**
 * The parameters of a challenge of WWW-Authenticate (Bearer realm="…",service="…",scope="…")
 * @param header
 */
function Challenge(header: string): { scheme: string, params: Record<string, string> } {
    const space: number = header.indexOf(' ')
    const scheme: string = (space < 0 ? header : header.slice(0, space)).toLowerCase()
    const params: Record<string, string> = {}
    for (const match of header.slice(space + 1).matchAll(/(\w+)="([^"]*)"/g)) params[match[1].toLowerCase()] = match[2]
    return {scheme: scheme, params: params}
}

/**
 * An error of a registry
 */
export class RegistryError extends Error {
    constructor(message: string, public readonly status: number) {
        super(message)
        this.name = 'RegistryError'
    }
}

/**
 * The client of a repository of a registry (the distribution API of OCI): its manifests and its blobs, the tokens of
 * its authentication requested as its challenges ask (Bearer, Basic), with its credentials or anonymously
 */
export class RegistryClient {

    readonly #tokens: Map<string, string> = new Map()

    constructor(protected readonly reference: ImageReference, protected readonly options: RegistryOptions = {}) {
    }

    /**
     * The credentials of the registry (by its name or by its host)
     */
    protected credentials(): RegistryCredentials | undefined {
        const all: Record<string, RegistryCredentials> = this.options.credentials ?? {}
        return all[this.reference.registry] ?? all[this.reference.host] ?? (this.reference.registry === 'docker.io' ? all['https://index.docker.io/v1/'] ?? all['index.docker.io'] : undefined)
    }

    /**
     * The base URL of the repository
     */
    protected base(): string {
        const insecure: boolean = (this.options.insecure ?? []).some((host: string): boolean => host === this.reference.registry || host === this.reference.host)
        return `${insecure ? 'http' : 'https'}://${this.reference.host}/v2/${this.reference.repository}`
    }

    /**
     * The authorization of a challenge: a token of its realm (with the credentials when there are), or the credentials
     * @param challenge
     * @param scope
     */
    protected async authorize(challenge: string, scope: string): Promise<string | undefined> {
        const {scheme, params} = Challenge(challenge)
        const credentials: RegistryCredentials | undefined = this.credentials()
        const basic: string | undefined = credentials?.username !== undefined ? `Basic ${Buffer.from(`${credentials.username}:${credentials.password ?? ''}`).toString('base64')}` : undefined
        if (scheme === 'basic') return basic
        if (scheme !== 'bearer' || !params.realm) return undefined
        const url: URL = new URL(params.realm)
        if (params.service) url.searchParams.set('service', params.service)
        url.searchParams.set('scope', scope)
        let response: Response
        if (credentials?.identityToken) {
            //The refresh token of the registries (Docker Hub, ECR…): OAuth2
            response = await fetch(url.origin + url.pathname, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: credentials.identityToken, service: params.service ?? '', scope: scope, client_id: 'lakutata'}),
                signal: this.options.signal
            })
        } else {
            response = await fetch(url, {headers: basic ? {Authorization: basic} : {}, signal: this.options.signal})
        }
        if (!response.ok) throw new RegistryError(`The registry ${this.reference.registry} refuses the authentication (${response.status}): ${(await response.text()).slice(0, 200)}`, response.status)
        const body = await response.json() as { token?: string, access_token?: string }
        const token: string | undefined = body.token ?? body.access_token
        return token ? `Bearer ${token}` : undefined
    }

    /**
     * A request to the repository, authenticated as its registry asks
     * @param path the path under the repository (/manifests/latest), or a URL (the location of an upload)
     * @param init
     * @param actions the actions of its scope: pull, or push and pull
     */
    public async request(path: string, init: RequestInit = {}, actions: string = 'pull'): Promise<Response> {
        const scope: string = `repository:${this.reference.repository}:${actions}`
        const url: string = /^https?:\/\//.test(path) ? path : `${this.base()}${path}`
        const send = (authorization?: string): Promise<Response> => fetch(url, {
            ...init,
            headers: {...init.headers as Record<string, string>, ...authorization ? {Authorization: authorization} : {}},
            signal: this.options.signal,
            //The bodies of the streams (the blobs pushed)
            ...init.body && typeof (init.body as ReadableStream).getReader === 'function' ? {duplex: 'half'} : {}
        } as RequestInit)
        let response: Response = await send(this.#tokens.get(scope))
        if (response.status === 401) {
            const challenge: string | null = response.headers.get('www-authenticate')
            await response.body?.cancel()
            const authorization: string | undefined = challenge ? await this.authorize(challenge, scope) : undefined
            if (!authorization) throw new RegistryError(`The registry ${this.reference.registry} refuses the request of ${this.reference.repository} without authentication: give its credentials`, 401)
            this.#tokens.set(scope, authorization)
            response = await send(authorization)
        }
        return response
    }

    /**
     * Fail on an error response
     * @param response
     * @param what
     */
    protected async check(response: Response, what: string): Promise<Response> {
        if (response.ok) return response
        const text: string = await response.text().catch((): string => '')
        let message: string = text.slice(0, 300)
        try {
            const errors = (JSON.parse(text) as { errors?: { code: string, message: string }[] }).errors
            if (errors?.length) message = errors.map(({code, message}): string => `${code}: ${message}`).join(', ')
        } catch {
            //Not JSON
        }
        throw new RegistryError(`${what} of ${this.reference.registry}/${this.reference.repository} failed (${response.status}): ${message}`, response.status)
    }

    /**
     * Resolve a reference (a tag or a digest): the descriptor of its manifest or of its index, and its bytes
     * @param reference
     */
    public async resolve(reference: string): Promise<{ descriptor: ContentDescriptor, data: Buffer }> {
        const accept: string = [MediaTypes.OCI_INDEX, MediaTypes.DOCKER_LIST, MediaTypes.OCI_MANIFEST, MediaTypes.DOCKER_MANIFEST].join(', ')
        const response: Response = await this.check(await this.request(`/manifests/${reference}`, {headers: {Accept: accept}}), `The manifest ${reference}`)
        const data: Buffer = Buffer.from(await response.arrayBuffer())
        const digest: string = Digest(data)
        if (reference.startsWith('sha256:') && reference !== digest) throw new RegistryError(`The manifest ${reference} has the digest ${digest}`, 0)
        const mediaType: string = response.headers.get('content-type')?.split(';')[0].trim() || (JSON.parse(data.toString('utf8')) as { mediaType?: string }).mediaType || MediaTypes.OCI_MANIFEST
        return {descriptor: {mediaType: mediaType, digest: digest, size: data.length}, data: data}
    }

    /**
     * Fetch a manifest (or an index) by its descriptor, checked by its digest
     * @param descriptor
     */
    public async fetchManifest(descriptor: ContentDescriptor): Promise<Buffer> {
        const response: Response = await this.check(await this.request(`/manifests/${descriptor.digest}`, {headers: {Accept: descriptor.mediaType}}), `The manifest ${descriptor.digest}`)
        const data: Buffer = Buffer.from(await response.arrayBuffer())
        if (Digest(data) !== descriptor.digest) throw new RegistryError(`The manifest ${descriptor.digest} has the digest ${Digest(data)}`, 0)
        return data
    }

    /**
     * Fetch a blob: its bytes streamed (the redirections of the registry to its storage followed)
     * @param descriptor
     */
    public async fetchBlob(descriptor: ContentDescriptor): Promise<AsyncIterable<Uint8Array>> {
        const response: Response = await this.check(await this.request(`/blobs/${descriptor.digest}`), `The blob ${descriptor.digest}`)
        if (!response.body) throw new RegistryError(`The blob ${descriptor.digest} has no body`, response.status)
        return response.body as unknown as AsyncIterable<Uint8Array>
    }

    /**
     * Whether the repository has a blob
     * @param digest
     */
    public async hasBlob(digest: string): Promise<boolean> {
        const response: Response = await this.request(`/blobs/${digest}`, {method: 'HEAD'}, 'push,pull')
        await response.body?.cancel()
        return response.ok
    }

    /**
     * Push a blob, unless the repository has it: uploaded at once
     * @param descriptor
     * @param data its bytes, or the function giving their stream
     */
    public async pushBlob(descriptor: ContentDescriptor, data: Uint8Array | (() => AsyncIterable<Uint8Array>)): Promise<void> {
        if (await this.hasBlob(descriptor.digest)) return
        const started: Response = await this.check(await this.request('/blobs/uploads/', {method: 'POST', headers: {'Content-Length': '0'}}, 'push,pull'), `The upload of ${descriptor.digest}`)
        await started.body?.cancel()
        const location: string | null = started.headers.get('location')
        if (!location) throw new RegistryError(`The upload of ${descriptor.digest} has no location`, started.status)
        const url: URL = new URL(location, this.base())
        url.searchParams.set('digest', descriptor.digest)
        const body: RequestInit['body'] = data instanceof Uint8Array ? data : ReadableStream.from(data() as AsyncIterable<Uint8Array>) as unknown as RequestInit['body']
        const put: Response = await this.check(await this.request(url.toString(), {method: 'PUT', headers: {'Content-Type': 'application/octet-stream', 'Content-Length': String(descriptor.size)}, body: body}, 'push,pull'), `The upload of ${descriptor.digest}`)
        await put.body?.cancel()
    }

    /**
     * Push a manifest (or an index), by a tag or by its digest
     * @param reference
     * @param mediaType
     * @param data
     */
    public async pushManifest(reference: string, mediaType: string, data: Uint8Array): Promise<void> {
        const response: Response = await this.check(await this.request(`/manifests/${reference}`, {method: 'PUT', headers: {'Content-Type': mediaType}, body: data}, 'push,pull'), `The push of the manifest ${reference}`)
        await response.body?.cancel()
    }
}
