import {randomBytes} from 'node:crypto'
import {createWriteStream, type BigIntStats} from 'node:fs'
import {lstat, open, readdir, readlink} from 'node:fs/promises'
import path from 'node:path'
import {Duplex, type Writable} from 'node:stream'
import {finished} from 'node:stream/promises'
import {GRPCConnection, GRPCError, GRPCServer, GRPCServerCall, GRPCStatus, type BidiStream, type CallOptions} from './GRPC.js'
import type {Message} from './Protobuf.js'
import * as B from './BuildKitMessages.js'
import {DockerIgnore} from './DockerIgnore.js'
import {FormatPlatform, NormalizePlatform, type Platform} from './Platforms.js'
import {FetchRegistryToken, type RegistryCredentials} from './Registry.js'
import {TimestampDate} from './ContainerdClient.js'

/**
 * The service of BuildKit
 */
const CONTROL: string = '/moby.buildkit.v1.Control'

/**
 * The size of the chunks of the files sent
 */
const CHUNK_SIZE: number = 32 * 1024

/**
 * The mode of a file as Go writes it (os.FileMode), the one of the stats of fsutil
 * @param stats
 */
export function GoFileMode(stats: BigIntStats): number {
    let mode: number = Number(stats.mode & 0o777n)
    if (stats.isDirectory()) mode |= 0x80000000
    else if (stats.isSymbolicLink()) mode |= 0x08000000
    else if (stats.isFIFO()) mode |= 0x02000000
    else if (stats.isSocket()) mode |= 0x01000000
    else if (stats.isCharacterDevice()) mode |= 0x04000000 | 0x00200000
    else if (stats.isBlockDevice()) mode |= 0x04000000
    if (stats.mode & 0o4000n) mode |= 0x00800000
    if (stats.mode & 0o2000n) mode |= 0x00400000
    if (stats.mode & 0o1000n) mode |= 0x00100000
    return mode >>> 0
}

/**
 * The expression of a pattern of the paths of fsutil (filepath.Match, ** for any directories)
 * @param pattern
 */
