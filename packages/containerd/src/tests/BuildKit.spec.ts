import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import http2, {type ClientHttp2Session, type ClientHttp2Stream, type Http2Server, type ServerHttp2Stream} from 'node:http2'
import {lstat, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Duplex} from 'node:stream'
import {GRPCConnection} from '../client/GRPC.js'
import {BuildKitSession, GoFileMode, PatternExpression, WalkDirectory, type SyncEntry} from '../client/BuildKit.js'
import * as B from '../client/BuildKitMessages.js'
import {Decode, Encode, type Message, type Schema} from '../client/Protobuf.js'

function Frame(schema: Schema, message: Message): Buffer {
    const data: Uint8Array = Encode(schema, message)
    const frame: Buffer = Buffer.alloc(5 + data.length)
    frame.writeUInt32BE(data.length, 1)
    frame.set(data, 5)
    return frame
}

/**
 * The messages of the frames of a stream, as they come
 * @param stream
 * @param schema
 */
async function* Messages(stream: AsyncIterable<Buffer>, schema: Schema): AsyncGenerator<Message> {
    let buffer: Buffer = Buffer.alloc(0)
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt32BE(1)) {
            const length: number = buffer.readUInt32BE(1)
            yield Decode(schema, buffer.subarray(5, 5 + length))
            buffer = buffer.subarray(5 + length)
        }
    }
}

