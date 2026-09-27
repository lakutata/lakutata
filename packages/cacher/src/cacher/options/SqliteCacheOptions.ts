import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class SqliteCacheOptions extends DTO {
    @Expect(DTO.String().allow('sqlite').only().required())
    public type: 'sqlite'

    @Expect(DTO.String().required())
    public database: string

    @Expect(DTO.String().required())
    public table: string

    @Expect(DTO.Number().positive().integer().optional().default(10000))
    public busyTimeout?: number

    @Expect(DTO.String().optional())
    public namespace?: string
}