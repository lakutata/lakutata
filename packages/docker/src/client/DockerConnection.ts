/*
 * The connection to the Docker Engine API, rewritten from docker-modem (Copyright Pedro Dias, Apache License 2.0,
 * see THIRD_PARTY_NOTICES.md), modified: the requests are promises, the API version is negotiated, and the requests
 * streaming a body close their connection (see Request)
 */
import {existsSync, readFileSync} from 'node:fs'
import http, {type Agent, type ClientRequest, type IncomingMessage, type RequestOptions} from 'node:http'
import https from 'node:https'
import {homedir, platform} from 'node:os'
import path from 'node:path'
import {Duplex, Writable} from 'node:stream'
import {DockerRequestError} from './DockerRequestError.js'

/**
 * A key of a TLS connection with its passphrase
 */
export type DockerKeyObject = {
    pem: string | Buffer
    passphrase?: string
}

export type DockerConnectionOptions = {
    /**
     * The socket of the Docker daemon (a Unix socket, or a named pipe on Windows)
     */
    socketPath?: string
    /**
     * The host of the Docker daemon (tcp, https, ssh)
     */
    host?: string
    port?: number | string
    protocol?: 'http' | 'https' | 'ssh'
    /**
     * The user of the SSH connection
     */
    username?: string
    password?: string
    /**
     * The SSH agent socket, the one of SSH_AUTH_SOCK by default
     */
    sshAuthAgent?: string
    headers?: Record<string, string>
    ca?: string | string[] | Buffer | Buffer[]
    cert?: string | string[] | Buffer | Buffer[]
    key?: string | string[] | Buffer | Buffer[] | DockerKeyObject[]
    /**
     * The timeout of the requests, in milliseconds
     */
    timeout?: number
    /**
     * The API version ("1.47", or "v1.47"), negotiated with the daemon by default
     */
    version?: string
}

/**
 * A request to the Engine API
 */
export type DockerRequest = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
    path: string
    /**
     * The query parameters: the objects are JSON encoded, the arrays repeat their parameter, the undefined ones are omitted
     */
    query?: Record<string, unknown>
    /**
     * A JSON body, or a stream sent as it is (a tar archive)
     */
    body?: unknown
    headers?: Record<string, string>
    /**
     * The registry credentials of the request (X-Registry-Auth)
     */
    auth?: Record<string, unknown>
    /**
     * The registry credentials of a build (X-Registry-Config)
     */
    registryConfig?: Record<string, unknown>
    /**
     * The meanings of the status codes: true for a success, the reason of the failure otherwise
     */
    statusCodes: Record<number, true | string>
    signal?: AbortSignal
}

/**
 * The newest API version this client is tested with (Docker 29.8): the one negotiated when the daemon supports it, so that
 * a newer daemon answers as the tested one. An older daemon answers with its version: the fields a version does not have
 * are missing or null
 */
export const DOCKER_API_VERSION: string = '1.56'

/**
 * The oldest API version this client works with
 */
export const DOCKER_MIN_API_VERSION: string = '1.41'

/**
 * Compare two API versions
 * @param a
 * @param b
 */
export function compareAPIVersions(a: string, b: string): number {
    const [x, y] = [a, b].map((version: string): number[] => version.replace(/^v/, '').split('.').map(Number))
    return (x[0] - y[0]) || ((x[1] ?? 0) - (y[1] ?? 0))
}

/**
 * The certificates of a CA file, split (a file may have several)
 * @param file
 */
function splitCA(file: string): string[] {
    return readFileSync(file, 'utf8').split(/(?<=-----END CERTIFICATE-----)\s*/).map((certificate: string): string => certificate.trim()).filter(Boolean)
}

/**
 * The connection options given by the environment (DOCKER_HOST, DOCKER_TLS_VERIFY, DOCKER_CERT_PATH,
 * DOCKER_CLIENT_TIMEOUT), else the socket of the platform: the named pipe on Windows, the socket of the user (Docker
 * Desktop) or /var/run/docker.sock
 */
