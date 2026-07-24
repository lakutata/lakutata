//Self-implemented URL builder (replaces the `url-parse` package dependency).
//String-based: works with any protocol (postgresql://, memcache://, etc.) where
//native URL would reject non-standard schemes.

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

const URL_RE = /^([^:]+):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]+)(?::(\d+))?(\/[^?#]*)?(?:\?([^#]*))?(#.*)?$/

export class URLBuilder {

    public static parse(url: string): URLBuilder {
        const m = url.match(URL_RE)
        if (!m) return new URLBuilder({href: url})
        const [, protocol, username, password, hostname, port, pathname, queryStr, hash] = m
        const query: Record<string, string> = {}
        if (queryStr) for (const pair of queryStr.split('&')) { const [k, v] = pair.split('='); if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '') }
        return new URLBuilder({protocol, username, password, hostname, port, pathname, query, hash})
    }

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
        Object.assign(this, options)
    }

    public toString(): string {
        if (this.href) return this.href
        let str: string = this.protocol || 'http'
        if (!str.endsWith(':')) str += ':'
        str += '//'
        const user = this.username || (this.auth ? this.auth.split(':')[0] : '')
        const pass = this.password || (this.auth ? this.auth.split(':')[1] : '')
        if (user) { str += user; if (pass) str += ':' + pass; str += '@' }
        str += this.hostname || this.host || 'localhost'
        if (this.port) str += ':' + this.port
        if (this.pathname) { if (!this.pathname.startsWith('/')) str += '/'; str += this.pathname }
        if (this.query && Object.keys(this.query).length) {
            str += '?' + Object.entries(this.query).map(([k, v]): string => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
        }
        if (this.hash) { if (!this.hash.startsWith('#')) str += '#'; str += this.hash }
        return str
    }
}
