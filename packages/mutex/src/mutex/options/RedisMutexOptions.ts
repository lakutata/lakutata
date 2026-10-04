import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The locks of Redis (the package redis)
 */
export class RedisMutexOptions extends DTO {
    @Expect(DTO.String().valid('redis').required())
    public type: 'redis'

    /**
     * Its URL (redis://user:password@host:6379/0), instead of its host and its port
     */
    @Expect(DTO.String().optional())
    public url?: string

    @Expect(DTO.String().optional())
    public host?: string

    @Expect(DTO.Number().port().optional())
    public port?: number

    @Expect(DTO.Number().integer().min(0).optional())
    public database?: number

    @Expect(DTO.String().optional())
    public username?: string

    @Expect(DTO.String().optional())
    public password?: string

    @Expect(DTO.Boolean().optional())
    public tls?: boolean
}
