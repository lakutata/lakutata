import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {mkdtemp, rm} from 'node:fs/promises'
import http2, {type IncomingHttpHeaders} from 'node:http2'
import {gzipSync} from 'node:zlib'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {decode, encode, formatGRPCTimeout, GRPCConnection, GRPCError, GRPCServer, GRPCStatus, parseGRPCTimeout, type GRPCServerCall, type Message, type Schema} from '../exports/GRPC.js'
import {CreateTestCertificates, OpenSSLAvailable, type TestCertificates} from './support/Certificates.js'

const Text: Schema = {text: {no: 1, type: 'string'}, count: {no: 2, type: 'uint32'}}

describe('The gRPC client and server', (): void => {

    let directory: string
    let server: GRPCServer
    let port: number

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-grpc-'))
        server = new GRPCServer()
            .method('/test.Echo/Unary', async (call: GRPCServerCall): Promise<void> => {
                const request: Message = await call.request(Text)
                await call.send(Text, {text: `${request.text}!`, count: (request.count ?? 0) + 1})
            })
            .method('/test.Echo/Stream', async (call: GRPCServerCall): Promise<void> => {
                const request: Message = await call.request(Text)
                for (let index = 0; index < request.count; index++) await call.send(Text, {text: request.text, count: index})
            })
            .method('/test.Echo/Bidi', async (call: GRPCServerCall): Promise<void> => {
                for await (const request of call.requests(Text)) await call.send(Text, {text: String(request.text).toUpperCase()})
            })
            .method('/test.Echo/Fail', async (call: GRPCServerCall): Promise<void> => {
                await call.request(Text)
                throw new GRPCError(GRPCStatus.FAILED_PRECONDITION, 'not ready, try later', call.path)
            })
            .method('/test.Echo/Metadata', async (call: GRPCServerCall): Promise<void> => {
                await call.request(Text)
                await call.send(Text, {text: call.metadata('x-values').join('|')})
            })
            .method('/test.Echo/Binary', async (call: GRPCServerCall): Promise<void> => {
                await call.request(Text)
                await call.send(Text, {text: call.binaryMetadata('x-trace-bin').map((value: Buffer): string => value.toString('hex')).join('|')})
            })
        port = (await server.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
    })

    after(async (): Promise<void> => {
        await server.close()
        await rm(directory, {recursive: true, force: true})
    })

    it('encodes and decodes the messages', (): void => {
        assert.deepStrictEqual(decode(Text, encode(Text, {text: 'héllo', count: 300})), {text: 'héllo', count: 300})
        assert.deepStrictEqual(decode(Text, encode(Text, {text: '', count: 0})), {})
        //The 64-bit integers: numbers while safe, bigints beyond, signed or not
        const Wide: Schema = {unsigned: {no: 1, type: 'uint64'}, signed: {no: 2, type: 'int64'}, small: {no: 3, type: 'uint64'}, negative: {no: 4, type: 'int64'}}
        assert.deepStrictEqual(decode(Wide, encode(Wide, {unsigned: 2n ** 64n - 1n, signed: -(2n ** 62n), small: 42, negative: -1})), {unsigned: 2n ** 64n - 1n, signed: -(2n ** 62n), small: 42, negative: -1})
        //A map value equal to its default: the default of its type
        const Flags: Schema = {flags: {no: 1, type: 'bool', map: true}, blobs: {no: 2, type: 'bytes', map: true}}
        assert.deepStrictEqual(decode(Flags, encode(Flags, {flags: {on: true, off: false}, blobs: {empty: Buffer.alloc(0)}})), {flags: {on: true, off: false}, blobs: {empty: Buffer.alloc(0)}})
        //The timeouts in the largest unit fitting 8 digits
        assert.strictEqual(formatGRPCTimeout(1500), '1500m')
        assert.strictEqual(formatGRPCTimeout(30 * 24 * 3600 * 1000), '2592000S')
        assert.strictEqual(formatGRPCTimeout(10 * 365 * 24 * 3600 * 1000), '5256000M')
        assert.strictEqual(parseGRPCTimeout(formatGRPCTimeout(10 * 365 * 24 * 3600 * 1000)), 10 * 365 * 24 * 3600 * 1000)
    })

    it('takes the addresses of host:port, refuses TLS over the unix sockets', async (): Promise<void> => {
        const connection: GRPCConnection = new GRPCConnection(`127.0.0.1:${port}`)
        try {
            assert.strictEqual(connection.address, `tcp://127.0.0.1:${port}`)
            assert.strictEqual((await connection.unary('/test.Echo/Unary', Text, {text: 'hi'}, Text)).text, 'hi!')
        } finally {
            connection.close()
        }
        assert.throws((): unknown => new GRPCConnection('/run/test.sock', {}), /TLS is not supported over the unix socket/)
        assert.throws((): unknown => new GRPCConnection('nowhere'), /is not a unix socket/)
    })

    it('cancels a call whose signal is aborted already, keeps the long deadlines, reads the binary metadata', async (): Promise<void> => {
        const connection: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${port}`)
        try {
            await assert.rejects(connection.unary('/test.Echo/Unary', Text, {}, Text, {signal: AbortSignal.abort()}), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.CANCELLED)
            //30 days: beyond the timers of Node.js
            assert.strictEqual((await connection.unary('/test.Echo/Unary', Text, {text: 'later'}, Text, {timeout: 30 * 24 * 3600 * 1000})).text, 'later!')
            assert.strictEqual((await connection.unary('/test.Echo/Binary', Text, {}, Text, {metadata: {'x-trace-bin': [Buffer.from([1, 2]).toString('base64'), Buffer.from([255]).toString('base64')]}})).text, '0102|ff')
            //A request which is not a message of the schema
            await assert.rejects(connection.unary('/test.Echo/Unary', {raw: {no: 2, type: 'bytes'}}, {raw: Buffer.from([0xff, 0xff])}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.INTERNAL)
        } finally {
            connection.close()
        }
    })

    it('calls the unary methods, the server streams and the bidirectional streams over TCP', async (): Promise<void> => {
        const connection: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${port}`)
        try {
            assert.deepStrictEqual(await connection.unary('/test.Echo/Unary', Text, {text: 'hi', count: 1}, Text), {text: 'hi!', count: 2})
            const streamed: Message[] = []
            for await (const message of connection.serverStream('/test.Echo/Stream', Text, {text: 'x', count: 3}, Text)) streamed.push(message)
            assert.deepStrictEqual(streamed.map((message: Message): number => message.count ?? 0), [0, 1, 2])
            const bidi = connection.bidi('/test.Echo/Bidi', Text, Text)
            await bidi.send({text: 'a'})
            await bidi.send({text: 'b'})
            bidi.end()
            const answers: string[] = []
            for await (const message of bidi.responses) answers.push(message.text)
            assert.deepStrictEqual(answers, ['A', 'B'])
            assert.strictEqual((await connection.unary('/test.Echo/Metadata', Text, {}, Text, {metadata: {'x-values': ['one', 'two']}})).text, 'one|two')
            await assert.rejects(connection.unary('/test.Echo/Fail', Text, {}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.FAILED_PRECONDITION && error.message === 'not ready, try later')
            await assert.rejects(connection.unary('/test.Echo/Missing', Text, {}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.UNIMPLEMENTED)
        } finally {
            connection.close()
        }
    })

    it('serves over TLS, the certificates of the clients required by its authority', {skip: !OpenSSLAvailable() && 'openssl creates the certificates of the tests'}, async (): Promise<void> => {
        const certificates: TestCertificates = CreateTestCertificates(directory)
        const handler = async (call: GRPCServerCall): Promise<void> => {
            await call.send(Text, {text: `${(await call.request(Text)).text} over TLS`})
        }
        //TLS: the server authenticated by the client
        const tls: GRPCServer = new GRPCServer({tls: {cert: certificates.serverCert, key: certificates.serverKey}}).method('/test.Echo/Unary', handler)
        const tlsPort: number = (await tls.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
        const trusting: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${tlsPort}`, {ca: certificates.ca, servername: 'localhost'})
        const untrusting: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${tlsPort}`, {servername: 'localhost'})
        const plain: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${tlsPort}`)
        try {
            assert.strictEqual((await trusting.unary('/test.Echo/Unary', Text, {text: 'hello'}, Text)).text, 'hello over TLS')
            //Its certificate not trusted, or no TLS
            await assert.rejects(untrusting.unary('/test.Echo/Unary', Text, {text: 'hello'}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.UNAVAILABLE)
            await assert.rejects(plain.unary('/test.Echo/Unary', Text, {text: 'hello'}, Text, {signal: AbortSignal.timeout(2000)}))
        } finally {
            trusting.close()
            untrusting.close()
            plain.close()
            await tls.close()
        }
        //Mutual TLS: the clients authenticated by the authority of the server
        const mutual: GRPCServer = new GRPCServer({tls: {cert: certificates.serverCert, key: certificates.serverKey, ca: certificates.ca}}).method('/test.Echo/Unary', handler)
        const mutualPort: number = (await mutual.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
        const authenticated: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${mutualPort}`, {ca: certificates.ca, cert: certificates.clientCert, key: certificates.clientKey, servername: 'localhost'})
        const anonymous: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${mutualPort}`, {ca: certificates.ca, servername: 'localhost'})
        try {
            assert.strictEqual((await authenticated.unary('/test.Echo/Unary', Text, {text: 'mutual'}, Text)).text, 'mutual over TLS')
            await assert.rejects(anonymous.unary('/test.Echo/Unary', Text, {text: 'anonymous'}, Text, {signal: AbortSignal.timeout(2000)}))
        } finally {
            authenticated.close()
            anonymous.close()
            await mutual.close()
        }
    })

    it('limits the size of the messages received, compressed or not', async (): Promise<void> => {
        const limited: GRPCServer = new GRPCServer({maxMessageSize: 1024}).method('/test.Echo/Unary', async (call: GRPCServerCall): Promise<void> => {
            await call.send(Text, {text: `${String((await call.request(Text)).text).length} bytes`})
        })
        const limitedPort: number = (await limited.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
        const plain: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${limitedPort}`)
        const gzip: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${limitedPort}`, undefined, {compression: 'gzip'})
        try {
            assert.strictEqual((await plain.unary('/test.Echo/Unary', Text, {text: 'x'.repeat(1000)}, Text)).text, '1000 bytes')
            await assert.rejects(plain.unary('/test.Echo/Unary', Text, {text: 'x'.repeat(2000)}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.RESOURCE_EXHAUSTED)
            //Small once compressed, too large once decompressed
            await assert.rejects(gzip.unary('/test.Echo/Unary', Text, {text: 'x'.repeat(100000)}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.RESOURCE_EXHAUSTED)
            assert.strictEqual((await gzip.unary('/test.Echo/Unary', Text, {text: 'y'.repeat(500)}, Text)).text, '500 bytes')
            //The responses limited by the connections
            const small: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${port}`, undefined, {maxMessageSize: 10})
            await assert.rejects(small.unary('/test.Echo/Unary', Text, {text: 'a longer text'}, Text), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.RESOURCE_EXHAUSTED)
            small.close()
        } finally {
            plain.close()
            gzip.close()
            await limited.close()
        }
    })

    it('compresses the messages with gzip and deflate, the responses for the clients accepting it', async (): Promise<void> => {
        const compressing: GRPCServer = new GRPCServer({compression: 'gzip'}).method('/test.Echo/Unary', async (call: GRPCServerCall): Promise<void> => {
            await call.send(Text, {text: `${(await call.request(Text)).text}!`})
        })
        const compressingPort: number = (await compressing.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
        try {
            for (const compression of ['gzip', 'deflate', 'identity'] as const) {
                const connection: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${compressingPort}`, undefined, {compression: compression})
                assert.strictEqual((await connection.unary('/test.Echo/Unary', Text, {text: compression.repeat(100)}, Text)).text, `${compression.repeat(100)}!`)
                connection.close()
            }
            //Raw: the response compressed for a client accepting gzip, not for the other ones; an unknown compression refused
            const raw = async (headers: Record<string, string>, body: Buffer): Promise<{ headers: IncomingHttpHeaders, trailers: IncomingHttpHeaders, body: Buffer }> => {
                const client = http2.connect(`http://127.0.0.1:${compressingPort}`)
                try {
                    const stream = client.request({':method': 'POST', ':path': '/test.Echo/Unary', 'content-type': 'application/grpc', 'te': 'trailers', ...headers})
                    const chunks: Buffer[] = []
                    let responseHeaders: IncomingHttpHeaders = {}
                    let trailers: IncomingHttpHeaders = {}
                    stream.on('response', (value: IncomingHttpHeaders): unknown => responseHeaders = value)
                    stream.on('trailers', (value: IncomingHttpHeaders): unknown => trailers = value)
                    stream.on('data', (chunk: Buffer): unknown => chunks.push(chunk))
                    stream.end(body)
                    await new Promise((resolve): unknown => stream.on('close', resolve))
                    return {headers: responseHeaders, trailers: trailers, body: Buffer.concat(chunks)}
                } finally {
                    client.close()
                }
            }
            const encoded: Buffer = Buffer.from(encode(Text, {text: 'raw'}))
            const plainFrame: Buffer = Buffer.concat([Buffer.from([0, 0, 0, 0, encoded.length]), encoded])
            const accepting = await raw({'grpc-accept-encoding': 'identity,gzip'}, plainFrame)
            assert.strictEqual(accepting.headers['grpc-encoding'], 'gzip')
            assert.strictEqual(accepting.body[0], 1)
            const notAccepting = await raw({}, plainFrame)
            assert.strictEqual(notAccepting.headers['grpc-encoding'], undefined)
            assert.strictEqual(notAccepting.body[0], 0)
            const compressed: Buffer = gzipSync(encoded)
            const gzipFrame: Buffer = Buffer.concat([Buffer.from([1, 0, 0, 0, compressed.length]), compressed])
            assert.strictEqual((await raw({'grpc-encoding': 'gzip'}, gzipFrame)).trailers['grpc-status'], '0')
            assert.strictEqual((await raw({'grpc-encoding': 'br'}, gzipFrame)).trailers['grpc-status'], String(GRPCStatus.UNIMPLEMENTED))
        } finally {
            await compressing.close()
        }
    })

    it('keeps the deadlines of the calls', async (): Promise<void> => {
        const aborted: string[] = []
        const slow: GRPCServer = new GRPCServer().method('/test.Echo/Slow', async (call: GRPCServerCall): Promise<void> => {
            await call.request(Text)
            await new Promise<void>((resolve: () => void): void => {
                const timer: NodeJS.Timeout = setTimeout(resolve, 1000)
                call.signal.addEventListener('abort', (): void => {
                    aborted.push((call.signal.reason as GRPCError).code === GRPCStatus.DEADLINE_EXCEEDED ? 'deadline' : 'cancelled')
                    clearTimeout(timer)
                    resolve()
                })
            })
        })
        const slowPort: number = (await slow.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
        const connection: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${slowPort}`)
        try {
            //The client ends the call at its deadline
            await assert.rejects(connection.unary('/test.Echo/Slow', Text, {}, Text, {timeout: 100}), (error: unknown): boolean => error instanceof GRPCError && error.code === GRPCStatus.DEADLINE_EXCEEDED)
            //The server answers at the deadline of a client which does not end it
            const client = http2.connect(`http://127.0.0.1:${slowPort}`)
            const stream = client.request({':method': 'POST', ':path': '/test.Echo/Slow', 'content-type': 'application/grpc', 'te': 'trailers', 'grpc-timeout': '100m'})
            let trailers: IncomingHttpHeaders = {}
            stream.on('trailers', (value: IncomingHttpHeaders): unknown => trailers = value).resume()
            const started: number = Date.now()
            stream.end(Buffer.from([0, 0, 0, 0, 0]))
            await new Promise((resolve): unknown => stream.on('close', resolve))
            client.close()
            assert.strictEqual(trailers['grpc-status'], String(GRPCStatus.DEADLINE_EXCEEDED))
            assert.ok(Date.now() - started < 900)
            for (let attempt = 0; attempt < 20 && aborted.length < 2; attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
            assert.ok(aborted.includes('deadline'), aborted.join())
        } finally {
            connection.close()
            await slow.close()
        }
    })

    it('listens on the unix sockets', async (): Promise<void> => {
        const socketServer: GRPCServer = new GRPCServer().method('/test.Echo/Unary', async (call: GRPCServerCall): Promise<void> => {
            await call.send(Text, {text: `${(await call.request(Text)).text}?`})
        })
        const socketPath: string = path.join(directory, 'grpc.sock')
        await socketServer.listen({socketPath: socketPath})
        const connection: GRPCConnection = new GRPCConnection(`unix://${socketPath}`)
        try {
            assert.strictEqual((await connection.unary('/test.Echo/Unary', Text, {text: 'socket'}, Text)).text, 'socket?')
        } finally {
            connection.close()
            await socketServer.close()
        }
    })
})
