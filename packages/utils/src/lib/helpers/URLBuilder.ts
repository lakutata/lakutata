import {UrlParse} from './internal/UrlParse.js'

/**
 * The attributes of a URL, given to the `URLBuilder` constructor to build one; all are optional.
 */
export interface URLAttributes {
    /**
     * The credentials, `username:password` or `username`: they set `username` and `password`.
     */
    auth?: string
    /**
     * The fragment, `#` added when missing.
     */
    hash?: string
    /**
     * The host name with its port (`'example.com:8080'`): it sets `hostname` and `port`, which win over it when given
     * too.
     */
    host?: string
    /**
     * The host name, without port.
     */
    hostname?: string
    /**
     * Kept as given, not used to build: the URL is made of the other attributes.
     */
    href?: string
    /**
     * Kept as given, not used to build: it is the protocol and the host.
     */
    origin?: string
    /**
     * The password of the credentials, percent-encoded when built.
     */
    password?: string
    /**
     * The path, `/` added when missing.
     */
    pathname?: string
    /**
     * The port; not written when it is the scheme's default (`443` for `https`, `80` for `http`).
     */
    port?: string
    /**
     * The scheme, with or without its colon (`'https'`, `'redis:'`). Any scheme is accepted.
     */
    protocol?: string
    /**
     * The query parameters by name, percent-encoded when built (`{q: 'a b'}` gives `?q=a%20b`); an empty object gives
     * no query.
     */
    query?: Record<string, string>
    /**
     * Whether the protocol is followed by `//` (always for `http`, `https`, `ws`, `wss`, `ftp`, `file` and `gopher`).
     * @default true with a protocol
     */
    slashes?: boolean
    /**
     * The user name of the credentials, percent-encoded when built.
     */
    username?: string
}

/**
 * A URL, parsed into its attributes or built from them. Unlike `URL`, any scheme is handled the same way (`redis:`,
 * `mongodb:`, `amqp:`), relative URLs are accepted, and the query is a plain object of strings.
 *
 * `URLBuilder.parse()` fills the attributes from a URL; `new URLBuilder({...})` takes them from an object. They are
 * public properties, which can be changed before `toString()` builds the URL. `toString()` builds it from the current
 * attributes at each call: an attribute set to `undefined` or `''` is no longer in the URL. `host` is `hostname` and
 * `port` together: setting it sets them, setting them changes it. `username` and `password` win over `auth`, and
 * `href` and `origin` are kept as given, not used to build.
 * @example
 * ```typescript
 * import {URLBuilder} from 'lakutata/utils'
 *
 * const url: URLBuilder = URLBuilder.parse('https://user:secret@example.com:8080/search?q=books#results')
 * console.log(url.hostname, url.port, url.pathname, url.query)
 * //example.com 8080 /search {q: 'books'}
 * url.query = {...url.query, page: '2'}
 * console.log(url.toString())
 * //https://user:secret@example.com:8080/search?q=books&page=2#results
 *
 * const built: URLBuilder = new URLBuilder({protocol: 'redis', hostname: 'localhost', port: '6379', pathname: '0'})
 * console.log(built.toString())
 * //redis://localhost:6379/0
 * ```
 */
export class URLBuilder {

    /**
     * Parse a URL into its attributes. The parsing does not validate: a string which is not a URL gives a relative URL
     * of that path (`'not a url'` gives the `pathname` `'not a url'`).
     * @param url The URL, absolute (`'https://example.com/a'`, `'redis://:pw@host:6379/0'`) or relative (`'/a?b=1'`).
     * @returns A new instance holding the URL's attributes.
     */
    public static parse(url: string): URLBuilder {
        return new URLBuilder(JSON.parse(JSON.stringify(new UrlParse(url, true))))
    }

    /**
     * The credentials, `username:password` or `username` alone, percent-encoded. When set, they replace `username` and
     * `password` in the URL built (unless these are set too).
     */
    public auth?: string

    /**
     * The fragment, with its `#` (`'#top'`); `#` is added when building without it.
     */
    public hash?: string