export function defaultConnectionOptions(): DockerConnectionOptions {
    const dockerHost: string | undefined = process.env.DOCKER_HOST
    if (!dockerHost) {
        if (platform() === 'win32') return {socketPath: '//./pipe/docker_engine'}
        const userSocket: string = path.join(homedir(), '.docker', 'run', 'docker.sock')
        return {socketPath: existsSync(userSocket) ? userSocket : '/var/run/docker.sock'}
    }
    if (dockerHost.startsWith('unix://')) return {socketPath: dockerHost.slice(7) || '/var/run/docker.sock'}
    if (dockerHost.startsWith('npipe://')) return {socketPath: dockerHost.slice(8) || '//./pipe/docker_engine'}
    let url: URL
    try {
        url = new URL(dockerHost.includes('//') ? dockerHost : `tcp://${dockerHost}`)
    } catch {
        throw new Error('DOCKER_HOST should be something like tcp://localhost:2375')
    }
    const options: DockerConnectionOptions = {host: url.hostname, port: url.port}
    if (url.protocol === 'ssh:') {
        options.protocol = 'ssh'
        options.username = url.username || undefined
    } else {
        options.protocol = process.env.DOCKER_TLS_VERIFY === '1' || url.port === '2376' ? 'https' : 'http'
    }
    const certPath: string | undefined = process.env.DOCKER_CERT_PATH
    if (certPath) {
        options.ca = splitCA(path.join(certPath, 'ca.pem'))
        options.cert = readFileSync(path.join(certPath, 'cert.pem'))
        options.key = readFileSync(path.join(certPath, 'key.pem'))
    }
    if (process.env.DOCKER_CLIENT_TIMEOUT) options.timeout = Number.parseInt(process.env.DOCKER_CLIENT_TIMEOUT, 10)
    return options
}

/**
 * The query string of the parameters of a request
 * @param query
 */
function queryString(query: Record<string, unknown> = {}): string {
    const parameters: URLSearchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue
        if (Array.isArray(value)) {
            value.forEach((item: unknown): void => parameters.append(key, String(item)))
        } else if (typeof value === 'object') {
            parameters.append(key, JSON.stringify(value))
        } else {
            parameters.append(key, String(value))
        }
    }
    const text: string = parameters.toString()
    return text ? `?${text}` : ''
}

/**
 * Whether a body is a stream
 * @param body
 */
function isStream(body: unknown): body is NodeJS.ReadableStream {
    return !!body && typeof (body as NodeJS.ReadableStream).pipe === 'function'
}

/**
 * The connection to a Docker daemon
 */
export class DockerConnection {

    readonly #options: DockerConnectionOptions

    readonly #protocol: 'http' | 'https' | 'ssh'

    /**
     * The agent of the requests: the connections are kept alive
     */
    readonly #agent: Agent | undefined

    /**
     * The agent of the requests streaming their body: their connections are closed after them. Docker answers a build
     * while it reads its context: on a kept alive connection, its HTTP server discards a part of the unread body when it
     * answers, which corrupts the context ("unpigz: corrupted -- invalid deflate data")
     */
    readonly #closingAgent: Agent | undefined

    /**
     * The negotiated API version
     */
    #version: string | undefined

    #sshAgent: Promise<Agent> | undefined

