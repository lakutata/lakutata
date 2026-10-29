import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn} from 'node:child_process'
import {createServer as createHTTPServer, request as httpRequest, type Server as HTTPServer} from 'node:http'
import {connect as http2Connect, createSecureServer as createHTTP2SecureServer, createServer as createHTTP2Server, type ClientHttp2Session} from 'node:http2'
import {createServer as createHTTPSServer, request as httpsRequest} from 'node:https'
import {createServer as createNetServer, type Server} from 'node:net'
import {connect as tlsConnect, createServer as createTLSServer, type TLSSocket} from 'node:tls'
import {
    type InterfaceAddress,
    type InterfaceListener,
    listenOn,
    listInterfaces,
    NetIfException,
    NetIfNotEnforcedException,
    NetIfNotSupportedException,
    NetworkInterface,
    type NetworkInterfaceInfo
} from '../exports/Netif.js'
import {CERTIFICATE, KEY} from './support/Certificate.js'
import {mayBind} from './support/Permission.js'

//A URL: import() takes no path of Windows
const EXPORTS: string = new URL('../exports/Netif.js', import.meta.url).href

function loopback(): NetworkInterfaceInfo {
    return listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!
}

function hasIPv6Loopback(): boolean {
    return loopback().addresses.some((address: InterfaceAddress): boolean => address.address === '::1')
}

/**
 * A GET of http(s)://host:port/: the text of the response, or the code of the error
 */
function get(host: string, port: number, secure: boolean = false): Promise<string> {
    return new Promise((resolve: (text: string) => void): void => {
        const request = (secure ? httpsRequest : httpRequest)({host: host, port: port, path: '/', ca: CERTIFICATE, agent: false, timeout: 3000}, (response): void => {
            let text: string = ''
            response.setEncoding('utf8')
            response.on('data', (chunk: string): void => {
                text += chunk
            })
            response.on('end', (): void => resolve(text))
        })
        request.on('timeout', (): void => {
            request.destroy()
            resolve('timed out')
        })
        request.on('error', (error: NodeJS.ErrnoException): void => resolve(error.code ?? error.message))
        request.end()
    })
}

function textServer(text: string): HTTPServer {
    return createHTTPServer((request, response): void => {
        response.setHeader('connection', 'close')
        response.end(text)
    })
}

