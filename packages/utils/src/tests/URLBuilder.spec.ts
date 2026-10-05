import {describe, it} from 'node:test'
import assert from 'node:assert'
import UpstreamUrlParse from 'url-parse'
import {URLBuilder, type URLAttributes} from '../exports/Utils.js'
import {UrlParse} from '../lib/helpers/internal/UrlParse.js'

/**
 * The URLBuilder of 2.x, on url-parse
 */
class UpstreamURLBuilder {

    public static parse(url: string): UpstreamURLBuilder {
        return new UpstreamURLBuilder(JSON.parse(JSON.stringify((UpstreamUrlParse as any)(url, true))))
    }

    readonly #urlObject: any

    [key: string]: any

    constructor(options: URLAttributes = {}) {
        this.#urlObject = (UpstreamUrlParse as any)('')
        for (const key of ATTRIBUTES) this[key] = (options as any)[key]
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

const ATTRIBUTES: string[] = ['auth', 'hash', 'host', 'hostname', 'href', 'origin', 'password', 'pathname', 'port', 'protocol', 'query', 'slashes', 'username']

/**
 * A URL built by url-parse from attributes, as URLBuilder builds it: from a new URL each time, the protocol first (the
 * default port depends on it), the host name and the port of the host unless they are given
 * @param attributes
 */
function upstreamBuild(attributes: URLAttributes): string {
    const url: any = (UpstreamUrlParse as any)('')
    const host: any = (UpstreamUrlParse as any)('')
    if (attributes.host !== undefined) host.set('host', attributes.host)
    const hostname: string | undefined = attributes.hostname !== undefined ? attributes.hostname : attributes.host !== undefined ? host.hostname : undefined
    const port: string | number | undefined = attributes.port !== undefined ? attributes.port : attributes.host !== undefined ? host.port : undefined
    if (attributes.protocol) url.set('protocol', attributes.protocol)
    if (attributes.slashes !== undefined) url.slashes = attributes.slashes
    if (attributes.auth) url.set('auth', attributes.auth)
    if (attributes.username) url.set('username', attributes.username)
    if (attributes.password) url.set('password', attributes.password)
    if (hostname) url.set('hostname', hostname)
    if (port !== undefined && port !== '') url.set('port', port)
    if (attributes.pathname) url.set('pathname', attributes.pathname)
    if (attributes.query) url.set('query', attributes.query)
    if (attributes.hash) url.set('hash', attributes.hash)
    return url.toString()
}

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function seededRandom(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = seededRandom(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

/**
 * A random address, of random parts: protocols, slashes, credentials, hosts, ports, paths, queries, hashes
 */
function randomAddress(): string {
    const parts: string[] = [
        pick(['', '', ' ', '\t', '\u0000', ' ']),
        pick(['http:', 'https:', 'HTTP:', 'ftp:', 'file:', 'ws:', 'wss:', 'mailto:', 'postgresql:', 'redis:', 'custom+x:', 'C:', '', '', 'javascript:']),
        pick(['//', '//', '///', '\\\\', '/', '', '/\\']),
        pick(['', '', 'user@', 'user:pw@', 'us%20er:p%40w@', '@', ':pw@', 'a:b@c@', '%E4%B8%AD@']),
        pick(['example.com', 'EXAMPLE.Com', '[::1]', '127.0.0.1', '', '例子.测试', 'a:b', 'host_name', 'x']),
        pick(['', '', ':80', ':443', ':8080', ':', ':21', ':0', ':abc', ':65536']),
        pick(['', '/', '/a/b', 'a/b', '/../x', '/./y/../z', '\\a\\b', '/%20x', '/中文', '//double']),
        pick(['', '', '?a=1&b=2', '?a', '?a=1&a=2', '?%zz=1&ok=2', '?', '?toString=1&__proto__=2', '?a+b=c+d', '?x=%E4%B8%AD']),
        pick(['', '', '#x', '#', '#a#b', '#?q'])
    ]
    let address: string = parts.join('')
    if (random() < 0.1) address = address.replace(/(.)/, '$1\n')
    if (random() < 0.05) address = address.toUpperCase()
    return address
}

/**
 * Random attributes of a URL
 */
function randomAttributes(): URLAttributes {
    const attributes: Record<string, unknown> = {}
    const choices: Record<string, unknown[]> = {
        auth: ['user:pw', 'user', '%41:%42', ''],
        hash: ['x', '#y', ''],
        host: ['a.com', 'a.com:81', 'A.COM:80', 'b.com:'],
        hostname: ['a.com', 'B.com', ''],
        href: ['http://b.com/y'],
        origin: ['http://o.com', ''],
        password: ['p w', 'pw', ''],
        pathname: ['/x', 'y/z', ''],
        port: ['8080', '80', '', 0, 443],
        protocol: ['https', 'http:', 'FTP', 'custom'],
        query: [{a: '1', b: '2'}, {}, {k: 'v w'}],
        slashes: [true, false],
        username: ['u ser', 'u', '']
    }
    for (const [key, values] of Object.entries(choices)) if (random() < 0.4) attributes[key] = pick(values)
    return attributes as URLAttributes
}

/**
 * The result or the error of a function
 * @param fn
 */
function outcomeOf(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        return {value: fn()}
    } catch (error) {
        return {error: (error as Error).message}
    }
}

describe('URLBuilder', (): void => {

    it('parses as the URLBuilder of 2.x, and builds the URL parsed again as url-parse', (): void => {
        //The attributes only: 2.x built the URL by changing the URL of its previous builds, and ignored slashes
        const attributes = (url: any): Record<string, unknown> => Object.fromEntries(ATTRIBUTES.map((key: string): [string, unknown] => [key, url[key]]))
        for (let run: number = 0; run < 5000; run++) {
            const address: string = randomAddress()
            assert.deepStrictEqual(outcomeOf((): unknown => attributes(URLBuilder.parse(address))), outcomeOf((): unknown => attributes(UpstreamURLBuilder.parse(address))), JSON.stringify(address))
            const parsed: URLAttributes = attributes(UpstreamURLBuilder.parse(address)) as URLAttributes
            assert.strictEqual(URLBuilder.parse(address).toString(), upstreamBuild(parsed), JSON.stringify(address))
        }
    })

    it('builds the URLs as url-parse, the protocol first', (): void => {
        for (let run: number = 0; run < 5000; run++) {
            const attributes: URLAttributes = randomAttributes()
            assert.deepStrictEqual(outcomeOf((): unknown => new URLBuilder(attributes).toString()), outcomeOf((): unknown => upstreamBuild(attributes)), JSON.stringify(attributes))
        }
    })

    it('keeps the host, the host name and the port consistent', (): void => {
        const url: URLBuilder = URLBuilder.parse('https://example.com:8080/a?b=1')
        url.host = 'other.com:9090'
        assert.deepStrictEqual([url.hostname, url.port, url.toString()], ['other.com', '9090', 'https://other.com:9090/a?b=1'])
        url.hostname = 'third.com'
        assert.deepStrictEqual([url.host, url.toString()], ['third.com:9090', 'https://third.com:9090/a?b=1'])
        url.port = ''
        assert.deepStrictEqual([url.host, url.toString()], ['third.com', 'https://third.com/a?b=1'])
        url.host = 'fourth.com'
        assert.deepStrictEqual([url.hostname, url.port], ['fourth.com', ''])
        //The host name and the port given win over the host
        assert.strictEqual(new URLBuilder({protocol: 'http', host: 'a.com:81', port: '82'}).toString(), 'http://a.com:82')
    })

    it('builds from the current attributes at each call', (): void => {
        const url: URLBuilder = URLBuilder.parse('https://user:pw@example.com/a?b=1#top')
        assert.strictEqual(url.toString(), 'https://user:pw@example.com/a?b=1#top')
        url.hash = undefined
        url.query = {}
        url.username = ''
        url.password = undefined
        url.auth = undefined
        assert.strictEqual(url.toString(), 'https://example.com/a')
        url.pathname = '/b'
        assert.strictEqual(url.toString(), 'https://example.com/b')
    })

    it('does not write the default port of the scheme', (): void => {
        assert.strictEqual(new URLBuilder({protocol: 'https', hostname: 'a.com', port: '443'}).toString(), 'https://a.com')
        assert.strictEqual(new URLBuilder({protocol: 'http:', hostname: 'a.com', port: '80'}).toString(), 'http://a.com')
        assert.strictEqual(new URLBuilder({protocol: 'https', hostname: 'a.com', port: '80'}).toString(), 'https://a.com:80')
        assert.strictEqual(new URLBuilder({protocol: 'redis', hostname: 'localhost', port: '6379', pathname: '0'}).toString(), 'redis://localhost:6379/0')
    })

    it('keeps href and origin as given, without building from them', (): void => {
        const url: URLBuilder = URLBuilder.parse('https://example.com/a')
        url.hostname = 'other.com'
        assert.deepStrictEqual([url.href, url.origin, url.toString()], ['https://example.com/a', 'https://example.com', 'https://other.com/a'])
        assert.strictEqual(new URLBuilder({href: 'https://ignored.com/', protocol: 'https', hostname: 'a.com'}).toString(), 'https://a.com')
    })

    it('parses, resolves and changes the URLs as url-parse', (): void => {
        const own = (url: any): Record<string, unknown> => JSON.parse(JSON.stringify(url))
        //The messages of the errors of V8 quote the code ("(fn || qs.parse) is not a function"): their types are compared
        const typeOf = (outcome: { value?: unknown, error?: string }, fn: () => unknown): unknown => {
            try {
                fn()
                return outcome
            } catch (error) {
                return {error: (error as Error).constructor.name}
            }
        }
        for (let run: number = 0; run < 3000; run++) {
            const address: string = randomAddress()
            const location: unknown = pick([undefined, true, {}, 'https://base.com/a/b/c?q#h', {protocol: 'http:', host: 'l.com', hostname: 'l.com', pathname: '/p/q', slashes: true}, 'ftp://x/y/'])
            const ported: any = new UrlParse(address, location)
            const upstream: any = new (UpstreamUrlParse as any)(address, location)
            assert.deepStrictEqual(own(ported), own(upstream), `${JSON.stringify(address)} ${JSON.stringify(location)}`)
            for (let change: number = 0; change < 3; change++) {
                const part: string = pick(['query', 'port', 'hostname', 'host', 'protocol', 'pathname', 'hash', 'username', 'password', 'auth', 'origin'])
                const value: unknown = pick(['8080', '', 'a:b@c', 'HTTPS', 'x.com:99', '/p', 'h', 'q=1&r=2', 'u%20v', 'w:z', '0'])
                const flag: unknown = pick([undefined, true])
                const setPorted = (): unknown => own(ported.set(part, value, flag))
                const setUpstream = (): unknown => own(upstream.set(part, value, flag))
                assert.deepStrictEqual(typeOf(outcomeOf(setPorted), setPorted), typeOf(outcomeOf(setUpstream), setUpstream), `${JSON.stringify(address)} set ${part} ${JSON.stringify(value)} ${flag}`)
            }
            assert.strictEqual(ported.toString(), upstream.toString())
        }
    })
})
