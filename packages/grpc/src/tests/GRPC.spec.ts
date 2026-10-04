import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Decode, Encode, GRPCConnection, GRPCError, GRPCServer, GRPCStatus, type GRPCServerCall, type Message, type Schema} from '../exports/GRPC.js'

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
        port = (await server.listen({port: 0, host: '127.0.0.1'}) as AddressInfo).port
    })

    after(async (): Promise<void> => {
        await server.close()
        await rm(directory, {recursive: true, force: true})
    })

    it('encodes and decodes the messages', (): void => {
        assert.deepStrictEqual(Decode(Text, Encode(Text, {text: 'héllo', count: 300})), {text: 'héllo', count: 300})
        assert.deepStrictEqual(Decode(Text, Encode(Text, {text: '', count: 0})), {})
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
