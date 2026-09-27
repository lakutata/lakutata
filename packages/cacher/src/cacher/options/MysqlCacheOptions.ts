import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class MysqlCacheOptions extends DTO {
    @Expect(DTO.String().allow('mysql').only().required())
    public type: 'mysql'

    @Expect(DTO.String().required())
    public host: string

    @Expect(DTO.String().required())
    public database: string

    @Expect(DTO.String().required())
    public table: string

    @Expect(DTO.Number().positive().port().optional().default(3306))
    public port?: number

    @Expect(DTO.String().required())
    public username: string

    @Expect(DTO.String().required())
    public password: string

    @Expect(DTO.String().optional())
    public namespace?: string
}