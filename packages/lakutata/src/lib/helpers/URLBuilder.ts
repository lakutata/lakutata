import urlParse from 'url-parse'

export interface URLAttributes {
    auth?: string
    hash?: string
    host?: string
    hostname?: string
    href?: string
    origin?: string
    password?: string
    pathname?: string
    port?: string
    protocol?: string
    query?: Record<string, string>
    slashes?: boolean
    username?: string
}

export class URLBuilder {

    public static parse(url: string): URLBuilder {
        return new URLBuilder(JSON.parse(JSON.stringify(urlParse(url, true))))
    }

    #urlObject: any

    public auth?: string
    public hash?: string
    public host?: string
    public hostname?: string
    public href?: string
    public origin?: string
    public password?: string
    public pathname?: string
    public port?: string | number
    public protocol?: string
    public query?: Record<string, string>
    public slashes?: boolean
    public username?: string

    constructor(options: URLAttributes = {}) {
        this.#urlObject = urlParse('')
        this.auth = options.auth
        this.hash = options.hash
        this.host = options.host
        this.hostname = options.hostname
        this.href = options.href
        this.origin = options.origin
        this.password = options.password
        this.pathname = options.pathname
        this.port = options.port
        this.protocol = options.protocol
        this.query = options.query
        this.slashes = options.slashes
        this.username = options.username
    }

    public toString(): string {
        if (this.auth) this.#urlObject.set('auth', this.auth)
        if (this.hash) this.#urlObject.set('hash', this.hash)
        if (this.host) this.#urlObject.set('host', this.host)
        if (this.hostname) this.#urlObject.set('hostname', this.hostname)
        if (this.href) this.#urlObject.set('href', this.href)
        if (this.origin !== undefined) this.#urlObject.set('origin', this.origin.toString())
        if (this.password) this.#urlObject.set('password', this.password)
        if (this.pathname) this.#urlObject.set('pathname', this.pathname)
        if (this.port !== undefined) this.#urlObject.set('port', this.port)
        if (this.protocol) this.#urlObject.set('protocol', this.protocol)
        if (this.query) this.#urlObject.set('query', this.query)
        if (this.slashes !== undefined) this.#urlObject.set('slashes', this.slashes)
        if (this.username) this.#urlObject.set('username', this.username)
        return this.#urlObject.toString()
    }
}