export function PatternExpression(pattern: string): RegExp {
    const normalized: string = path.posix.normalize(pattern.replace(/\\/g, '/')).replace(/^\/+/, '').replace(/\/+$/, '')
    let expression: string = ''
    for (let index = 0; index < normalized.length; index++) {
        const character: string = normalized[index]
        if (character === '*') {
            if (normalized[index + 1] === '*') {
                //**/ any directories, ** anything
                if (normalized[index + 2] === '/') {
                    expression += '(?:.*/)?'
                    index += 2
                } else {
                    expression += '.*'
                    index++
                }
            } else {
                expression += '[^/]*'
            }
        } else if (character === '?') {
            expression += '[^/]'
        } else if (character === '[') {
            const end: number = normalized.indexOf(']', index + 1)
            if (end < 0) {
                expression += '\\['
            } else {
                expression += `[${normalized.slice(index + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
                index = end
            }
        } else {
            expression += character.replace(/[.+^${}()|\\]/g, '\\$&')
        }
    }
    return new RegExp(`^${expression}$`)
}

/**
 * An entry of a directory sent: its path (relative, "/" separated), its stat of fsutil
 */
export type SyncEntry = {
    path: string
    absolute: string
    stat: Message
    file: boolean
}

/**
 * The filters of a directory sent to BuildKit: its patterns included (the Dockerfile), excluded (its .dockerignore), its
 * paths whose symbolic links are followed
 */
export type SyncFilter = {
    include?: string[]
    exclude?: string[]
    followPaths?: string[]
}

/**
 * The entries of a directory sent to BuildKit, in the order fsutil walks them (lexical, the directories before their
 * content); the parents of the paths included are included
 * @param root
 * @param filter
 */
export async function WalkDirectory(root: string, filter: SyncFilter = {}): Promise<SyncEntry[]> {
    const include: string[] = [...filter.include ?? []]
    //The targets of the symbolic links followed (the Dockerfile linked)
    for (const follow of filter.followPaths ?? []) {
        try {
            const absolute: string = path.join(root, follow)
            if ((await lstat(absolute)).isSymbolicLink()) {
                const target: string = await readlink(absolute)
                const relative: string = path.posix.normalize(path.posix.join(path.posix.dirname(follow), target)).replace(/^\/+/, '')
                if (!relative.startsWith('..')) include.push(relative)
            }
        } catch {
            //Not there
        }
    }
    const includes: RegExp[] = include.map(PatternExpression)
    const literals: string[] = include.map((pattern: string): string => path.posix.normalize(pattern).replace(/^\/+/, '').split(/[*?[]/)[0])
    const ignore: DockerIgnore = new DockerIgnore((filter.exclude ?? []).join('\n'))
    const included = (relative: string, directory: boolean): 'yes' | 'parent' | 'no' => {
        if (!includes.length) return 'yes'
        const parts: string[] = relative.split('/')
        for (let length = 1; length <= parts.length; length++) {
            const prefix: string = parts.slice(0, length).join('/')
            if (includes.some((expression: RegExp): boolean => expression.test(prefix))) return 'yes'
        }
        //A parent of a path included
        if (directory && literals.some((literal: string): boolean => literal.startsWith(`${relative}/`) || (literal === '' && includes.length > 0))) return 'parent'
        return 'no'
    }
    const entries: SyncEntry[] = []
    const walk = async (relativeDirectory: string): Promise<void> => {
        const names: string[] = (await readdir(path.join(root, relativeDirectory))).sort((a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0)
        for (const name of names) {
            const relative: string = relativeDirectory ? `${relativeDirectory}/${name}` : name
            const absolute: string = path.join(root, relative)
            const stats: BigIntStats = await lstat(absolute, {bigint: true})
            const directory: boolean = stats.isDirectory()
            if (ignore.ignores(relative)) continue
            const inclusion = included(relative, directory)
            if (inclusion === 'no') continue
            //The sockets are not sent
            if (stats.isSocket()) continue
            const stat: Message = {
                path: relative,
                mode: GoFileMode(stats),
                uid: Number(stats.uid),
                gid: Number(stats.gid),
                modTime: stats.mtimeNs
            }
            if (!directory) stat.size = Number(stats.size)
            if (stats.isSymbolicLink()) stat.linkname = await readlink(absolute)
            if (stats.isCharacterDevice() || stats.isBlockDevice()) {
                stat.devmajor = Number(((stats.rdev >> 8n) & 0xfffn) | ((stats.rdev >> 32n) & ~0xfffn))
                stat.devminor = Number((stats.rdev & 0xffn) | ((stats.rdev >> 12n) & ~0xffn))
            }
            entries.push({path: relative, absolute: absolute, stat: stat, file: stats.isFile()})
            if (directory) {
                const before: number = entries.length
                await walk(relative)
                //A parent without any path included under it
                if (inclusion === 'parent' && entries.length === before) entries.pop()
            }
        }
    }
    await walk('')
    return entries
}

/**
 * Send a directory as fsutil sends it (FileSync.DiffCopy): its stats, then the files the receiver requests, until it
 * finishes
 * @param call
 * @param root
 */
export async function SendDirectory(call: GRPCServerCall, root: string): Promise<void> {
    const entries: SyncEntry[] = await WalkDirectory(root, {
        include: call.metadata('include-patterns'),
        exclude: call.metadata('exclude-patterns'),
        followPaths: call.metadata('followpaths')
    })
    let pending: Promise<void> = Promise.resolve()
    const sendFile = async (id: number): Promise<void> => {
        const entry: SyncEntry | undefined = entries[id]
        if (!entry) throw new GRPCError(GRPCStatus.INVALID_ARGUMENT, `The file ${id} is not sent`, call.path)
        if (entry.file) {
            const handle = await open(entry.absolute, 'r')
            try {
                const buffer: Buffer = Buffer.alloc(CHUNK_SIZE)
                for (; ;) {
                    const {bytesRead} = await handle.read(buffer, 0, CHUNK_SIZE, null)
                    if (!bytesRead) break
                    await call.send(B.Packet, {type: B.PacketType.DATA, id: id, data: Buffer.from(buffer.subarray(0, bytesRead))})
                }
            } finally {
                await handle.close()
            }
        }
        await call.send(B.Packet, {type: B.PacketType.DATA, id: id})
    }
    const receiving: Promise<void> = (async (): Promise<void> => {
        for await (const packet of call.requests(B.Packet)) {
            switch (packet.type ?? B.PacketType.STAT) {
                case B.PacketType.REQ: {
                    const id: number = packet.id ?? 0
                    pending = pending.then((): Promise<void> => sendFile(id))
                    break
                }
                case B.PacketType.FIN:
                    await pending
                    await call.send(B.Packet, {type: B.PacketType.FIN})
                    return
                case B.PacketType.ERR:
                    throw new GRPCError(GRPCStatus.ABORTED, `The receiver of ${root} failed: ${Buffer.from(packet.data ?? []).toString()}`, call.path)
            }
        }
    })()
    receiving.catch((): undefined => undefined)
    for (const entry of entries) await call.send(B.Packet, {type: B.PacketType.STAT, stat: entry.stat})
    await call.send(B.Packet, {type: B.PacketType.STAT})
    await receiving
    await pending
}

/**
 * The options of a session of BuildKit
 */
export type BuildKitSessionOptions = {
    /**
     * Its name (the one of the build)
     */
    name: string
    /**
     * The key of the files of its directories cached by BuildKit (the one of buildx: the path of the context)
     */
    sharedKey: string
    /**
     * The directories it sends (context, dockerfile)
     */
    directories: Record<string, string>
    /**
     * The credentials of a registry (registry-1.docker.io, registry.example.com:5000)
     */
    credentials?: (host: string) => RegistryCredentials | undefined
    /**
     * Where the results exported to the client are written (the archive of the oci exporter)
     */
    output?: () => Writable
}

/**
 * A session of BuildKit: a connection of HTTP/2 in the stream of Control.Session, where the daemon calls its methods
 * (the files of the directories of the build, the results exported, the credentials of the registries, its health)
 */
export class BuildKitSession {

    public readonly id: string = randomBytes(16).toString('hex')

    readonly #server: GRPCServer = new GRPCServer()

    #stream: BidiStream | undefined

    constructor(protected readonly options: BuildKitSessionOptions) {
        this.#server.method('/grpc.health.v1.Health/Check', async (call: GRPCServerCall): Promise<void> => {
            await call.request(B.HealthCheckRequest)
            await call.send(B.HealthCheckResponse, {status: 1})
        })
        this.#server.method('/moby.filesync.v1.FileSync/DiffCopy', async (call: GRPCServerCall): Promise<void> => {
            const name: string = call.metadata('dir-name')[0] ?? ''
            const directory: string | undefined = this.options.directories[name]
            if (!directory) throw new GRPCError(GRPCStatus.NOT_FOUND, `The session has no directory ${name}`, call.path)
            await SendDirectory(call, directory)
        })
        if (this.options.output) {
            this.#server.method('/moby.filesync.v1.FileSend/DiffCopy', async (call: GRPCServerCall): Promise<void> => {
                const output: Writable = this.options.output!()
                try {
                    for await (const message of call.requests(B.BytesMessage)) {
                        if (!message.data?.length) continue
                        if (!output.write(Buffer.from(message.data))) await new Promise<void>((resolve: () => void): void => void output.once('drain', resolve))
                    }
                    output.end()
                    await finished(output)
                } catch (error: unknown) {
                    output.destroy(error as Error)
                    throw error
                }
            })
        }
        this.#server.method('/moby.filesync.v1.Auth/Credentials', async (call: GRPCServerCall): Promise<void> => {
            const host: string = (await call.request(B.CredentialsRequest)).host ?? ''
            const credentials: RegistryCredentials | undefined = this.credentials(host)
            await call.send(B.CredentialsResponse, credentials?.identityToken ? {secret: credentials.identityToken} : {username: credentials?.username ?? '', secret: credentials?.password ?? ''})
        })
        this.#server.method('/moby.filesync.v1.Auth/FetchToken', async (call: GRPCServerCall): Promise<void> => {
            const request: Message = await call.request(B.FetchTokenRequest)
            const token = await FetchRegistryToken({realm: request.realm, service: request.service, scopes: request.scopes ?? []}, this.credentials(request.host ?? ''))
            if (!token) throw new GRPCError(GRPCStatus.UNAUTHENTICATED, `The registry ${request.host} gives no token`, call.path)
            await call.send(B.FetchTokenResponse, {token: token.token, expiresIn: token.expiresIn ?? 0, issuedAt: token.issuedAt ?? 0})
        })
        for (const method of ['GetTokenAuthority', 'VerifyTokenAuthority']) {
            this.#server.method(`/moby.filesync.v1.Auth/${method}`, async (call: GRPCServerCall): Promise<void> => {
                throw new GRPCError(GRPCStatus.UNIMPLEMENTED, `${method} is not implemented`, call.path)
            })
        }
    }

    /**
     * The credentials of a host of a registry (Docker Hub by its names)
     * @param host
     * @protected
     */
    protected credentials(host: string): RegistryCredentials | undefined {
        const registry: string = ['registry-1.docker.io', 'index.docker.io', 'registry.hub.docker.com'].includes(host) ? 'docker.io' : host
        return this.options.credentials?.(registry) ?? (registry === host ? undefined : this.options.credentials?.(host))
    }

    /**
     * Open the session: the stream of Control.Session, the methods of the session exposed by its headers
     * @param connection
     * @param signal
     */
    public start(connection: GRPCConnection, signal?: AbortSignal): void {
        const options: CallOptions = {
            metadata: {
                'x-docker-expose-session-uuid': this.id,
                'x-docker-expose-session-name': this.options.name,
                'x-docker-expose-session-sharedkey': this.options.sharedKey,
                'x-docker-expose-session-grpc-method': this.#server.methods
            },
            signal: signal
        }
        const stream: BidiStream = connection.bidi(`${CONTROL}/Session`, B.BytesMessage, B.BytesMessage, options)
        this.#stream = stream
        const socket: Duplex = new Duplex({
            write: (chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void => {
                stream.send({data: chunk}).then((): void => callback(), (error: Error): void => callback(error))
            },
            final: (callback: (error?: Error | null) => void): void => {
                stream.end()
                callback()
            },
            read: (): void => undefined
        })
        ;(async (): Promise<void> => {
            for await (const message of stream.responses) if (message.data?.length) socket.push(Buffer.from(message.data))
            socket.push(null)
        })().catch((): void => {
            socket.push(null)
        })
        this.#server.serve(socket)
    }

    /**
     * Close the session
     */
    public close(): void {
        this.#stream?.end()
        this.#stream?.cancel()
    }
}

/**
 * The lines of the progress of a build, as "docker build --progress=plain" shows them: the steps are numbered in their
 * order ("#3 [2/2] RUN npm ci"), with their output, and whether they are cached, done ("#3 DONE 1.2s") or failed
 */
export class BuildKitProgress {

    readonly #steps: Map<string, { number: number, started: boolean, ended: boolean }> = new Map()

    readonly #pending: Map<string, string> = new Map()

    protected step(digest: string): { number: number, started: boolean, ended: boolean } {
        let step = this.#steps.get(digest)
        if (!step) this.#steps.set(digest, step = {number: this.#steps.size + 1, started: false, ended: false})
        return step
    }

    /**
     * The lines of a status of the build
     * @param status
     */
    public lines(status: Message): string[] {
        const lines: string[] = []
        for (const vertex of status.vertexes ?? []) {
            const step = this.step(vertex.digest)
            const started: Date | undefined = TimestampDate(vertex.started)
            const completed: Date | undefined = TimestampDate(vertex.completed)
            if (!step.started && (started || vertex.cached)) {
                step.started = true
                lines.push(`#${step.number} ${vertex.name}`)
            }
            if (step.ended) continue
            if (vertex.cached) {
                step.ended = true
                lines.push(`#${step.number} CACHED`)
            } else if (vertex.error) {
                step.ended = true
                lines.push(...this.flush(vertex.digest), `#${step.number} ERROR: ${vertex.error}`)
            } else if (completed) {
                step.ended = true
                const seconds: string = started ? ` ${((completed.getTime() - started.getTime()) / 1000).toFixed(1)}s` : ''
                lines.push(...this.flush(vertex.digest), `#${step.number} DONE${seconds}`)
            }
        }
        for (const log of status.logs ?? []) {
            const output: string = (this.#pending.get(log.vertex) ?? '') + Buffer.from(log.msg ?? []).toString()
            const parts: string[] = output.split(/\r?\n/)
            this.#pending.set(log.vertex, parts.pop()!)
            const number: number = this.step(log.vertex).number
            parts.forEach((part: string): unknown => lines.push(`#${number} ${part}`))
        }
        for (const warning of status.warnings ?? []) lines.push(`#${this.step(warning.vertex).number} WARN: ${Buffer.from(warning.short ?? []).toString()}`)
        return lines
    }

    protected flush(digest: string): string[] {
        const pending: string | undefined = this.#pending.get(digest)
        this.#pending.delete(digest)
        return pending ? [`#${this.step(digest).number} ${pending}`] : []
    }
}

/**
 * The options of a build
 */
export type BuildKitBuildOptions = {
    /**
     * The directory of the context
     */
    context: string
    /**
     * The Dockerfile (relative to the context, or absolute): Dockerfile of the context by default
     */
    dockerfile?: string
    target?: string
    buildArgs?: Record<string, string>
    labels?: Record<string, string>
    /**
     * The platforms built: the one of the workers of BuildKit by default
     */
    platforms?: Platform[]
    noCache?: boolean
    /**
     * Pull the base images again (their tags resolved by their registries)
     */
    pull?: boolean
    /**
     * The name of the image (in the archive)
     */
    name: string
    /**
     * The archive of the image (OCI image layout) written
     */
    output: string
    credentials?: (registry: string) => RegistryCredentials | undefined
    /**
     * The lines of its progress
     */
    progress?: (line: string) => void
    signal?: AbortSignal
}

/**
 * Build an image with BuildKit (its Dockerfile frontend): its context and its Dockerfile sent by the session, the image
 * exported to the client as an archive (the oci exporter); the daemon is local or remote, of any worker
 * @param connection
 * @param options
 */
export async function BuildKitBuild(connection: GRPCConnection, options: BuildKitBuildOptions): Promise<Record<string, string>> {
    const context: string = path.resolve(options.context)
    const dockerfile: string = path.resolve(context, options.dockerfile ?? 'Dockerfile')
    const session: BuildKitSession = new BuildKitSession({
        name: options.name,
        sharedKey: context,
        directories: {context: context, dockerfile: path.dirname(dockerfile)},
        credentials: options.credentials,
        output: (): Writable => createWriteStream(options.output)
    })
    const abort: AbortController = new AbortController()
    const signal: AbortSignal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
    session.start(connection, signal)
    const ref: string = randomBytes(16).toString('hex')
    const progress: BuildKitProgress = new BuildKitProgress()
    const status: Promise<void> = (async (): Promise<void> => {
        if (!options.progress) return
        for await (const response of connection.serverStream(`${CONTROL}/Status`, B.StatusRequest, {ref: ref}, B.StatusResponse, {signal: signal})) {
            for (const line of progress.lines(response)) options.progress(line)
        }
    })().catch((): void => undefined)
    const frontendAttrs: Record<string, string> = {filename: path.basename(dockerfile)}
    if (options.target) frontendAttrs.target = options.target
    for (const [key, value] of Object.entries(options.buildArgs ?? {})) frontendAttrs[`build-arg:${key}`] = value
    for (const [key, value] of Object.entries(options.labels ?? {})) frontendAttrs[`label:${key}`] = value
    if (options.platforms?.length) frontendAttrs.platform = options.platforms.map((platform: Platform): string => FormatPlatform(NormalizePlatform(platform))).join(',')
    if (options.noCache) frontendAttrs['no-cache'] = ''
    if (options.pull) frontendAttrs['image-resolve-mode'] = 'pull'
    try {
        const response: Message = await connection.unary(`${CONTROL}/Solve`, B.SolveRequest, {
            ref: ref,
            session: session.id,
            frontend: 'dockerfile.v0',
            frontendAttrs: frontendAttrs,
            exporter: 'oci',
            exporterAttrs: {name: options.name}
        }, B.SolveResponse, {signal: signal})
        await status
        return response.exporterResponse ?? {}
    } finally {
        abort.abort()
        session.close()
    }
}

/**
 * The version of BuildKit
 * @param connection
 */
export async function BuildKitVersion(connection: GRPCConnection): Promise<{ package: string, version: string, revision: string }> {
    const response: Message = await connection.unary(`${CONTROL}/Info`, {}, {}, B.InfoResponse)
    return {package: response.buildkitVersion?.package ?? '', version: response.buildkitVersion?.version ?? '', revision: response.buildkitVersion?.revision ?? ''}
}

/**
 * The platforms the workers of BuildKit build
 * @param connection
 */
export async function BuildKitPlatforms(connection: GRPCConnection): Promise<Platform[]> {
    const response: Message = await connection.unary(`${CONTROL}/ListWorkers`, B.ListWorkersRequest, {}, B.ListWorkersResponse)
    const platforms: Platform[] = []
    for (const record of response.record ?? []) {
        for (const platform of record.platforms ?? []) {
            const normalized: Platform = NormalizePlatform({os: platform.os, architecture: platform.architecture, variant: platform.variant || undefined})
            if (!platforms.some((known: Platform): boolean => FormatPlatform(known) === FormatPlatform(normalized))) platforms.push(normalized)
        }
    }
    return platforms
}