    /**
     * The host name with its port (`'example.com:8080'`), made of `hostname` and `port`: `undefined` when neither is
     * set. Setting it sets `hostname` and `port` (`''` when it has none); `undefined` unsets them both.
     */
    public get host(): string | undefined {
        if (this.#hostname === undefined && (this.#port === undefined || this.#port === '')) return undefined
        const port: string = this.#port === undefined ? '' : String(this.#port)
        return port === '' ? (this.#hostname ?? '') : `${this.#hostname ?? ''}:${port}`
    }

    public set host(value: string | undefined) {
        if (value === undefined) {
            this.#hostname = undefined
            this.#port = undefined
            return
        }
        const port: RegExpExecArray | null = /:(\d+)$/.exec(value)
        this.#hostname = port ? value.slice(0, port.index) : value
        this.#port = port ? port[1] : ''
    }

    /**
     * The host name, without port, in lower case when parsed.
     */
    public get hostname(): string | undefined {
        return this.#hostname
    }

    public set hostname(value: string | undefined) {
        this.#hostname = value
    }

    #hostname?: string

    /**
     * The whole URL, as parsed (or given). Kept as it is: `toString()` builds the URL from the other attributes, and
     * does not update it.
     */
    public href?: string

    /**
     * The protocol and the host (`'https://example.com:8080'`), or `'null'` for a scheme without origin (`redis:`,
     * `file:`) or a URL without host, as parsed (or given). Kept as it is: `toString()` does not use nor update it.
     */
    public origin?: string

    /**
     * The password of the credentials, percent-encoded (when parsed, and when built).
     */
    public password?: string

    /**
     * The path, starting with `/` (`'/a/b'`), still percent-encoded; `/` is added when building without it.
     */
    public pathname?: string

    /**
     * The port. Parsed, it is a string, `''` when absent or when it is the scheme's default (`80` for `http:`, `443`
     * for `https:`). When building, the scheme's default port is not written.
     */
    public get port(): string | number | undefined {
        return this.#port
    }

    public set port(value: string | number | undefined) {
        this.#port = value
    }

    #port?: string | number

    /**
     * The scheme with its colon, in lower case (`'https:'`); `''` for a relative URL. Given without its colon
     * (`'https'`), it is added when building.
     */
    public protocol?: string

    /**
     * The query parameters by name, decoded (`+` read as a space). A name repeated keeps its first value only
     * (`?a=1&a=2` gives `{a: '1'}`), and a name without value gives `''`. Percent-encoded when building; an empty
     * object gives no query.
     */
    public query?: Record<string, string>

    /**
     * Whether the scheme is followed by `//` (always for `http:`, `https:`, `ws:`, `wss:`, `ftp:`, `file:` and
     * `gopher:`); `undefined` is `true` with a `protocol`.
     */
    public slashes?: boolean

    /**
     * The user name of the credentials, percent-encoded (when parsed, and when built).
     */
    public username?: string

    /**
     * Create a URL from its attributes, to build with `toString()`.
     * @param options The attributes; none gives an empty URL (`toString()` returns `''`).
     */
    constructor(options: URLAttributes = {}) {
        this.auth = options.auth
        this.hash = options.hash
        //The host first: the hostname and the port given win over the ones of the host
        this.host = options.host
        if (options.hostname !== undefined) this.hostname = options.hostname
        if (options.port !== undefined) this.port = options.port
        this.href = options.href
        this.origin = options.origin
        this.password = options.password
        this.pathname = options.pathname
        this.protocol = options.protocol
        this.query = options.query
        this.slashes = options.slashes
        this.username = options.username
    }

    /**
     * Build the URL from the current attributes (the non-empty strings, `port`, `query` and `slashes`).
     * @returns The URL; `''` when no attribute is set.
     */
    public toString(): string {
        const url: UrlParse = new UrlParse('')
        //The protocol first: the default port depends on it
        if (this.protocol) url.set('protocol', this.protocol)
        if (this.slashes !== undefined) url.slashes = this.slashes
        if (this.auth) url.set('auth', this.auth)
        if (this.username) url.set('username', this.username)
        if (this.password) url.set('password', this.password)
        if (this.hostname) url.set('hostname', this.hostname)
        if (this.port !== undefined && this.port !== '') url.set('port', this.port)
        if (this.pathname) url.set('pathname', this.pathname)
        if (this.query) url.set('query', this.query)
        if (this.hash) url.set('hash', this.hash)
        return url.toString()
    }
}