describe('The builds with BuildKit', (): void => {

    let directory: string
    let context: string
    let socket: string
    let daemon: Http2Server
    /**
     * The connection of the daemon to the session (the daemon is its client)
     */
    let sessionClient: Promise<{ client: ClientHttp2Session, headers: http2.IncomingHttpHeaders }>

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-buildkit-'))
        context = path.join(directory, 'context')
        await mkdir(path.join(context, 'src', 'deep'), {recursive: true})
        await mkdir(path.join(context, 'node_modules', 'x'), {recursive: true})
        await writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\n')
        await writeFile(path.join(context, 'src', 'index.js'), 'console.log(1)\n')
        await writeFile(path.join(context, 'src', 'deep', 'big.bin'), Buffer.alloc(100000, 7))
        await writeFile(path.join(context, 'node_modules', 'x', 'index.js'), '')
        await writeFile(path.join(context, 'b.txt'), 'b')
        await symlink('Dockerfile', path.join(context, 'Linked.Dockerfile'))
        socket = path.join(directory, 'buildkitd.sock')
        //A daemon of BuildKit: its Session opens the connection of HTTP/2 to the session of the client
        daemon = http2.createServer()
        daemon.on('stream', (stream: ServerHttp2Stream, headers: http2.IncomingHttpHeaders): void => {
            if (headers[':path'] !== '/moby.buildkit.v1.Control/Session') return void stream.respond({':status': 404})
            stream.respond({':status': 200, 'content-type': 'application/grpc'})
            const tunnel: Duplex = new Duplex({
                write: (chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void => void stream.write(Frame(B.BytesMessage, {data: chunk}), callback),
                read: (): void => undefined
            })
            ;(async (): Promise<void> => {
                for await (const message of Messages(stream as AsyncIterable<Buffer>, B.BytesMessage)) tunnel.push(Buffer.from(message.data))
                tunnel.push(null)
            })().catch((): void => void tunnel.push(null))
            const client: ClientHttp2Session = http2.connect('http://session', {createConnection: (): Duplex => tunnel})
            client.on('error', (): void => undefined)
            resolveClient({client: client, headers: headers})
        })
        let resolveClient: (value: { client: ClientHttp2Session, headers: http2.IncomingHttpHeaders }) => void = (): void => undefined
        sessionClient = new Promise((resolve): void => void (resolveClient = resolve))
        await new Promise<void>((resolve: () => void): void => void daemon.listen(socket, resolve))
    })

    after(async (): Promise<void> => {
        daemon.close()
        await rm(directory, {recursive: true, force: true})
    })

    it('matches the patterns of fsutil', (): void => {
        assert.ok(PatternExpression('Dockerfile').test('Dockerfile'))
        assert.ok(!PatternExpression('Dockerfile').test('src/Dockerfile'))
        assert.ok(PatternExpression('*.Dockerfile').test('App.Dockerfile'))
        assert.ok(PatternExpression('src/**/*.js').test('src/a/b/c.js'))
        assert.ok(PatternExpression('src/**/*.js').test('src/c.js'))
        assert.ok(PatternExpression('file.[ch]').test('file.c'))
        assert.ok(!PatternExpression('file.[!ch]').test('file.c'))
    })

    it('gives the modes of the files as Go does', async (): Promise<void> => {
        assert.strictEqual(GoFileMode(await lstat(path.join(context, 'src'), {bigint: true})), (0x80000000 | 0o755) >>> 0)
        assert.strictEqual(GoFileMode(await lstat(path.join(context, 'Linked.Dockerfile'), {bigint: true})) & 0x08000000, 0x08000000)
    })

    it('walks the directories as fsutil does: their order, their patterns', async (): Promise<void> => {
        const paths = async (filter = {}): Promise<string[]> => (await WalkDirectory(context, filter)).map((entry: SyncEntry): string => entry.path)
        assert.deepStrictEqual(await paths(), ['Dockerfile', 'Linked.Dockerfile', 'b.txt', 'node_modules', 'node_modules/x', 'node_modules/x/index.js', 'src', 'src/deep', 'src/deep/big.bin', 'src/index.js'])
        assert.deepStrictEqual(await paths({exclude: ['node_modules', '**/*.bin']}), ['Dockerfile', 'Linked.Dockerfile', 'b.txt', 'src', 'src/deep', 'src/index.js'])
        assert.deepStrictEqual(await paths({include: ['src/deep/big.bin']}), ['src', 'src/deep', 'src/deep/big.bin'])
        //The Dockerfile linked: its target followed
        assert.deepStrictEqual(await paths({include: ['Linked.Dockerfile'], followPaths: ['Linked.Dockerfile']}), ['Dockerfile', 'Linked.Dockerfile'])
        const [file] = await WalkDirectory(context, {include: ['b.txt']})
        assert.strictEqual(file.stat.size, 1)
        assert.strictEqual(typeof file.stat.modTime, 'bigint')
    })

    it('serves the files, the credentials and its health to the daemon over the session', async (): Promise<void> => {
        const session: BuildKitSession = new BuildKitSession({
            name: 'test',
            sharedKey: context,
            directories: {context: context},
            credentials: (registry: string): { username: string, password: string } | undefined => registry === 'docker.io' ? {username: 'user', password: 'secret'} : undefined
        })
        const connection: GRPCConnection = new GRPCConnection(`unix://${socket}`)
        session.start(connection)
        const {client, headers} = await sessionClient
        try {
            assert.strictEqual(headers['x-docker-expose-session-uuid'], session.id)
            assert.match(String(headers['x-docker-expose-session-grpc-method']), /\/moby\.filesync\.v1\.FileSync\/DiffCopy/)
            const call = (method: string, metadata: Record<string, string> = {}): ClientHttp2Stream => client.request({':method': 'POST', ':path': method, 'content-type': 'application/grpc', 'te': 'trailers', ...metadata})
            //Its health
            const health: ClientHttp2Stream = call('/grpc.health.v1.Health/Check')
            health.end(Frame(B.HealthCheckRequest, {}))
            for await (const message of Messages(health as AsyncIterable<Buffer>, B.HealthCheckResponse)) assert.strictEqual(message.status, 1)
            //The credentials of Docker Hub, by the host of its registry
            const credentials: ClientHttp2Stream = call('/moby.filesync.v1.Auth/Credentials')
            credentials.end(Frame(B.CredentialsRequest, {host: 'registry-1.docker.io'}))
            for await (const message of Messages(credentials as AsyncIterable<Buffer>, B.CredentialsResponse)) assert.deepStrictEqual(message, {username: 'user', secret: 'secret'})
            //The files of the context, as the receiver of fsutil asks them
            const copy: ClientHttp2Stream = call('/moby.filesync.v1.FileSync/DiffCopy', {'dir-name': 'context', 'exclude-patterns': 'node_modules'})
            const stats: Message[] = []
            const files: Map<number, Buffer[]> = new Map()
            let finished: boolean = false
            for await (const packet of Messages(copy as AsyncIterable<Buffer>, B.Packet)) {
                const type: number = packet.type ?? B.PacketType.STAT
                if (type === B.PacketType.STAT && packet.stat) {
                    stats.push(packet.stat)
                } else if (type === B.PacketType.STAT) {
                    //The last stat: the files requested
                    stats.forEach((stat: Message, id: number): unknown => (stat.mode & 0x80000000) || (stat.mode & 0x08000000) ? undefined : copy.write(Frame(B.Packet, {type: B.PacketType.REQ, id: id})))
                    if (!stats.some((stat: Message): boolean => !((stat.mode & 0x80000000) || (stat.mode & 0x08000000)))) copy.end(Frame(B.Packet, {type: B.PacketType.FIN}))
                } else if (type === B.PacketType.DATA) {
                    const id: number = packet.id ?? 0
                    if (!files.has(id)) files.set(id, [])
                    if (packet.data?.length) {
                        files.get(id)!.push(Buffer.from(packet.data))
                    } else {
                        (files.get(id) as Buffer[] & { done?: boolean }).done = true
                        const regular: number = stats.filter((stat: Message): boolean => !((stat.mode & 0x80000000) || (stat.mode & 0x08000000))).length
                        if ([...files.values()].filter((chunks: Buffer[] & { done?: boolean }): boolean => !!chunks.done).length === regular) copy.end(Frame(B.Packet, {type: B.PacketType.FIN}))
                    }
                } else if (type === B.PacketType.FIN) {
                    finished = true
                }
            }
            assert.ok(finished)
            assert.deepStrictEqual(stats.map((stat: Message): string => stat.path), ['Dockerfile', 'Linked.Dockerfile', 'b.txt', 'src', 'src/deep', 'src/deep/big.bin', 'src/index.js'])
            assert.strictEqual(stats[1].linkname, 'Dockerfile')
            const content = (file: string): string => Buffer.concat(files.get(stats.findIndex((stat: Message): boolean => stat.path === file))!).toString()
            assert.strictEqual(content('src/index.js'), 'console.log(1)\n')
            assert.strictEqual(content('src/deep/big.bin').length, 100000)
            //A directory the session has not
            const missing: ClientHttp2Stream = call('/moby.filesync.v1.FileSync/DiffCopy', {'dir-name': 'other'})
            missing.end()
            const trailers: http2.IncomingHttpHeaders = await new Promise((resolve): void => void missing.on('trailers', resolve).resume())
            assert.strictEqual(trailers['grpc-status'], '5')
        } finally {
            session.close()
            client.close()
            connection.close()
        }
    })
})