    constructor(options: DockerConnectionOptions = {}) {
        //The options given (a timeout, headers…) apply over the ones of the environment, the ones not given keep them
        const given: DockerConnectionOptions = Object.fromEntries(Object.entries(options).filter(([, value]: [string, unknown]): boolean => value !== undefined))
        this.#options = given.socketPath || given.host ? given : {...defaultConnectionOptions(), ...given}
        this.#protocol = this.#options.protocol ?? (this.#options.key && this.#options.cert && this.#options.ca ? 'https' : 'http')
        if (this.#options.version) this.#version = this.#options.version.replace(/^v/, '')
        if (this.#protocol !== 'ssh') {
            const module: typeof http | typeof https = this.#protocol === 'https' ? https : http
            this.#agent = new module.Agent({keepAlive: true})
            this.#closingAgent = new module.Agent({keepAlive: false})
        }
    }

    /**
     * The API version of the requests, once negotiated
     */
    public get version(): string | undefined {
        return this.#version
    }

    /**
     * Negotiate the API version with the daemon: the newest one both support
     */
    public async negotiate(): Promise<string> {
        if (this.#version) return this.#version
        const version: { ApiVersion?: string, MinAPIVersion?: string } = await this.request({method: 'GET', path: '/version', statusCodes: {200: true, 500: 'server error'}})
        const daemon: string = version.ApiVersion ?? DOCKER_MIN_API_VERSION
        let negotiated: string = compareAPIVersions(daemon, DOCKER_API_VERSION) < 0 ? daemon : DOCKER_API_VERSION
        //The daemon no longer supports the version of the client
        if (version.MinAPIVersion && compareAPIVersions(negotiated, version.MinAPIVersion) < 0) negotiated = version.MinAPIVersion
        this.#version = negotiated
        return negotiated
    }

    /**
     * The agent of an SSH connection: the requests are sent to "docker system dial-stdio" (ssh2, an optional dependency)
     */
    protected sshAgent(): Promise<Agent> {
        return this.#sshAgent ??= (async (): Promise<Agent> => {
            let ssh2: any
            try {
                //An optional dependency, loaded where it is installed
                const ssh2Module: string = 'ssh2'
                ssh2 = await import(ssh2Module)
            } catch {
                throw new Error('The SSH connections to Docker need the package ssh2: npm install ssh2')
            }
            const Client: new () => any = ssh2.Client ?? ssh2.default?.Client
            const agent: Agent = new http.Agent()
            const options = this.#options
            agent.createConnection = ((_: unknown, callback: (error: Error | null, stream?: Duplex) => void): void => {
                const client = new Client()
                const fail = (error: Error): void => {
                    client.end()
                    callback(error)
                }
                client.once('ready', (): void => {
                    client.exec('docker system dial-stdio', (error: Error | undefined, stream: Duplex): void => {
                        if (error) return fail(error)
                        callback(null, stream)
                        stream.once('close', (): unknown => client.end())
                    })
                }).once('error', fail).connect({
                    host: options.host,
                    port: Number(options.port ?? 22),
                    username: options.username,
                    password: options.password,
                    agent: options.sshAuthAgent ?? process.env.SSH_AUTH_SOCK
                })
            }) as any
            return agent
        })()
    }

