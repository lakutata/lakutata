import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import http2, {type Http2Server, type ServerHttp2Stream, type IncomingHttpHeaders} from 'node:http2'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {GRPCConnection, GRPCError, GRPCStatus, decode, encode, type Message} from '@lakutata/grpc'
import {ContainerdClient, isGRPCError} from '../client/ContainerdClient.js'
import * as M from '../client/Messages.js'

/**
 * A frame of gRPC
 * @param data
 */
function encodeFrame(data: Uint8Array): Buffer {
    const frame: Buffer = Buffer.alloc(5 + data.length)
    frame.writeUInt32BE(data.length, 1)
    frame.set(data, 5)
    return frame
}

/**
 * The messages of the frames of a request
 * @param stream
 */
async function readFrames(stream: ServerHttp2Stream): Promise<Buffer[]> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    let buffer: Buffer = Buffer.concat(chunks)
    const messages: Buffer[] = []
    while (buffer.length >= 5) {
        const length: number = buffer.readUInt32BE(1)
        messages.push(buffer.subarray(5, 5 + length))
        buffer = buffer.subarray(5 + length)
    }
    return messages
}

describe('The gRPC client of containerd', (): void => {

    let directory: string
    let socket: string
    let server: Http2Server
    const seen: { path: string, headers: IncomingHttpHeaders }[] = []

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-grpc-'))
        socket = path.join(directory, 'containerd.sock')
        //A containerd of the tests: the methods the tests call
        server = http2.createServer()
        const handle = async (stream: ServerHttp2Stream, headers: IncomingHttpHeaders): Promise<void> => {
            const method: string = String(headers[':path'])
            seen.push({path: method, headers: headers})
            const reply = (message: Buffer[], status: number = 0, error: string = ''): void => {
                stream.respond({':status': 200, 'content-type': 'application/grpc'}, {waitForTrailers: true})
                stream.on('wantTrailers', (): void => stream.sendTrailers({'grpc-status': String(status), ...error ? {'grpc-message': encodeURIComponent(error)} : {}}))
                for (const frame of message) stream.write(frame)
                stream.end()
            }
            const requests: Buffer[] = await readFrames(stream)
            switch (method) {
                case '/containerd.services.version.v1.Version/Version':
                    return reply([encodeFrame(encode(M.VersionResponse, {version: '1.7.0', revision: 'test'}))])
                case '/containerd.services.images.v1.Images/Get':
                    return reply([], GRPCStatus.NOT_FOUND, `image "${decode(M.GetImageRequest, requests[0]).name}": not found`)
                case '/containerd.services.content.v1.Content/Read': {
                    //Its chunks in a frame split over writes
                    const frames: Buffer = Buffer.concat(['ab', 'cd', 'ef'].map((data: string): Buffer => encodeFrame(encode(M.ReadContentResponse, {data: Buffer.from(data)}))))
                    return reply([frames.subarray(0, 3), frames.subarray(3, 11), frames.subarray(11)])
                }
                case '/containerd.services.content.v1.Content/Write': {
                    const writes: Message[] = requests.map((request: Buffer): Message => decode(M.WriteContentRequest, request))
                    const data: string = writes.filter((write: Message): boolean => write.action === M.WriteAction.WRITE).map((write: Message): string => Buffer.from(write.data).toString()).join('')
                    const commit: Message = writes[writes.length - 1]
                    return reply(writes.map((write: Message): Buffer => encodeFrame(encode(M.WriteContentResponse, {action: write.action, offset: data.length, digest: write.action === M.WriteAction.COMMIT ? commit.expected : ''}))))
                }
                case '/containerd.services.content.v1.Content/Info':
                    return reply([], GRPCStatus.NOT_FOUND, 'not found')
                case '/containerd.services.events.v1.Events/Subscribe':
                    stream.respond({':status': 200, 'content-type': 'application/grpc'})
                    stream.write(encodeFrame(encode(M.Envelope, {namespace: 'test', topic: '/tasks/exit', event: {typeUrl: 'containerd.events.TaskExit', value: encode(M.EVENTS['containerd.events.TaskExit'], {containerId: 'c', exitStatus: 3})}})))
                    return
                default:
                    return reply([], GRPCStatus.UNIMPLEMENTED, `unknown ${method}`)
            }
        }
        server.on('stream', (stream: ServerHttp2Stream, headers: IncomingHttpHeaders): void => void handle(stream, headers))
        await new Promise<void>((resolve: () => void): void => void server.listen(socket, resolve))
    })

    after(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void): void => void server.close((): void => resolve()))
        await rm(directory, {recursive: true, force: true})
    })

    it('calls the unary methods with the metadata of the namespace', async (): Promise<void> => {
        const client: ContainerdClient = new ContainerdClient(socket, 'test')
        try {
            assert.deepStrictEqual(await client.version(), {version: '1.7.0', revision: 'test'})
            assert.strictEqual(await client.getImage('alpine'), undefined)
            assert.strictEqual(seen.find((call): boolean => call.path.endsWith('.Images/Get'))!.headers['containerd-namespace'], 'test')
            await assert.rejects(client.grpc.unary('/unknown/Method', M.Empty, {}, M.Empty), (error: unknown): boolean => isGRPCError(error, GRPCStatus.UNIMPLEMENTED) && (error as GRPCError).message === 'unknown /unknown/Method')
        } finally {
            client.close()
        }
    })

    it('reads the server streams whose frames are split', async (): Promise<void> => {
        const client: ContainerdClient = new ContainerdClient(socket, 'test')
        try {
            assert.strictEqual((await client.readAll('sha256:x')).toString(), 'abcdef')
        } finally {
            client.close()
        }
    })

    it('writes the content over a bidirectional stream, with its lease', async (): Promise<void> => {
        const client: ContainerdClient = new ContainerdClient(socket, 'test')
        try {
            const chunks = async function* (): AsyncGenerator<Uint8Array> {
                yield Buffer.from('hello ')
                yield Buffer.from('world')
            }
            await client.writeContent({digest: 'sha256:abc', size: 11}, chunks(), 'lease-1')
            assert.strictEqual(seen.find((call): boolean => call.path.endsWith('.Content/Write'))!.headers['containerd-lease'], 'lease-1')
        } finally {
            client.close()
        }
    })

    it('subscribes to the events until its signal aborts', async (): Promise<void> => {
        const client: ContainerdClient = new ContainerdClient(socket, 'test')
        const abort: AbortController = new AbortController()
        try {
            for await (const event of client.subscribe([], abort.signal)) {
                assert.strictEqual(event.topic, '/tasks/exit')
                assert.deepStrictEqual(event.event, {containerId: 'c', exitStatus: 3})
                abort.abort()
            }
        } finally {
            client.close()
        }
    })

    it('fails the calls when containerd is not there', async (): Promise<void> => {
        const connection: GRPCConnection = new GRPCConnection(path.join(directory, 'none.sock'))
        await assert.rejects(connection.unary('/containerd.services.version.v1.Version/Version', M.Empty, {}, M.VersionResponse), (error: unknown): boolean => isGRPCError(error, GRPCStatus.UNAVAILABLE))
        connection.close()
    })
})
