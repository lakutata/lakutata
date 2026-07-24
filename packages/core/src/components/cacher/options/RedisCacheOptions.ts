import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class RedisCacheOptions extends DTO {
    @Expect(DTO.String().allow('redis').only().required())
    public type: 'redis'

    @Expect(DTO.String().required())
    public host: string

    @Expect(DTO.Number().positive().port().optional().default(6379))
    public port?: number

    @Expect(DTO.Number().positive().allow(0).default(0).optional())
    public database?: number

    @Expect(DTO.Boolean().optional().default(false))
    public tls?: boolean

    @Expect(DTO.Number().positive().allow(0).optional())
    public keepAlive?: number

    @Expect(DTO.String().optional())
    public username?: string

    @Expect(DTO.String().optional())
    public password?: string

    @Expect(DTO.Boolean().optional().default(true))
    public reconnect?: boolean

    @Expect(DTO.String().optional())
    public namespace?: string

    @Expect(DTO.String().optional())
    public keyPrefixSeparator?: string

    @Expect(DTO.Number().positive().allow(0).optional())
    public clearBatchSize?: number

    @Expect(DTO.Boolean().optional())
    public useUnlink?: boolean

    @Expect(DTO.Boolean().optional())
    public noNamespaceAffectsAll?: boolean

    @Expect(DTO.Number().positive().optional())
    public connectTimeout?: number

    @Expect(DTO.Boolean().optional().default(true))
    public throwOnConnectError?: boolean
}