    /**
     * The options of a request
     * @param request
     * @param streamingBody
     */
    protected async requestOptions(request: DockerRequest, streamingBody: boolean): Promise<RequestOptions> {
        const headers: Record<string, string> = {...this.#options.headers, ...request.headers}
        if (request.auth) headers['X-Registry-Auth'] = Buffer.from(JSON.stringify(request.auth)).toString('base64url')
        if (request.registryConfig) headers['X-Registry-Config'] = Buffer.from(JSON.stringify(request.registryConfig)).toString('base64')
        const versioned: string = this.#version ? `/v${this.#version}${request.path}` : request.path
        const options: RequestOptions = {
            method: request.method,
            path: `${versioned}${queryString(request.query)}`,
            headers: headers,
            signal: request.signal,
            timeout: this.#options.timeout
        }
        if (this.#protocol === 'ssh') {
            options.agent = await this.sshAgent()
            options.host = 'localhost'
        } else {
            options.agent = streamingBody ? this.#closingAgent : this.#agent
            if (this.#options.socketPath) {
                options.socketPath = this.#options.socketPath
            } else {
                options.host = this.#options.host
                options.port = this.#options.port
            }
            if (this.#protocol === 'https') Object.assign(options, {ca: this.#options.ca, cert: this.#options.cert, key: this.#options.key})
        }
        return options
    }

    /**
     * Send a request: the response, once its status is known
     * @param request
     * @param hijack upgrade the connection to a raw stream (the TTYs, the attached executions)
     */
    protected async send(request: DockerRequest, hijack: boolean = false): Promise<{ response?: IncomingMessage, socket?: Duplex, request: ClientRequest }> {
        const streamingBody: boolean = isStream(request.body)
        const options: RequestOptions = await this.requestOptions(request, streamingBody)
        const headers: Record<string, string> = options.headers as Record<string, string>
        let payload: string | undefined
        if (request.body !== undefined && !streamingBody) {
            payload = JSON.stringify(request.body)
            headers['Content-Type'] = 'application/json'
            headers['Content-Length'] = String(Buffer.byteLength(payload))
        } else if (streamingBody) {
            headers['Content-Type'] = 'application/x-tar'
        }
        if (hijack) {
            headers.Connection = 'Upgrade'
            headers.Upgrade = 'tcp'
        }
        const module: typeof http | typeof https = this.#protocol === 'https' ? https : http
        return new Promise((resolve, reject): void => {
            const req: ClientRequest = module.request(options)
            req.once('error', reject)
            req.once('timeout', (): unknown => req.destroy(new Error(`Timeout of ${this.#options.timeout} ms exceeded`)))
            if (hijack) {
                req.once('upgrade', (response: IncomingMessage, socket: Duplex, head: Buffer): void => {
                    if (head.length) socket.unshift(head)
                    resolve({response: response, socket: socket, request: req})
                })
            }
            req.once('response', (response: IncomingMessage): void => resolve({response: response, request: req}))
            if (streamingBody) {
                const body: NodeJS.ReadableStream = request.body as NodeJS.ReadableStream
                //An error of the body (the packing of a build context) fails the request, instead of ending its stream
                body.once('error', (error: Error): unknown => req.destroy(error))
                body.pipe(req)
            } else {
                req.end(payload)
            }
        })
    }

    /**
     * The error of a failed response
     * @param request
     * @param response
     */
    protected async failure(request: DockerRequest, response: IncomingMessage): Promise<DockerRequestError> {
        const text: string = Buffer.concat(await response.toArray()).toString()
        let json: any
        try {
            json = JSON.parse(text)
        } catch {
            json = undefined
        }
        const reason: string = typeof request.statusCodes[response.statusCode!] === 'string' ? request.statusCodes[response.statusCode!] as string : 'unexpected'
        return new DockerRequestError(response.statusCode!, reason, json?.message ?? text.trim(), json)
    }

    /**
     * A request whose response is JSON (or nothing)
     * @param request
     */
    public async request<T = any>(request: DockerRequest): Promise<T> {
        const {response} = await this.send(request)
        if (request.statusCodes[response!.statusCode!] !== true) throw await this.failure(request, response!)
        const text: string = Buffer.concat(await response!.toArray()).toString()
        if (!text) return undefined as T
        try {
            return JSON.parse(text)
        } catch {
            return text as T
        }
    }

    /**
     * A request whose response is a stream (the progress of a pull, the logs, an archive)
     * @param request
     */
    public async stream(request: DockerRequest): Promise<IncomingMessage> {
        const {response} = await this.send(request)
        if (request.statusCodes[response!.statusCode!] !== true) throw await this.failure(request, response!)
        return response!
    }

    /**
     * A request upgraded to a raw stream, read and written (the TTYs, the attached executions)
     * @param request
     */
    public async hijack(request: DockerRequest): Promise<Duplex> {
        const {response, socket} = await this.send(request, true)
        if (socket) return socket
        if (request.statusCodes[response!.statusCode!] !== true) throw await this.failure(request, response!)
        //A daemon answering without upgrading: its response is the output, what is written is discarded
        return Duplex.from({readable: response!, writable: new Writable({write: (_chunk: unknown, _encoding: string, callback: () => void): void => callback()})}) as Duplex
    }

    /**
     * Close the kept alive connections
     */
    public close(): void {
        this.#agent?.destroy()
        this.#closingAgent?.destroy()
        this.#sshAgent?.then((agent: Agent): void => agent.destroy()).catch((): void => undefined)
    }
}
