/*
 * The service of the tests of interoperability (test-env/interop.sh): the service actions served over gRPC to the
 * clients of the other implementations; its port written once it listens, the proto of its service written where asked
 */
import {writeFileSync} from 'node:fs'
import type {AddressInfo} from 'node:net'
import {Container, DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint, type ServiceContext} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {grpcServiceEntrypoint, SERVICE_PROTO} from '../../exports/GRPCService.js'

class OrderDTO extends DTO {
    @Expect(DTO.Number().required())
    public id: number
}

class OrderException extends Exception {
    public errno: string | number = 'E_ORDER'
}

class InteropController extends Controller {

    @ServiceAction({cmd: 'order.get'}, OrderDTO)
    public async get(input: OrderDTO): Promise<unknown> {
        return {id: input.id, client: (this.context as ServiceContext).clientId}
    }

    @ServiceAction({cmd: 'order.close'})
    public async close(): Promise<void> {
        throw new OrderException('The order is closed')
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<string> {
        await new Promise((resolve): unknown => setTimeout(resolve, 2000))
        return 'slow'
    }

    @ServiceAction({cmd: 'notify'})
    public async notify(input: { count: number }): Promise<boolean> {
        const clientId: string = (this.context as ServiceContext).clientId!
        setTimeout((): unknown => entrypoint.notify(clientId, 'pushed', {count: input.count}), 100)
        return true
    }
}

if (process.argv[2]) writeFileSync(process.argv[2], SERVICE_PROTO)
const container: Container = new Container()
//Used by the actions once the service listens
const entrypoint: Entrypoint = await container.set(Entrypoint, buildEntrypoints({
    controllers: [InteropController],
    service: grpcServiceEntrypoint({
        port: Number(process.env.PORT ?? 0),
        host: '0.0.0.0',
        maxMessageSize: 1024 * 1024,
        compression: 'gzip',
        listening: (address): void => console.log(`listening ${(address as AddressInfo).port}`)
    })
}))
process.on('SIGTERM', (): void => void container.destroy().then((): never => process.exit(0)))
