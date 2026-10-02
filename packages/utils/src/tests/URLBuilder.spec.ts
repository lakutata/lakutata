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
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = Random(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

/**
 * A random address, of random parts: protocols, slashes, credentials, hosts, ports, paths, queries, hashes
 */
function Address(): string {
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
function Attributes(): URLAttributes {
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
 * The attributes of a built URL and its string
 * @param url
 */
function Describe(url: any): Record<string, unknown> {
    return {...Object.fromEntries(ATTRIBUTES.map((key: string): [string, unknown] => [key, url[key]])), string: url.toString()}
}

/**
 * The result or the error of a function
 * @param fn
 */
function Outcome(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        return {value: fn()}
    } catch (error) {
        return {error: (error as Error).message}
    }
}

describe('URLBuilder', (): void => {

    it('parses as the URLBuilder of 2.x', (): void => {
        for (let run: number = 0; run < 5000; run++) {
            const address: string = Address()
            assert.deepStrictEqual(Outcome((): unknown => Describe(URLBuilder.parse(address))), Outcome((): unknown => Describe(UpstreamURLBuilder.parse(address))), JSON.stringify(address))
        }
    })

    it('builds the URLs as the URLBuilder of 2.x', (): void => {
        for (let run: number = 0; run < 5000; run++) {
            const attributes: URLAttributes = Attributes()
            assert.deepStrictEqual(Outcome((): unknown => new URLBuilder(attributes).toString()), Outcome((): unknown => new UpstreamURLBuilder(attributes).toString()), JSON.stringify(attributes))
        }
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
            const address: string = Address()
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
                assert.deepStrictEqual(typeOf(Outcome(setPorted), setPorted), typeOf(Outcome(setUpstream), setUpstream), `${JSON.stringify(address)} set ${part} ${JSON.stringify(value)} ${flag}`)
            }
            assert.strictEqual(ported.toString(), upstream.toString())
        }
    })
})
