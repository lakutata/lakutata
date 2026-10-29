import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm} from 'node:fs/promises'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {type InterfaceAddress, type InterfaceListener, listInterfaces, type NetworkInterfaceInfo} from '@lakutata/netif'
import {GRPCConnection, GRPCServer, type GRPCServerCall, type Message, type Schema} from '../exports/GRPC.js'
import {grpcServiceEntrypoint, GRPCServiceProxy} from '../exports/GRPCService.js'
import {createTestCertificates, openSSLAvailable, type TestCertificates} from './support/Certificates.js'

const Text: Schema = {text: {no: 1, type: 'string'}}

/**
 * The loopback interface, found by its address
 */
const LOOPBACK: string = listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!.name

class PingController extends Controller {
    @ServiceAction({cmd: 'ping'})
    public async ping(): Promise<string> {
        return 'pong'
    }
}

/**
 * A server answering its unary calls, slowly for the text 'slow'
 */
function echoServer(options: ConstructorParameters<typeof GRPCServer>[0] = {}): GRPCServer {
    return new GRPCServer(options).method('/test.Echo/Unary', async (call: GRPCServerCall): Promise<void> => {
        const {text} = await call.request(Text) as { text: string }
        if (text === 'slow') await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
        await call.send(Text, {text: `${text}!`})
    })
}

describe('gRPC listening on an interface', (): void => {

    let directory: string

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-grpc-netif-'))
    })

    after(async (): Promise<void> => {
        await rm(directory, {recursive: true, force: true})
    })

    it('serves the calls through the interface, and completes the calls in progress when it closes', async (): Promise<void> => {
        const server: GRPCServer = echoServer()
        const address: AddressInfo | null = await server.listen({interface: LOOPBACK, port: 0, family: 'IPv4'})
        assert.strictEqual(address?.address, '127.0.0.1')
        assert.strictEqual(server.listeners.length, 1)
        const connection: GRPCConnection = new GRPCConnection(`127.0.0.1:${address!.port}`)
        try {
            assert.strictEqual((await connection.unary('/test.Echo/Unary', Text, {text: 'hi'}, Text)).text, 'hi!')
            const slow: Promise<Message> = connection.unary('/test.Echo/Unary', Text, {text: 'slow'}, Text)
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            const closed: Promise<void> = server.close()
            assert.strictEqual((await slow).text, 'slow!')
            await closed
            assert.strictEqual(server.listeners.length, 0)
        } finally {
            connection.close()
        }
        const late: GRPCConnection = new GRPCConnection(`127.0.0.1:${address!.port}`)
        try {
            await assert.rejects(late.unary('/test.Echo/Unary', Text, {text: 'late'}, Text, {signal: AbortSignal.timeout(2000)}))
        } finally {
            late.close()
        }
    })

    it('serves over TLS through the interface', {skip: !openSSLAvailable() && 'openssl creates the certificates of the tests'}, async (): Promise<void> => {
        const certificates: TestCertificates = createTestCertificates(directory)
        const server: GRPCServer = echoServer({tls: {cert: certificates.serverCert, key: certificates.serverKey}})
        const address: AddressInfo | null = await server.listen({interface: LOOPBACK, port: 0, family: 'IPv4'})
        const connection: GRPCConnection = new GRPCConnection(`tcp://127.0.0.1:${address!.port}`, {ca: certificates.ca, servername: 'localhost'})
        try {
            assert.strictEqual((await connection.unary('/test.Echo/Unary', Text, {text: 'hello'}, Text)).text, 'hello!')
        } finally {
            connection.close()
            await server.close()
        }
    })

    it('has no address while the interface does not exist', async (): Promise<void> => {
        const server: GRPCServer = echoServer()
        try {
            assert.strictEqual(await server.listen({interface: 'netif-absent0', port: 0}), null)
            assert.strictEqual(server.listeners[0].listening, false)
        } finally {
            await server.close()
        }
    })

    it('serves the service actions of grpcServiceEntrypoint through the interface', async (): Promise<void> => {
        let port: number = 0
        let listeners: InterfaceListener[] | undefined
        const container: Container = new Container()
        await container.set(Entrypoint, buildEntrypoints({
            controllers: [PingController],
            service: grpcServiceEntrypoint({
                port: 0,
                interface: LOOPBACK,
                family: 'IPv4',
                listening: (address: AddressInfo | string | null, made?: InterfaceListener[]): void => {
                    port = (address as AddressInfo).port
                    listeners = made
                }
            })
        }))
        try {
            assert.strictEqual(listeners!.length, 1)
            const proxy: GRPCServiceProxy = await container.set(GRPCServiceProxy, {address: `127.0.0.1:${port}`})
            assert.strictEqual(await proxy.invoke({cmd: 'ping'}), 'pong')
        } finally {
            await container.destroy()
        }
        assert.strictEqual(listeners![0].closed, true)
    })

    it('refuses the options that contradict', async (): Promise<void> => {
        await assert.rejects(echoServer().listen({interface: LOOPBACK, host: '127.0.0.1'} as never), TypeError)
        assert.throws((): unknown => grpcServiceEntrypoint({socketPath: path.join(directory, 'grpc.sock'), interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => grpcServiceEntrypoint({host: '127.0.0.1', interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => grpcServiceEntrypoint({strict: true}), TypeError)
    })
})
