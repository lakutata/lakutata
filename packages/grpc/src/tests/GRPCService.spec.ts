import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {Container, DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BuildEntrypoints, Controller, Entrypoint, ServiceContext, ServiceInvokeException} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {GRPCCallOfContext, GRPCServiceEntrypoint, GRPCServiceProxy, SERVICE_PROTO} from '../exports/GRPCService.js'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CreateTestCertificates, OpenSSLAvailable, type TestCertificates} from './support/Certificates.js'

class OrderDTO extends DTO {
    @Expect(DTO.Number().required())
    public id: number
}

class OrderException extends Exception {
    public errno: string | number = 'E_ORDER'
}

class OrderController extends Controller {

    @ServiceAction({cmd: 'order.get'}, OrderDTO)
    public async get(input: OrderDTO): Promise<unknown> {
        return {id: input.id, client: (this.context as ServiceContext).clientId, path: GRPCCallOfContext(this.context as ServiceContext)?.path}
    }

    @ServiceAction({cmd: 'order.close'})
    public async close(): Promise<void> {
        throw new OrderException('The order is closed')
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<string> {
        await new Promise((resolve): unknown => setTimeout(resolve, 200))
        return 'slow'
    }
}

/**
 * Start an entrypoint with a gRPC service adapter, and a proxy of it
 */
async function Start(): Promise<{ container: Container, entrypoint: Entrypoint, proxy: GRPCServiceProxy, port: number }> {
    let port: number = 0
    const container: Container = new Container()
    const entrypoint: Entrypoint = await container.set(Entrypoint, BuildEntrypoints({
        controllers: [OrderController],
        service: GRPCServiceEntrypoint({port: 0, host: '127.0.0.1', listening: (address): void => void (port = (address as AddressInfo).port)})
    }))
    const proxy: GRPCServiceProxy = await container.set(GRPCServiceProxy, {address: `127.0.0.1:${port}`, clientId: 'proxy-1', reconnectDelay: 100})
    return {container: container, entrypoint: entrypoint, proxy: proxy, port: port}
}

describe('The service actions over gRPC', (): void => {

    it('invokes the actions through the proxy', async (): Promise<void> => {
        const {container, proxy} = await Start()
        try {
            assert.deepStrictEqual(await proxy.invoke({cmd: 'order.get', id: 7}), {id: 7, client: 'proxy-1', path: '/lakutata.service.v1.Service/Invoke'})
            await assert.rejects(proxy.invoke({cmd: 'order.close'}), (error: unknown): boolean => error instanceof ServiceInvokeException && error.message === 'The order is closed' && (error as any).errno === 'E_ORDER')
            await assert.rejects(proxy.invoke({cmd: 'order.get', id: 'x'}), ServiceInvokeException)
            await assert.rejects(proxy.invoke({cmd: 'missing'}), ServiceInvokeException)
            await assert.rejects(proxy.invoke({cmd: 'slow'}, 50))
        } finally {
            await container.destroy()
        }
    })

    it('limits and compresses the requests, aborts the actions at their deadlines', async (): Promise<void> => {
        let port: number = 0
        const container: Container = new Container()
        try {
            await container.set(Entrypoint, BuildEntrypoints({
                controllers: [OrderController],
                service: GRPCServiceEntrypoint({port: 0, host: '127.0.0.1', maxMessageSize: 2048, compression: 'gzip', listening: (address): void => void (port = (address as AddressInfo).port)})
            }))
            const proxy: GRPCServiceProxy = await container.set(GRPCServiceProxy, {address: `127.0.0.1:${port}`, compression: 'gzip'})
            assert.deepStrictEqual((await proxy.invoke({cmd: 'order.get', id: 1, note: 'x'.repeat(1000)})).id, 1)
            await assert.rejects(proxy.invoke({cmd: 'order.get', id: 1, note: 'x'.repeat(100000)}), (error: unknown): boolean => (error as {code?: number}).code === 8)
            await assert.rejects(proxy.invoke({cmd: 'slow'}, 50), (error: unknown): boolean => (error as {code?: number}).code === 4)
        } finally {
            await container.destroy()
        }
    })

    it('pushes the events to the clients', async (): Promise<void> => {
        const {container, entrypoint, proxy} = await Start()
        try {
            const received: unknown[][] = []
            const once: unknown[][] = []
            proxy.on('orderChanged', (...args: unknown[]): unknown => received.push(args))
            proxy.once('orderChanged', (...args: unknown[]): unknown => once.push(args))
            let delivered: boolean = false
            for (let attempt = 0; attempt < 50 && !delivered; attempt++) {
                await new Promise((resolve): unknown => setTimeout(resolve, 20))
                delivered = entrypoint.notify('proxy-1', 'orderChanged', {id: 1}, 'paid')
            }
            assert.ok(delivered)
            entrypoint.broadcast('orderChanged', {id: 2}, 'closed')
            assert.strictEqual(entrypoint.notify('nobody', 'orderChanged'), false)
            for (let attempt = 0; attempt < 50 && received.length < 2; attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
            assert.deepStrictEqual(received, [[{id: 1}, 'paid'], [{id: 2}, 'closed']])
            assert.deepStrictEqual(once, [[{id: 1}, 'paid']])
            //No listener any more: its stream closed
            proxy.off('orderChanged')
            for (let attempt = 0; attempt < 50 && entrypoint.notify('proxy-1', 'orderChanged'); attempt++) await new Promise((resolve): unknown => setTimeout(resolve, 20))
            assert.strictEqual(entrypoint.notify('proxy-1', 'orderChanged'), false)
        } finally {
            await container.destroy()
        }
    })

    it('invokes the actions over mutual TLS', {skip: !OpenSSLAvailable() && 'openssl creates the certificates of the tests'}, async (): Promise<void> => {
        const directory: string = await mkdtemp(path.join(tmpdir(), 'lakutata-grpc-tls-'))
        const container: Container = new Container()
        try {
            const certificates: TestCertificates = CreateTestCertificates(directory)
            let port: number = 0
            await container.set(Entrypoint, BuildEntrypoints({
                controllers: [OrderController],
                service: GRPCServiceEntrypoint({
                    port: 0,
                    host: '127.0.0.1',
                    tls: {cert: certificates.serverCert, key: certificates.serverKey, ca: certificates.ca},
                    listening: (address): void => void (port = (address as AddressInfo).port)
                })
            }))
            const proxy: GRPCServiceProxy = await container.set(GRPCServiceProxy, {address: `127.0.0.1:${port}`, clientId: 'tls-1', tls: {ca: certificates.ca, cert: certificates.clientCert, key: certificates.clientKey, servername: 'localhost'}})
            assert.deepStrictEqual(await proxy.invoke({cmd: 'order.get', id: 3}), {id: 3, client: 'tls-1', path: '/lakutata.service.v1.Service/Invoke'})
            //Without the certificate of its client: refused (a proxy of another container, a component being single in one)
            const other: Container = new Container()
            try {
                const anonymous: GRPCServiceProxy = await other.set(GRPCServiceProxy, {address: `127.0.0.1:${port}`, tls: {ca: certificates.ca, servername: 'localhost'}})
                assert.notStrictEqual(anonymous, proxy)
                await assert.rejects(anonymous.invoke({cmd: 'order.get', id: 3}, 2000))
            } finally {
                await other.destroy()
            }
        } finally {
            await container.destroy()
            await rm(directory, {recursive: true, force: true})
        }
    })

    it('gives the proto of its service to the other languages', (): void => {
        assert.match(SERVICE_PROTO, /service Service \{/)
        assert.match(SERVICE_PROTO, /rpc Invoke \(InvokeRequest\) returns \(InvokeResponse\);/)
        assert.match(SERVICE_PROTO, /rpc Events \(EventsRequest\) returns \(stream Event\);/)
    })
})