describe('A listener', (): void => {

    it('gives the connections of the interface to an http server', async (): Promise<void> => {
        const server: HTTPServer = textServer('hello')
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const listener: InterfaceListener = await followed.listen(server, {port: 0, family: 'IPv4'})
        try {
            assert.strictEqual(listener.listening, true)
            assert.ok(listener.port! > 0)
            assert.ok(listener.addresses.some(address => address.address === '127.0.0.1' && address.port === listener.port))
            assert.strictEqual(server.listening, false)
            assert.strictEqual(await get('127.0.0.1', listener.port!), 'hello')
        } finally {
            await listener.close()
            followed.close()
        }
        assert.strictEqual(listener.closed, true)
        assert.strictEqual(listener.listening, false)
        assert.strictEqual(await get('127.0.0.1', listener.port!), 'ECONNREFUSED')
    })

    it('listens on both families by default', {skip: hasIPv6Loopback() ? false : 'no ::1'}, async (): Promise<void> => {
        const listener: InterfaceListener = await listenOn(loopback().name, textServer('both'), {port: 0})
        try {
            assert.strictEqual(await get('127.0.0.1', listener.port!), 'both')
            assert.strictEqual(await get('::1', listener.port!), 'both')
            const families: Set<string> = new Set(listener.addresses.map(address => address.family))
            assert.deepStrictEqual([...families].sort(), ['IPv4', 'IPv6'])
        } finally {
            await listener.close()
        }
        assert.strictEqual(listener.networkInterface.closed, true)
    })

    it('tells whether the connections of the other interfaces are refused', async (): Promise<void> => {
        const listener: InterfaceListener = await listenOn(loopback().name, textServer(''), {port: 0, family: 'IPv4'})
        try {
            //Linux: bound to the interface, unless the process may not (then by address, as elsewhere)
            if (process.platform === 'linux') assert.strictEqual(listener.enforced, mayBind())
            if (!listener.enforced) assert.match(listener.reason ?? '', /\S/)
            if (listener.enforced) assert.strictEqual(listener.reason, undefined)
        } finally {
            await listener.close()
        }
    })

    it('refuses to listen strictly where it cannot be enforced', async (t): Promise<void> => {
        const probe: InterfaceListener = await listenOn(loopback().name, textServer(''), {port: 0, family: 'IPv4'})
        const enforced: boolean = probe.enforced
        await probe.close()
        if (enforced) {
            const strict: InterfaceListener = await listenOn(loopback().name, textServer('strict'), {port: 0, family: 'IPv4', strict: true})
            assert.strictEqual(await get('127.0.0.1', strict.port!), 'strict')
            await strict.close()
            return t.skip('the system enforces it here')
        }
        await assert.rejects(listenOn(loopback().name, textServer(''), {port: 0, family: 'IPv4', strict: true}), NetIfNotEnforcedException)
    })

    it('gives the connections to https and tls servers', async (): Promise<void> => {
        const https = createHTTPSServer({key: KEY, cert: CERTIFICATE}, (request, response): void => {
            response.setHeader('connection', 'close')
            response.end('secure')
        })
        const tls = createTLSServer({key: KEY, cert: CERTIFICATE}, (socket: TLSSocket): void => {
            socket.end('tls')
        })
        //Bun answers in plain HTTP on its https server: refused there
        if (process.versions.bun) {
            await assert.rejects(listenOn(loopback().name, https, {port: 0, family: 'IPv4'}), NetIfNotSupportedException)
        }
        const httpsListener: InterfaceListener | undefined = process.versions.bun ? undefined : await listenOn(loopback().name, https, {port: 0, family: 'IPv4'})
        const tlsListener: InterfaceListener = await listenOn(loopback().name, tls, {port: 0, family: 'IPv4'})
        try {
            if (httpsListener) assert.strictEqual(await get('127.0.0.1', httpsListener.port!, true), 'secure')
            const received: string = await new Promise((resolve: (text: string) => void, reject: (error: Error) => void): void => {
                const socket: TLSSocket = tlsConnect({host: '127.0.0.1', port: tlsListener.port!, ca: CERTIFICATE}, (): void => undefined)
                let text: string = ''
                socket.setEncoding('utf8')
                socket.on('data', (chunk: string): void => {
                    text += chunk
                })
                socket.on('end', (): void => resolve(text))
                socket.on('error', reject)
            })
            assert.strictEqual(received, 'tls')
        } finally {
            await httpsListener?.close()
            await tlsListener.close()
        }
    })

    it('gives the connections to a secure http2 server, also for HTTP/1 clients', async (): Promise<void> => {
        const server = createHTTP2SecureServer({key: KEY, cert: CERTIFICATE, allowHTTP1: true}, (request, response): void => {
            response.setHeader('connection', 'close')
            response.end('h2s')
        })
        const listener: InterfaceListener = await listenOn(loopback().name, server, {port: 0, family: 'IPv4'})
        try {
            assert.strictEqual(await get('127.0.0.1', listener.port!, true), 'h2s')
        } finally {
            await listener.close()
        }
    })

    it('gives the connections to an http2 server', async (): Promise<void> => {
        const server = createHTTP2Server((request, response): void => {
            response.end('h2')
        })
        const listener: InterfaceListener = await listenOn(loopback().name, server, {port: 0, family: 'IPv4'})
        const session: ClientHttp2Session = http2Connect(`http://127.0.0.1:${listener.port}`)
        try {
            const text: string = await new Promise((resolve: (text: string) => void, reject: (error: Error) => void): void => {
                const stream = session.request({':path': '/'})
                let body: string = ''
                stream.setEncoding('utf8')
                stream.on('data', (chunk: string): void => {
                    body += chunk
                })
                stream.on('end', (): void => resolve(body))
                stream.on('error', reject)
                stream.end()
            })
            assert.strictEqual(text, 'h2')
        } finally {
            session.close()
            await listener.close()
        }
    })

    it('keeps a port the system chose for every family', {skip: hasIPv6Loopback() ? false : 'no ::1'}, async (): Promise<void> => {
        const listener: InterfaceListener = await listenOn(loopback().name, textServer(''), {port: 0})
        try {
            assert.ok(listener.addresses.length >= 2)
            assert.ok(listener.addresses.every(address => address.port === listener.port))
        } finally {
            await listener.close()
        }
    })

    it('rejects a port taken', async (): Promise<void> => {
        const taken: Server = createNetServer()
        await new Promise<void>((resolve: () => void): void => {
            taken.listen(0, '127.0.0.1', resolve)
        })
        const port: number = (taken.address() as {port: number}).port
        try {
            await assert.rejects(listenOn(loopback().name, textServer(''), {port: port, family: 'IPv4'}), (error: NetIfException | NodeJS.ErrnoException): boolean => {
                return (error as NetIfException).errno === 'EADDRINUSE' || (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
            })
        } finally {
            taken.close()
        }
    })

    it('rejects what is not a server or a port', async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        try {
            await assert.rejects(followed.listen({} as Server, {port: 0}), TypeError)
            await assert.rejects(followed.listen(textServer(''), {port: 70000}), TypeError)
            await assert.rejects(followed.listen(textServer(''), {port: 0, family: 'IPv5' as 'IPv4'}), TypeError)
        } finally {
            followed.close()
        }
    })

    it('is closed with its interface', async (): Promise<void> => {
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        const listener: InterfaceListener = await followed.listen(textServer(''), {port: 0, family: 'IPv4'})
        let closed: boolean = false
        listener.on('close', (): void => {
            closed = true
        })
        followed.close()
        assert.strictEqual(closed, true)
        assert.strictEqual(listener.closed, true)
        await assert.rejects(followed.listen(textServer(''), {port: 0}), NetIfException)
    })

    it('waits for an interface that does not exist yet, and keeps the process alive meanwhile', async (): Promise<void> => {
        const code: string = `import(${JSON.stringify(EXPORTS)}).then(async ({listenOn}) => {
            const listener = await listenOn('netif-absent0', require('node:http').createServer(), {port: 0})
            console.log(JSON.stringify({listening: listener.listening, addresses: listener.addresses}))
            if (process.argv[1] === 'close') await listener.close()
        })`
        for (const mode of ['keep', 'close']) {
            //In Electron, its executable runs as Node.js
            const child = spawn(process.execPath, ['-e', code, mode], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}})
            let output: string = ''
            child.stdout.on('data', (chunk: Buffer): void => {
                output += chunk.toString()
            })
            const exited: boolean = await new Promise((resolve: (exited: boolean) => void): void => {
                const timer: NodeJS.Timeout = setTimeout((): void => {
                    child.kill()
                    resolve(false)
                }, 2000)
                child.once('exit', (): void => {
                    clearTimeout(timer)
                    resolve(true)
                })
            })
            assert.deepStrictEqual(JSON.parse(output), {listening: false, addresses: []})
            assert.strictEqual(exited, mode === 'close', mode)
        }
    })
})
