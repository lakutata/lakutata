import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class MemcacheCacheOptions extends DTO {
    @Expect(DTO.String().allow('memcache').only().required())
    public type: 'memcache'

    @Expect(DTO.String().required())
    public host: string

    @Expect(DTO.Number().positive().port().optional().default(11211))
    public port?: number

    @Expect(DTO.String().optional())
    public username?: string

    @Expect(DTO.String().optional())
    public password?: string

    @Expect(DTO.String().optional())
    public namespace?: string
}