/**
 * Derived from index.js of url-parse 1.5.10, index.js of querystringify 2.2.0 and index.js of requires-port 1.0.0 (MIT,
 * see THIRD_PARTY_NOTICES.md): the parsing and the building of the URLs of 2.x (URLBuilder)
 */

const CONTROL_OR_WHITESPACE: RegExp = /^[\x00-\x20\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/
const CRHTLF: RegExp = /[\n\r\t]/g
const SLASHES: RegExp = /^[A-Za-z][A-Za-z0-9+-.]*:\/\//
const PORT: RegExp = /:\d+$/
const PROTOCOL: RegExp = /^([a-z][a-z0-9.+-]*:)?(\/\/)?([\\/]+)?([\S\s]*)/i
const WINDOWS_DRIVE_LETTER: RegExp = /^[a-zA-Z]:/

type QueryParser = (query: string) => Record<string, string>

type QueryStringifier = (query: Record<string, any>) => string

/**
 * A rule of the parsing: what to look for (a string by indexOf, a RegExp by exec, NaN for the value left), the property
 * set, the characters split off (a number: from the front), the property inherited from the location of a relative URL,
 * and the lowercasing of the value
 */
type Rule = [string | RegExp | number, string, number?, number?, number?] | ((address: string, url: UrlParse) => string)

/**
 * The properties neither copied nor inherited from the location
 */
const IGNORE: Record<string, number> = {hash: 1, query: 1}

//----------------------------------------------------------------------------------------------------------------------
//querystringify

function decode(input: string): string | null {
    try {
        return decodeURIComponent(input.replace(/\+/g, ' '))
    } catch {
        return null
    }
}

function encode(input: any): string | null {
    try {
        return encodeURIComponent(input)
    } catch {
        return null
    }
}

/**
 * Parse a query string (the first value of a key is kept, the keys and values which cannot be decoded are left out)
 * @param query
 */
export function ParseQuery(query: string): Record<string, string> {
    const parser: RegExp = /([^=?#&]+)=?([^&]*)/g
    const result: Record<string, string> = {}
    let part: RegExpExecArray | null
    while ((part = parser.exec(query))) {
        const key: string | null = decode(part[1])
        const value: string | null = decode(part[2])
        //The existing properties are not overridden (the built-in ones such as toString or __proto__ included)
        if (key === null || value === null || key in result) continue
        result[key] = value
    }
    return result
}

/**
 * Stringify a query object
 * @param obj
 * @param prefix
 */
export function StringifyQuery(obj: Record<string, any>, prefix?: string | boolean): string {
    prefix = prefix || ''
    if (typeof prefix !== 'string') prefix = '?'
    const pairs: string[] = []
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
        let value: any = obj[key]
        //Empty for null, undefined and NaN
        if (!value && (value === null || value === undefined || isNaN(value))) value = ''
        const encodedKey: string | null = encode(key)
        const encodedValue: string | null = encode(value)
        if (encodedKey === null || encodedValue === null) continue
        pairs.push(encodedKey + '=' + encodedValue)
    }
    return pairs.length ? prefix + pairs.join('&') : ''
}

//----------------------------------------------------------------------------------------------------------------------
//requires-port

/**
 * Whether the port is required: not the default port of the protocol
 * @param port
 * @param protocol
 */
function Required(port: any, protocol: string): boolean {
    protocol = protocol.split(':')[0]
    port = +port
    if (!port) return false
    switch (protocol) {
        case 'http':
        case 'ws':
            return port !== 80
        case 'https':
        case 'wss':
            return port !== 443
        case 'ftp':
            return port !== 21
        case 'gopher':
            return port !== 70
        case 'file':
            return false
    }
    return port !== 0
}

//----------------------------------------------------------------------------------------------------------------------
//url-parse

const RULES: Rule[] = [
    //Extracted from the back
    ['#', 'hash'],
    ['?', 'query'],
    //The address left sanitized
    (address: string, url: UrlParse): string => IsSpecial(url.protocol) ? address.replace(/\\/g, '/') : address,
    ['/', 'pathname'],
    //Extracted from the front
    ['@', 'auth', 1],
    //The value left
    [NaN, 'host', undefined, 1, 1],
    [/:(\d*)$/, 'port', undefined, 1],
    [NaN, 'hostname', undefined, 1, 1]
]

function TrimLeft(str: any): string {
    return (str ? str : '').toString().replace(CONTROL_OR_WHITESPACE, '')
}

function IsSpecial(scheme: string | undefined): boolean {
    return scheme === 'file:' || scheme === 'ftp:' || scheme === 'http:' || scheme === 'https:' || scheme === 'ws:' || scheme === 'wss:'
}

/**
 * The default location of the relative URLs: the location of the global object (none in Node.js)
 * @param loc
 */
function Location(loc?: any): Record<string, any> {
    const location: any = (globalThis as any).location || {}
    loc = loc || location
    let destination: Record<string, any> = {}
    const type: string = typeof loc
    if (loc.protocol === 'blob:') {
        destination = new UrlParse((globalThis as any).unescape(loc.pathname), {})
    } else if (type === 'string') {
        destination = new UrlParse(loc, {})
        for (const key in IGNORE) delete destination[key]
    } else if (type === 'object') {
        for (const key in loc) {
            if (key in IGNORE) continue
            destination[key] = loc[key]
        }
        if (destination.slashes === undefined) destination.slashes = SLASHES.test(loc.href)
    }
    return destination
}

/**
 * The protocol of an address: its scheme (lowercase), whether slashes follow it, their number, and the rest
 * @param address
 * @param location
 */
function ExtractProtocol(address: string, location?: Record<string, any>): { protocol: string, slashes: boolean, slashesCount: number, rest: string } {
    address = TrimLeft(address).replace(CRHTLF, '')
    location = location || {}
    const match: RegExpExecArray = PROTOCOL.exec(address)!
    const protocol: string = match[1] ? match[1].toLowerCase() : ''
    const forwardSlashes: boolean = !!match[2]
    const otherSlashes: boolean = !!match[3]
    let slashesCount: number = 0
    let rest: string
    if (forwardSlashes) {
        if (otherSlashes) {
            rest = match[2] + match[3] + match[4]
            slashesCount = match[2].length + match[3].length
        } else {
            rest = match[2] + match[4]
            slashesCount = match[2].length
        }
    } else if (otherSlashes) {
        rest = match[3] + match[4]
        slashesCount = match[3].length
    } else {
        rest = match[4]
    }
    if (protocol === 'file:') {
        if (slashesCount >= 2) rest = rest.slice(2)
    } else if (IsSpecial(protocol)) {
        rest = match[4]
    } else if (protocol) {
        if (forwardSlashes) rest = rest.slice(2)
    } else if (slashesCount >= 2 && IsSpecial(location.protocol)) {
        rest = match[4]
    }
    return {protocol: protocol, slashes: forwardSlashes || IsSpecial(protocol), slashesCount: slashesCount, rest: rest}
}

/**
 * Resolve a relative pathname against a base pathname
 * @param relative
 * @param base
 */
function Resolve(relative: string, base: string): string {
    if (relative === '') return base
    const path: string[] = (base || '/').split('/').slice(0, -1).concat(relative.split('/'))
    let i: number = path.length
    const last: string = path[i - 1]
    let unshift: boolean = false
    let up: number = 0
    while (i--) {
        if (path[i] === '.') {
            path.splice(i, 1)
        } else if (path[i] === '..') {
            path.splice(i, 1)
            up++
        } else if (up) {
            if (i === 0) unshift = true
            path.splice(i, 1)
            up--
        }
    }
    if (unshift) path.unshift('')
    if (last === '.' || last === '..') path.push('')
    return path.join('/')
}

/**
 * A parsed URL (url-parse)
 */
export class UrlParse {

    [key: string]: any

    public slashes: boolean

    public protocol: string

    public hash: string

    public query: string | Record<string, string>

    public pathname: string

    public auth: string

    public host: string

    public port: string

    public hostname: string

    public username: string

    public password: string

    public origin: string

    public href: string

    /**
     * Parse an address
     * @param address
     * @param location the defaults of the relative URLs (an object or an address), or the parser of the query
     * @param parser the parser of the query, or true for the default one
     */
    constructor(address: any, location?: any, parser?: any) {
        address = TrimLeft(address).replace(CRHTLF, '')
        const instructions: Rule[] = RULES.slice()
        const type: string = typeof location
        const url: UrlParse = this
        //Node.js url.parse(address, parseQuery), or the URL of the browsers (address, location)
        if (type !== 'object' && type !== 'string') {
            parser = location
            location = null
        }
        if (parser && typeof parser !== 'function') parser = ParseQuery
        location = Location(location)
        const extracted: { protocol: string, slashes: boolean, slashesCount: number, rest: string } = ExtractProtocol(address || '', location)
        const relative: boolean = !extracted.protocol && !extracted.slashes
        url.slashes = extracted.slashes || relative && location.slashes
        url.protocol = extracted.protocol || location.protocol || ''
        address = extracted.rest
        //Without authority, the URL starts with a path
        if ((extracted.protocol === 'file:' && (extracted.slashesCount !== 2 || WINDOWS_DRIVE_LETTER.test(address))) || (!extracted.slashes && (extracted.protocol || extracted.slashesCount < 2 || !IsSpecial(url.protocol)))) {
            instructions[3] = [/(.*)/, 'pathname']
        }
        for (const instruction of instructions) {
            if (typeof instruction === 'function') {
                address = instruction(address, url)
                continue
            }
            const parse: string | RegExp | number = instruction[0]
            const key: string = instruction[1]
            if (typeof parse === 'number') {
                //NaN: the value left
                url[key] = address
            } else if (typeof parse === 'string') {
                const index: number = parse === '@' ? address.lastIndexOf(parse) : address.indexOf(parse)
                if (index !== -1) {
                    if (typeof instruction[2] === 'number') {
                        url[key] = address.slice(0, index)
                        address = address.slice(index + instruction[2])
                    } else {
                        url[key] = address.slice(index)
                        address = address.slice(0, index)
                    }
                }
            } else {
                const matched: RegExpExecArray | null = parse.exec(address)
                if (matched) {
                    url[key] = matched[1]
                    address = address.slice(0, matched.index)
                }
            }
            url[key] = url[key] || (relative && instruction[3] ? location[key] || '' : '')
            //The hostname, the host and the protocol in lowercase for the origin
            if (instruction[4]) url[key] = url[key].toLowerCase()
        }
        if (parser) url.query = parser(url.query)
        //A relative URL resolved against the base URL
        if (relative && location.slashes && url.pathname.charAt(0) !== '/' && (url.pathname !== '' || location.pathname !== '')) {
            url.pathname = Resolve(url.pathname, location.pathname)
        }
        //A pathname starting with a slash
        if (url.pathname.charAt(0) !== '/' && IsSpecial(url.protocol)) url.pathname = '/' + url.pathname
        //No default port: the host is the hostname
        if (!Required(url.port, url.protocol)) {
            url.host = url.hostname
            url.port = ''
        }
        url.username = url.password = ''
        if (url.auth) {
            const index: number = url.auth.indexOf(':')
            if (index !== -1) {
                url.username = encodeURIComponent(decodeURIComponent(url.auth.slice(0, index)))
                url.password = encodeURIComponent(decodeURIComponent(url.auth.slice(index + 1)))
            } else {
                url.username = encodeURIComponent(decodeURIComponent(url.auth))
            }
            url.auth = url.password ? url.username + ':' + url.password : url.username
        }
        url.origin = url.protocol !== 'file:' && IsSpecial(url.protocol) && url.host ? url.protocol + '//' + url.host : 'null'
        url.href = url.toString()
    }

    /**
     * Change a property of the URL, the others following it
     * @param part
     * @param value
     * @param fn the parser of a query string, or for the protocol, whether there are no slashes
     */
    public set(part: string, value: any, fn?: any): this {
        const url: UrlParse = this
        switch (part) {
            case 'query':
                if (typeof value === 'string' && value.length) value = (fn || ParseQuery)(value)
                url[part] = value
                break
            case 'port':
                url[part] = value
                if (!Required(value, url.protocol)) {
                    url.host = url.hostname
                    url[part] = ''
                } else if (value) {
                    url.host = url.hostname + ':' + value
                }
                break
            case 'hostname':
                url[part] = value
                if (url.port) value += ':' + url.port
                url.host = value
                break
            case 'host':
                url[part] = value
                if (PORT.test(value)) {
                    value = value.split(':')
                    url.port = value.pop()
                    url.hostname = value.join(':')
                } else {
                    url.hostname = value
                    url.port = ''
                }
                break
            case 'protocol':
                url.protocol = value.toLowerCase()
                url.slashes = !fn
                break
            case 'pathname':
            case 'hash':
                if (value) {
                    const char: string = part === 'pathname' ? '/' : '#'
                    url[part] = value.charAt(0) !== char ? char + value : value
                } else {
                    url[part] = value
                }
                break
            case 'username':
            case 'password':
                url[part] = encodeURIComponent(value)
                break
            case 'auth': {
                const index: number = value.indexOf(':')
                if (index !== -1) {
                    url.username = encodeURIComponent(decodeURIComponent(value.slice(0, index)))
                    url.password = encodeURIComponent(decodeURIComponent(value.slice(index + 1)))
                } else {
                    url.username = encodeURIComponent(decodeURIComponent(value))
                }
            }
        }
        for (const rule of RULES) if (typeof rule !== 'function' && rule[4]) url[rule[1]] = url[rule[1]].toLowerCase()
        url.auth = url.password ? url.username + ':' + url.password : url.username
        url.origin = url.protocol !== 'file:' && IsSpecial(url.protocol) && url.host ? url.protocol + '//' + url.host : 'null'
        url.href = url.toString()
        return this
    }

    /**
     * The URL
     * @param stringify the stringifier of the query
     */
    public toString(stringify?: QueryStringifier): string {
        if (!stringify || typeof stringify !== 'function') stringify = StringifyQuery
        const url: UrlParse = this
        let host: string = url.host
        let protocol: string = url.protocol
        if (protocol && protocol.charAt(protocol.length - 1) !== ':') protocol += ':'
        let result: string = protocol + ((url.protocol && url.slashes) || IsSpecial(url.protocol) ? '//' : '')
        if (url.username) {
            result += url.username
            if (url.password) result += ':' + url.password
            result += '@'
        } else if (url.password) {
            result += ':' + url.password
            result += '@'
        } else if (url.protocol !== 'file:' && IsSpecial(url.protocol) && !host && url.pathname !== '/') {
            //The empty userinfo, or an invalid URL would become a valid one with its pathname as host
            result += '@'
        }
        //The trailing colon of the host, or an invalid URL would become a valid one
        if (host[host.length - 1] === ':' || (PORT.test(url.hostname) && !url.port)) host += ':'
        result += host + url.pathname
        const query: string = typeof url.query === 'object' ? stringify(url.query) : url.query
        if (query) result += query.charAt(0) !== '?' ? '?' + query : query
        if (url.hash) result += url.hash
        return result
    }
}

export type {QueryParser}
