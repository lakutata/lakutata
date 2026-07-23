import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

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